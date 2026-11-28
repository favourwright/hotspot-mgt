/**
 * Fails if a charge can be started anywhere but the two places that record it first.
 *
 * Every charge starts on the server, after a record of what it is for is written:
 * voucher sales at /api/purchase/initiate (`pendingPurchases`), payments to the platform
 * in lib/billing-charges.ts (`billingCharges`). Fulfilment and billing honour that
 * record, not what the charge says, so a new path that called Knomad Pay's
 * `createCharge` without writing one would bypass all of it: the payment would still
 * work, and nothing would know what it was for.
 *
 * And no browser code may import the gateway client at all: its API key is a server
 * secret, and a client bundle that pulled it in would either break or leak it.
 *
 * A grep rather than a lint rule on purpose: `no-restricted-imports` has no per-file
 * allowlist, and lint once crashed on every file for weeks without anyone noticing
 * (docs/decisions-and-gotchas.md).
 *
 * Run: npm run check:checkout-paths
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN = ["app", "components", "hooks", "lib", "stores", "providers"];

/** The only files allowed to start a charge, each after writing its record. */
const CHARGE_STARTERS = new Set(["app/api/purchase/initiate/route.ts", "lib/billing-charges.ts"]);

/**
 * The one place that calls the gateway's `createCharge`: startKnomadPayCharge, which
 * wraps it with the same-request retry. Everything else starts a charge through that
 * helper, so the helper's callers are what CHARGE_STARTERS guards.
 */
const GATEWAY_WRAPPER = "lib/knomad-pay.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(path);
  }
  return out;
}

const problems: string[] = [];
for (const top of SCAN) {
  let files: string[];
  try {
    files = walk(join(ROOT, top));
  } catch {
    continue;
  }
  for (const file of files) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, "utf8");
    if (/\.createCharge\s*\(/.test(src) && rel !== GATEWAY_WRAPPER) {
      problems.push(`${rel}: calls the gateway's createCharge directly. Start a charge with startKnomadPayCharge, from /api/purchase/initiate or lib/billing-charges.ts.`);
    }
    if (/\bstartKnomadPayCharge\s*\(/.test(src) && rel !== GATEWAY_WRAPPER && !CHARGE_STARTERS.has(rel)) {
      problems.push(`${rel}: starts a charge itself. Voucher sales start at /api/purchase/initiate, payments to the platform in lib/billing-charges.ts.`);
    }
    const isClient = /^\s*["']use client["']/.test(src);
    if (isClient && /from\s+["'](@favourwright\/knomad-pay-client|@\/lib\/knomad-pay|@\/lib\/billing-charges)["']/.test(src)) {
      problems.push(`${rel}: browser code imports the gateway client, whose key is a server secret.`);
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.log(`FAIL  ${p}`);
  process.exit(1);
}
console.log("Checkout paths ok: charges start only where their record is written.");
