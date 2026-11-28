/**
 * Payments to the platform itself: a plan period, an addon, voucher generation credits,
 * or a paid plan at signup.
 * One record per payment, in `billingCharges/{reference}`, taken through Knomad Pay
 * with no split (the money is Knomad's own), on Monnify's checkout in a frame.
 *
 * The record is written before the charge is started and says what the money is for,
 * so nothing about it is taken from the browser: whoever reports the payment (the
 * dialog, Knomad Pay's event, or the reconcile cron) only names the reference, and
 * `confirmBillingCharge` asks the gateway and applies it once. Applying extends
 * `nextBillingDate` (plan) or the entitlement's `currentPeriodEnd` (addon) by one period
 * from where the paid time ends (lib/billing-periods.ts), in a transaction that flips
 * the record to `applied`, so three reporters racing still buy one period.
 *
 * A signup charge is different: there is no tenant yet. It is claimed by
 * `create-tenant`, in the same batch that creates the tenant (`claimSignupCharge`).
 */
import { randomBytes } from "crypto";
import type { DocumentReference } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { signupPaymentReturnUrl, startKnomadPayCharge, tenantPaymentReturnUrl, verifyKnomadPayCharge } from "@/lib/knomad-pay";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimateProcessingFee } from "@/lib/processing-fees";
import { getEffectiveBilling } from "@/lib/fee-waivers";
import { addonIntervalMs, PLAN_INTERVAL_MS } from "@/lib/billing-periods";
import { invalidateBillingLock } from "@/lib/billing-lock";
import { invalidateTenant } from "@/lib/tenant-cache";
import { notifyPlanPaid, notifyPurchaseReceived } from "@/lib/notifications";
import { formatDay } from "@/lib/utils";
import { chargeRevenue, revenueEntryId } from "@/lib/platform-revenue";
import { addPurchasedCredits } from "@/lib/voucher-generation";

export type BillingChargeKind = "plan" | "addon" | "credits" | "signup";

export interface BillingCharge {
  reference: string;
  kind: BillingChargeKind;
  /** Null for a signup, until the tenant it creates exists. */
  tenantId: string | null;
  uid: string;
  email: string;
  planId: string | null;
  addonKey: string | null;
  /** For `credits`: how many voucher generation credits it buys. */
  credits: number | null;
  /** What is being bought, in kobo, before the processing fee. */
  priceKobo: number;
  /** The processing fee passed on to the payer (PlatformConfig's passthrough). */
  feeKobo: number;
  /** What the charge asks for: price plus fee. */
  amountKobo: number;
  /** For a signup: the promo code the price was worked out with. */
  couponCode: string | null;
  status: "pending" | "applied";
  /** The period it bought, once applied (none for a one-time addon or a signup). */
  periodFrom: Date | null;
  periodTo: Date | null;
  createdAt: Date;
  appliedAt: Date | null;
}

const charges = () => adminDb.collection(COLLECTIONS.BILLING_CHARGES);

/**
 * The platform revenue entry for a charge being applied, written in the same
 * transaction or batch that flips it to `applied`, so a charge is never
 * applied without its entry or the reverse (lib/platform-revenue.ts).
 */
function writeChargeRevenue(
  w: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch,
  charge: BillingCharge,
  tenantId: string,
  paidAt: Date
) {
  const ref = adminDb.collection(COLLECTIONS.PLATFORM_REVENUE).doc(revenueEntryId("charge", charge.reference));
  const entry = chargeRevenue({ ...charge, tenantId, paidAt });
  // Both writers' `set` share this signature; the union does not narrow.
  (w as FirebaseFirestore.WriteBatch).set(ref, entry);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

function fromStored(data: FirebaseFirestore.DocumentData): BillingCharge {
  return {
    reference: data.reference,
    kind: data.kind,
    tenantId: data.tenantId ?? null,
    uid: data.uid,
    email: data.email,
    planId: data.planId ?? null,
    addonKey: data.addonKey ?? null,
    credits: typeof data.credits === "number" ? data.credits : null,
    priceKobo: data.priceKobo,
    feeKobo: data.feeKobo,
    amountKobo: data.amountKobo,
    couponCode: data.couponCode ?? null,
    status: data.status,
    periodFrom: toDate(data.periodFrom),
    periodTo: toDate(data.periodTo),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    appliedAt: toDate(data.appliedAt),
  };
}

export async function getBillingCharge(reference: string): Promise<BillingCharge | null> {
  const doc = await charges().doc(reference).get();
  return doc.exists ? fromStored(doc.data()!) : null;
}

/** The processing fee passed on for a price, under the platform's current setting. */
export async function passedOnFee(priceKobo: number): Promise<number> {
  const config = await getPlatformConfig();
  return estimateProcessingFee(priceKobo, config.processingFeePassthrough);
}

export type StartResult =
  | { ok: true; reference: string; checkoutUrl: string; amountKobo: number }
  | { ok: false; status: number; error: string };

/**
 * Records what a payment is for, then asks Knomad Pay for a checkout. The price is the
 * caller's, worked out on the server from the plan, addon or coupon; the fee is added
 * here. A charge the gateway does not start is left pending and never applied.
 */
export async function startBillingCharge(input: {
  kind: BillingChargeKind;
  tenantId: string | null;
  uid: string;
  email: string;
  planId?: string | null;
  addonKey?: string | null;
  credits?: number | null;
  priceKobo: number;
  couponCode?: string | null;
  description: string;
}): Promise<StartResult> {
  if (!Number.isInteger(input.priceKobo) || input.priceKobo <= 0) {
    return { ok: false, status: 409, error: "There is nothing to pay." };
  }
  const feeKobo = await passedOnFee(input.priceKobo);
  const amountKobo = input.priceKobo + feeKobo;
  const reference = `bill_${Date.now()}_${randomBytes(8).toString("hex")}`;

  // Back to where the payer left from: their tenant's subdomain, or signup.
  let callbackUrl: string;
  if (input.tenantId) {
    const slug = (await adminDb.collection(COLLECTIONS.TENANTS).doc(input.tenantId).get()).data()?.slug;
    if (typeof slug !== "string") return { ok: false, status: 404, error: "Tenant not found" };
    callbackUrl = tenantPaymentReturnUrl(slug, reference, "billing");
  } else {
    callbackUrl = signupPaymentReturnUrl(reference);
  }
  await charges().doc(reference).create({
    reference,
    kind: input.kind,
    tenantId: input.tenantId,
    uid: input.uid,
    email: input.email,
    planId: input.planId ?? null,
    addonKey: input.addonKey ?? null,
    credits: input.credits ?? null,
    priceKobo: input.priceKobo,
    feeKobo,
    amountKobo,
    couponCode: input.couponCode ?? null,
    status: "pending",
    periodFrom: null,
    periodTo: null,
    gateway: "knomadpay",
    createdAt: new Date(),
    appliedAt: null,
  });

  const started = await startKnomadPayCharge({
    reference,
    amountKobo,
    currency: "NGN",
    customer: { email: input.email },
    description: input.description.slice(0, 100),
    callbackUrl,
    metadata: {
      purpose: "billing",
      kind: input.kind,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.addonKey ? { addonKey: input.addonKey } : {}),
    },
  });

  if (!started.ok) {
    console.error(`[billing] ${reference} not started: ${started.code} ${started.message} (after ${started.attempts} tries)`);
    return { ok: false, status: 502, error: "The payment page could not be opened. Please try again." };
  }
  if (!started.charge.checkoutUrl) {
    console.error(`[billing] ${reference} started with no checkout link`);
    return { ok: false, status: 502, error: "The payment page could not be opened. Please try again." };
  }
  return { ok: true, reference, checkoutUrl: started.charge.checkoutUrl, amountKobo };
}

export type ConfirmResult =
  | { state: "applied"; charge: BillingCharge }
  /** A signup charge that has been paid: create-tenant claims it. */
  | { state: "paid"; charge: BillingCharge }
  | { state: "unpaid"; detail: string }
  | { state: "refused"; error: string };

/**
 * Whether a billing charge has been paid, and if so, what it bought, applied once.
 * Safe to call any number of times, from anywhere.
 */
export async function confirmBillingCharge(reference: string): Promise<ConfirmResult> {
  const charge = await getBillingCharge(reference);
  if (!charge) return { state: "refused", error: "No such payment." };
  if (charge.status === "applied") return { state: "applied", charge };

  const verified = await verifyKnomadPayCharge(reference);
  if (!verified.success || !verified.data) {
    return { state: "unpaid", detail: verified.error ?? "not paid" };
  }
  // Knomad Pay has checked the amount paid against the amount asked, with Monnify. The
  // record is checked too, so a charge started for one thing cannot be read as another.
  if (verified.data.amount !== charge.amountKobo) {
    console.error(`[billing] ${reference}: charged ${verified.data.amount}, recorded ${charge.amountKobo}`);
    return { state: "refused", error: "The payment does not match what was being bought." };
  }
  if (verified.data.customerEmail.toLowerCase() !== charge.email.toLowerCase()) {
    console.error(`[billing] ${reference}: paid as ${verified.data.customerEmail}, recorded for ${charge.email}`);
    return { state: "refused", error: "This payment belongs to another account." };
  }
  const paidAt = new Date(verified.data.paidAt);
  const at = Number.isNaN(paidAt.getTime()) ? new Date() : paidAt;

  if (charge.kind === "signup") return { state: "paid", charge };
  if (charge.kind === "plan") return applyPlanCharge(charge, at);
  if (charge.kind === "credits") return applyCreditsCharge(charge, at);
  return applyAddonCharge(charge, at);
}

const latest = (...dates: (Date | null)[]) =>
  new Date(Math.max(...dates.filter((d): d is Date => d !== null).map((d) => d.getTime())));

async function applyPlanCharge(charge: BillingCharge, paidAt: Date): Promise<ConfirmResult> {
  const tenantId = charge.tenantId!;
  // Read before the transaction: the plan and a waiver are not changed by paying, and
  // the transaction re-reads what is (the tenant's paid time and this record). The live
  // plan's fee, as the status and the quote read it (lib/fee-waivers.ts).
  const billing = await getEffectiveBilling(tenantId, paidAt);
  if (!billing) return { state: "refused", error: "This business no longer exists." };
  // Free time is not paid for twice: a whole-fee waiver's days come first.
  const freeUntil =
    billing.waiver && billing.discountKobo >= billing.planMonthlyFee ? billing.waiver.endsAt : null;
  const tenantRef = adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId);
  const chargeRef = charges().doc(charge.reference);

  const { applied, slug, didApply } = await adminDb.runTransaction(async (tx) => {
    const [current, tenantDoc] = await Promise.all([tx.get(chargeRef), tx.get(tenantRef)]);
    const tenant = tenantDoc.data();
    if (!tenant) throw new Error(`tenant ${tenantId} not found`);
    const slug = tenant.slug as string;
    if (current.data()?.status === "applied") return { applied: fromStored(current.data()!), slug, didApply: false };
    const periodFrom = latest(paidAt, toDate(tenant.nextBillingDate), freeUntil);
    const periodTo = new Date(periodFrom.getTime() + PLAN_INTERVAL_MS);
    const now = new Date();
    tx.update(tenantRef, { nextBillingDate: periodTo, updatedAt: now });
    tx.update(chargeRef, { status: "applied", periodFrom, periodTo, appliedAt: now });
    writeChargeRevenue(tx, charge, tenantId, paidAt);
    return { applied: { ...charge, status: "applied" as const, periodFrom, periodTo, appliedAt: now }, slug, didApply: true };
  });

  invalidateBillingLock(tenantId);
  invalidateTenant(slug);
  // A receipt, from the one call that applied it, however many raced to.
  if (didApply) {
    await notifyPlanPaid(tenantId, applied.periodTo!, charge.amountKobo).catch((error) =>
      console.error(`[billing] receipt for ${charge.reference} not sent:`, error)
    );
  }
  console.info(`[billing] ${charge.reference}: plan for ${tenantId} paid to ${applied.periodTo?.toISOString()}`);
  return { state: "applied", charge: applied };
}

/**
 * Credits bought online: the balance, a `purchase` entry on the credit ledger keyed by
 * this charge, the charge flipped to `applied`, and its revenue entry, in one
 * transaction. The quota code needs no change: credits are credits, however bought.
 */
async function applyCreditsCharge(charge: BillingCharge, paidAt: Date): Promise<ConfirmResult> {
  const tenantId = charge.tenantId!;
  const credits = charge.credits;
  if (!credits || credits <= 0) return { state: "refused", error: "This payment names no credits." };
  const chargeRef = charges().doc(charge.reference);

  const { applied, balance } = await adminDb.runTransaction(async (tx) => {
    const current = await tx.get(chargeRef);
    if (current.data()?.status === "applied") return { applied: fromStored(current.data()!), balance: null };
    // Reads the balance, then writes it: before any write of ours.
    const balance = await addPurchasedCredits(tx, { tenantId, credits, reference: charge.reference, email: charge.email });
    const now = new Date();
    tx.update(chargeRef, { status: "applied", appliedAt: now });
    writeChargeRevenue(tx, charge, tenantId, paidAt);
    return { applied: { ...charge, status: "applied" as const, appliedAt: now }, balance };
  });

  // A receipt, from the one call that applied it (the only one with a balance).
  if (balance !== null) {
    await notifyPurchaseReceived(tenantId, {
      item: `${credits} voucher generation credits`,
      amountKobo: charge.amountKobo,
      detail: `You now have ${balance} credits. They are used after your plan's codes each cycle, and they never expire.`,
      path: "/admin/generate",
    }).catch((error) => console.error(`[billing] receipt for ${charge.reference} not sent:`, error));
  }

  console.info(`[billing] ${charge.reference}: ${credits} credits for ${tenantId}`);
  return { state: "applied", charge: applied };
}

async function applyAddonCharge(charge: BillingCharge, paidAt: Date): Promise<ConfirmResult> {
  const tenantId = charge.tenantId!;
  const key = charge.addonKey!;
  const addonDoc = await adminDb.collection(COLLECTIONS.ADDONS).doc(key).get();
  const addon = addonDoc.data();
  if (!addon) return { state: "refused", error: "This addon no longer exists." };
  const entitlementRef = adminDb.collection(TENANT_COLLECTIONS.entitlements(tenantId)).doc(key);
  const chargeRef = charges().doc(charge.reference);
  const subscription = addon.pricingModel === "subscription";
  const interval = addon.billingInterval === "yearly" ? "yearly" : "monthly";

  const { applied, didApply } = await adminDb.runTransaction(async (tx) => {
    const [current, entitlementDoc] = await Promise.all([tx.get(chargeRef), tx.get(entitlementRef)]);
    if (current.data()?.status === "applied") return { applied: fromStored(current.data()!), didApply: false };
    const now = new Date();
    const periodFrom = subscription ? latest(paidAt, toDate(entitlementDoc.data()?.currentPeriodEnd)) : null;
    const periodTo = periodFrom ? new Date(periodFrom.getTime() + addonIntervalMs(interval)) : null;
    writeEntitlement(tx, entitlementRef, {
      key,
      pricingModel: addon.pricingModel,
      amountPaid: charge.amountKobo,
      reference: charge.reference,
      currentPeriodEnd: periodTo,
      grantedAt: toDate(entitlementDoc.data()?.grantedAt) ?? now,
      now,
    });
    tx.update(chargeRef, { status: "applied", periodFrom, periodTo, appliedAt: now });
    writeChargeRevenue(tx, charge, tenantId, paidAt);
    return { applied: { ...charge, status: "applied" as const, periodFrom, periodTo, appliedAt: now }, didApply: true };
  });

  // A receipt, from the one call that applied it, however many raced to.
  if (didApply) {
    await notifyPurchaseReceived(tenantId, {
      item: `${addon.name ?? key} addon`,
      amountKobo: charge.amountKobo,
      detail: applied.periodTo
        ? `It is paid until ${formatDay(applied.periodTo)}. Nothing renews by itself: we will email you before then.`
        : "It is yours to keep: there is nothing more to pay.",
      path: "/admin/addons",
    }).catch((error) => console.error(`[billing] receipt for ${charge.reference} not sent:`, error));
  }
  console.info(`[billing] ${charge.reference}: ${key} for ${tenantId}${applied.periodTo ? ` to ${applied.periodTo.toISOString()}` : ""}`);
  return { state: "applied", charge: applied };
}

function writeEntitlement(
  tx: FirebaseFirestore.Transaction,
  ref: DocumentReference,
  e: {
    key: string;
    pricingModel: string;
    amountPaid: number;
    reference: string;
    currentPeriodEnd: Date | null;
    grantedAt: Date;
    now: Date;
  }
) {
  tx.set(
    ref,
    {
      addonKey: e.key,
      source: "purchase",
      status: "active",
      pricingModel: e.pricingModel,
      lastPaymentRef: e.reference,
      amountPaid: e.amountPaid,
      currentPeriodEnd: e.currentPeriodEnd,
      // A payment after a lapse clears the old lapse markers, or the grace-window
      // arithmetic would still be reading them.
      pastDueSince: null,
      cancelledAt: null,
      grantedAt: e.grantedAt,
      updatedAt: e.now,
    },
    { merge: true }
  );
}

/**
 * For create-tenant: checks a paid signup charge is this user's, for this plan and
 * price, and not used yet, and returns the write that claims it, for the batch that
 * creates the tenant. The write is conditional on the record being as read, so two
 * signups racing with one payment cannot both create a tenant.
 */
export async function prepareSignupClaim(input: {
  reference: string;
  uid: string;
  planId: string;
  priceKobo: number;
}): Promise<
  | {
      ok: true;
      charge: BillingCharge;
      claim: (batch: FirebaseFirestore.WriteBatch, tenantId: string, period: { from: Date; to: Date }) => void;
    }
  | { ok: false; status: number; error: string }
> {
  const confirmed = await confirmBillingCharge(input.reference);
  if (confirmed.state === "unpaid") return { ok: false, status: 402, error: "That payment has not gone through yet." };
  if (confirmed.state === "refused") return { ok: false, status: 400, error: confirmed.error };
  const charge = confirmed.charge;
  if (charge.kind !== "signup" || confirmed.state !== "paid") {
    return { ok: false, status: 409, error: "This payment has already been used." };
  }
  if (charge.uid !== input.uid) return { ok: false, status: 403, error: "This payment belongs to another account." };
  if (charge.planId !== input.planId || charge.priceKobo !== input.priceKobo) {
    return { ok: false, status: 400, error: "This payment was for a different plan or price." };
  }
  const ref = charges().doc(charge.reference);
  const snap = await ref.get();
  return {
    ok: true,
    charge,
    claim: (batch, tenantId, period) => {
      const now = new Date();
      batch.update(
        ref,
        { status: "applied", tenantId, periodFrom: period.from, periodTo: period.to, appliedAt: now },
        { lastUpdateTime: snap.updateTime! }
      );
      // When it was claimed, minutes at most after it was paid: the gateway's
      // paid time is not carried this far, and the entry needs a date.
      writeChargeRevenue(batch, charge, tenantId, now);
    },
  };
}

/** Billing charges started since `sinceMs` and not yet applied, for the reconcile cron. */
export async function listPendingBillingCharges(sinceMs: number): Promise<BillingCharge[]> {
  // One range filter and the status checked here: no composite index to build.
  const snap = await charges().where("createdAt", ">=", new Date(sinceMs)).get();
  return snap.docs.map((d) => fromStored(d.data())).filter((c) => c.status === "pending");
}
