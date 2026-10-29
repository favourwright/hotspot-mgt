/**
 * Fails if browser code can open a Paystack charge outside the known places.
 *
 * Voucher charges must start at /api/purchase/initiate, which records what
 * was agreed before the transaction exists; the browser then only resumes
 * it. A future dialog that went back to opening its own transaction
 * (`newTransaction` with a client-chosen amount and metadata) would bypass
 * that silently: payment would still work, and every charge from it would
 * land in Payment reviews once enforcement is on.
 *
 * A grep rather than a lint rule on purpose: `no-restricted-imports` has no
 * per-file allowlist, and lint once crashed on every file for weeks without
 * anyone noticing (docs/decisions-and-gotchas.md).
 *
 * Run: npm run check:checkout-paths
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN = ["app", "components", "hooks", "lib", "stores", "providers"];

/** The one file allowed to touch the Paystack popup directly. */
const POPUP_OWNER = "hooks/use-paystack.ts";

/**
 * Non-voucher flows that still open their own transaction: an addon
 * subscription, the tenant's plan fee, and the onboarding signup charge.
 * Each is verified by its own server route against its own records. A
 * voucher purchase must never be added here.
 */
const PAY_ALLOWED = new Set([
  "components/admin/addons-marketplace.tsx",
  "components/tenant/plan-subscription-actions.tsx",
  "components/onboarding/step-confirm.tsx",
]);

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

    if (rel !== POPUP_OWNER && /\.newTransaction\s*\(|new\s+window\.PaystackPop\b/.test(src)) {
      problems.push(`${rel}: opens the Paystack popup directly; go through ${POPUP_OWNER}`);
    }

    // `const { pay } = usePaystackInline()`, in any destructuring shape.
    if (/\{[^}]*\bpay\b[^}]*\}\s*=\s*usePaystackInline\s*\(/.test(src) && !PAY_ALLOWED.has(rel)) {
      problems.push(
        `${rel}: opens its own Paystack transaction with pay(). Voucher purchases must start at /api/purchase/initiate and use resume().`
      );
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.log(`FAIL  ${p}`);
  process.exit(1);
}
console.log("Checkout paths ok: no browser code opens a voucher charge of its own.");
