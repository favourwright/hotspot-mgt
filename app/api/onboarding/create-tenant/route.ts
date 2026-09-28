import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import {
  createPaystackSubaccount,
  createPaystackCustomer,
  verifyPaystackPayment,
} from "@/lib/paystack";
import { isSlugAvailable } from "@/lib/firestore-helpers";
import { CreateTenantSchema } from "@/types/schemas";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";
import { getBillingPlanConfig } from "@/lib/platform-config";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyAuthenticated(authHeader);

    // Prevent creating multiple tenants
    if (verifiedUser.role === "owner") {
      return NextResponse.json(
        { success: false, error: "You already have a tenant account" },
        { status: 400 }
      );
    }

    if (verifiedUser.role === "superadmin") {
      return NextResponse.json(
        { success: false, error: "Superadmin cannot create a tenant" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validation = CreateTenantSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const {
      businessName,
      slug,
      billingPlan,
      accountNumber,
      bankCode,
      bankName,
      accountName,
      paystackReference,
    } = validation.data;

    // Check slug availability
    const slugAvailable = await isSlugAvailable(slug);
    if (!slugAvailable) {
      return NextResponse.json(
        { success: false, error: "This slug is already taken" },
        { status: 400 }
      );
    }

    // Get billing plan config
    const planConfig = await getBillingPlanConfig(billingPlan);

    // Paid tiers require proof of a successful first-month payment before
    // the tenant account is created/activated.
    let subscriptionStatus: "active" | null = null;
    let nextBillingDate: Date | null = null;

    if (planConfig.monthlyFee > 0) {
      if (!paystackReference) {
        return NextResponse.json(
          {
            success: false,
            error: "Payment is required to activate this billing plan.",
          },
          { status: 400 }
        );
      }

      const paymentResult = await verifyPaystackPayment(paystackReference);

      if (!paymentResult.success || !paymentResult.data) {
        return NextResponse.json(
          {
            success: false,
            error: paymentResult.error || "Payment verification failed.",
          },
          { status: 400 }
        );
      }

      if (paymentResult.data.amount !== planConfig.monthlyFee) {
        return NextResponse.json(
          { success: false, error: "Payment amount does not match the selected plan." },
          { status: 400 }
        );
      }

      if (
        paymentResult.data.customerEmail.toLowerCase() !==
        verifiedUser.email.toLowerCase()
      ) {
        return NextResponse.json(
          { success: false, error: "Payment does not belong to this account." },
          { status: 400 }
        );
      }

      subscriptionStatus = "active";
      nextBillingDate = new Date();
      nextBillingDate.setDate(nextBillingDate.getDate() + 30);
    }

    // Create Paystack customer for owner
    const customerResult = await createPaystackCustomer({
      email: verifiedUser.email,
    });

    if (!customerResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to create billing account: ${customerResult.error}`,
        },
        { status: 500 }
      );
    }

    // Create Paystack subaccount for revenue split
    const subaccountResult = await createPaystackSubaccount({
      businessName,
      bankCode,
      accountNumber,
      percentageCharge: planConfig.platformFeePercent,
    });

    if (!subaccountResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to create payment account: ${subaccountResult.error}`,
        },
        { status: 500 }
      );
    }

    // Create tenant document in Firestore
    const tenantRef = adminDb.collection(COLLECTIONS.TENANTS).doc();
    await tenantRef.set({
      slug,
      businessName,
      ownerUid: verifiedUser.uid,
      ownerEmail: verifiedUser.email,
      status: "active",
      billingPlan,
      platformFeePercent: planConfig.platformFeePercent,
      monthlyFee: planConfig.monthlyFee,
      paystackCustomerCode: customerResult.data!.customerCode,
      paystackSubscriptionCode: null, // populated by the subscription.create webhook
      subscriptionStatus,
      nextBillingDate,
      paystackSubaccountCode: subaccountResult.data!.subaccountCode,
      bankName,
      accountNumber,
      accountName,
      wireguardPublicKey: null,
      wireguardTunnelIp: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Upgrade user to owner role and set tenantId
    await adminDb
      .collection(COLLECTIONS.USERS)
      .doc(verifiedUser.uid)
      .update({
        role: "owner",
        tenantId: tenantRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      });

    return NextResponse.json({
      success: true,
      data: {
        tenantId: tenantRef.id,
        slug,
        billingPlan,
        requiresSubscriptionPayment: planConfig.monthlyFee > 0,
        monthlyFee: planConfig.monthlyFee,
      },
    });
  } catch (error) {
    console.error("Create tenant error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
