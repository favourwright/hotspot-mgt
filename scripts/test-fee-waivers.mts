/**
 * The plan-fee waiver window, exercised without Firestore.
 *
 * This decides whether a tenant owes their plan fee, so the failure modes
 * are a comped account quietly being billed, or a promo tenant staying free
 * forever. Both are about dates rather than flags, which is exactly the kind
 * of logic that looks obviously correct and is not.
 *
 * Two behaviours here are deliberate and worth knowing:
 *
 *  - `endsAt` is exclusive. A waiver ending at noon is already over at noon,
 *    so a window can never pay out one tick more than it says.
 *  - Overlapping waivers resolve to the one ending latest, and a permanent
 *    one beats every dated one. Stacking a coupon on a manual comp can only
 *    extend the free period, never cut it short - the opposite would make
 *    granting someone an extra month silently shorten their comp.
 *
 * Run: npm run test:waivers
 */
import { isWaiverActive } from "../lib/fee-waivers";
import type { FeeWaiver } from "../types/schemas";

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const base: FeeWaiver = {
  id: "w1",
  startsAt: at(-10 * DAY),
  endsAt: at(10 * DAY),
  source: "manual",
  couponCode: null,
  reason: "",
  grantedBy: "uid",
  revokedAt: null,
  createdAt: at(-10 * DAY),
};

const cases: Array<[string, Partial<FeeWaiver>, boolean]> = [
  ["open window", {}, true],
  ["permanent, no end date", { endsAt: null }, true],
  ["ends in a minute", { endsAt: at(60_000) }, true],
  ["ended exactly now", { endsAt: NOW }, false],
  ["ended yesterday", { endsAt: at(-1 * DAY) }, false],
  ["starts tomorrow", { startsAt: at(1 * DAY) }, false],
  ["starts exactly now", { startsAt: NOW }, true],
  ["revoked, window still open", { revokedAt: at(-1 * DAY) }, false],
  ["revoked and permanent", { endsAt: null, revokedAt: at(-1 * DAY) }, false],
];

let failed = 0;
for (const [name, patch, want] of cases) {
  const got = isWaiverActive({ ...base, ...patch }, NOW);
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(30)} active=${String(got).padEnd(5)}` +
      (ok ? "" : `  (wanted ${want})`)
  );
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
