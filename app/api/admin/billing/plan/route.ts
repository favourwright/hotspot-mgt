/**
 * A tenant owner moving themselves to a different billing plan.
 *
 * Owner-only and scoped by their own claims, exactly like the subscription
 * route beside it - there is no slug to spoof and no way to re-tier somebody
 * else. A superadmin has their own path at
 * `/api/superadmin/tenants/[id]/billing`; they cannot use this one, because
 * `verifyOwnerWithTenant` gives them no tenant.
 *
 * GET lists what they could move to, with the cost of each move.
 * PATCH performs it.
 *
 * ## Deliberately not behind the billing lock
 *
 * This is one of the three ways out of it. A tenant who cannot afford their
 * current tier has to be able to reach a cheaper one, or the only remaining
 * option is to abandon the account - which collects nothing and loses the
 * customer. See `lib/billing-lock.ts`.
 *
 * ## Paid time and commission
 *
 * Nothing is prorated: time already paid for stands, and the new fee applies from the
 * next payment (`paidThroughAfterPlanChange`, lib/plan-change.ts). Nothing renews by
 * itself, so there is no subscription to move.
 *
 * The commission is the tenant's `platformFeePercent`, which Knomad Pay sales read on
 * every charge (app/api/purchase/initiate), so changing it here is the whole change.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import {
  getAllBillingPlans,
  getBillingPlanById,
  toPublicBillingPlan,
} from "@/lib/billing-plans";
import { getActiveCustomerCount } from "@/lib/firestore-helpers";
import { getCachedTenantStats } from "@/lib/stats-cache";
import {
  describePlanDowngrade,
  paidThroughAfterPlanChange,
  type TenantUsage,
} from "@/lib/plan-change";
import { invalidateTenant } from "@/lib/tenant-cache";
import { invalidateBillingLock } from "@/lib/billing-lock";

const patchSchema = z.object({
  planId: z.string().min(1, "Plan is required"),
  /**
   * Set by the dialog only once the owner has ticked the box saying they
   * understand what stops being possible. Required whenever the move would
   * put them over a limit, and ignored when it would not - so a client that
   * sends it blindly cannot turn a clean change into a warned one.
   */
  acceptFrozenLimits: z.boolean().default(false),
});

/** The three counts any plan limit is measured against. */
async function readUsage(tenantId: string): Promise<TenantUsage> {
  const [stats, customers] = await Promise.all([
    getCachedTenantStats(tenantId),
    getActiveCustomerCount(tenantId),
  ]);
  return {
    routers: stats.routerCount,
    locations: stats.locationCount,
    customers,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(
      request.headers.get("authorization")
    );

    const tenantDoc = await adminDb
      .collection(COLLECTIONS.TENANTS)
      .doc(tenantId)
      .get();
    const tenant = tenantDoc.data();
    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    const [plans, usage] = await Promise.all([
      // Archived plans excluded: a tenant already on one keeps it, because
      // their `planId` still resolves, but nobody may move onto a tier that
      // has been withdrawn from sale.
      getAllBillingPlans({ activeOnly: true }),
      readUsage(tenantId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        currentPlanId: tenant.planId ?? null,
        usage,
        plans: plans.map((plan) => ({
          ...toPublicBillingPlan(plan),
          // Computed per plan rather than left to the browser, so the
          // warning shown and the check that enforces it are the same code.
          breaches:
            plan.id === tenant.planId ? [] : describePlanDowngrade(usage, plan),
        })),
      },
    });
  } catch (error) {
    console.error("GET billing plan error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(
      request.headers.get("authorization")
    );

    const validation = patchSchema.safeParse(await request.json());
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

    if (tenant.planId === validation.data.planId) {
      return NextResponse.json(
        { success: false, error: "You're already on that plan." },
        { status: 409 }
      );
    }

    const plan = await getBillingPlanById(validation.data.planId);
    if (!plan || plan.archivedAt !== null) {
      return NextResponse.json(
        { success: false, error: "That plan isn't available." },
        { status: 404 }
      );
    }

    // Re-measured against the live counts, not the ones the dialog was
    // rendered from. A router added while the dialog sat open is exactly
    // the case where the acknowledgement they gave no longer covers what
    // they are agreeing to.
    const usage = await readUsage(tenantId);
    const breaches = describePlanDowngrade(usage, plan);

    if (breaches.length > 0 && !validation.data.acceptFrozenLimits) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This plan is smaller than your current setup. Confirm you understand what it pauses before continuing.",
          data: { breaches },
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const paidThrough = paidThroughAfterPlanChange({
      oldMonthlyFee: tenant.monthlyFee ?? 0,
      newMonthlyFee: plan.monthlyFee,
      paidThrough: tenant.nextBillingDate?.toDate?.() ?? null,
      now,
    });

    await tenantRef.update({
      nextBillingDate: paidThrough,
      planId: plan.id,
      planName: plan.name,
      // Snapshotted, the same as at signup: this is the price they agreed
      // to, and a later edit of the plan must not retroactively change what
      // they are billed.
      monthlyFee: plan.monthlyFee,
      platformFeePercent: plan.platformFeePercent,
      updatedAt: now,
    });

    // The tenant document is cached for the portal and every admin page, so
    // without this the old plan name and fee survive the change.
    invalidateTenant(tenant.slug);
    // Moving to a free plan clears a lock outright (`no-fee` outranks
    // everything), and moving to a paid one can create the conditions for
    // the next one. Either way the cached answer is now wrong.
    invalidateBillingLock(tenantId);

    return NextResponse.json({
      success: true,
      data: {
        planId: plan.id,
        planName: plan.name,
        monthlyFee: plan.monthlyFee,
        breaches,
        paidThrough: paidThrough?.toISOString() ?? null,
        paidAhead: paidThrough !== null && paidThrough.getTime() > now.getTime(),
      },
    });
  } catch (error) {
    console.error("PATCH billing plan error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
