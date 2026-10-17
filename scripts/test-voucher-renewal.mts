/**
 * What a repeat purchase does, and the arithmetic behind carrying a
 * customer's leftovers across.
 *
 * Every case here fails silently if it is wrong. Counting a renewal from
 * `now` instead of from the current expiry confiscates the days the
 * customer had left and looks identical from the outside. Treating an
 * uncapped user's `limit-bytes-total` of "0" as a number caps someone who
 * was sold unlimited. Extending a voucher that was never activated gives
 * them nothing, because the router has not started their clock.
 *
 * Run: npm run test:voucher-renewal
 */
import {
  describePurchaseOptions,
  parsePurchaseIntent,
  parseRouterLimitBytes,
  renewalDataLimitBytes,
  renewalExpiry,
  resolveVoucherAction,
} from "../lib/voucher-renewal";
import { formatRouterExpiryComment } from "../lib/hotspot-users";
import type { Voucher } from "../types/schemas";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const GB = 1024 ** 3;

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const g = got instanceof Date ? got.toISOString() : String(got);
  const w = want instanceof Date ? want.toISOString() : String(want);
  const ok = g === w;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(54)} ${g}`);
  if (!ok) console.log(`      wanted: ${w}`);
}

function voucher(over: Partial<Voucher>): Voucher {
  return {
    id: "v1",
    userId: "u1",
    userEmail: "a@example.com",
    planId: "plan-a",
    planName: "2 Hours",
    locationId: "loc-a",
    locationName: "Shop",
    username: "HS-ABCD1234",
    password: "XYZ12345",
    duration: "2 Hours",
    status: "active",
    paystackReference: "hs_1",
    retryCount: 0,
    createdAt: NOW,
    expiresAt: null,
    ...over,
  } as Voucher;
}

console.log("Which action a purchase takes\n");

const live = voucher({
  id: "live",
  expiresAt: new Date("2026-10-18T12:00:00.000Z"),
});
const unused = voucher({ id: "unused", expiresAt: null });
const dead = voucher({
  id: "dead",
  status: "expired",
  expiresAt: new Date("2026-10-01T12:00:00.000Z"),
});

const here = { planId: "plan-a", locationId: "loc-a", now: NOW };
const sevenDays = { routerDurationValue: 7, routerDurationUnit: "d" as const };

check("nothing bought before", resolveVoucherAction([], here).kind, "fresh");
check(
  "same plan, running",
  resolveVoucherAction([live], here).kind,
  "extend"
);
check(
  "same plan, bought and never used",
  resolveVoucherAction([unused], here).kind,
  "unactivated"
);
// Used to mint a fresh code and leave the dead one for the reaper. Now it
// offers the code back: the customer already knows it, and the router does
// not gain a user per sale. Nothing carries over - the counters are reset
// and the new plan's allowance applied from zero.
check(
  "same plan, already finished, offers its code back",
  resolveVoucherAction([dead], here).kind,
  "revive"
);
// The router decides this one: a hotspot user carries exactly one profile,
// and the profile is what enforces speed and duration, so two plans cannot
// share a credential however convenient it would be.
check(
  "a different plan, theirs still running",
  resolveVoucherAction([live], { ...here, planId: "plan-b" }).kind,
  "fresh"
);
check(
  "same plan at another location",
  resolveVoucherAction([live], { ...here, locationId: "loc-b" }).kind,
  "fresh"
);
check(
  "archived vouchers are not extended",
  resolveVoucherAction([voucher({ ...live, archivedAt: NOW })], here).kind,
  "fresh"
);
check(
  "a running voucher wins over an unused one",
  resolveVoucherAction([unused, live], here).kind,
  "extend"
);
check(
  "the one running longest is the one extended",
  (
    resolveVoucherAction(
      [
        live,
        voucher({ id: "later", expiresAt: new Date("2026-10-25T12:00:00.000Z") }),
      ],
      here
    ) as { voucher: Voucher }
  ).voucher.id,
  "later"
);

console.log("\nThe buyer's answer overrides every reading of their history\n");

// The incident, in one case. Three daily plans in nineteen minutes, two of
// them meant for other people, all stacked onto the buyer's own login
// because nothing ever asked.
check(
  "buying for someone else never touches a running plan",
  resolveVoucherAction([live], { ...here, intent: "fresh" }).kind,
  "fresh"
);
check(
  "...nor an idle login of theirs",
  resolveVoucherAction([dead], {
    ...here,
    intent: "fresh",
    savedUsername: "favour-7k2p",
  }).kind,
  "fresh"
);
check(
  "...nor their saved profile login",
  resolveVoucherAction([], {
    ...here,
    intent: "fresh",
    savedUsername: "favour-7k2p",
  }).kind,
  "fresh"
);
// Holding an unused code used to refuse the sale outright. It is their own
// code; buying one for somebody else is an ordinary purchase.
check(
  "an unused code of their own does not block a gift",
  resolveVoucherAction([unused], { ...here, intent: "fresh" }).kind,
  "fresh"
);
check(
  "but it still blocks topping up, there being nothing to top up",
  resolveVoucherAction([unused], { ...here, intent: "reuse" }).kind,
  "unactivated"
);
check(
  "no answer means reuse, which is what shipped first",
  resolveVoucherAction([live], here).kind,
  "extend"
);
check("unrecognised answers mean reuse too", parsePurchaseIntent("nonsense"), "reuse");
check("...as does none at all", parsePurchaseIntent(undefined), "reuse");
check("and fresh is read when sent", parsePurchaseIntent("fresh"), "fresh");

console.log("\nReusing a login that is sitting idle\n");

check(
  "their saved profile login, never yet issued",
  (resolveVoucherAction([], { ...here, savedUsername: "favour-7k2p" }) as {
    username: string;
  }).username,
  "favour-7k2p"
);
check(
  "an expired voucher's own code, when there is no saved login",
  (resolveVoucherAction([dead], here) as { username: string }).username,
  dead.username
);
// The point of reviving is the name, not the plan. A customer moving from
// Daily to Weekly keeps the code they know.
check(
  "a dead code is reused across plans",
  resolveVoucherAction([dead], { ...here, planId: "plan-b" }).kind,
  "revive"
);
// One RouterOS user carries one profile, so taking over a live login would
// silently swap the plan somebody is in the middle of using.
check(
  "a login busy with another plan is left alone",
  resolveVoucherAction([voucher({ ...live, planId: "plan-b" })], {
    ...here,
    savedUsername: live.username,
  }).kind,
  "fresh"
);
check(
  "a failed voucher's code is not reused, the retry would collide",
  resolveVoucherAction([voucher({ ...dead, status: "failed" })], here).kind,
  "fresh"
);

console.log("\nWhat the dialog is told\n");

check(
  "nothing to decide on a first purchase",
  describePurchaseOptions([], here, sevenDays).reuse,
  "null"
);
check(
  "a running plan offers a top-up",
  describePurchaseOptions([live], here, sevenDays).reuse?.mode,
  "extend"
);
check(
  "...and says where it would land",
  describePurchaseOptions([live], here, sevenDays).reuse?.newExpiresAt?.toISOString(),
  "2026-10-25T12:00:00.000Z"
);
check(
  "a dead code offers a revival",
  describePurchaseOptions([dead], here, sevenDays).reuse?.mode,
  "revive"
);
check(
  "an unused code is flagged but offers nothing",
  describePurchaseOptions([unused], here, sevenDays).hasUnusedVoucher,
  true
);

console.log("\nWhere the new expiry lands\n");

const twoHours = { routerDurationValue: 2, routerDurationUnit: "h" as const };

// The whole point of renewing in place. Two days left plus seven bought is
// nine, not seven - counting from now would quietly take the two back.
check(
  "unused days carry over",
  renewalExpiry(new Date("2026-10-18T12:00:00.000Z"), NOW, sevenDays),
  new Date("2026-10-25T12:00:00.000Z")
);
check(
  "hours too",
  renewalExpiry(new Date("2026-10-16T13:00:00.000Z"), NOW, twoHours),
  new Date("2026-10-16T15:00:00.000Z")
);
check(
  "an expiry already past counts from now, never backwards",
  renewalExpiry(new Date("2026-10-01T12:00:00.000Z"), NOW, twoHours),
  new Date("2026-10-16T14:00:00.000Z")
);
check(
  "no expiry at all counts from now",
  renewalExpiry(null, NOW, twoHours),
  new Date("2026-10-16T14:00:00.000Z")
);

console.log("\nWhere the new data cap lands\n");

check("leftover data carries over", renewalDataLimitBytes(5 * GB, "5GB"), 10 * GB);
check(
  "an uncapped user stays uncapped when a capped plan is bought",
  renewalDataLimitBytes(null, "5GB"),
  null
);
check(
  "a capped user becomes uncapped when an uncapped plan is bought",
  renewalDataLimitBytes(5 * GB, null),
  null
);
check(
  '"Unlimited" is not a quantity',
  renewalDataLimitBytes(5 * GB, "Unlimited"),
  null
);

console.log("\nReading a cap back off the router\n");

check("a real cap", parseRouterLimitBytes(String(5 * GB)), 5 * GB);
// All three of these mean "no limit" in RouterOS, and reading any of them
// as a number would cap a customer at zero bytes - which reads as already
// exhausted, on a plan they just paid for.
check('"0" means no limit', parseRouterLimitBytes("0"), null);
check("empty means no limit", parseRouterLimitBytes(""), null);
check("absent means no limit", parseRouterLimitBytes(undefined), null);
check("nonsense means no limit", parseRouterLimitBytes("lots"), null);

console.log("\nWriting the expiry back into the router's comment\n");

const expiry = new Date(2026, 9, 25, 15, 30, 0); // local, as the router's clock is

// Written back in whatever format we found, because which one is in use
// depends on the RouterOS version that wrote it and the router's own
// script has to keep being able to read it.
check(
  "RouterOS 7 style",
  formatRouterExpiryComment(expiry, "2026-10-18 09:00:00"),
  "2026-10-25 15:30:00"
);
check(
  "RouterOS 6 style",
  formatRouterExpiryComment(expiry, "oct/18/2026 09:00:00"),
  "oct/25/2026 15:30:00"
);
check(
  "the expires: token is spliced, leaving the rest of the comment alone",
  formatRouterExpiryComment(expiry, "sold by hand expires:2026-10-18 ok"),
  "sold by hand expires:2026-10-25 ok"
);
// Refused rather than guessed: a comment we cannot read is one the router's
// own script cannot read either, so writing a date into it would expire
// nobody and look like nothing happened.
check("an unactivated voucher", formatRouterExpiryComment(expiry, "vc"), "null");
check("free text", formatRouterExpiryComment(expiry, "regular customer"), "null");
check("no comment", formatRouterExpiryComment(expiry, null), "null");

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
