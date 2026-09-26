import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifyPaystackPayment } from "@/lib/paystack";
import { createHotspotUser, generateVoucherCredentials } from "@/lib/mikrotik";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { FieldValue } from "firebase-admin/firestore";
import { parsePlan, parseLocation } from "@/lib/firestore-helpers";

const verifySchema = z.object({
  reference: z.string().min(1),
  planId: z.string().min(1),
  locationId: z.string().min(1),
  tenantId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    // Verify Firebase token
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyAuthenticated(authHeader);
    const userId = verifiedUser.uid;
    const userEmail = verifiedUser.email;

    // Validate input
    const body = await request.json();
    const validation = verifySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { reference, planId, locationId, tenantId } = validation.data;

    // Check if reference already processed (idempotency)
    const existingPayment = await adminDb
      .collection(TENANT_COLLECTIONS.payments(tenantId))
      .where("paystackReference", "==", reference)
      .limit(1)
      .get();

    if (!existingPayment.empty) {
      const payment = existingPayment.docs[0].data();
      return NextResponse.json({
        success: true,
        data: { voucherId: payment.voucherId, alreadyProcessed: true },
      });
    }

    // Verify payment with Paystack
    const paymentResult = await verifyPaystackPayment(reference);
    if (!paymentResult.success) {
      return NextResponse.json(
        { success: false, error: "Payment verification failed" },
        { status: 400 }
      );
    }

    const paymentData = paymentResult.data!;

    // Fetch tenant to verify subaccount
    const tenantDoc = await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    const tenantData = tenantDoc.data()!;

    // Verify subaccount was applied if tenant has one
    if (
      tenantData.paystackSubaccountCode &&
      paymentData.subaccount?.subaccountCode !== tenantData.paystackSubaccountCode
    ) {
      // Log the mismatch for admin visibility
      // but do NOT block the payment — the customer
      // already paid and blocking would be worse.
      // Admin can investigate via Paystack dashboard.
      console.warn("Subaccount mismatch on payment:", {
        reference,
        expected: tenantData.paystackSubaccountCode,
        received: paymentData.subaccount?.subaccountCode,
      });
    }

    // Fetch plan
    const planDoc = await adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).doc(planId).get();
    const plan = parsePlan(planDoc);
    
    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    // Verify plan is active
    if (!plan.active) {
      return NextResponse.json(
        { success: false, error: "Plan is no longer active" },
        { status: 400 }
      );
    }

    // Verify price matches (amount is in kobo from Paystack)
    if (paymentData.amount !== plan.price) {
      return NextResponse.json(
        { success: false, error: "Payment amount does not match plan price" },
        { status: 400 }
      );
    }

    // Fetch location with router credentials
    const locationDoc = await adminDb.collection(TENANT_COLLECTIONS.locations(tenantId)).doc(locationId).get();
    const location = parseLocation(locationDoc);

    if (!location) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    // Verify location is active
    if (!location.active) {
      return NextResponse.json(
        { success: false, error: "Location is no longer active" },
        { status: 400 }
      );
    }

    // Generate voucher credentials (using sameCredentials setting from plan)
    const credentials = generateVoucherCredentials(plan.sameCredentials ?? true);

    // Create payment document
    const paymentRef = adminDb.collection(TENANT_COLLECTIONS.payments(tenantId)).doc();
    await paymentRef.set({
      userId,
      userEmail,
      planId,
      planName: plan.name,
      locationId,
      locationName: location.name,
      tenantId,
      amount: paymentData.amount,
      paystackReference: reference,
      status: "success",
      subaccountCode: paymentData.subaccount?.subaccountCode || null,
      platformShareKobo: paymentData.subaccount
        ? paymentData.amount - (paymentData.subaccount.shareOfSettlement || 0)
        : 0,
      tenantShareKobo: paymentData.subaccount?.shareOfSettlement || paymentData.amount,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Attempt to create hotspot user on MikroTik
    const routerConfig = {
      ip: location.routerIp,
      username: location.routerUser,
      password: location.routerPass,
    };

    const mikrotikResult = await createHotspotUser(routerConfig, {
      username: credentials.username,
      password: credentials.password,
      profile: plan.mikrotikProfile,
      comment: "vc",
    });

    const voucherRef = adminDb.collection(TENANT_COLLECTIONS.vouchers(tenantId)).doc();

    if (mikrotikResult.success) {
      // Success - create active voucher
      await voucherRef.set({
        userId,
        userEmail,
        planId,
        planName: plan.name,
        locationId,
        locationName: location.name,
        tenantId,
        username: credentials.username,
        password: credentials.password,
        duration: plan.duration,
        dataLimit: plan.dataLimit || null,
        status: "active",
        paystackReference: reference,
        retryCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: null,
      });

      // Update payment with voucherId
      await paymentRef.update({
        voucherId: voucherRef.id,
      });

      return NextResponse.json({
        success: true,
        data: { voucherId: voucherRef.id },
      });
    } else {
      // MikroTik failed - create failed voucher for admin retry
      await voucherRef.set({
        userId,
        userEmail,
        planId,
        planName: plan.name,
        locationId,
        locationName: location.name,
        tenantId,
        username: credentials.username,
        password: credentials.password,
        duration: plan.duration,
        dataLimit: plan.dataLimit || null,
        status: "failed",
        failureReason: mikrotikResult.error || "Unknown error",
        paystackReference: reference,
        retryCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: null,
      });

      // Update payment with voucherId
      await paymentRef.update({
        voucherId: voucherRef.id,
      });

      // Return success with failed flag - payment succeeded, voucher pending
      return NextResponse.json({
        success: true,
        data: { voucherId: voucherRef.id, failed: true },
      });
    }
  } catch (error) {
    console.error("Payment verification error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
