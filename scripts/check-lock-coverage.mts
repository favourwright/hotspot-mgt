/**
 * Fails if a mutating /api/admin route skips the billing lock without saying why.
 *
 * lib/billing-lock.ts promises that every owner write stops while a tenant
 * owes their plan fee, except a short list of routes that must stay open
 * (paying, revoking, giving things back). That promise was only ever a
 * comment: by 2026-11-27 the comment listed five exemptions and eleven
 * routes were exempt, every one of them deliberate and none of them
 * checked. A new write route that forgot `requireUnlockedOwner` would have
 * looked exactly the same.
 *
 * Every exported POST, PUT, PATCH or DELETE under app/api/admin must call
 * `requireUnlockedOwner`, or appear in EXEMPT below with its reason. An
 * exemption that no longer matches a route is an error too, so the list
 * cannot rot into the comment it replaced.
 *
 * Run: npm run check:lock-coverage
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const ADMIN = join(ROOT, "app/api/admin");

/** `route file:METHOD` -> why it stays open while the tenant is locked. */
const EXEMPT: Record<string, string> = {
  "app/api/admin/billing/plan/route.ts:PATCH": "changing plan is a way out of the lock",
  "app/api/admin/billing/payment/route.ts:POST": "paying is the way out of the lock",
  "app/api/admin/billing/charges/[reference]/route.ts:POST": "applies a payment already made",
  "app/api/admin/notifications/route.ts:PATCH": "muting an email is not a privilege to withhold",
  "app/api/admin/routers/test-connection/route.ts:POST": "read-only: asks a router and reports back",
  "app/api/admin/locations/test/route.ts:POST": "read-only: asks a router and reports back",
  "app/api/admin/payout-account/route.ts:PUT": "being paid is never what a lock takes away",
  "app/api/admin/api-keys/[id]/route.ts:DELETE": "revoking a key only ever takes access away",
  "app/api/admin/voucher-batches/[id]/void/route.ts:POST": "voiding codes only ever takes something away",
  "app/api/admin/locations/[id]/active-sessions/disconnect/route.ts:POST":
    "removes, never adds: an owner can always put a device off their own network",
  "app/api/admin/hooks/[id]/route.ts:DELETE":
    "an owner must always be able to remove a block hook pausing their own sales (its PATCH locks all but switching off)",
  "app/api/admin/webhooks/[id]/route.ts:DELETE":
    "deleting an endpoint only takes something away (its PATCH locks all but switching off)",
};

const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name === "route.ts") out.push(path);
  }
  return out;
}

/**
 * The text of each exported handler, from its `export` to the next one. A
 * route that guards one method and not another is judged per method.
 */
function handlers(src: string): Map<string, string> {
  const re = /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  const marks = [...src.matchAll(re)].map((m) => ({ method: m[1], at: m.index! }));
  const out = new Map<string, string>();
  marks.forEach((m, i) => out.set(m.method, src.slice(m.at, marks[i + 1]?.at ?? src.length)));
  return out;
}

const problems: string[] = [];
const used = new Set<string>();
let checked = 0;

for (const file of walk(ADMIN)) {
  const rel = relative(ROOT, file);
  for (const [method, body] of handlers(readFileSync(file, "utf8"))) {
    if (!MUTATING.includes(method)) continue;
    checked += 1;
    const key = `${rel}:${method}`;
    const locked = /\brequireUnlockedOwner\s*\(/.test(body);
    if (EXEMPT[key]) {
      used.add(key);
      if (locked) problems.push(`${key}: listed as exempt but calls requireUnlockedOwner. Remove it from EXEMPT.`);
    } else if (!locked) {
      problems.push(
        `${key}: an owner write that skips the billing lock. Use requireUnlockedOwner, or add it to EXEMPT in scripts/check-lock-coverage.mts with the reason it must stay open.`
      );
    }
  }
}

for (const key of Object.keys(EXEMPT)) {
  if (!used.has(key)) problems.push(`${key}: exempt, but there is no such handler. Remove it from EXEMPT.`);
}

if (problems.length > 0) {
  console.error(`check:lock-coverage failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`check:lock-coverage: ${checked} owner write handlers, ${used.size} exempt with a reason.`);
