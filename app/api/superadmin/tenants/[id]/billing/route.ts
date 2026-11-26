/**
 * The superadmin's view of, and controls over, one tenant's billing.
 *
 * Everything here is superadmin-only and server-side. None of it is exposed
 * to a tenant: a tenant who could call these would be assigning themselves a
 * free plan, waiving their own bill, or granting themselves a paid addon.
 *
 * GET returns the whole picture in one read: plan, waivers, addons, payee.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { getBillingPlanById, getAllBillingPlans } from "@/lib/billing-plans";
import { getEffectiveBilling, listFeeWaivers } from "@/lib/fee-waivers";
import { paidThroughAfterPlanChange } from "@/lib/plan-change";
import { invalidateBillingLock } from "@/lib/billing-lock";
import { ADDON_KEYS } from "@/lib/addon-catalog";
import { getEntitlement, getEntitlementState } from "@/lib/entitlements";
import { z } from "zod";

const patchSchema = z.object({
  planId: z.string().min(1, "Plan is required"),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));
    const { id: tenantId } = await params;

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

    const [billing, waivers, plans] = await Promise.all([
      getEffectiveBilling(tenantId),
      listFeeWaivers(tenantId),
      getAllBillingPlans(),
    ]);

    // Every addon, with why the tenant does or does not have it. The reason
    // matters more than the boolean here: "included-in-plan" and "purchased"
    // need completely different actions from whoever is looking.
    const entitlements = await Promise.all(
      ADDON_KEYS.map(async (key) => {
        const [state, entitlement] = await Promise.all([
          getEntitlementState(tenantId, key),
          getEntitlement(tenantId, key),
        ]);
        return {
          addonKey: key,
          entitled: state.entitled,
          reason: state.reason,
          // A comp and a sale both resolve to "purchased", so the reason
          // alone cannot tell them apart - and only a comp may be withdrawn
          // from here.
          source: entitlement?.source ?? null,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: {
        tenant: {
          id: tenantId,
          slug: tenant.slug,
          businessName: tenant.businessName,
          planId: tenant.planId ?? "",
          planName: tenant.planName ?? "",
          monthlyFee: tenant.monthlyFee ?? 0,
          platformFeePercent: tenant.platformFeePercent ?? 0,
          paidThrough: tenant.nextBillingDate?.toDate?.()?.toISOString() ?? null,
          knomadPayeeReference: tenant.knomadPayeeReference ?? null,
        },
        billing,
        waivers,
        entitlements,
        plans: plans.map((p) => ({
          id: p.id,
          name: p.name,
          monthlyFee: p.monthlyFee,
          platformFeePercent: p.platformFeePercent,
          active: p.active,
        })),
      },
    });
  } catch (error) {
    console.error("GET tenant billing error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

/**
 * Move a tenant onto a different plan.
 *
 * Re-snapshots `platformFeePercent` and `monthlyFee`, because those are
 * stored on the tenant and are what the rest of the app reads.
 *
 * There is no provider-side split to move: each sale's commission
 * is read from `platformFeePercent` when it is charged, so the new plan's rate applies
 * from the next sale. Paid time stands (`paidThroughAfterPlanChange`, lib/plan-change.ts);
 * nothing renews by itself, so there is no subscription to move.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));
    const { id: tenantId } = await params;

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

    const plan = await getBillingPlanById(validation.data.planId);
    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
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
      platformFeePercent: plan.platformFeePercent,
      monthlyFee: plan.monthlyFee,
      updatedAt: new Date(),
    });

    invalidateBillingLock(tenantId);

    return NextResponse.json({
      success: true,
      data: {
        planId: plan.id,
        paidThrough: paidThrough?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("PATCH tenant billing error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
