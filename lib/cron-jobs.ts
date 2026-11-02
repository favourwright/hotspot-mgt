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

import { adminDb, adminAuth } from "@/lib/firebase-admin";
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
  notifyRouterOffline,
  notifyVoucherExpiring,
} from "@/lib/notifications";
import {
  DISPLAY_TIME_ZONE,
  formatNaira,
  startOfTodayInDisplayZone,
} from "@/lib/utils";
import { planEntriesFor } from "@/lib/plan-map";
import { writePortalFile } from "@/lib/mikrotik";
import { fulfilVoucherPurchase, paymentDocId } from "@/lib/voucher-fulfilment";
import { parsePaystackMetadata } from "@/lib/paystack";
import { runDueDeliveries } from "@/lib/webhooks";
import { PLAN_MAP_FILE, buildPlanMap } from "@/lib/hotspot-portal";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getPlanFeeState } from "@/lib/fee-waivers";

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
  Array<{ id: string; businessName: string }>
> {
  const snap = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("status", "==", "active")
    .get();
  // The name comes along because the platform digest lists tenants by name
  // and the document is already read here; fetching it again per tenant
  // would be a read per tenant for a string we had in hand.
  return snap.docs.map((d) => ({
    id: d.id,
    businessName: (d.data().businessName as string) ?? d.id,
  }));
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

  for (const tenant of await activeTenants()) {
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
        const synced = await syncRouterUsers(tenant.id, routerDoc.id, config);
        expiryFilled += synced.filled;
        mapsWritten += synced.mapped;
      } catch (error) {
        errors.push(`expiry ${routerDoc.id}: ${String(error)}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    summary: { checked, wentOffline, cameOnline, expiryFilled, mapsWritten },
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
  config: { ip: string; username: string; password: string }
): Promise<{ filled: number; mapped: number }> {
  const users = await listHotspotUsers(config);
  if (!users.success || !users.data) return { filled: 0, mapped: 0 };

  const mapped = await writePlanMaps(tenantId, routerId, config, users.data);
  const filled = await backfillExpiry(tenantId, users.data);

  return { filled, mapped };
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
  users: HotspotUser[]
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
 * Paystack pages its transaction list. This used to read only the first
 * page, so a day with more than 100 successful charges platform-wide had
 * the rest silently unchecked. The cap keeps the job bounded (rule 1 in
 * docs/cron-jobs.md); hitting it is reported as an error, not swallowed.
 */
const RECONCILE_PAGE_SIZE = 100;
const RECONCILE_MAX_PAGES = 20;

/**
 * The last line of defence for "money arrived, nothing was delivered".
 *
 * Fulfilment has two paths already: the buyer's browser calling
 * /api/payment/verify, and the `charge.success` webhook. Both can fail. The
 * browser is on a captive portal mid bank-redirect; the webhook depends on
 * Paystack reaching us and on us being up when it does.
 *
 * So this asks Paystack directly what it charged, and compares that against
 * what we recorded. It exists because exactly this went wrong once and
 * nobody found out for a day: a 500 naira portal purchase produced no
 * voucher, no record and no email, and the only evidence was the customer's
 * own Paystack receipt.
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

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    return {
      ok: false,
      summary: { checked: 0, orphaned: 0, fulfilled: 0, skipped: 0 },
      errors: ["PAYSTACK_SECRET_KEY is not set"],
    };
  }

  const from = new Date(Date.now() - RECONCILE_WINDOW_MS)
    .toISOString()
    .slice(0, 10);

  const transactions: Array<Record<string, unknown>> = [];
  try {
    for (let page = 1; ; page += 1) {
      const response = await fetch(
        `https://api.paystack.co/transaction?perPage=${RECONCILE_PAGE_SIZE}&page=${page}&status=success&from=${from}`,
        {
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(15_000),
        }
      );
      const json = await response.json();
      if (!json.status) throw new Error(json.message ?? "Paystack list failed");
      const batch: Array<Record<string, unknown>> = json.data ?? [];
      transactions.push(...batch);

      const pageCount =
        typeof json.meta?.pageCount === "number" ? json.meta.pageCount : page;
      if (batch.length < RECONCILE_PAGE_SIZE || page >= pageCount) break;
      if (page >= RECONCILE_MAX_PAGES) {
        errors.push(
          `stopped after ${RECONCILE_MAX_PAGES} pages of Paystack transactions; later ones were not checked`
        );
        break;
      }
    }
  } catch (error) {
    return {
      ok: false,
      summary: { checked: 0, orphaned: 0, fulfilled: 0, skipped: 0 },
      errors: [`paystack list failed: ${String(error)}`],
    };
  }

  for (const txn of transactions) {
    const metadata = parsePaystackMetadata(txn.metadata) ?? {};
    const reference = typeof txn.reference === "string" ? txn.reference : null;
    const planId = metadata.planId;
    const locationId = metadata.locationId;
    const tenantId = metadata.tenantId;

    // Only voucher sales. A platform subscription charge has no plan
    // metadata and is none of this job's business.
    if (
      !reference ||
      typeof planId !== "string" ||
      typeof locationId !== "string" ||
      typeof tenantId !== "string"
    ) {
      continue;
    }

    const paidAt = txn.paid_at ? new Date(txn.paid_at as string).getTime() : 0;
    if (Date.now() - paidAt < FULFILMENT_GRACE_MS) continue;

    checked += 1;

    try {
      const existing = await adminDb
        .collection(TENANT_COLLECTIONS.payments(tenantId))
        .where("paystackReference", "==", reference)
        .limit(1)
        .get();
      if (!existing.empty) continue;

      orphaned += 1;

      // Deliberately left unfulfilled by a human: a refund, a chargeback, a
      // test charge, or a case already settled off-platform. Without this the
      // job would "helpfully" issue a voucher for something somebody decided
      // not to honour, and would do it again on every tick.
      const skipped = await adminDb
        .collection(COLLECTIONS.RECONCILE_SKIPS)
        .doc(reference)
        .get();
      if (skipped.exists) {
        skippedCount += 1;
        continue;
      }

      // Already recorded as paid-but-not-fulfillable, and already emailed
      // to the platform. Retrying it every tick would change nothing.
      const underReview = await adminDb
        .collection(COLLECTIONS.PAYMENT_REVIEWS)
        .doc(paymentDocId(reference))
        .get();
      if (underReview.exists) {
        skippedCount += 1;
        continue;
      }

      const email = (txn.customer as { email?: string } | undefined)?.email;
      const buyer = await resolveBuyer(
        typeof metadata.userId === "string" ? metadata.userId : undefined,
        email
      );
      if (!buyer) {
        // Deliberately loud and deliberately not fatal: this is real money
        // with no account to attach it to, and it needs a human.
        errors.push(
          `${reference}: paid by ${email ?? "unknown"} with no matching account`
        );
        continue;
      }

      const result = await fulfilVoucherPurchase({
        reference,
        planId,
        locationId,
        tenantId,
        deviceMac:
          typeof metadata.deviceMac === "string" ? metadata.deviceMac : null,
        deviceIp:
          typeof metadata.deviceIp === "string" ? metadata.deviceIp : null,
        buyer,
      });

      if (result.ok && result.outcome === "in_progress") {
        // Being worked on right now by the browser or the webhook. A
        // stalled one is resumed on a later tick, once its lease lapses.
        skippedCount += 1;
      } else if (result.ok) {
        fulfilled += 1;
        console.warn(
          `[reconcile] recovered unfulfilled payment ${reference} ` +
            `(${result.outcome}) for tenant ${tenantId}`
        );
      } else {
        errors.push(`${reference}: ${result.error}`);
      }
    } catch (error) {
      errors.push(`${reference}: ${String(error)}`);
    }
  }

  const ledgersPurged = await purgeExpiredLedgers(errors);

  return {
    ok: errors.length === 0,
    summary: { checked, orphaned, fulfilled, skipped: skippedCount, ledgersPurged },
    errors,
  };
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
async function resolveBuyer(
  metadataUserId: string | undefined,
  email: string | undefined
): Promise<{ uid: string; email: string } | null> {
  if (metadataUserId && email) return { uid: metadataUserId, email };
  if (!email) return null;
  try {
    const user = await adminAuth.getUserByEmail(email);
    return { uid: user.uid, email };
  } catch {
    return null;
  }
}


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

  return {
    ok: errors.length === 0,
    summary: {
      tenantsWithSales,
      sent,
      platformVouchers,
      needsAttention: attention.length,
    },
    errors,
  };
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

  for (const [status, label] of [
    ["past_due", "behind on payment"],
    ["cancelled", "cancelled their subscription"],
  ] as const) {
    const snap = await adminDb
      .collection(COLLECTIONS.TENANTS)
      .where("subscriptionStatus", "==", status)
      .count()
      .get();
    const n = snap.data().count;
    if (n > 0) out.push(`${n} tenant${n === 1 ? "" : "s"} ${label}`);
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
        await notifyPlanFeeEnding({ tenantId, endsAt });
        await doc.ref.update({
          endingNotifiedAt: FieldValue.serverTimestamp(),
        });
        warned++;
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

  locked = await notifyNewlyLockedTenants(now, errors);

  return { ok: errors.length === 0, summary: { warned, due, locked }, errors };
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
