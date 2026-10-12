/**
 * The scheduled work. Driven by systemd timers on the VPS calling
 * /api/cron/<job> on loopback (see deploy/ and docs/emails.md).
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
import { listHotspotUsers, testRouterConnection, HotspotUser } from "@/lib/mikrotik";
import { parseRouterExpiryComment } from "@/lib/hotspot-users";
import {
  notifyOwnerSalesDigest,
  notifyRouterOffline,
  notifyVoucherExpiring,
} from "@/lib/notifications";
import { formatNaira } from "@/lib/utils";
import { planEntriesFor } from "@/lib/plan-map";
import { writePortalFile } from "@/lib/mikrotik";
import { fulfilVoucherPurchase } from "@/lib/voucher-fulfilment";
import { PLAN_MAP_FILE, buildPlanMap } from "@/lib/hotspot-portal";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export type CronJobName =
  | "router-health"
  | "voucher-expiry"
  | "payment-reconcile"
  | "sales-digest";

export const CRON_JOBS: CronJobName[] = [
  "router-health",
  "voucher-expiry",
  "payment-reconcile",
  "sales-digest",
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

async function activeTenants(): Promise<Array<{ id: string }>> {
  const snap = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("status", "==", "active")
    .get();
  return snap.docs.map((d) => ({ id: d.id }));
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
      const config = {
        ip: router.wireguardTunnelIp || router.routerIp,
        username: router.routerUser,
        password: router.routerPass,
      };

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

  return { ok: errors.length === 0, summary: { notified }, errors };
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

  let transactions: Array<Record<string, unknown>>;
  try {
    const response = await fetch(
      `https://api.paystack.co/transaction?perPage=100&status=success&from=${from}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const json = await response.json();
    if (!json.status) throw new Error(json.message ?? "Paystack list failed");
    transactions = json.data ?? [];
  } catch (error) {
    return {
      ok: false,
      summary: { checked: 0, orphaned: 0, fulfilled: 0, skipped: 0 },
      errors: [`paystack list failed: ${String(error)}`],
    };
  }

  for (const txn of transactions) {
    const metadata = (txn.metadata ?? {}) as Record<string, unknown>;
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

      if (result.ok) {
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

  return {
    ok: errors.length === 0,
    summary: { checked, orphaned, fulfilled, skipped: skippedCount },
    errors,
  };
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
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const dayFormat: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
  };
  const period = start.toLocaleDateString(undefined, dayFormat);

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

  return {
    ok: errors.length === 0,
    summary: { tenantsWithSales, sent },
    errors,
  };
}

/* ---------------------------------------------------------------- dispatch */

export async function runCronJob(job: CronJobName): Promise<CronResult> {
  const started = Date.now();
  const result =
    job === "router-health"
      ? await runRouterHealth()
      : job === "voucher-expiry"
        ? await runVoucherExpiry()
        : job === "payment-reconcile"
          ? await runPaymentReconcile()
          : await runSalesDigest();

  return { job, ...result, ms: Date.now() - started };
}
