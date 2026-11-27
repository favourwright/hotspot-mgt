/**
 * Builds the dashboards' stored days (lib/stats-rollup.ts) for past dates.
 *
 * The nightly job only ever writes the last two days, so history before it
 * shipped, and any stretch it missed, comes from here. Every day is
 * recomputed from `payments`, `vouchers` and the revenue ledger and
 * overwrites what was stored, so it is safe to repeat.
 *
 * Flow figures only. The snapshot figures (active vouchers, MRR, tenant
 * counts) are what was true on the morning after, and cannot be known for a
 * past day; those days simply have none.
 *
 * Reads: about 3 per tenant per day, plus 5 per day for the platform. The
 * estimate is printed before anything runs. A dry run unless given --apply.
 *
 * Uses .env.production, so this reads and writes the live project.
 *
 * Run: npm run stats:backfill -- --from=2026-10-01
 * Then: npm run stats:backfill -- --from=2026-10-01 --apply
 * --from defaults to the 1st of last month, the furthest back a dashboard
 * looks. It always runs up to yesterday, in Lagos.
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const { adminDb } = await import("../lib/firebase-admin");
const { COLLECTIONS } = await import("../lib/firebase-collections");
const { displayZoneDateKey } = await import("../lib/utils");
const { addDays, dateKeyFor, monthKeyOf, previousMonthKey } = await import("../lib/stats-period");
const rollup = await import("../lib/stats-rollup");

const apply = process.argv.includes("--apply");
const fromArg = process.argv.find((a) => a.startsWith("--from="))?.slice("--from=".length);

const todayKey = displayZoneDateKey(new Date());
const yesterday = addDays(todayKey, -1);
const from = fromArg ?? dateKeyFor(previousMonthKey(monthKeyOf(todayKey)), 1);
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from > yesterday) {
  console.error(`--from must be a date no later than ${yesterday}, got ${from}`);
  process.exit(1);
}

const dateKeys: string[] = [];
for (let key = from; key <= yesterday; key = addDays(key, 1)) dateKeys.push(key);

const tenants = await adminDb
  .collection(COLLECTIONS.TENANTS)
  .where("status", "in", ["active", "suspended"])
  .select()
  .get();
const tenantIds = tenants.docs.map((d) => d.id);

console.log(
  `${apply ? "APPLY" : "DRY RUN"}: ${dateKeys.length} days (${from} to ${yesterday}), ` +
    `${tenantIds.length} tenants, about ${dateKeys.length * (tenantIds.length * 3 + 5)} reads`
);

// One month at a time, so each tenant's days for it land in one write and
// no more than a month of aggregations is in flight at once.
const months = [...new Set(dateKeys.map(monthKeyOf))];
const sales = new Map(dateKeys.map((k) => [k, { salesKobo: 0, vouchersSold: 0 }]));
let failed = 0;

for (const tenantId of tenantIds) {
  for (const month of months) {
    const keys = dateKeys.filter((k) => monthKeyOf(k) === month);
    try {
      const flows = await Promise.all(
        keys.map((k) => {
          const { start, end } = rollup.dayBounds(k);
          return rollup.tenantFlowBetween(tenantId, start, end);
        })
      );
      flows.forEach((flow, i) => {
        const day = sales.get(keys[i])!;
        day.salesKobo += flow.onlineKobo + flow.cashKobo;
        day.vouchersSold += flow.vouchersSold;
      });
      const kobo = flows.reduce((s, f) => s + f.onlineKobo + f.cashKobo, 0);
      const sold = flows.reduce((s, f) => s + f.vouchersSold, 0);
      console.log(`  ${tenantId} ${month}: ${sold} vouchers, ${kobo} kobo`);
      if (apply) {
        await rollup.writeTenantDays(
          tenantId,
          keys.map((dateKey, i) => ({ dateKey, figures: flows[i] }))
        );
      }
    } catch (error) {
      failed += 1;
      console.log(`  FAILED ${tenantId} ${month}: ${String(error)}`);
    }
  }
}

if (failed > 0) {
  // The platform's daily sales are the sum of the tenants'; one missing
  // would be stored as a wrong total.
  console.log(`${failed} tenant-month(s) failed: platform days not written. Fix and re-run.`);
  process.exit(1);
}

for (const month of months) {
  const keys = dateKeys.filter((k) => monthKeyOf(k) === month);
  const figures = await Promise.all(
    keys.map(async (k) => {
      const { start, end } = rollup.dayBounds(k);
      const [income, newTenants] = await Promise.all([
        rollup.platformIncomeBetween(start, end),
        rollup.newTenantsBetween(start, end),
      ]);
      return { ...income, ...sales.get(k)!, newTenants };
    })
  );
  const income = figures.reduce(
    (s, f) => s + f.commissionKobo + f.planKobo + f.addonKobo + f.creditsKobo,
    0
  );
  console.log(`  platform ${month}: ${income} kobo income`);
  if (apply) {
    await rollup.writePlatformDays(keys.map((dateKey, i) => ({ dateKey, figures: figures[i] })));
  }
}

console.log(apply ? "Done." : "Dry run only. Re-run with --apply to write.");
