import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import {
  getCustomerVouchers,
  getTenantBySlug,
  getTenantCustomer,
  getTenantCustomerCount,
  getVoucherCredential,
  parsePlan,
} from "@/lib/firestore-helpers";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { getBillingPlanById } from "@/lib/billing-plans";
import { describePurchaseOptions } from "@/lib/voucher-renewal";
import { routerUsernameFor } from "@/lib/voucher-credentials";
import {
  BILLING_LOCK_PORTAL_MESSAGE,
  isTenantBillingLocked,
} from "@/lib/billing-lock";

// Checked by the customer portal right before opening the Paystack popup -
// this is the actual enforcement point for a plan's maxCustomers limit.
// Existing customers of a tenant always pass; only a brand-new customer can
// be blocked, and only before they've paid - /api/payment/verify never
// blocks fulfillment after a payment has already gone through.
//
// It is also the only place a purchase is refused for already owning an
// unused voucher. That check needs `planId` and `locationId`, which are
// optional here: a caller that does not send them gets the customer-limit
// answer alone, exactly as before.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyAuthenticated(authHeader);

    const { slug } = await params;
    const tenant = await getTenantBySlug(slug);
    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Business not found" },
        { status: 404 }
      );
    }

    // What would happen if they paid right now, so the dialog can say so
    // and let them choose otherwise.
    //
    // This used to refuse the sale outright when they held an unused
    // voucher for the same plan, which was half of a mistake: it guessed
    // that a repeat purchase was always for the buyer themselves. It is
    // not, and the dialog now asks. See lib/voucher-renewal.ts.
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get("planId");
    const locationId = searchParams.get("locationId");

    let options = null;

    if (planId && locationId) {
      const planDoc = await adminDb
        .collection(TENANT_COLLECTIONS.plans(tenant.id))
        .doc(planId)
        .get();
      const plan = parsePlan(planDoc);

      if (plan) {
        const [history, credential] = await Promise.all([
          getCustomerVouchers(tenant.id, verifiedUser.uid),
          getVoucherCredential(tenant.id, verifiedUser.uid),
        ]);

        const preview = describePurchaseOptions(
          history,
          {
            planId,
            locationId,
            now: new Date(),
            savedUsername: credential
              ? routerUsernameFor(credential.handle, credential.suffix)
              : null,
          },
          plan
        );

        options = {
          reuse: preview.reuse
            ? {
                mode: preview.reuse.mode,
                username: preview.reuse.username,
                currentExpiresAt:
                  preview.reuse.currentExpiresAt?.toISOString() ?? null,
                newExpiresAt: preview.reuse.newExpiresAt?.toISOString() ?? null,
                previousPlanName: preview.reuse.previousPlanName,
              }
            : null,
          hasUnusedVoucher: preview.hasUnusedVoucher,
        };
      }
    }

    // Before any limit check, because this is not about this buyer at all:
    // the tenant owes their plan fee and has run out of grace. Existing
    // customers are refused too, which is the one place this differs from
    // the customer cap - that cap protects a tenant's own allowance, and
    // this one stops the sale entirely.
    //
    // Vouchers already sold are untouched and keep working on the router.
    // Only the next sale is stopped. See lib/billing-lock.ts.
    if (await isTenantBillingLocked(tenant.id)) {
      return NextResponse.json({
        success: true,
        data: {
          allowed: false,
          reason: BILLING_LOCK_PORTAL_MESSAGE,
          options,
        },
      });
    }

    const existingCustomer = await getTenantCustomer(tenant.id, verifiedUser.uid);
    if (existingCustomer) {
      return NextResponse.json({ success: true, data: { allowed: true, options } });
    }

    const plan = await getBillingPlanById(tenant.planId);
    const maxCustomers = plan?.limits.maxCustomers ?? null;

    if (maxCustomers === null) {
      return NextResponse.json({ success: true, data: { allowed: true, options } });
    }

    const currentCount = await getTenantCustomerCount(tenant.id);

    if (currentCount >= maxCustomers) {
      return NextResponse.json({
        success: true,
        data: {
          allowed: false,
          reason:
            "This business isn't accepting new customers right now. Please check back later.",
          options,
        },
      });
    }

    return NextResponse.json({ success: true, data: { allowed: true, options } });
  } catch (error) {
    console.error("Can-purchase check error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
