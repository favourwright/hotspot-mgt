/**
 * Set a tenant's Paystack subaccount split to match their current plan.
 * Superadmin only.
 *
 * This is the only thing in the app that changes what a live tenant is
 * actually paid. The split lives on Paystack, is set once at onboarding, and
 * nothing keeps it in step with the billing plan afterwards - so moving a
 * tenant to a plan with a different `platformFeePercent` does nothing to
 * their money until this runs.
 *
 * Kept as its own deliberate action rather than folded into the plan change
 * on purpose. Editing a billing plan must never silently move money for
 * every tenant on it, and a split change should be something a person chose,
 * saw the before and after of, and can be asked about later.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import {
  fetchPaystackSubaccount,
  updatePaystackSubaccount,
} from "@/lib/paystack";

export async function POST(
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

    const subaccountCode = tenant.paystackSubaccountCode;
    if (!subaccountCode) {
      // Without a subaccount there is no split at all and the whole charge
      // settles into the platform's account, which is a different problem
      // from a wrong percentage and is not fixable here.
      return NextResponse.json(
        {
          success: false,
          error:
            "This tenant has no Paystack subaccount, so there is no split to set.",
        },
        { status: 409 }
      );
    }

    const target = tenant.platformFeePercent ?? 0;

    const before = await fetchPaystackSubaccount(subaccountCode);
    if (!before.success) {
      return NextResponse.json(
        { success: false, error: before.error ?? "Could not read subaccount" },
        { status: 502 }
      );
    }

    const result = await updatePaystackSubaccount(subaccountCode, {
      percentageCharge: target,
    });
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error ?? "Could not update subaccount" },
        { status: 502 }
      );
    }

    // Read it back rather than trusting the write. This is money, and a
    // success response that did not take effect is the failure mode that
    // would go unnoticed for months.
    const after = await fetchPaystackSubaccount(subaccountCode);

    return NextResponse.json({
      success: true,
      data: {
        previousPercentage: before.data?.percentageCharge ?? null,
        requestedPercentage: target,
        confirmedPercentage: after.success
          ? (after.data?.percentageCharge ?? null)
          : null,
        confirmed: after.success && after.data?.percentageCharge === target,
      },
    });
  } catch (error) {
    console.error("POST paystack split error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
