import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import {
  getCustomerVouchers,
  getTenantBySlug,
  getVoucherCredential,
  parsePlan,
} from "@/lib/firestore-helpers";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import {
  describePurchaseOptions,
  parseRenewalModes,
} from "@/lib/voucher-renewal";
import { routerUsernameFor } from "@/lib/voucher-credentials";
import { checkPurchaseEligibility } from "@/lib/purchase-eligibility";

// Checked by both checkout dialogs when they open, so the buyer learns
// before tapping Pay. It is a preview: the enforcement is the same
// `checkPurchaseEligibility` call inside /api/purchase/initiate, which is
// the only route that can start a voucher charge.
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
            // The same two settings fulfilment will renew under, so the
            // dates this dialog promises and the dates the customer gets
            // cannot disagree.
            modes: parseRenewalModes(tenant),
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
                expiryMode: preview.reuse.expiryMode,
                dataMode: preview.reuse.dataMode,
              }
            : null,
          hasUnusedVoucher: preview.hasUnusedVoucher,
        };
      }
    }

    // The same check /api/purchase/initiate makes before it starts a
    // charge, so what this dialog promises and what checkout does cannot
    // differ. A refusal is `allowed: false` with a reason, not an error:
    // the dialog shows it in place of the pay button.
    const eligibility = await checkPurchaseEligibility({
      tenant,
      uid: verifiedUser.uid,
      planId,
      locationId,
    });

    return NextResponse.json({
      success: true,
      data: eligibility.ok
        ? { allowed: true, options }
        : { allowed: false, reason: eligibility.reason, options },
    });
  } catch (error) {
    console.error("Can-purchase check error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
