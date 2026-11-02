/**
 * Moving a tenant's Paystack subscription when they change billing plan.
 *
 * The rules are in `lib/plan-change.ts`, kept free of I/O so they can be tested;
 * this carries them out. It comes in two halves so a caller can do other work
 * in between: `prepare` only reads, so a failure there has changed nothing, and
 * `apply` is the first thing that touches the subscription.
 *
 * `apply` stops the old subscription before creating the new one. If creating
 * it fails, the tenant has no renewal and is asked to pay by hand. The other
 * order could leave two live subscriptions charging the same card.
 *
 * Neither half writes the plan. `apply` returns the fields for the caller to
 * include in its own update, so the plan and its billing land in one write.
 */

import type { DocumentReference } from "firebase-admin/firestore";

import { ensureFeeInclusivePlanCodeForBillingPlan } from "@/lib/billing-plans";
import {
  createPaystackSubscription,
  disablePaystackSubscription,
  fetchPaystackSubscription,
} from "@/lib/paystack";
import {
  decideSubscriptionMove,
  hasLivePlatformSubscription,
  type SubscriptionMove,
} from "@/lib/plan-change";
import { linkPlatformSubscriptionIfMissing } from "@/lib/subscription-index";

type TenantBilling = {
  subscriptionStatus?: string | null;
  paystackSubscriptionCode?: string | null;
};

export type PreparedSubscriptionMove =
  | { ok: true; move: { action: "none" } }
  | {
      ok: true;
      move: Exclude<SubscriptionMove, { action: "none" }>;
      code: string;
      emailToken: string;
      /** Null when a replacement cannot be scheduled. Not a reason to abort. */
      schedule: {
        customerCode: string;
        authorizationCode: string;
        planCode: string;
      } | null;
    };

export type PrepareResult = PreparedSubscriptionMove | { ok: false; error: string };

export type ApplyResult =
  | {
      ok: true;
      action: SubscriptionMove["action"];
      /** To include in the caller's tenant update. */
      fields: Record<string, unknown>;
      nextBillingDate: Date | null;
      /** Whether automatic renewal is set up on the new plan. */
      scheduled: boolean;
    }
  | { ok: false; error: string };

export async function prepareSubscriptionMove(
  tenant: TenantBilling & { [key: string]: unknown },
  plan: { id: string; monthlyFee: number },
  now: Date = new Date()
): Promise<PrepareResult> {
  // A superadmin can re-save a tenant's current plan to refresh its snapshot.
  // That is not a move, and must not replace the subscription behind it.
  if (tenant.planId === plan.id || !hasLivePlatformSubscription(tenant)) {
    return { ok: true, move: { action: "none" } };
  }

  const code = tenant.paystackSubscriptionCode as string;
  const fetched = await fetchPaystackSubscription(code);
  if (!fetched.success || !fetched.data) {
    return { ok: false, error: fetched.error ?? "Could not read subscription" };
  }

  const { data } = fetched;
  const move = decideSubscriptionMove({
    subscriptionStatus: tenant.subscriptionStatus ?? null,
    paystackStatus: data.status,
    nextPaymentDate: data.nextPaymentDate ? new Date(data.nextPaymentDate) : null,
    newMonthlyFee: plan.monthlyFee,
    now,
  });

  if (move.action === "none") return { ok: true, move };

  if (!data.emailToken) {
    return { ok: false, error: "Paystack returned no token to stop the subscription" };
  }

  let schedule = null;
  if (move.action === "reschedule" && data.customerCode && data.authorizationCode) {
    try {
      const { planCode } = await ensureFeeInclusivePlanCodeForBillingPlan(plan.id);
      if (planCode) {
        schedule = {
          customerCode: data.customerCode,
          authorizationCode: data.authorizationCode,
          planCode,
        };
      }
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  return {
    ok: true,
    move,
    code,
    emailToken: data.emailToken,
    schedule,
  };
}

export async function applySubscriptionMove(
  tenantRef: DocumentReference,
  prepared: PreparedSubscriptionMove
): Promise<ApplyResult> {
  if (prepared.move.action === "none") {
    return {
      ok: true,
      action: "none",
      fields: {},
      nextBillingDate: null,
      scheduled: false,
    };
  }

  const { move, code, emailToken, schedule } = prepared as Extract<
    PreparedSubscriptionMove,
    { code: string }
  >;

  // Before the call, because Paystack's webhook can arrive before it returns.
  await tenantRef.update({ supersededSubscriptionCode: code });

  const stopped = await disablePaystackSubscription(code, emailToken);
  if (!stopped.success) {
    await tenantRef.update({ supersededSubscriptionCode: null });
    return { ok: false, error: stopped.error ?? "Could not stop subscription" };
  }

  if (move.action === "stop") {
    return {
      ok: true,
      action: "stop",
      fields: { subscriptionStatus: "cancelled", paystackSubscriptionCode: null },
      nextBillingDate: null,
      scheduled: false,
    };
  }

  // The paid period stands whatever happens next: as `active` if the
  // replacement exists, otherwise as `cancelled`, which reads as `ending`
  // until this date and asks the owner to pay after it.
  const unscheduled: ApplyResult = {
    ok: true,
    action: "reschedule",
    fields: {
      subscriptionStatus: "cancelled",
      paystackSubscriptionCode: null,
      nextBillingDate: move.startDate,
    },
    nextBillingDate: move.startDate,
    scheduled: false,
  };

  if (!schedule) return unscheduled;

  const created = await createPaystackSubscription({
    ...schedule,
    startDate: move.startDate,
  });
  if (!created.success || !created.data) {
    console.error(
      `[billing] ${tenantRef.id}: old subscription stopped, new one not created: ${created.error}`
    );
    return unscheduled;
  }

  await linkPlatformSubscriptionIfMissing(
    created.data.subscriptionCode,
    tenantRef.id
  );

  return {
    ok: true,
    action: "reschedule",
    fields: {
      subscriptionStatus: "active",
      paystackSubscriptionCode: created.data.subscriptionCode,
      nextBillingDate: move.startDate,
    },
    nextBillingDate: move.startDate,
    scheduled: true,
  };
}
