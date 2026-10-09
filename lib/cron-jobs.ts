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

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { listHotspotUsers, testRouterConnection } from "@/lib/mikrotik";
import { parseRouterExpiryComment } from "@/lib/hotspot-users";
import { notifyRouterOffline, notifyVoucherExpiring } from "@/lib/notifications";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export type CronJobName = "router-health" | "voucher-expiry";

export const CRON_JOBS: CronJobName[] = ["router-health", "voucher-expiry"];

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
 * Polls every active tenant's routers. Does two things on the one connection,
 * because reaching the router is the expensive part and both jobs need it:
 *
 *  - flips `Router.status` and emails the owner **on the transition into
 *    offline**, never on the state. A router down overnight would otherwise
 *    mail them every tick until morning.
 *  - reads each hotspot user's comment back and fills in `Voucher.expiresAt`
 *    for vouchers still holding null. The router's on-login script writes the
 *    real expiry there at first login; this is how that reaches Firestore for
 *    purchases the auto-login path in /api/payment/verify did not cover.
 */
async function runRouterHealth(): Promise<Omit<CronResult, "job" | "ms">> {
  const errors: string[] = [];
  let checked = 0;
  let wentOffline = 0;
  let cameOnline = 0;
  let expiryFilled = 0;

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

      const config = {
        ip: router.routerIp,
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

      // Online, so backfill expiry while the connection is good.
      try {
        expiryFilled += await backfillExpiry(tenant.id, config);
      } catch (error) {
        errors.push(`expiry ${routerDoc.id}: ${String(error)}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    summary: { checked, wentOffline, cameOnline, expiryFilled },
    errors,
  };
}

/**
 * One listing per router, not one call per user. Only vouchers still holding
 * a null `expiresAt` are looked at, so a router full of long-settled users
 * costs a single read and no writes.
 */
async function backfillExpiry(
  tenantId: string,
  config: { ip: string; username: string; password: string }
): Promise<number> {
  const pending = await adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .where("status", "==", "active")
    .where("expiresAt", "==", null)
    .limit(500)
    .get();

  if (pending.empty) return 0;

  const users = await listHotspotUsers(config);
  if (!users.success || !users.data) return 0;

  const expiryByName = new Map<string, Date>();
  for (const u of users.data) {
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

/* ---------------------------------------------------------------- dispatch */

export async function runCronJob(job: CronJobName): Promise<CronResult> {
  const started = Date.now();
  const result =
    job === "router-health" ? await runRouterHealth() : await runVoucherExpiry();

  return { job, ...result, ms: Date.now() - started };
}
