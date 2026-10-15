/**
 * The superadmin's view of, and controls over, one tenant's billing.
 *
 * Everything here is superadmin-only and server-side. None of it is exposed
 * to a tenant: a tenant who could call these would be assigning themselves a
 * free plan, waiving their own bill, or granting themselves a paid addon.
 *
 * GET returns the whole picture in one read, including what Paystack is
 * actually applying, because the stored split and the plan's fee drift apart
 * by design (see docs/billing-and-payments.md) and the only way to see that
 * is to ask Paystack.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { getBillingPlanById, getAllBillingPlans } from "@/lib/billing-plans";
import { getEffectiveBilling, listFeeWaivers } from "@/lib/fee-waivers";
import { fetchPaystackSubaccount } from "@/lib/paystack";
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

    // What Paystack is really applying, which is the only authority on the
    // split. A failure here is reported rather than thrown: the rest of this
    // page is still useful when Paystack is unreachable.
    let paystackSplit: {
      percentageCharge: number | null;
      error: string | null;
    } = { percentageCharge: null, error: null };

    if (tenant.paystackSubaccountCode) {
      const result = await fetchPaystackSubaccount(tenant.paystackSubaccountCode);
      paystackSplit = result.success
        ? { percentageCharge: result.data?.percentageCharge ?? null, error: null }
        : { percentageCharge: null, error: result.error ?? "Unknown error" };
    }

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
          subscriptionStatus: tenant.subscriptionStatus ?? null,
          paystackSubaccountCode: tenant.paystackSubaccountCode ?? null,
        },
        billing,
        waivers,
        entitlements,
        paystackSplit,
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
 * stored on the tenant and are what the rest of the app reads. It
 * deliberately does **not** touch the Paystack subaccount: the split is
 * live money and changing it is its own explicit action, so that assigning
 * a plan can never quietly change what a tenant is paid.
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
    if (!(await tenantRef.get()).exists) {
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

    await tenantRef.update({
      planId: plan.id,
      planName: plan.name,
      platformFeePercent: plan.platformFeePercent,
      monthlyFee: plan.monthlyFee,
      updatedAt: new Date(),
    });

    return NextResponse.json({ success: true, data: { planId: plan.id } });
  } catch (error) {
    console.error("PATCH tenant billing error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
