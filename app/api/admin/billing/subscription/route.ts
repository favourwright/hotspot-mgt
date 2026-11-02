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
 *
 * ## Two ways to pay, and why they are not the same charge
 *
 * `subscribe` is the ordinary one: the fee is owed now, so Paystack Inline
 * opens the Plan, charges, and the subscription starts immediately.
 *
 * `prepay` is for a tenant still inside a trial or promo who wants to settle
 * up before it closes. Opening the Plan for them would charge today and
 * start billing today, throwing away the free days they were given. So the
 * charge is a plain one-off for a single month, and the recurring
 * subscription is created server-side with a `start_date` one interval after
 * the waiver closes - they keep every free day, the month they just bought
 * covers the first month after it, and renewal picks up from there.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { ensureFeeInclusivePlanCodeForBillingPlan } from "@/lib/billing-plans";
import {
  getPlanFeeState,
  PLAN_FEE_PREPAY_PURPOSE,
} from "@/lib/fee-waivers";
import {
  verifyPaystackPayment,
  fetchPaystackSubscription,
  disablePaystackSubscription,
  createPaystackSubscription,
} from "@/lib/paystack";
import { linkPlatformSubscriptionIfMissing } from "@/lib/subscription-index";
import { invalidateBillingLock } from "@/lib/billing-lock";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimatePaystackFee } from "@/lib/paystack-fees";
import { getBillingPlanById } from "@/lib/billing-plans";
import { z } from "zod";

const activateSchema = z.object({
  paystackReference: z.string().min(1, "Payment reference is required"),
  /**
   * Which of the two charges this was. Defaults to `subscribe` so an older
   * client that does not send it behaves exactly as before.
   */
  intent: z.enum(["subscribe", "prepay"]).default("subscribe"),
});

/**
 * One billing interval. Paystack's monthly plans are what this mirrors, and
 * it is the same 30 days the rest of the app already uses for
 * `nextBillingDate`.
 */
const BILLING_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;


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

    // Exactly two states can be paid from, and they are paid differently.
    // Anything else - a free plan, a live subscription, a card Paystack is
    // already retrying - has nothing to charge, and handing a Plan code to a
    // tenant Paystack is already billing is how a second subscription for
    // the same plan gets created.
    const prepay = state.status === "waived" && state.waiverEndsAt !== null;

    if (state.status !== "payment-due" && !prepay) {
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

    if (prepay) {
      const recurringFrom = new Date(
        state.waiverEndsAt!.getTime() + BILLING_INTERVAL_MS
      );

      // No `planCode` in the response, deliberately. The browser must open a
      // plain amount here: handing Inline a Plan is what would subscribe
      // them today and cancel out the free days they are trying to keep.
      return NextResponse.json({
        success: true,
        data: {
          mode: "prepay",
          amount,
          purpose: PLAN_FEE_PREPAY_PURPOSE,
          coversFrom: state.waiverEndsAt!.toISOString(),
          recurringFrom: recurringFrom.toISOString(),
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: { mode: "subscribe", planCode, amount },
    });
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

    if (validation.data.intent === "prepay") {
      // Re-resolved rather than trusted from the request: the client said
      // this was a prepayment, but whether there is still a waiver to
      // prepay against is ours to decide. A waiver that closed while the
      // Paystack popup was open makes this an ordinary payment instead.
      const state = await getPlanFeeState(tenantId);
      if (state?.status !== "waived" || !state.waiverEndsAt) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Your free period has already ended, so this was charged as a normal payment. Reload to see your plan.",
          },
          { status: 409 }
        );
      }

      const recurringFrom = new Date(
        state.waiverEndsAt.getTime() + BILLING_INTERVAL_MS
      );

      // Both are needed to schedule, and neither is guaranteed: a bank
      // transfer or USSD charge is never tokenised. The month they paid for
      // still stands, so this records it and says plainly that renewal is
      // not set up, rather than failing a payment that already succeeded.
      const customerCode = payment.data.customerCode;
      const authorizationCode = payment.data.authorizationCode;

      if (!customerCode || !authorizationCode) {
        await tenantRef.update({
          subscriptionStatus: "active",
          nextBillingDate: recurringFrom,
          updatedAt: new Date(),
        });
        return NextResponse.json({
          success: true,
          data: {
            nextBillingDate: recurringFrom,
            scheduled: false,
            notice:
              "Your payment is recorded, but this payment method can't be charged automatically. We'll ask you again before it renews.",
          },
        });
      }

      const { planCode } = await ensureFeeInclusivePlanCodeForBillingPlan(
        tenant.planId
      );
      if (!planCode) {
        return NextResponse.json(
          { success: false, error: "This plan can't be charged for." },
          { status: 409 }
        );
      }

      const subscription = await createPaystackSubscription({
        customerCode,
        planCode,
        authorizationCode,
        startDate: recurringFrom,
      });

      if (!subscription.success || !subscription.data) {
        // The charge is real and theirs either way. Record it, and let the
        // plan-fee-due job pick them up at the end of the month they bought
        // if the schedule never got made.
        await tenantRef.update({
          subscriptionStatus: "active",
          nextBillingDate: recurringFrom,
          updatedAt: new Date(),
        });
        console.error(
          `[billing] prepay for ${tenantId} charged but not scheduled: ${subscription.error}`
        );
        return NextResponse.json({
          success: true,
          data: {
            nextBillingDate: recurringFrom,
            scheduled: false,
            notice:
              "Your payment is recorded. We couldn't set up automatic renewal, so we'll ask you again before it's due.",
          },
        });
      }

      // Written here rather than left to the webhook, which is the opposite
      // of the rule below and for a reason that only holds in this branch:
      // we created this subscription ourselves and the API handed the code
      // straight back, so there is nothing to infer and no addon
      // subscription it could be confused with.
      await linkPlatformSubscriptionIfMissing(
        subscription.data.subscriptionCode,
        tenantId
      );

      await tenantRef.update({
        subscriptionStatus: "active",
        paystackSubscriptionCode: subscription.data.subscriptionCode,
        nextBillingDate: recurringFrom,
        updatedAt: new Date(),
      });

      // Nothing was locked (a waiver was live), but a tenant who prepaid and
      // then watched the waiver close would otherwise be told their sales
      // had paused for up to a minute.
      invalidateBillingLock(tenantId);

      return NextResponse.json({
        success: true,
        data: { nextBillingDate: recurringFrom, scheduled: true },
      });
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

    // This is the moment a locked tenant is unlocked, and they are looking
    // at the screen when it happens. Waiting out the cache TTL here would
    // mean paying and then watching the next sale still fail.
    invalidateBillingLock(tenantId);

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
            "Could not reach our payment provider to cancel this subscription.",
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
