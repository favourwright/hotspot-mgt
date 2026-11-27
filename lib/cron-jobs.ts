/**
 * The scheduled work. Driven by an external cron-job.org account calling
 * /api/cron/<job> over HTTPS. The systemd units in deploy/ are a kept
 * fallback and are NOT installed on the VPS - see docs/cron-jobs.md before
 * concluding a job is broken.
 *
 * Every job here obeys the same three rules:
 *
 * 1. **Bounded.** The VPS is 956MB with an OOM in its history
 *    (docs/deployment.md), so nothing walks an unbounded collection or holds
 *    a whole tenant's vouchers in memory.
 * 2. **Idempotent.** A timer that fires every 15 minutes will re-run the same
 *    work all day. Anything that sends email records that it did, and acts on
 *    transitions rather than on states.
 * 3. **Partial failure is fine.** One unreachable router must not stop the
 *    other tenants being processed, so each unit of work is caught
 *    individually and reported in the summary.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import {
  deleteHotspotUser,
  listHotspotUsers,
  testRouterConnection,
  HotspotUser,
} from "@/lib/mikrotik";
import { getRouterForLocation } from "@/lib/router-config";
import { parseRouterExpiryComment } from "@/lib/hotspot-users";
import { routerLogin } from "@/lib/router-credentials";
import {
  USERNAME_CHUNK,
  chunk,
  reapVerdict,
  reapViewOf,
  type ReapView,
} from "@/lib/voucher-reap";
import {
  notifyOwnerSalesDigest,
  notifyPlatformDailyDigest,
  notifyPlanFeeDue,
  notifyPlanFeeEnding,
  notifyPlanFeeLocked,
  notifyAddonRenewalDue,
  notifyRouterOffline,
  notifyVoucherExpiring,
} from "@/lib/notifications";
import {
  DISPLAY_TIME_ZONE,
  formatNaira,
  startOfTodayInDisplayZone,
} from "@/lib/utils";
import { planEntriesFor } from "@/lib/plan-map";
import { getPortalBranding } from "@/lib/portal-branding";
import { brandSyncKey, portalBrandName, writePortalBrand } from "@/lib/portal-brand-sync";
import type { EffectiveBranding } from "@/lib/branding";
import { TenantBrandingSchema, type TenantBranding } from "@/types/schemas";
import { writePortalFile } from "@/lib/mikrotik";
import { fulfilVoucherPurchase, paymentDocId } from "@/lib/voucher-fulfilment";
import { knomadPayConfigured, verifyKnomadPayCharge } from "@/lib/knomad-pay";
import { listRecentPendingPurchases } from "@/lib/pending-purchases";
import { confirmBillingCharge, listPendingBillingCharges } from "@/lib/billing-charges";
import { ensureTenantPayee } from "@/lib/knomad-pay-payees";
import { resolveSaleBuyer } from "@/lib/sale-buyer";
import { runDueDeliveries } from "@/lib/webhooks";
import { runStatsRollup } from "@/lib/stats-rollup";
import { PLAN_MAP_FILE, buildPlanMap } from "@/lib/hotspot-portal";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getPlanFeeState } from "@/lib/fee-waivers";
import { invalidateTenantFleet } from "@/lib/tenant-fleet";
import {
  activateGeneratedCodes,
  resumeStalledBatches,
} from "@/lib/voucher-generation";

/**
 * How long before a waiver closes the owner is warned.
 *
 * Three days, matching the entitlement grace window: long enough to act on,
 * short enough that the mail still reads as about something imminent.
 */
const PLAN_FEE_WARNING_MS = 3 * 24 * 60 * 60 * 1000;

export type CronJobName =
  | "router-health"
  | "voucher-expiry"
  | "payment-reconcile"
  | "sales-digest"
  | "plan-fee-due"
  | "voucher-reap"
  | "webhook-deliver";

export const CRON_JOBS: CronJobName[] = [
  "router-health",
  "voucher-expiry",
  "payment-reconcile",
  "sales-digest",
  "plan-fee-due",
  "voucher-reap",
  "webhook-deliver",
];

export function isCronJob(value: string): value is CronJobName {
  return (CRON_JOBS as string[]).includes(value);
}

export interface CronResult {
  job: CronJobName;
  ok: boolean;
  summary: Record<string, number>;
  errors: string[];
  ms: number;
}

/* ------------------------------------------------------------------ shared */

async function activeTenants(): Promise<
  Array<{
    id: string;
    businessName: string;
    /** The name on the router-rendered portal pages (lib/portal-brand-sync.ts). */
    portalName: string;
    /** Whether the plan includes custom branding is read off this. */
    planId: string | null;
    branding: TenantBranding | null;
  }>
> {
  const snap = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("status", "==", "active")
    .get();
  // The name comes along because the platform digest lists tenants by name
  // and the document is already read here; fetching it again per tenant
  // would be a read per tenant for a string we had in hand.
  // The branding rides along for the same reason: router-health needs it
  // for every tenant with a portal installed, and it is on this document.
  return snap.docs.map((d) => {
    const data = d.data();
    const branding = TenantBrandingSchema.safeParse(data.branding ?? {});
    return {
      id: d.id,
      businessName: (data.businessName as string) ?? d.id,
      portalName: portalBrandName(data),
      planId: typeof data.planId === "string" && data.planId ? data.planId : null,
      branding: branding.success ? branding.data : null,
    };
  });
}

/* ------------------------------------------------------- job: router-health */

/**
 * Polls every active tenant's routers. Reaching the router is the expensive
 * part, so everything that needs one shares the single connection:
 *
 *  - flips `Router.status` and emails the owner **on the transition into
 *    offline**, never on the state. A router down overnight would otherwise
 *    mail them every tick until morning.
 *  - reads each hotspot user's comment back and fills in `Voucher.expiresAt`
 *    for vouchers still holding null. The router's on-login script writes the
 *    real expiry there at first login; this is how that reaches Firestore for
 *    purchases the auto-login path in /api/payment/verify did not cover.
 *  - rewrites `plan.json` in every installed portal directory, which is
 *    the only way the router-rendered status and alogin pages can show a
 *    customer their expiry date and data allowance. See lib/plan-map.ts.
 *
 * That makes this job the heartbeat those pages depend on: if it stops, the
 * dates they show go stale rather than wrong, because the map is rewritten
 * whole on every pass.
 */
async function runRouterHealth(): Promise<Omit<CronResult, "job" | "ms">> {
  const errors: string[] = [];
  let checked = 0;
  let wentOffline = 0;
  let cameOnline = 0;
  let expiryFilled = 0;
  let mapsWritten = 0;
  let codesActivated = 0;

  for (const tenant of await activeTenants()) {
    // Decided once per tenant per pass, and only if one of their portals is
    // actually looked at: the plan lookup behind it is skipped outright for
    // a tenant with nothing saved.
    let portalBrand: Promise<PortalBrand> | null = null;
    const brandFor = () =>
      (portalBrand ??= getPortalBranding(tenant.planId, tenant.branding).then(
        (branding) => ({
          brandName: tenant.portalName,
          branding,
          key: brandSyncKey(branding, tenant.branding?.version ?? 0),
        })
      ));

    let routers;
    try {
      routers = await adminDb
        .collection(TENANT_COLLECTIONS.routers(tenant.id))
        .where("active", "==", true)
        .get();
    } catch (error) {
      errors.push(`tenant ${tenant.id}: ${String(error)}`);
      continue;
    }

    for (const routerDoc of routers.docs) {
      const router = routerDoc.data();
      checked++;

      // The tunnel address first, matching every other router call site. A
      // router reachable only over WireGuard was otherwise probed on its
      // LAN IP and reported as an outage it was not having.
      let login: ReturnType<typeof routerLogin>;
      try {
        login = routerLogin(router);
      } catch (error) {
        // Our key, not their router: reporting it offline would email the owner
        // about an outage they are not having.
        errors.push(`router ${routerDoc.id}: ${String(error)}`);
        continue;
      }
      const config = { ip: router.wireguardTunnelIp || router.routerIp, ...login };

      // A router with no IP yet has never finished provisioning. Not an
      // outage, so it is skipped rather than reported as one.
      if (!config.ip) continue;

      const reachable = await testRouterConnection(config);
      const previous = router.status as string | undefined;
      const next = reachable.success ? "online" : "offline";

      if (previous !== next) {
        try {
          await routerDoc.ref.update({
            status: next,
            updatedAt: FieldValue.serverTimestamp(),
          });
          // The admin notice region names offline routers.
          invalidateTenantFleet(tenant.id);
        } catch (error) {
          errors.push(`router ${routerDoc.id}: ${String(error)}`);
        }
      }

      if (next === "offline") {
        // Only on the transition, and only from a state that was genuinely
        // working. "pending" means it never came up, which is a provisioning
        // problem the owner is already looking at.
        if (previous === "online") {
          wentOffline++;
          await notifyRouterOffline({
            tenantId: tenant.id,
            routerName: router.name ?? "Unnamed router",
            lastSeen: router.updatedAt instanceof Timestamp
              ? router.updatedAt.toDate()
              : null,
          });
        }
        continue;
      }

      if (previous === "offline") cameOnline++;

      // Online, so do the per-user work while the connection is good.
      try {
        const synced = await syncRouterUsers(tenant.id, routerDoc.id, config, brandFor);
        expiryFilled += synced.filled;
        mapsWritten += synced.mapped;
        codesActivated += synced.activated;
      } catch (error) {
        errors.push(`expiry ${routerDoc.id}: ${String(error)}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    summary: { checked, wentOffline, cameOnline, expiryFilled, mapsWritten, codesActivated },
    errors,
  };
}

/**
 * Everything that needs the router's hotspot user list, on one listing.
 *
 * Reaching the router is the expensive part of this job, and two separate
 * pieces of work need the same data, so they share a single call:
 *
 *  - `plan.json` is rewritten in every portal directory installed against
 *    this router, which is what the router-rendered status and alogin pages
 *    read to show a customer when their plan runs out and how much data is
 *    left on it.
 *  - vouchers still holding a null `expiresAt` are filled in from the
 *    comment the on-login script wrote at first login.
 *
 * Neither half can fail the other: a router with no portal installed still
 * gets its vouchers backfilled, and a tenant with no pending vouchers still
 * gets a fresh map.
 */
async function syncRouterUsers(
  tenantId: string,
  routerId: string,
  config: { ip: string; username: string; password: string },
  brandFor: () => Promise<PortalBrand>
): Promise<{ filled: number; mapped: number; activated: number }> {
  const users = await listHotspotUsers(config);
  if (!users.success || !users.data) return { filled: 0, mapped: 0, activated: 0 };

  // Generated codes first, so a code first used since the last tick already
  // has its voucher document when the plan map below is built from them.
  // Never allowed to fail the rest of the tick (docs/voucher-generation.md).
  let activated = 0;
  try {
    activated = await activateGeneratedCodes(
      tenantId,
      routerId,
      users.data,
      parseRouterExpiryComment
    );
    await resumeStalledBatches(tenantId, routerId);
  } catch (error) {
    console.error(`[router-health] voucher generation on ${routerId}:`, error);
  }

  const mapped = await writePlanMaps(tenantId, routerId, config, users.data, brandFor);
  const filled = await backfillExpiry(tenantId, users.data);

  return { filled, mapped, activated };
}

/**
 * One map per installed portal directory on this router.
 *
 * Driven off `portalHtmlDirectory` rather than written blindly: a location
 * whose portal was never installed, or has been uninstalled, has no
 * directory of ours to write into, and creating one would leave a stray
 * file behind on a router we are meant to have left alone.
 */
async function writePlanMaps(
  tenantId: string,
  routerId: string,
  config: { ip: string; username: string; password: string },
  users: HotspotUser[],
  brandFor: () => Promise<PortalBrand>
): Promise<number> {
  const locations = await adminDb
    .collection(TENANT_COLLECTIONS.locations(tenantId))
    .where("routerId", "==", routerId)
    .get();

  const directories = new Set<string>();
  for (const doc of locations.docs) {
    const directory = doc.data().portalHtmlDirectory;
    if (typeof directory === "string" && directory) directories.add(directory);
  }
  if (directories.size === 0) return 0;

  // Branding, and the pages that read it, only where the location's
  // recorded key has fallen behind. Never allowed to stop the plan map
  // below, which is what customers' expiry dates depend on.
  try {
    await syncPortalBrands(config, locations.docs, await brandFor());
  } catch (error) {
    console.error(`[router-health] portal branding on ${routerId}:`, error);
  }

  const contents = buildPlanMap(await planEntriesFor(tenantId, users));

  let written = 0;
  for (const directory of directories) {
    const result = await writePortalFile(
      config,
      directory,
      PLAN_MAP_FILE,
      contents
    );
    if (result.success) written += 1;
  }
  return written;
}

/** What router-health writes into a tenant's portals, and the key it is recorded under. */
interface PortalBrand {
  brandName: string;
  branding: EffectiveBranding | null;
  key: string;
}

/**
 * Rewrites brand.json and the two router pages in each portal directory
 * whose `portalBrandSynced` differs from the key, and records the key only
 * when every file landed. Two locations sharing a directory are written
 * once. See lib/portal-brand-sync.ts.
 */
async function syncPortalBrands(
  config: { ip: string; username: string; password: string },
  locations: FirebaseFirestore.QueryDocumentSnapshot[],
  brand: PortalBrand
): Promise<void> {
  const written = new Map<string, boolean>();

  for (const doc of locations) {
    const data = doc.data();
    const directory = data.portalHtmlDirectory;
    if (typeof directory !== "string" || !directory) continue;
    if (data.portalBrandSynced === brand.key) continue;

    let ok = written.get(directory);
    if (ok === undefined) {
      const result = await writePortalBrand(config, directory, brand);
      ok = result.success;
      written.set(directory, ok);
      if (!ok) {
        console.error(
          `[router-health] portal branding in ${directory}: ${result.errors.join("; ")}`
        );
      }
    }
    if (ok) await doc.ref.update({ portalBrandSynced: brand.key });
  }
}

/**
 * Only vouchers still holding a null `expiresAt` are looked at, so a router
 * full of long-settled users costs no writes at all.
 */
async function backfillExpiry(
  tenantId: string,
  users: HotspotUser[]
): Promise<number> {
  const pending = await adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .where("status", "==", "active")
    .where("expiresAt", "==", null)
    .limit(500)
    .get();

  if (pending.empty) return 0;

  const expiryByName = new Map<string, Date>();
  for (const u of users) {
    const expiry = parseRouterExpiryComment(u.comment);
    if (expiry && u.name) expiryByName.set(u.name, expiry);
  }
  if (expiryByName.size === 0) return 0;

  let written = 0;
  let batch = adminDb.batch();
  let inBatch = 0;

  for (const doc of pending.docs) {
    const expiry = expiryByName.get(doc.data().username);
    if (!expiry) continue;

    batch.update(doc.ref, { expiresAt: expiry });
    written++;
    inBatch++;

    // Firestore caps a batch at 500 writes; committing at 400 leaves room
    // and keeps peak memory small on a 956MB box.
    if (inBatch >= 400) {
      await batch.commit();
      batch = adminDb.batch();
      inBatch = 0;
    }
  }

  if (inBatch > 0) await batch.commit();
  return written;
}

/* ------------------------------------------------------ job: voucher-expiry */

/** How far ahead of expiry the reminder goes out. */
const EXPIRY_WARNING_MS = 60 * 60 * 1000;

/**
 * Emails customers whose access runs out within the warning window.
 *
 * A collection-group query, so it is one query for the whole platform rather
 * than one per tenant. Needs the composite index in firestore.indexes.json.
 */
async function runVoucherExpiry(): Promise<Omit<CronResult, "job" | "ms">> {
  const errors: string[] = [];
  const now = new Date();
  const until = new Date(now.getTime() + EXPIRY_WARNING_MS);
  let notified = 0;

  let snapshot;
  try {
    snapshot = await adminDb
      .collectionGroup("vouchers")
      .where("status", "==", "active")
      .where("expiresAt", ">=", now)
      .where("expiresAt", "<=", until)
      .limit(200)
      .get();
  } catch (error) {
    // A missing composite index surfaces here with an explicit message and a
    // link to create it, rather than silently returning nothing.
    return {
      ok: false,
      summary: { notified: 0 },
      errors: [`expiry query failed: ${String(error)}`],
    };
  }

  for (const doc of snapshot.docs) {
    const voucher = doc.data();

    // Sent once per voucher. Without this the same customer is mailed on
    // every tick for the whole hour before they expire.
    if (voucher.expiryNotifiedAt) continue;

    const tenantId = voucher.tenantId ?? doc.ref.parent.parent?.id;
    if (!tenantId || !voucher.userEmail) continue;

    try {
      await notifyVoucherExpiring({
        tenantId,
        customerEmail: voucher.userEmail,
        planName: voucher.planName ?? "",
        expiresAt:
          voucher.expiresAt instanceof Timestamp
            ? voucher.expiresAt.toDate()
            : new Date(voucher.expiresAt),
      });
      await doc.ref.update({ expiryNotifiedAt: FieldValue.serverTimestamp() });
      notified++;
    } catch (error) {
      errors.push(`voucher ${doc.id}: ${String(error)}`);
    }
  }

  // Close out everything whose date has passed. Nothing else in the codebase
  // ever writes `status: "expired"` to a voucher, so without this every
  // voucher stays "active" forever: the crons sync the expiry *date* and not
  // the *status*. The visible symptom is the admin Users page reporting
  // "the platform and the router disagree about them" once per expired
  // voucher, growing by one with every plan that runs out.
  //
  // Decided on our own `expiresAt` rather than on the router's verdict,
  // because this is what the customer was sold and it holds even when the
  // router is unreachable. The separate drift warning for "past its expiry
  // date but still enabled on the router" is deliberately left alone: that
  // one is a real router-side failure to enforce, and marking the voucher
  // expired here must not hide it.
  let expired = 0;
  try {
    const stale = await adminDb
      .collectionGroup("vouchers")
      .where("status", "==", "active")
      .where("expiresAt", "<=", now)
      .limit(300)
      .get();

    // One batch, committed once: these are small and a partial commit would
    // leave the page reporting drift for whatever did not make it.
    if (!stale.empty) {
      const batch = adminDb.batch();
      for (const doc of stale.docs) {
        batch.update(doc.ref, {
          status: "expired",
          expiredAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      expired = stale.size;
    }
  } catch (error) {
    errors.push(`expiry close-out failed: ${String(error)}`);
  }

  return { ok: errors.length === 0, summary: { notified, expired }, errors };
}


/* -------------------------------------------------- job: payment-reconcile */

/**
 * How long a charge is given to be fulfilled by the normal paths before this
 * job treats it as orphaned. Long enough that a slow browser or a retried
 * webhook is not fought with, short enough that a customer is not left
 * stranded for an hour.
 */
const FULFILMENT_GRACE_MS = 10 * 60 * 1000;

/** How far back to look. One pass covers a full day of missed webhooks. */
const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The last line of defence for "money arrived, nothing was delivered".
 *
 * Fulfilment has two paths already: the buyer's browser calling
 * /api/payment/verify, and Knomad Pay's `charge.succeeded` event. Both can
 * fail. The browser is on a captive portal mid bank-redirect; the event
 * depends on the gateway reaching us and on us being up when it does.
 *
 * So this asks Knomad Pay about every checkout of the last day, and fulfils
 * what was paid but never recorded. It exists because exactly this went
 * wrong once and nobody found out for a day: a 500 naira portal purchase
 * produced no voucher, no record and no email.
 *
 * Fulfils rather than merely alerting. The customer paid; the work is
 * idempotent; and a job that only reports would still leave someone waiting
 * for a human to read a log. Fulfilment sends the customer their voucher
 * email, and emails the owner if the router could not be programmed.
 */
async function runPaymentReconcile(): Promise<Omit<CronResult, "job" | "ms">> {
  const errors: string[] = [];
  let checked = 0;
  let orphaned = 0;
  let fulfilled = 0;
  let skippedCount = 0;

  // No list to page through: this app's own pending purchases of the window, each
  // asked of the gateway.
  if (knomadPayConfigured()) {
    try {
      const recent = await listRecentPendingPurchases(Date.now() - RECONCILE_WINDOW_MS);
      for (const pending of recent) {
        const verified = await verifyKnomadPayCharge(pending.reference);
        if (!verified.success || !verified.data) continue;
        if (Date.now() - new Date(verified.data.paidAt).getTime() < FULFILMENT_GRACE_MS) continue;
        checked += 1;
        const tally = { orphaned, fulfilled, skipped: skippedCount, errors };
        await recoverSale(
          {
            reference: pending.reference,
            planId: pending.planId,
            locationId: pending.locationId,
            tenantId: pending.tenantId,
            userId: pending.userId,
            email: pending.userEmail,
            deviceMac: pending.deviceMac,
            deviceIp: pending.deviceIp,
          },
          tally
        );
        ({ orphaned, fulfilled, skipped: skippedCount } = tally);
      }
    } catch (error) {
      errors.push(`knomad pay reconcile failed: ${String(error)}`);
    }
  }

  const billing = knomadPayConfigured() ? await reconcileBillingCharges(errors) : { applied: 0 };
  const payees = knomadPayConfigured() ? await makeMissingPayees(errors) : { made: 0 };

  const ledgersPurged = await purgeExpiredLedgers(errors);

  return {
    ok: errors.length === 0,
    summary: {
      checked,
      orphaned,
      fulfilled,
      skipped: skippedCount,
      ledgersPurged,
      billingApplied: billing.applied,
      payeesMade: payees.made,
    },
    errors,
  };
}

/** A paid sale found by reconciliation. */
interface ReconciledSale {
  reference: string;
  planId: string;
  locationId: string;
  tenantId: string;
  userId: string | undefined;
  email: string | undefined;
  deviceMac: string | null;
  deviceIp: string | null;
}

interface ReconcileTally {
  orphaned: number;
  fulfilled: number;
  skipped: number;
  errors: string[];
}

/**
 * One paid sale: fulfilled unless it already was, was set aside, or is under review.
 */
/** How far back unreported billing payments are looked for: a few days of retries. */
const BILLING_RECONCILE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** A paid signup still unclaimed after this has lost its browser: someone must look. */
const SIGNUP_CLAIM_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Payments to the platform (plan periods, addons) that were paid but never reported
 * back by the dashboard: applied here, the same way and only once (lib/billing-charges.ts).
 *
 * A signup's payment is not applied here: it creates a tenant, which needs the form the
 * owner filled in. One paid and still unclaimed after a day is reported, for someone to
 * finish the signup or refund it.
 */
async function reconcileBillingCharges(errors: string[]): Promise<{ applied: number }> {
  let applied = 0;
  try {
    const pending = await listPendingBillingCharges(Date.now() - BILLING_RECONCILE_WINDOW_MS);
    for (const charge of pending) {
      if (charge.kind === "signup" && Date.now() - charge.createdAt.getTime() < SIGNUP_CLAIM_GRACE_MS) continue;
      const result = await confirmBillingCharge(charge.reference);
      if (result.state === "applied") applied += 1;
      else if (result.state === "paid") {
        errors.push(`signup payment ${charge.reference} (${charge.email}) is paid but no business was created: finish it or refund it`);
      } else if (result.state === "refused") {
        errors.push(`billing payment ${charge.reference}: ${result.error}`);
      }
    }
  } catch (error) {
    errors.push(`billing reconcile failed: ${String(error)}`);
  }
  return { applied };
}

/**
 * Tenants on Knomad Pay with no payee yet: made here from their bank details, so a
 * signup whose payee could not be made at the time (Monnify unreachable, or not yet
 * allowing sub-accounts) starts selling once it can. Until then their sales are refused.
 * What needs a person (a bank that cannot be matched, a name that does not agree) is
 * reported; a provider that is unavailable is simply tried again next run.
 */
async function makeMissingPayees(errors: string[]): Promise<{ made: number }> {
  let made = 0;
  try {
    const snap = await adminDb.collection(COLLECTIONS.TENANTS).where("paymentGateway", "==", "knomadpay").get();
    for (const doc of snap.docs) {
      const t = doc.data();
      if (t.knomadPayeeReference || t.kpTest) continue;
      const outcome = await ensureTenantPayee({
        id: doc.id,
        businessName: t.businessName,
        ownerEmail: t.ownerEmail,
        bankName: t.bankName ?? null,
        bankCode: t.bankCode ?? null,
        accountNumber: t.accountNumber ?? null,
        accountName: t.accountName ?? null,
        knomadPayeeReference: null,
      });
      if (outcome.kind === "ready") {
        if (outcome.created) made += 1;
      } else if (outcome.kind !== "unavailable") {
        errors.push(`tenant ${t.slug}: no payee, ${outcome.kind}${"detail" in outcome ? ` (${outcome.detail})` : ""}`);
      }
    }
  } catch (error) {
    errors.push(`payee pass failed: ${String(error)}`);
  }
  return { made };
}

async function recoverSale(sale: ReconciledSale, tally: ReconcileTally): Promise<void> {
  const { reference, planId, locationId, tenantId } = sale;
  try {
      const existing = await adminDb
        .collection(TENANT_COLLECTIONS.payments(tenantId))
        .where("reference", "==", reference)
        .limit(1)
        .get();
      if (!existing.empty) return;

      tally.orphaned += 1;

      // Deliberately left unfulfilled by a human: a refund, a chargeback, a
      // test charge, or a case already settled off-platform. Without this the
      // job would "helpfully" issue a voucher for something somebody decided
      // not to honour, and would do it again on every tick.
      const skipped = await adminDb
        .collection(COLLECTIONS.RECONCILE_SKIPS)
        .doc(reference)
        .get();
      if (skipped.exists) {
        tally.skipped += 1;
        return;
      }

      // Already recorded as paid-but-not-fulfillable, and already emailed
      // to the platform. Retrying it every tick would change nothing.
      const underReview = await adminDb
        .collection(COLLECTIONS.PAYMENT_REVIEWS)
        .doc(paymentDocId(reference))
        .get();
      if (underReview.exists) {
        tally.skipped += 1;
        return;
      }

      const email = sale.email;
      const buyer = await resolveBuyer(sale.userId, email);
      if (!buyer) {
        // Deliberately loud and deliberately not fatal: this is real money
        // with no account to attach it to, and it needs a human.
        tally.errors.push(
          `${reference}: paid by ${email ?? "unknown"} with no matching account`
        );
        return;
      }

      const result = await fulfilVoucherPurchase({
        reference,
        planId,
        locationId,
        tenantId,
        deviceMac: sale.deviceMac,
        deviceIp: sale.deviceIp,
        buyer,
      });

      if (result.ok && result.outcome === "in_progress") {
        // Being worked on right now by the browser or the webhook. A
        // stalled one is resumed on a later tick, once its lease lapses.
        tally.skipped += 1;
      } else if (result.ok) {
        tally.fulfilled += 1;
        console.warn(
          `[reconcile] recovered unfulfilled payment ${reference} ` +
            `(${result.outcome}) for tenant ${tenantId}`
        );
      } else {
        tally.errors.push(`${reference}: ${result.error}`);
      }
  } catch (error) {
    tally.errors.push(`${reference}: ${String(error)}`);
  }
}

/** Per tick. Every 15 minutes, that is far more than a day's sales. */
const LEDGER_PURGE_BATCH = 100;

/**
 * Deletes fulfilment ledgers past their `deleteAt`.
 *
 * This is the job a Firestore TTL policy would do, and does not, because TTL
 * policies need the Blaze plan and this project is on Spark. A ledger holds
 * the voucher password it provisioned, so keeping every one forever would
 * leave a second copy of every password ever sold. Payments are the
 * permanent record and are never touched here.
 *
 * Lives in this job because it is the one already registered and running
 * every 15 minutes, so the cleanup needed no new cron-job.org entry. The
 * field keeps the TTL-friendly name, so switching to a real policy later is
 * a console setting and deleting this function.
 *
 * Bounded (one batch per tick), and a failure is reported, not fatal: it
 * must never stand between a customer and an unfulfilled charge above.
 */
async function purgeExpiredLedgers(errors: string[]): Promise<number> {
  let purged = 0;
  // Pending purchases age out the same way: kept to reconcile against, then
  // dropped. Each collection gets its own batch so one failing does not
  // stop the other.
  for (const collection of [
    COLLECTIONS.FULFILMENTS,
    COLLECTIONS.PENDING_PURCHASES,
    COLLECTIONS.HOOK_CALLS,
    COLLECTIONS.HOOK_LINK_STATES,
    COLLECTIONS.WEBHOOK_EVENTS,
    COLLECTIONS.WEBHOOK_DELIVERIES,
  ]) {
    try {
      const expired = await adminDb
        .collection(collection)
        .where("deleteAt", "<=", new Date())
        .limit(LEDGER_PURGE_BATCH)
        .get();
      if (expired.empty) continue;

      const batch = adminDb.batch();
      for (const doc of expired.docs) batch.delete(doc.ref);
      await batch.commit();
      purged += expired.size;
    } catch (error) {
      errors.push(`${collection} purge failed: ${String(error)}`);
    }
  }
  return purged;
}

/** Same resolution the webhook uses: metadata first, then the charged email. */
const resolveBuyer = resolveSaleBuyer;


/* ------------------------------------------------------- job: sales-digest */


/**
 * Yesterday's sales, one email per tenant.
 *
 * The quiet alternative to `owner.voucher_sold`, which fires on every single
 * sale. A location selling thirty vouchers a day sends thirty emails, the
 * owner mutes the sender, and the failure alerts that share that address go
 * with it. Both exist; which one actually sends is decided by whichever has
 * a Mailtrap template ID configured at /superadmin/emails.
 *
 * Sent only for a day that had at least one sale. A daily "you sold nothing"
 * email is itself a reason to mute us.
 */
async function runSalesDigest(): Promise<Omit<CronResult, "job" | "ms">> {
  const errors: string[] = [];
  let tenantsWithSales = 0;
  let sent = 0;

  // Yesterday in full, in the server's timezone. Deliberately a closed window
  // rather than "the last 24 hours": a digest that overlaps itself would
  // count the same sale twice if the job ever ran late or twice.
  // Yesterday in Lagos, not on the VPS's UTC clock - a digest headed
  // "Thursday" should cover the day its readers lived through.
  const end = startOfTodayInDisplayZone();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const dayFormat: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    // The VPS runs UTC, so without this the digest names the day in a
    // timezone no reader of it lives in.
    timeZone: DISPLAY_TIME_ZONE,
  };
  const period = start.toLocaleDateString("en-GB", dayFormat);

  // Platform-wide accumulators, filled by the same loop rather than a second
  // pass: the tenant list and their payments are already in hand, and
  // querying twice to send two emails about the same day would be wasteful.
  let platformVouchers = 0;
  let platformGross = 0;
  let platformRevenue = 0;
  const platformRows: Array<{ name: string; count: number; gross: number }> = [];
  const attention: string[] = [];

  for (const tenant of await activeTenants()) {
    try {
      const payments = await adminDb
        .collection(TENANT_COLLECTIONS.payments(tenant.id))
        .where("createdAt", ">=", start)
        .where("createdAt", "<", end)
        .get();

      const sales = payments.docs
        .map((d) => d.data())
        .filter((p) => p.status === "success");

      if (sales.length === 0) continue;
      tenantsWithSales += 1;

      let gross = 0;
      // Null once any sale in the period had an unknown split. A total that
      // silently omits a sale is worse than no total: it reads as exact.
      let share: number | null = 0;
      const byLocation = new Map<string, { count: number; gross: number }>();

      for (const sale of sales) {
        const amount = Number(sale.amount) || 0;
        gross += amount;

        if (share !== null) {
          const s = sale.tenantShareKobo;
          if (typeof s === "number") share += s;
          else share = null;
        }

        const name = (sale.locationName as string) || "Unknown location";
        const row = byLocation.get(name) ?? { count: 0, gross: 0 };
        row.count += 1;
        row.gross += amount;
        byLocation.set(name, row);
      }

      const locationBreakdown = [...byLocation.entries()]
        .sort((a, b) => b[1].gross - a[1].gross)
        .map(
          ([name, row]) =>
            `${name}: ${row.count} voucher${row.count === 1 ? "" : "s"}, ` +
            `${formatNaira(row.gross)}`
        )
        // Joined with a separator rather than newlines: this lands in a
        // single escaped Handlebars value in an HTML email, where a newline
        // collapses to a space and the locations run together. Escaped, not
        // raw HTML, because location names are tenant-controlled.
        .join(" | ");

      platformVouchers += sales.length;
      platformGross += gross;
      for (const sale of sales) {
        const p = sale.platformShareKobo;
        if (typeof p === "number") platformRevenue += p;
      }
      platformRows.push({
        name: tenant.businessName,
        count: sales.length,
        gross,
      });

      await notifyOwnerSalesDigest({
        tenantId: tenant.id,
        period,
        voucherCount: sales.length,
        grossKobo: gross,
        tenantShareKobo: share,
        locationBreakdown,
      });
      sent += 1;
    } catch (error) {
      errors.push(`tenant ${tenant.id}: ${String(error)}`);
    }
  }

  // The half that matters: everything still broken as of this morning. Each
  // of these is a thing that stays broken until a person looks at it.
  // A failed scan must never render as "Nothing needs attention". Saying all
  // is well when we could not check is the exact failure this email exists to
  // prevent, and it is the most believable kind of lie: it looks like good
  // news. Report the failure in the email itself, not only in the job log.
  let attentionFailed = false;
  try {
    attention.push(...(await platformAttention()));
  } catch (error) {
    attentionFailed = true;
    errors.push(`attention scan: ${String(error)}`);
  }

  try {
    await notifyPlatformDailyDigest({
      period,
      voucherCount: platformVouchers,
      grossKobo: platformGross,
      platformRevenueKobo: platformRevenue,
      tenantCount: platformRows.length,
      tenantBreakdown: platformRows
        .sort((a, b) => b.gross - a.gross)
        .map(
          (r) =>
            `${r.name}: ${r.count} voucher${r.count === 1 ? "" : "s"}, ` +
            `${formatNaira(r.gross)}`
        )
        .join(" | "),
      attention: attentionFailed
        ? "Could not be checked - the scan failed. Check the superadmin dashboard directly."
        : attention.length
          ? attention.join(" | ")
          : "Nothing needs attention.",
    });
  } catch (error) {
    errors.push(`platform digest: ${String(error)}`);
  }

  // The dashboards' stored days (lib/stats-rollup.ts). Here because this is
  // the job that already runs once a day just after the day ends, and after
  // the emails so a slow rollup never delays them. Suspended tenants too:
  // one suspended this morning still sold yesterday, and the platform's
  // daily total is the sum of the tenants'.
  let statsTenants = 0;
  try {
    const rollup = await runStatsRollup(await sellingTenantIds());
    statsTenants = rollup.tenants;
    errors.push(...rollup.errors);
  } catch (error) {
    errors.push(`stats rollup: ${String(error)}`);
  }

  return {
    ok: errors.length === 0,
    summary: {
      tenantsWithSales,
      sent,
      platformVouchers,
      needsAttention: attention.length,
      statsTenants,
    },
    errors,
  };
}

/** Every tenant that can have sold anything: not still onboarding. */
async function sellingTenantIds(): Promise<string[]> {
  const snap = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("status", "in", ["active", "suspended"])
    .select()
    .get();
  return snap.docs.map((d) => d.id);
}

/**
 * What is currently wrong across the platform.
 *
 * Counts rather than lists: a digest is a prompt to go and look, not the
 * place to resolve anything. Each line names where to look.
 *
 * Every query here is a `count()` aggregation, which bills one read rather
 * than one per document. That matters: this platform has already taken
 * itself down once by exhausting the daily read quota with unbounded
 * queries over tiny collections.
 */
async function platformAttention(): Promise<string[]> {
  const out: string[] = [];

  const failedVouchers = await adminDb
    .collectionGroup("vouchers")
    .where("status", "==", "failed")
    .count()
    .get();
  const failed = failedVouchers.data().count;
  if (failed > 0) {
    out.push(`${failed} voucher${failed === 1 ? "" : "s"} failed on the router`);
  }

  const offlineRouters = await adminDb
    .collectionGroup("routers")
    .where("status", "==", "offline")
    .count()
    .get();
  const offline = offlineRouters.data().count;
  if (offline > 0) {
    out.push(`${offline} router${offline === 1 ? "" : "s"} offline`);
  }

  const suspended = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("status", "==", "suspended")
    .count()
    .get();
  const n = suspended.data().count;
  if (n > 0) out.push(`${n} tenant${n === 1 ? "" : "s"} suspended`);

  return out;
}

/* ---------------------------------------------------------------- dispatch */

/**
 * Tells an owner their waived plan fee is coming back, before and after it
 * does.
 *
 * This is the only thing that says so before it happens, which matters more
 * than it used to: a waiver closing now starts a grace window, and when that
 * runs out new voucher sales stop (lib/billing-lock.ts). The warning email
 * is the tenant's one chance to act before trading is interrupted, so this
 * job not being registered at cron-job.org is no longer only a silence
 * problem - it is a tenant finding out by a sale failing.
 *
 * Reads every waiver in one collection-group query with no `where` clause:
 * the collection is small, the filtering is the same clock comparison
 * `isWaiverActive` makes, and there is no composite index to build or to
 * silently return nothing while it does.
 *
 * Both sends are stamped on the waiver so each goes once rather than on
 * every tick, the same way `expiryNotifiedAt` works above.
 */
async function runPlanFeeDue(): Promise<Omit<CronResult, "job" | "ms">> {
  const now = new Date();
  const warnFrom = new Date(now.getTime() + PLAN_FEE_WARNING_MS);

  let warned = 0;
  let due = 0;
  let locked = 0;
  const errors: string[] = [];

  const snapshot = await adminDb.collectionGroup("feeWaivers").get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const tenantId = doc.ref.parent.parent?.id;
    if (!tenantId) continue;

    // Revoked waivers are history. A waiver with no end date never closes,
    // so there is nothing to warn about.
    if (data.revokedAt) continue;
    const endsAt =
      data.endsAt instanceof Timestamp ? data.endsAt.toDate() : null;
    if (!endsAt) continue;

    try {
      if (endsAt > now && endsAt <= warnFrom && !data.endingNotifiedAt) {
        // Not to a tenant who has already paid for the time after it (prepaid during
        // a trial): nothing comes due when it closes.
        const state = await getPlanFeeState(tenantId, now);
        const prepaid = state?.paidThrough && state.paidThrough.getTime() > endsAt.getTime();
        if (!prepaid) {
          await notifyPlanFeeEnding({ tenantId, endsAt });
          warned++;
        }
        await doc.ref.update({
          endingNotifiedAt: FieldValue.serverTimestamp(),
        });
        continue;
      }

      if (endsAt <= now && !data.dueNotifiedAt) {
        // Re-resolved rather than assumed. Another waiver may already cover
        // this tenant, they may have moved to a free plan since, or they
        // may have paid already - and an email saying they owe money when
        // they do not is worse than none at all.
        const state = await getPlanFeeState(tenantId, now);
        if (state?.status === "payment-due") {
          // The deadline comes from the same state that enforces it, so the
          // date in the email and the date sales actually stop cannot drift.
          await notifyPlanFeeDue(tenantId, state.locksAt);
          due++;
        }
        await doc.ref.update({ dueNotifiedAt: FieldValue.serverTimestamp() });
      }
    } catch (error) {
      errors.push(`waiver ${doc.id}: ${String(error)}`);
    }
  }

  const periods = await notifyPaidPeriods(now, errors);
  warned += periods.warned;
  due += periods.due;
  const addonsWarned = await notifyAddonRenewals(now, errors);
  locked = await notifyNewlyLockedTenants(now, errors);

  return { ok: errors.length === 0, summary: { warned, due, locked, addonsWarned }, errors };
}

const dateOf = (v: unknown): Date | null =>
  v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : null;

/**
 * The same two emails as for a waiver, for a paid month: nothing renews by itself, so a
 * month running out is the fee coming due. "Due soon" a few days before
 * `nextBillingDate`, "now due" once it has passed and the fee is owed.
 *
 * Stamped with the date they were sent for (`planPeriodEndingNotifiedFor`,
 * `planPeriodDueNotifiedFor`), so each period is announced once and a payment, which
 * moves the date, re-arms both without anything having to clear them.
 */
async function notifyPaidPeriods(now: Date, errors: string[]): Promise<{ warned: number; due: number }> {
  let warned = 0;
  let due = 0;
  const warnFrom = new Date(now.getTime() + PLAN_FEE_WARNING_MS);
  const snap = await adminDb.collection(COLLECTIONS.TENANTS).where("nextBillingDate", "<=", warnFrom).get();
  for (const doc of snap.docs) {
    const t = doc.data();
    const paidThrough = dateOf(t.nextBillingDate);
    if (!paidThrough || t.status === "suspended") continue;
    const stamp = paidThrough.getTime();
    try {
      if (paidThrough > now && t.planPeriodEndingNotifiedFor !== stamp) {
        const state = await getPlanFeeState(doc.id, now);
        // Only a tenant actually paying: free plans and waivers have nothing coming due.
        if (state?.status === "paid") {
          await notifyPlanFeeEnding({ tenantId: doc.id, endsAt: paidThrough });
          warned++;
        }
        await doc.ref.update({ planPeriodEndingNotifiedFor: stamp });
      } else if (paidThrough <= now && t.planPeriodDueNotifiedFor !== stamp) {
        const state = await getPlanFeeState(doc.id, now);
        if (state?.status === "payment-due") {
          await notifyPlanFeeDue(doc.id, state.locksAt);
          due++;
        }
        await doc.ref.update({ planPeriodDueNotifiedFor: stamp });
      }
    } catch (error) {
      errors.push(`tenant ${doc.id}: ${String(error)}`);
    }
  }
  return { warned, due };
}

/**
 * A few days before a paid addon period runs out, the owner is told, with the price of
 * the next one. Once per period: stamped with the end date it was sent for.
 */
async function notifyAddonRenewals(now: Date, errors: string[]): Promise<number> {
  let sent = 0;
  const warnFrom = new Date(now.getTime() + PLAN_FEE_WARNING_MS);
  const snap = await adminDb.collectionGroup("entitlements").where("currentPeriodEnd", "<=", warnFrom).get();
  for (const doc of snap.docs) {
    const e = doc.data();
    const endsAt = dateOf(e.currentPeriodEnd);
    const tenantId = doc.ref.parent.parent?.id;
    if (!endsAt || !tenantId || endsAt <= now) continue;
    if (e.source !== "purchase" || e.pricingModel !== "subscription") continue;
    if (e.renewalNotifiedFor === endsAt.getTime()) continue;
    try {
      const addon = (await adminDb.collection(COLLECTIONS.ADDONS).doc(doc.id).get()).data();
      if (addon?.active) {
        await notifyAddonRenewalDue({ tenantId, addonName: addon.name, amountKobo: addon.amount, endsAt });
        sent++;
      }
      await doc.ref.update({ renewalNotifiedFor: endsAt.getTime() });
    } catch (error) {
      errors.push(`entitlement ${tenantId}/${doc.id}: ${String(error)}`);
    }
  }
  return sent;
}

/**
 * Tells the owners whose grace window has just closed that sales have
 * stopped.
 *
 * ## Why this is a tenant scan and not another pass over waivers
 *
 * The loop above walks `feeWaivers`, which only ever sees tenants who had
 * one. A tenant who simply cancelled their subscription has no waiver
 * document at all, so that loop has never known they exist - which did not
 * matter when an unpaid fee gated nothing, and matters a great deal now that
 * it stops them trading. Locking somebody silently because their lapse took
 * the wrong shape is the worst version of this feature.
 *
 * ## The stamp
 *
 * `planFeeLockNotifiedAt` on the tenant document, so this sends once per
 * lapse rather than daily. Every path that can clear a lock clears the stamp
 * too (see `clearPlanFeeLockNotice`), so a tenant who pays, lapses again six
 * months later and locks again is told again.
 *
 * ## Cost
 *
 * One read per tenant per day, plus the plan-fee resolution for the few that
 * could plausibly be due. That is the same bet `getActiveWaiversByTenant`
 * already makes about this collection being small, and it is bounded by a
 * daily schedule rather than by request volume. If the tenant count ever
 * makes this uncomfortable, the right fix is an index on the fields that
 * decide it, not a silent lock.
 */
async function notifyNewlyLockedTenants(
  now: Date,
  errors: string[]
): Promise<number> {
  let sent = 0;

  const tenants = await adminDb.collection(COLLECTIONS.TENANTS).get();

  for (const doc of tenants.docs) {
    const data = doc.data();

    // Already told about this lapse. Cleared when they pay.
    if (data.planFeeLockNotifiedAt) continue;

    // A suspended tenant is dark for an entirely different reason and has
    // already had `owner.account_suspended`. Two emails about two kinds of
    // "you are switched off" would read as one confused message.
    if (data.status === "suspended") continue;

    try {
      const state = await getPlanFeeState(doc.id, now);
      if (!state?.locked) continue;

      await notifyPlanFeeLocked(doc.id, state.locksAt ?? now);
      await doc.ref.update({
        planFeeLockNotifiedAt: FieldValue.serverTimestamp(),
      });
      sent++;
    } catch (error) {
      errors.push(`tenant ${doc.id}: ${String(error)}`);
    }
  }

  return sent;
}

/* ------------------------------------------------------ job: voucher-reap */

/**
 * How long an expired voucher's router user is left alone before it is
 * deleted.
 *
 * Two weeks, and not shorter. A customer who comes back the week after
 * their plan ran out and buys the same thing again has their old user
 * revived in place, keeping the username they chose and, where they chose
 * one, not having to learn a new code at all (lib/mikrotik.ts,
 * reviveHotspotUser). Reaping sooner would throw that away to save a row.
 * It is also a grace period against our own mistakes: a voucher wrongly
 * closed out has a fortnight to be noticed before the evidence on the
 * router is gone.
 */
const REAP_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** Deletions per run. The bound that keeps this inside rule 1. */
const REAP_LIMIT = 100;

/** Vouchers examined per run, which is the Firestore half of the same bound. */
const REAP_SCAN_LIMIT = 300;

const REAP_CURSOR = "cronState/voucher-reap";

/**
 * Deletes the hotspot users of long-expired vouchers from the routers.
 *
 * ## Why this job exists
 *
 * Nothing ever removed a user from a router. Every sale created one and
 * every expiry left it there, disabled, forever - which is how a hotspot
 * that has been running for a year ends up with thousands of dead logins,
 * most of a RouterOS user list being rubbish, and the admin Users page
 * taking longer to load every month. Renewing in place
 * (lib/voucher-renewal.ts) slows that growth for repeat customers; this is
 * what bounds it for everyone else.
 *
 * ## The guardrail
 *
 * **A router user with no voucher behind it is never touched.** Those are
 * the tenant's own, made by hand in Winbox, often years before this app
 * existed and often the ones keeping their own family online. The
 * reconciliation view at /admin/users exists to show them, not to clean
 * them up, and an automated delete that guessed wrong here would be
 * unrecoverable. So this job is driven entirely from voucher documents: it
 * starts from a voucher we sold, and deletes the one user that voucher
 * names.
 *
 * ## Why a cursor rather than a filter
 *
 * A reaped voucher still matches "expired and old", so a plain query would
 * return the same already-done rows on every pass and never reach new
 * ones. Marking the document is not enough to keep it out of the query
 * either: Firestore cannot match a field that older documents do not have.
 *
 * So the job keeps a high-water mark - the `expiresAt` of the last voucher
 * it looked at - and each run takes the next slice above it. The mark
 * trails real time by at least REAP_AFTER_MS, so a voucher whose
 * `expiresAt` is backfilled late by router-health still lands well above it
 * and is not skipped.
 */
/* -------------------------------------------------- job: webhook-deliver */

/**
 * Retries tenants' webhook deliveries that are due (lib/webhooks.ts).
 *
 * Every first attempt is made straight after the event, in the request
 * that caused it; this is everything after that, on the backoff schedule in
 * lib/webhook-events.ts. Bounded to 50 deliveries and about 45 seconds a
 * tick, so a backlog drains over several ticks rather than overrunning one.
 * One tenant's dead server is just one failed delivery among many.
 */
async function runWebhookDeliver(): Promise<Omit<CronResult, "job" | "ms">> {
  const { attempted, succeeded, errors } = await runDueDeliveries();
  return {
    ok: errors.length === 0,
    summary: { attempted, succeeded, failed: attempted - succeeded },
    errors,
  };
}

/**
 * Every voucher that shares a username with something in this batch.
 *
 * Keyed `tenantId/username`, which is safe as a key because a username is
 * either eight of our own alphanumerics or a validated handle plus suffix
 * (lib/voucher-credentials.ts) - no slashes in either.
 *
 * One query per thirty names rather than one per candidate: a full
 * REAP_SCAN_LIMIT sweep of 300 costs ten of these, against the 300 it would
 * cost to ask about each voucher on its own. Scoped to the tenant's own
 * subcollection, so this is an equality filter on a single field and needs
 * no composite index.
 */
async function loadUsernameSiblings(
  namesByTenant: Map<string, Set<string>>
): Promise<Map<string, ReapView[]>> {
  const siblings = new Map<string, ReapView[]>();

  for (const [tenantId, names] of namesByTenant) {
    for (const batch of chunk([...names], USERNAME_CHUNK)) {
      const snap = await adminDb
        .collection(TENANT_COLLECTIONS.vouchers(tenantId))
        .where("username", "in", batch)
        .get();

      for (const doc of snap.docs) {
        const view = reapViewOf(doc.id, doc.data());
        const key = `${tenantId}/${view.username}`;
        siblings.set(key, [...(siblings.get(key) ?? []), view]);
      }
    }
  }

  return siblings;
}

async function runVoucherReap(): Promise<Omit<CronResult, "job" | "ms">> {
  const errors: string[] = [];
  const now = new Date();
  const cutoff = new Date(now.getTime() - REAP_AFTER_MS);

  const cursorRef = adminDb.doc(REAP_CURSOR);
  const cursorDoc = await cursorRef.get();
  const after =
    cursorDoc.data()?.expiresAt instanceof Timestamp
      ? (cursorDoc.data()!.expiresAt as Timestamp).toDate()
      : new Date(0);

  if (after >= cutoff) {
    return {
      ok: true,
      summary: { scanned: 0, deleted: 0, keptInUse: 0, keptInGrace: 0 },
      errors,
    };
  }

  let snapshot;
  try {
    snapshot = await adminDb
      .collectionGroup("vouchers")
      .where("status", "==", "expired")
      .where("expiresAt", ">", after)
      .where("expiresAt", "<=", cutoff)
      .orderBy("expiresAt", "asc")
      .limit(REAP_SCAN_LIMIT)
      .get();
  } catch (error) {
    return {
      ok: false,
      summary: { scanned: 0, deleted: 0, keptInUse: 0, keptInGrace: 0 },
      errors: [`reap query failed: ${String(error)}`],
    };
  }

  // Which names this batch is about, gathered before anything is deleted so
  // the ownership question costs a handful of queries instead of one per
  // candidate. Rows that can never be reaped are left out of the lookup but
  // still walked below, because the cursor has to move past them.
  const namesByTenant = new Map<string, Set<string>>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const tenantId: string | undefined =
      data.tenantId ?? doc.ref.parent.parent?.id;
    if (!tenantId || !data.locationId || typeof data.username !== "string") {
      continue;
    }
    const names = namesByTenant.get(tenantId) ?? new Set<string>();
    names.add(data.username);
    namesByTenant.set(tenantId, names);
  }

  let siblings: Map<string, ReapView[]>;
  try {
    siblings = await loadUsernameSiblings(namesByTenant);
  } catch (error) {
    // Without this the job cannot tell a free name from one a live plan is
    // using, and guessing is what this fix exists to stop. Nothing is
    // deleted and the cursor stays put, so the next run tries the same
    // slice again.
    return {
      ok: false,
      summary: { scanned: 0, deleted: 0, keptInUse: 0, keptInGrace: 0 },
      errors: [`reap sibling lookup failed: ${String(error)}`],
    };
  }

  let deleted = 0;
  let scanned = 0;
  let keptInUse = 0;
  let keptInGrace = 0;
  let highWater = after;

  for (const doc of snapshot.docs) {
    if (deleted >= REAP_LIMIT) break;

    const voucher = doc.data();
    const expiresAt =
      voucher.expiresAt instanceof Timestamp
        ? voucher.expiresAt.toDate()
        : null;

    // The cursor advances past every row this loop finishes with, including
    // the ones it decides to skip - otherwise a voucher that can never be
    // reaped (no location, no router) would pin the mark and stall the job
    // behind it forever.
    scanned++;

    const tenantId = voucher.tenantId ?? doc.ref.parent.parent?.id;

    try {
      if (!tenantId || !voucher.locationId) continue;

      // The one question this job gets wrong if it asks it of a single
      // document: a revive leaves this voucher expired while a newer one on
      // the same credential is the live plan. See lib/voucher-reap.ts.
      const view = reapViewOf(doc.id, voucher);
      const verdict = reapVerdict(
        view,
        siblings.get(`${tenantId}/${view.username}`) ?? [view],
        cutoff
      );

      if (!verdict.reap) {
        if (verdict.reason === "name-in-use") keptInUse++;
        if (verdict.reason === "name-in-grace") keptInGrace++;
        continue;
      }

      const resolved = await getRouterForLocation(tenantId, voucher.locationId);
      if (!resolved) continue;

      const result = await deleteHotspotUser(resolved.config, voucher.username);

      // "not found" is success in the only sense that matters: the user is
      // not on the router, which is the state this job is trying to reach.
      // Stamping it keeps the reconciliation view from reporting it as
      // unexplained drift, which it would otherwise do forever.
      const gone =
        result.success || /not found/i.test(result.error ?? "");

      if (!gone) {
        errors.push(`voucher ${doc.id}: ${result.error ?? "unknown error"}`);
        continue;
      }

      await doc.ref.update({
        routerUserReapedAt: FieldValue.serverTimestamp(),
      });
      deleted++;
    } catch (error) {
      errors.push(`voucher ${doc.id}: ${String(error)}`);
    } finally {
      if (expiresAt && expiresAt > highWater) highWater = expiresAt;
    }
  }

  if (highWater > after) {
    await cursorRef.set(
      { expiresAt: Timestamp.fromDate(highWater), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  return {
    ok: errors.length === 0,
    summary: { scanned, deleted, keptInUse, keptInGrace },
    errors,
  };
}

export async function runCronJob(job: CronJobName): Promise<CronResult> {
  const started = Date.now();
  const result =
    job === "router-health"
      ? await runRouterHealth()
      : job === "voucher-expiry"
        ? await runVoucherExpiry()
        : job === "payment-reconcile"
          ? await runPaymentReconcile()
          : job === "sales-digest"
            ? await runSalesDigest()
            : job === "plan-fee-due"
              ? await runPlanFeeDue()
              : job === "webhook-deliver"
                ? await runWebhookDeliver()
                : await runVoucherReap();

  return { job, ...result, ms: Date.now() - started };
}
