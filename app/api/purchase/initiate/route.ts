/**
 * The only way a voucher charge starts.
 *
 * The browser never chooses the reference, the amount, the split or the
 * metadata that names the tenant, plan and buyer. It asks here: this route
 * checks the buyer may purchase, works out the amount and split
 * (lib/processing-fees.ts), writes a `pendingPurchases` record, starts the
 * charge at Knomad Pay with the tenant's share split to their payee, and
 * hands back Monnify's checkout. Fulfilment honours what the record says,
 * not what the charge says.
 *
 * POST, not GET: it has side effects, and it starts a charge.
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
import { resolveFeeBearer } from "@/lib/billing-plans";
import { estimateProcessingFee } from "@/lib/processing-fees";
import { knomadPay, knomadPaySplit, paymentReturnUrl } from "@/lib/knomad-pay";
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
      customer: {
        uid: purchaser.uid,
        email: purchaser.email,
        emailVerified: purchaser.emailVerified,
      },
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
          data: {
            blockedByHook: true,
            code: decision.code,
            // The hook doesn't know this customer yet and has a page to
            // verify them on. The dialog sends them to /api/hooks/link/start.
            canLink: decision.canLink === true,
          },
        },
        { status: 403 }
      );
    }

    // No payee, no sale: without one the tenant's share would land in Knomad's own
    // account, and Knomad does not hold its tenants' money. The payee is made from the
    // tenant's bank details at signup or by the reconcile cron.
    if (!tenant.knomadPayeeReference) {
      console.error(`[purchase] ${tenant.slug} has no payee; sale refused`);
      return NextResponse.json(
        { success: false, error: "This business can't take payments just yet. Please try again later." },
        { status: 503 }
      );
    }

    const platformConfig = await getPlatformConfig();
    const feeKobo = estimateProcessingFee(plan.price, platformConfig.processingFeePassthrough);
    const amount = plan.price + feeKobo;
    const bearer = await resolveFeeBearer(tenant.planId);
    const division = knomadPaySplit({
      amountKobo: amount,
      priceKobo: plan.price,
      feeKobo,
      platformFeePercent: tenant.platformFeePercent,
      bearer,
      payeeReference: tenant.knomadPayeeReference,
    });

    const deviceMac = validation.data.deviceMac ?? null;
    const deviceIp = validation.data.deviceIp ?? null;
    const reference = mintPurchaseReference();

    // Written before the charge exists: a charge that later arrives for this reference
    // is checked against this, and a charge for any other reference has no record at all.
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
      platformShareKobo: division?.platformShareKobo ?? null,
      currency: "NGN",
      payeeReference: division ? tenant.knomadPayeeReference : null,
      bearer,
      hookDecision:
        decision.hookId && decision.requestId
          ? { hookId: decision.hookId, requestId: decision.requestId, outcome: decision.outcome }
          : null,
    });
    const started = await knomadPay()
      .createCharge(
        {
          reference,
          amountKobo: amount,
          currency: "NGN",
          customer: { email: purchaser.email },
          description: `${plan.name} wifi voucher`.slice(0, 100),
          callbackUrl: paymentReturnUrl(reference),
          // They let Knomad Pay's event and the reconcile cron find the sale; the pending
          // record decides it.
          metadata: {
            planId,
            locationId,
            tenantId: tenant.id,
            userId: purchaser.uid,
            intent,
            ...(deviceMac ? { deviceMac } : {}),
            ...(deviceIp ? { deviceIp } : {}),
          },
          ...(division ? { split: division.split } : {}),
        },
        // The reference is new for every checkout, so it is the request's key too.
        { idempotencyKey: `charge:${reference}` }
      )
      .catch((error: Error) => ({ ok: false as const, status: 0, code: "UNREACHABLE", message: error.message }));
    if (!started.ok || !started.data.checkoutUrl) {
      // Nothing can be paid without a checkout, so the orphaned record is harmless and
      // ages out with the rest.
      console.error(
        `[initiate] Knomad Pay charge failed for ${reference}: ${started.ok ? "no checkout" : `${started.code} ${started.message}`}`
      );
      return NextResponse.json(
        { success: false, error: "We couldn't start the payment. Please try again in a moment." },
        { status: 502 }
      );
    }
    return NextResponse.json({
      success: true,
      data: { reference, checkoutUrl: started.data.checkoutUrl, amount },
    });
  } catch (error) {
    console.error("Purchase initiate error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
