import { NextRequest, NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { verifyPaystackPayment } from "@/lib/paystack";
import { getAddon } from "@/lib/entitlements";
import { grantEntitlement } from "@/lib/addons";
import { findSubscriptionForAddon } from "@/lib/subscription-index";

export const dynamic = "force-dynamic";

/**
 * Turn a completed Paystack transaction into an entitlement.
 *
 * This is the paywall's front door, so every claim the browser makes is
 * treated as a claim and nothing more. The browser supplies one thing, a
 * reference, and everything else is read back from Paystack or from our own
 * records:
 *
 *  1. **The transaction is verified against Paystack**, never trusted from
 *     the client. A reference is just a string until Paystack confirms it.
 *  2. **The amount must cover the addon's current price.** Without this, a
 *     tenant could initialise their own 100 kobo charge against any addon
 *     and present that reference here.
 *  3. **The payer's email must be the tenant's owner email.** This is what
 *     stops one tenant replaying another tenant's genuine reference, which
 *     would otherwise pass checks 1 and 2 perfectly.
 *  4. **The reference is claimed exactly once**, by a Firestore `create` that
 *     fails if the document already exists. Two concurrent requests with the
 *     same reference cannot both win, and a reference cannot be re-presented
 *     later to extend a subscription for free.
 *
 * Only after all four does anything get written.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await verifyOwnerWithTenant(authHeader);
    const { key } = await params;

    const body = await request.json().catch(() => ({}));
    const reference = typeof body?.reference === "string" ? body.reference : "";
    if (!reference) {
      return NextResponse.json(
        { success: false, error: "Missing payment reference" },
        { status: 400 }
      );
    }

    // Covers an unknown key as well as a withdrawn one: getAddon returns
    // null when no document exists, so there is no separate key whitelist to
    // keep in step with the catalog a superadmin manages.
    const addon = await getAddon(key);
    if (!addon || !addon.active) {
      return NextResponse.json(
        { success: false, error: "This addon is not available." },
        { status: 409 }
      );
    }
    if (addon.pricingModel === "free") {
      return NextResponse.json(
        { success: false, error: "This addon is free and needs no payment." },
        { status: 400 }
      );
    }

    // 1. Paystack is the authority on whether this was paid.
    const verified = await verifyPaystackPayment(reference);
    if (!verified.success || !verified.data) {
      return NextResponse.json(
        { success: false, error: verified.error ?? "Payment not verified" },
        { status: 402 }
      );
    }
    const txn = verified.data;

    if (txn.status !== "success") {
      return NextResponse.json(
        { success: false, error: `Payment status is "${txn.status}".` },
        { status: 402 }
      );
    }

    // 2. Underpayment. Compared against the addon's live price rather than
    //    anything the client sent.
    if (txn.amount < addon.amount) {
      console.error(
        `[addons] underpayment for ${key} by ${tenantId}: ` +
          `paid ${txn.amount}, price ${addon.amount}`
      );
      return NextResponse.json(
        { success: false, error: "The payment does not cover this addon." },
        { status: 402 }
      );
    }

    // 3. The payment has to belong to this tenant. Without this a tenant
    //    could take any successful reference of the right size and claim it.
    const tenantDoc = await adminDb
      .collection(COLLECTIONS.TENANTS)
      .doc(tenantId)
      .get();
    const ownerEmail = tenantDoc.data()?.ownerEmail;
    const payerEmail = txn.customerEmail;

    if (
      typeof ownerEmail !== "string" ||
      typeof payerEmail !== "string" ||
      ownerEmail.toLowerCase() !== payerEmail.toLowerCase()
    ) {
      console.error(
        `[addons] reference ${reference} presented by ${tenantId} but paid by ` +
          `a different account`
      );
      return NextResponse.json(
        { success: false, error: "This payment belongs to another account." },
        { status: 403 }
      );
    }

    // 4. Single use. `create` throws if the document exists, which makes this
    //    the atomic claim rather than a read-then-write that two concurrent
    //    requests could both pass.
    try {
      await adminDb
        .collection(COLLECTIONS.ADDON_PAYMENTS)
        .doc(reference)
        .create({
          reference,
          tenantId,
          addonKey: key,
          amount: txn.amount,
          claimedAt: new Date(),
        });
    } catch {
      return NextResponse.json(
        { success: false, error: "This payment has already been used." },
        { status: 409 }
      );
    }

    const currentPeriodEnd =
      addon.pricingModel === "subscription"
        ? new Date(
            Date.now() +
              (addon.billingInterval === "yearly" ? 365 : 30) * 86_400_000
          )
        : null;

    await grantEntitlement({
      tenantId,
      addonKey: key,
      pricingModel: addon.pricingModel,
      amountPaid: txn.amount,
      reference,
      paystackCustomerCode: txn.customerCode,
      currentPeriodEnd,
    });

    // The subscription code arrives by webhook, which may have landed before
    // this request did. Reading it back here rather than assuming an order
    // means the entitlement ends up linked either way.
    if (addon.pricingModel === "subscription") {
      const existing = await findSubscriptionForAddon(tenantId, key);
      if (existing) {
        await adminDb
          .collection(TENANT_COLLECTIONS.entitlements(tenantId))
          .doc(key)
          .update({ paystackSubscriptionCode: existing });
      }
    }

    console.info(`[addons] ${tenantId} activated ${key} (${reference})`);

    return NextResponse.json({ success: true, data: { addonKey: key } });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
