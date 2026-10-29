/**
 * The only way a voucher charge starts.
 *
 * The browser used to open Paystack itself, choosing the reference, the
 * amount, the split and the metadata that named the tenant, plan and buyer.
 * Now it asks here: this route checks the buyer may purchase, works out the
 * amount and split with the same `computeCheckoutSplit` as always, writes a
 * `pendingPurchases` record, creates the Paystack transaction server-side
 * and hands back an access code. The popup can only pay that transaction,
 * and fulfilment honours what the record says, not what the charge says.
 *
 * POST, not GET: it has side effects, and it calls Paystack.
 *
 * This is also where the tenant's pre-purchase decision hook runs
 * (lib/decision-hooks.ts): after the platform's own eligibility checks and
 * before the record and the charge, so a blocked purchase never costs the
 * customer anything and never needs a refund.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleAuthError, resolvePurchaser } from "@/lib/auth-helpers";
import { getTenantBySlug } from "@/lib/firestore-helpers";
import { checkPurchaseEligibility } from "@/lib/purchase-eligibility";
import { getPlatformConfig } from "@/lib/platform-config";
import { resolvePaystackBearer } from "@/lib/billing-plans";
import { computeCheckoutSplit, estimatePaystackFee } from "@/lib/paystack-fees";
import { initializePaystackTransaction } from "@/lib/paystack";
import {
  createPendingPurchase,
  mintPurchaseReference,
} from "@/lib/pending-purchases";
import { parsePurchaseIntent } from "@/lib/voucher-renewal";
import { rateLimit } from "@/lib/rate-limit";
import { runPrePurchaseHook } from "@/lib/decision-hooks";

const initiateSchema = z.object({
  tenantSlug: z.string().min(1),
  planId: z.string().min(1),
  locationId: z.string().min(1),
  /** The buyer's answer to "who is this for", when the dialog asked. */
  intent: z.enum(["reuse", "fresh"]).nullable().optional(),
  /**
   * Captive portal only: the router told the page which device is asking.
   * Recorded so the device can be logged in after payment; never trusted
   * for authorisation.
   */
  deviceMac: z
    .string()
    .regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/)
    .nullable()
    .optional(),
  deviceIp: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,3}){3}$/)
    .nullable()
    .optional(),
});

/**
 * Per buyer. Generous for a person (a double tap, a cancelled popup and a
 * retry), tight for a script. Deliberately no per-tenant cap here: that
 * would throttle a tenant's own busy evening.
 */
const INITIATE_LIMIT = { max: 10, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  try {
    const purchaser = await resolvePurchaser(request.headers.get("authorization"));

    // Keyed on the verified uid, never on anything the caller sends, so
    // the limiter's memory cannot be grown by forged keys.
    const limited = rateLimit(`initiate:${purchaser.uid}`, INITIATE_LIMIT);
    if (!limited.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "Too many attempts. Please wait a minute and try again.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) },
        }
      );
    }

    const validation = initiateSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }
    const { tenantSlug, planId, locationId } = validation.data;

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Business not found" },
        { status: 404 }
      );
    }

    const eligibility = await checkPurchaseEligibility({
      tenant,
      uid: purchaser.uid,
      planId,
      locationId,
    });
    if (!eligibility.ok || !eligibility.plan) {
      return NextResponse.json(
        {
          success: false,
          error: eligibility.ok ? "Plan not found" : eligibility.reason,
        },
        { status: eligibility.ok ? 404 : eligibility.status }
      );
    }
    const plan = eligibility.plan;
    const intent = parsePurchaseIntent(validation.data.intent);

    // The tenant's own rule, if they have one. Never throws: a hook that
    // cannot be reached resolves to the strategy the owner chose for it.
    const decision = await runPrePurchaseHook({
      tenantId: tenant.id,
      customer: { uid: purchaser.uid, email: purchaser.email },
      plan: { id: plan.id, name: plan.name, priceKobo: plan.price },
      location: {
        id: locationId,
        name: eligibility.location?.name ?? plan.locationName,
      },
      intent,
    });
    if (!decision.allowed) {
      return NextResponse.json(
        {
          success: false,
          // Tenant-written, already capped and flattened to one line of
          // plain text. The dialogs render it as text.
          error: decision.reason,
          data: { blockedByHook: true, code: decision.code },
        },
        { status: 403 }
      );
    }

    // Same arithmetic as the storefront and the portal always used, from
    // the same function, so the split cannot move. See lib/paystack-fees.ts.
    const platformConfig = await getPlatformConfig();
    const feeKobo = estimatePaystackFee(plan.price, platformConfig.paystackFeePassthrough);
    const bearer = await resolvePaystackBearer(tenant.planId);
    const subaccountCode = tenant.paystackSubaccountCode ?? null;
    const { amount, transactionCharge } = computeCheckoutSplit({
      priceKobo: plan.price,
      feeKobo,
      platformFeePercent: tenant.platformFeePercent,
      bearer,
      hasSubaccount: Boolean(subaccountCode),
    });

    const deviceMac = validation.data.deviceMac ?? null;
    const deviceIp = validation.data.deviceIp ?? null;
    const reference = mintPurchaseReference();

    // Written before the charge exists: a charge that later arrives for
    // this reference is checked against this, and a charge for any other
    // reference has no record at all.
    await createPendingPurchase({
      reference,
      tenantId: tenant.id,
      userId: purchaser.uid,
      userEmail: purchaser.email,
      planId,
      locationId,
      intent,
      deviceMac,
      deviceIp,
      amountKobo: amount,
      priceKobo: plan.price,
      feeKobo,
      transactionChargeKobo: transactionCharge,
      currency: "NGN",
      subaccountCode,
      bearer,
      hookDecision:
        decision.hookId && decision.requestId
          ? { hookId: decision.hookId, requestId: decision.requestId, outcome: decision.outcome }
          : null,
    });

    const initialized = await initializePaystackTransaction({
      email: purchaser.email,
      amountKobo: amount,
      reference,
      // The same keys the browser used to attach. They let the webhook and
      // the reconcile cron find the sale; the pending record decides it.
      metadata: {
        planId,
        locationId,
        tenantId: tenant.id,
        userId: purchaser.uid,
        intent,
        ...(deviceMac ? { deviceMac } : {}),
        ...(deviceIp ? { deviceIp } : {}),
      },
      subaccountCode,
      bearer,
      transactionChargeKobo: transactionCharge,
    });

    if (!initialized.success) {
      // Nothing can be charged without an access code, so the orphaned
      // record is harmless and ages out with the rest.
      console.error(
        `[initiate] Paystack initialize failed for ${reference}: ${initialized.error}`
      );
      return NextResponse.json(
        {
          success: false,
          error: "We couldn't start the payment. Please try again in a moment.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { reference, accessCode: initialized.accessCode, amount },
    });
  } catch (error) {
    console.error("Purchase initiate error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
