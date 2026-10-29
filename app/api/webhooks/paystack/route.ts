import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";
import {
  notifySubscriptionCancelled,
  notifySubscriptionPaymentFailed,
  notifySubscriptionRenewed,
} from "@/lib/notifications";
import {
  SubscriptionTarget,
  linkPlatformSubscriptionIfMissing,
  linkSubscription,
  resolveSubscription,
} from "@/lib/subscription-index";
import { findAddonByPlanCode } from "@/lib/addons";
import { PLAN_FEE_PREPAY_PURPOSE } from "@/lib/fee-waivers";
import { invalidateBillingLock } from "@/lib/billing-lock";
import { fulfilVoucherPurchase } from "@/lib/voucher-fulfilment";
import { parsePaystackMetadata } from "@/lib/paystack";
import { adminAuth } from "@/lib/firebase-admin";

/**
 * Paystack's webhook.
 *
 * The load-bearing idea here is that **a subscription event must be routed by
 * its subscription code, never by its customer code.** A tenant has exactly
 * one Paystack customer, shared by their platform subscription and every
 * addon subscription they buy. Resolving on customer code alone (which is
 * what this did before addons existed) meant an addon's `subscription.create`
 * would overwrite `tenant.paystackSubscriptionCode` and quietly sever
 * platform billing from its real subscription, while an addon's failed
 * invoice would mark the whole tenant past due.
 *
 * So: `routeSubscriptionEvent` first, customer code only as a last resort for
 * events that genuinely carry no subscription.
 */

async function verifyPaystackWebhook(
  payload: string,
  signature: string
): Promise<boolean> {
  const secret = process.env.PAYSTACK_SECRET_KEY!;
  const hash = crypto
    .createHmac("sha512", secret)
    .update(payload)
    .digest("hex");

  // Both sides are hex of a fixed-length digest, so a length mismatch here
  // means a malformed header rather than a near-miss guess.
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function findTenantByCustomerCode(
  customerCode: string
): Promise<string | null> {
  const snapshot = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("paystackCustomerCode", "==", customerCode)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].id;
}

/** The subscription code on an event, wherever Paystack put it. */
function subscriptionCodeOf(data: unknown): string | null {
  const d = data as
    | {
        subscription_code?: unknown;
        subscription?: { subscription_code?: unknown };
      }
    | undefined;

  const direct = d?.subscription_code;
  if (typeof direct === "string" && direct) return direct;

  const nested = d?.subscription?.subscription_code;
  if (typeof nested === "string" && nested) return nested;

  return null;
}

/**
 * What this event is about.
 *
 * Returns null when it cannot be established, and the caller then does
 * nothing. That is deliberate: the alternative is assuming an unrecognised
 * subscription belongs to the platform, which is precisely the bug this
 * routing exists to prevent. A no-op leaves money uncollected at worst; a
 * wrong guess corrupts a tenant's billing record.
 */
async function routeSubscriptionEvent(
  data: unknown
): Promise<SubscriptionTarget | null> {
  const subscriptionCode = subscriptionCodeOf(data);

  if (subscriptionCode) {
    const resolved = await resolveSubscription(subscriptionCode);
    if (resolved) return resolved;
  }

  // No index row. Either this subscription predates the index, or it belongs
  // to something else on the same Paystack account. Fall back to the tenant's
  // own recorded subscription code, which is the one case we can still
  // establish with certainty.
  const customerCode = (data as { customer?: { customer_code?: unknown } })
    ?.customer?.customer_code;
  if (typeof customerCode !== "string" || !customerCode) return null;

  const tenantId = await findTenantByCustomerCode(customerCode);
  if (!tenantId) return null;

  const tenantDoc = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .doc(tenantId)
    .get();
  const recorded = tenantDoc.data()?.paystackSubscriptionCode;

  // Only claim this for the platform when the tenant's own record agrees, or
  // when they have no subscription code at all yet (the very first signup,
  // where `subscription.create` is what supplies it).
  if (subscriptionCode && typeof recorded === "string" && recorded) {
    if (recorded !== subscriptionCode) return null;
  }

  if (subscriptionCode) {
    await linkPlatformSubscriptionIfMissing(subscriptionCode, tenantId);
  }

  return { kind: "platform", tenantId };
}

/* ------------------------------------------------------------- platform */

async function platformPaymentFailed(tenantId: string, amount?: number) {
  await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).update({
    subscriptionStatus: "past_due",
    updatedAt: FieldValue.serverTimestamp(),
  });

  // `past-due` can never lock, so this is strictly an unlock - but the
  // cached answer was computed from the old status either way.
  invalidateBillingLock(tenantId);

  // Past due is the first step towards suspension. Recording it in
  // Firestore and telling nobody is how an owner finds out by having
  // their portal go dark.
  await notifySubscriptionPaymentFailed(tenantId, amount);
}

async function platformPaymentSucceeded(
  tenantId: string,
  isRenewal: boolean,
  amount?: number
) {
  const nextBillingDate = new Date();
  nextBillingDate.setDate(nextBillingDate.getDate() + 30);

  await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).update({
    status: "active",
    subscriptionStatus: "active",
    nextBillingDate,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // A renewal that went through on its own. Nobody is watching a screen for
  // this one, but a tenant who had slipped into the grace window is owed
  // their sales back the moment it clears.
  invalidateBillingLock(tenantId);

  // Only the invoice event is a renewal. `charge.success` also arrives
  // for one-off charges that happen to resolve to this tenant, and a
  // "your subscription renewed" email for one of those would be wrong.
  if (isRenewal) {
    await notifySubscriptionRenewed(tenantId, nextBillingDate, amount);
  }
}

async function platformCancelled(tenantId: string) {
  await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).update({
    subscriptionStatus: "cancelled",
    updatedAt: FieldValue.serverTimestamp(),
  });

  invalidateBillingLock(tenantId);
  await notifySubscriptionCancelled(tenantId);
}

/* --------------------------------------------------------------- addons */

/**
 * Addon status changes write only to the entitlement document.
 *
 * Nothing here touches the tenant document. An addon lapsing must never
 * suspend the account or move `subscriptionStatus`: addons are independent
 * of platform access, so the two lifecycles stay strictly separate.
 */
async function updateAddonEntitlement(
  tenantId: string,
  addonKey: string,
  patch: Record<string, unknown>
) {
  const ref = adminDb
    .collection(TENANT_COLLECTIONS.entitlements(tenantId))
    .doc(addonKey);

  // Never creates. Inventing an entitlement from a webhook would be granting
  // a paid feature on the strength of an event nobody verified against
  // transaction/verify, which is the activate route's job.
  //
  // An absent document is also the normal state during the activation race,
  // where `subscription.create` beats the browser back to us. That case is
  // self-healing: the index row has already been written by the caller, and
  // activation reads the subscription code back from it.
  const existing = await ref.get();
  if (!existing.exists) {
    console.info(
      `[webhook] ${addonKey} event for ${tenantId} before activation; ` +
        `the index row carries the link until activation completes`
    );
    return;
  }

  await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
}


/* -------------------------------------------------------- voucher sales */

/**
 * A customer buying a voucher, identified by the metadata the checkout
 * dialogs attach. This is the server-to-server safety net for the one thing
 * that used to depend entirely on the buyer's browser surviving a bank
 * redirect on a captive portal: a payment arrived, the browser never called
 * /api/payment/verify, and the charge was silently dropped here because the
 * buyer's customer code is not a tenant's.
 *
 * Checked **before** the platform branch, which also closes a latent bug: a
 * tenant buying a voucher from their own portal with the email on their
 * platform subscription would otherwise resolve by customer code and mark
 * their subscription paid.
 */
function voucherMetadata(data: unknown): {
  planId: string;
  locationId: string;
  tenantId: string;
  deviceMac?: string;
  deviceIp?: string;
  userId?: string;
} | null {
  const m = parsePaystackMetadata((data as { metadata?: unknown })?.metadata);
  if (!m) return null;

  const str = (key: string) =>
    typeof m[key] === "string" && m[key] ? (m[key] as string) : undefined;

  const planId = str("planId");
  const locationId = str("locationId");
  const tenantId = str("tenantId");
  if (!planId || !locationId || !tenantId) return null;

  return {
    planId,
    locationId,
    tenantId,
    deviceMac: str("deviceMac"),
    deviceIp: str("deviceIp"),
    userId: str("userId"),
  };
}

/**
 * Who the voucher belongs to.
 *
 * The webhook has no token, so the uid has to come from somewhere else:
 * the metadata the checkout attached, or a lookup on the email Paystack
 * charged. Returns null rather than inventing an identity - a voucher
 * attributed to the wrong account is worse than one this path leaves for
 * the browser or the reconciliation job to issue.
 */
async function resolveWebhookBuyer(
  metadataUserId: string | undefined,
  email: string | undefined
): Promise<{ uid: string; email: string } | null> {
  if (metadataUserId && email) return { uid: metadataUserId, email };
  if (!email) return null;

  try {
    const user = await adminAuth.getUserByEmail(email);
    return { uid: user.uid, email };
  } catch {
    console.error(`[webhook] no account for ${email}; cannot attribute sale`);
    return null;
  }
}

/* ------------------------------------------------------------- handler */

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-paystack-signature");
    if (!signature) {
      return NextResponse.json({ error: "No signature" }, { status: 400 });
    }

    const payload = await request.text();
    const isValid = await verifyPaystackWebhook(payload, signature);

    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const event = JSON.parse(payload);
    const eventType = event.event;
    const data = event.data;
    const amount = typeof data?.amount === "number" ? data.amount : undefined;

    switch (eventType) {
      case "invoice.payment_failed": {
        const target = await routeSubscriptionEvent(data);
        if (!target) break;

        if (target.kind === "addon") {
          // past_due, not expired: Paystack retries, and this fires on the
          // first attempt. lib/entitlements.ts keeps access alive through
          // the grace window rather than cutting it off here.
          await updateAddonEntitlement(target.tenantId, target.addonKey, {
            status: "past_due",
            pastDueSince: new Date(),
          });
          break;
        }

        await platformPaymentFailed(target.tenantId, amount);
        break;
      }

      case "invoice.payment_succeeded":
      case "charge.success": {
        // A voucher sale, before anything else looks at this charge. Its
        // metadata names the tenant outright, so there is nothing to infer.
        const sale = voucherMetadata(data);
        if (eventType === "charge.success" && sale) {
          const buyer = await resolveWebhookBuyer(
            sale.userId,
            typeof data?.customer?.email === "string"
              ? data.customer.email
              : undefined
          );
          if (!buyer) break;

          const result = await fulfilVoucherPurchase({
            reference: data.reference,
            planId: sale.planId,
            locationId: sale.locationId,
            tenantId: sale.tenantId,
            deviceMac: sale.deviceMac,
            deviceIp: sale.deviceIp,
            buyer,
          });

          // Another caller is mid-way through this sale. Answering 503 makes
          // Paystack retry later, by which point it is either finished or
          // its lease has lapsed and the retry resumes it.
          if (result.ok && result.outcome === "in_progress") {
            console.info(`[webhook] ${data.reference} in progress elsewhere; asking Paystack to retry`);
            return NextResponse.json({ received: false }, { status: 503 });
          }

          // Logged either way. A webhook that silently declines to fulfil is
          // how the original failure stayed invisible for a day.
          if (result.ok) {
            console.info(
              `[webhook] voucher ${result.outcome} for ${data.reference} ` +
                `(${sale.tenantId})`
            );
          } else {
            console.error(
              `[webhook] voucher fulfilment failed for ${data.reference}: ` +
                result.error
            );
          }
          break;
        }

        // A plan fee paid *during* a waiver. The POST that verified it has
        // already written the dates, and they are not the ones this handler
        // would write: a prepayment covers the month after the waiver
        // closes, which can be weeks out, while everything below assumes
        // "paid now, due in thirty days". Applying that here would bring the
        // next charge forward past the month they just bought.
        if (
          eventType === "charge.success" &&
          (data?.metadata as { purpose?: unknown } | undefined)?.purpose ===
            PLAN_FEE_PREPAY_PURPOSE
        ) {
          console.info(
            `[webhook] plan-fee prepayment ${data?.reference}; dates owned by the billing route`
          );
          break;
        }

        const target = await routeSubscriptionEvent(data);

        if (target?.kind === "addon") {
          const periodEnd = new Date();
          periodEnd.setDate(periodEnd.getDate() + 30);
          await updateAddonEntitlement(target.tenantId, target.addonKey, {
            status: "active",
            currentPeriodEnd: periodEnd,
            pastDueSince: null,
            cancelledAt: null,
            lastPaymentRef:
              typeof data?.reference === "string" ? data.reference : null,
          });
          break;
        }

        if (target?.kind === "platform") {
          await platformPaymentSucceeded(
            target.tenantId,
            eventType === "invoice.payment_succeeded",
            amount
          );
          break;
        }

        // A bare `charge.success` with no subscription at all. This is the
        // one case where customer-code resolution is correct, because there
        // is no subscription for it to be confused with. Addon one-time
        // purchases do not rely on this: they are confirmed synchronously by
        // /api/admin/addons/[key]/activate against transaction/verify.
        if (eventType === "charge.success" && !subscriptionCodeOf(data)) {
          const customerCode = data?.customer?.customer_code;
          if (typeof customerCode !== "string" || !customerCode) break;
          const tenantId = await findTenantByCustomerCode(customerCode);
          if (!tenantId) break;
          await platformPaymentSucceeded(tenantId, false, amount);
        }
        break;
      }

      case "subscription.create": {
        const subscriptionCode = subscriptionCodeOf(data);
        if (!subscriptionCode) break;

        // Already claimed by an addon purchase, which indexes the code at
        // activation time. Without this check the old behaviour returns: the
        // addon's code overwrites the tenant's platform subscription.
        const known = await resolveSubscription(subscriptionCode);
        if (known?.kind === "addon") {
          await updateAddonEntitlement(known.tenantId, known.addonKey, {
            status: "active",
            paystackSubscriptionCode: subscriptionCode,
          });
          break;
        }
        if (known?.kind === "platform") break;

        const customerCode = data?.customer?.customer_code;
        if (typeof customerCode !== "string" || !customerCode) break;

        const tenantId = await findTenantByCustomerCode(customerCode);
        if (!tenantId) break;

        // Is this an addon rather than the platform? The customer code is
        // shared, so the Plan code is the only thing that distinguishes
        // them, and every addon owns its Plan exclusively.
        //
        // This also closes the ordering race with activation: Paystack can
        // deliver this before the browser returns the reference, so the
        // index row is written whether or not the entitlement exists yet.
        // Activation reads it back via findSubscriptionForAddon.
        const planCode = data?.plan?.plan_code;
        if (typeof planCode === "string" && planCode) {
          const addonKey = await findAddonByPlanCode(planCode);
          if (addonKey) {
            await linkSubscription(subscriptionCode, {
              kind: "addon",
              tenantId,
              addonKey,
            });
            await updateAddonEntitlement(tenantId, addonKey, {
              status: "active",
              paystackSubscriptionCode: subscriptionCode,
            });
            break;
          }
        }

        const tenantDoc = await adminDb
          .collection(COLLECTIONS.TENANTS)
          .doc(tenantId)
          .get();
        const recorded = tenantDoc.data()?.paystackSubscriptionCode;

        // Only fill an empty slot. A tenant that already has a platform
        // subscription is not getting a second one, so an unrecognised code
        // arriving for them is an addon we failed to index, and overwriting
        // would be the exact corruption this guards against.
        if (typeof recorded === "string" && recorded) {
          console.error(
            `[webhook] unindexed subscription ${subscriptionCode} for tenant ` +
              `${tenantId}, which already has ${recorded}. Ignored.`
          );
          break;
        }

        await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).update({
          paystackSubscriptionCode: subscriptionCode,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await linkPlatformSubscriptionIfMissing(subscriptionCode, tenantId);
        break;
      }

      case "subscription.disable":
      case "subscription.not_renew": {
        const target = await routeSubscriptionEvent(data);
        if (!target) break;

        if (target.kind === "addon") {
          // "Will not renew", not "stopped now". The entitlement keeps
          // working to the end of the period already paid for; that is
          // evaluated in lib/entitlements.ts, not decided here.
          await updateAddonEntitlement(target.tenantId, target.addonKey, {
            status: "cancelled",
            cancelledAt: new Date(),
          });
          break;
        }

        await platformCancelled(target.tenantId);
        break;
      }

      default:
        // Ignore other events
        break;
    }

    // Always return 200 to Paystack
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    // Still return 200 to prevent Paystack retries
    return NextResponse.json({ received: true });
  }
}
