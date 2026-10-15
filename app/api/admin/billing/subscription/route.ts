/**
 * A tenant owner starting, resuming or cancelling their own plan payment.
 *
 * Owner-only, never superadmin: `verifyOwnerWithTenant` takes the tenant
 * from the caller's own claims, so there is no slug to spoof and no way to
 * act on somebody else's billing. A superadmin looking at a tenant's
 * settings page sees the state and no buttons, the same arrangement the
 * email card already uses.
 *
 * GET prepares a charge (the Paystack Plan code and the real amount).
 * POST verifies one that succeeded.
 * DELETE cancels the subscription at Paystack.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { ensureFeeInclusivePlanCodeForBillingPlan } from "@/lib/billing-plans";
import { getPlanFeeState } from "@/lib/fee-waivers";
import {
  verifyPaystackPayment,
  fetchPaystackSubscription,
  disablePaystackSubscription,
} from "@/lib/paystack";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimatePaystackFee } from "@/lib/paystack-fees";
import { getBillingPlanById } from "@/lib/billing-plans";
import { z } from "zod";

const activateSchema = z.object({
  paystackReference: z.string().min(1, "Payment reference is required"),
});

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(
      request.headers.get("authorization")
    );

    const state = await getPlanFeeState(tenantId);
    if (!state) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    // Only ever prepare a charge for someone who actually owes one. Handing
    // a Plan code to a tenant Paystack is already billing is how a second
    // subscription for the same plan gets created.
    if (state.status !== "payment-due") {
      return NextResponse.json(
        { success: false, error: "There is nothing to pay right now." },
        { status: 409 }
      );
    }

    const tenantDoc = await adminDb
      .collection(COLLECTIONS.TENANTS)
      .doc(tenantId)
      .get();
    const planId = tenantDoc.data()?.planId;

    const { planCode, amount } =
      await ensureFeeInclusivePlanCodeForBillingPlan(planId);

    if (!planCode) {
      return NextResponse.json(
        { success: false, error: "This plan can't be charged for." },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, data: { planCode, amount } });
  } catch (error) {
    console.error("GET billing subscription error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const caller = await verifyOwnerWithTenant(
      request.headers.get("authorization")
    );
    const { tenantId } = caller;

    const validation = activateSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const tenantRef = adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId);
    const tenant = (await tenantRef.get()).data();
    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    const plan = await getBillingPlanById(tenant.planId);
    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Billing plan not found" },
        { status: 404 }
      );
    }

    // The same two checks onboarding makes, for the same reason: the client
    // reporting a successful charge is not evidence of one, and a reference
    // belonging to somebody else is not evidence either.
    const payment = await verifyPaystackPayment(
      validation.data.paystackReference
    );
    if (!payment.success || !payment.data) {
      return NextResponse.json(
        { success: false, error: payment.error || "Payment verification failed." },
        { status: 400 }
      );
    }

    const platformConfig = await getPlatformConfig();
    const expectedFee = estimatePaystackFee(
      plan.monthlyFee,
      platformConfig.paystackFeePassthrough
    );
    if (payment.data.amount !== plan.monthlyFee + expectedFee) {
      return NextResponse.json(
        { success: false, error: "Payment amount does not match your plan." },
        { status: 400 }
      );
    }

    if (
      payment.data.customerEmail.toLowerCase() !== caller.email.toLowerCase()
    ) {
      return NextResponse.json(
        { success: false, error: "That payment does not belong to this account." },
        { status: 400 }
      );
    }

    const nextBillingDate = new Date();
    nextBillingDate.setDate(nextBillingDate.getDate() + 30);

    // `paystackSubscriptionCode` is left alone: the subscription.create
    // webhook populates it, routed by subscription code through
    // subscriptionIndex. Guessing it here is how an addon's subscription
    // ends up recorded as the platform one.
    await tenantRef.update({
      subscriptionStatus: "active",
      nextBillingDate,
      updatedAt: new Date(),
    });

    return NextResponse.json({ success: true, data: { nextBillingDate } });
  } catch (error) {
    console.error("POST billing subscription error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(
      request.headers.get("authorization")
    );

    const tenant = (
      await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).get()
    ).data();
    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    // This tenant's **platform** subscription, read from their own document.
    // Never resolved from the Paystack customer code, which is shared with
    // every addon subscription they own - cancelling by customer would take
    // their captive portal down along with their plan.
    const code = tenant.paystackSubscriptionCode;
    if (!code) {
      return NextResponse.json(
        { success: false, error: "There is no active subscription to cancel." },
        { status: 409 }
      );
    }

    const subscription = await fetchPaystackSubscription(code);
    if (!subscription.success || !subscription.data?.emailToken) {
      return NextResponse.json(
        {
          success: false,
          error:
            subscription.error ||
            "Could not reach Paystack to cancel this subscription.",
        },
        { status: 502 }
      );
    }

    const result = await disablePaystackSubscription(
      code,
      subscription.data.emailToken
    );
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error ?? "Could not cancel" },
        { status: 502 }
      );
    }

    // Nothing is written here on purpose. Paystack's `subscription.disable`
    // webhook sets `subscriptionStatus` and sends the cancellation email;
    // doing it here too would either drift from that or send the email
    // twice. The UI says "requested" rather than pretending it is done.
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE billing subscription error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
