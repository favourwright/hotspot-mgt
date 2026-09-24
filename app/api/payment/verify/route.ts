import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { verifyPaystackPayment } from "@/lib/paystack";
import { createHotspotUser, generateVoucherCredentials } from "@/lib/mikrotik";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";
import { parsePlan, parseLocation } from "@/lib/firestore-helpers";

const verifySchema = z.object({
  reference: z.string().min(1),
  planId: z.string().min(1),
  locationId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    // Verify Firebase token
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userId = decodedToken.uid;
    const userEmail = decodedToken.email;

    // Validate input
    const body = await request.json();
    const validation = verifySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { reference, planId, locationId } = validation.data;

    // Check if reference already processed (idempotency)
    const existingPayment = await adminDb
      .collection(COLLECTIONS.PAYMENTS)
      .where("reference", "==", reference)
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

    // Fetch plan
    const planDoc = await adminDb.collection(COLLECTIONS.PLANS).doc(planId).get();
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
    const locationDoc = await adminDb.collection(COLLECTIONS.LOCATIONS).doc(locationId).get();
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
    const paymentRef = adminDb.collection(COLLECTIONS.PAYMENTS).doc();
    await paymentRef.set({
      userId,
      userEmail,
      planId,
      locationId,
      reference,
      amount: paymentData.amount,
      status: "success",
      paystackData: {
        customerEmail: paymentData.customerEmail,
        paidAt: paymentData.paidAt,
      },
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
      comment: "vc", // Mark as unactivated voucher
    });

    const voucherRef = adminDb.collection(COLLECTIONS.VOUCHERS).doc();

    if (mikrotikResult.success) {
      // Success - create active voucher
      await voucherRef.set({
        userId,
        userEmail,
        planId,
        planName: plan.name || 'Unknown Plan',
        locationId,
        locationName: location.name || 'Unknown Location',
        username: credentials.username,
        password: credentials.password,
        price: plan.price,
        duration: plan.duration,
        dataLimit: plan.dataLimit || null,
        status: "active",
        paystackReference: reference,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: null, // Could calculate based on duration if needed
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
        planName: plan.name || 'Unknown Plan',
        locationId,
        locationName: location.name || 'Unknown Location',
        username: credentials.username,
        password: credentials.password,
        price: plan.price,
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
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
