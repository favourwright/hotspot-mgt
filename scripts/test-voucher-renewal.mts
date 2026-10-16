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
check(
  "same plan, already finished",
  resolveVoucherAction([dead], here).kind,
  "fresh"
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

console.log("\nWhere the new expiry lands\n");

const twoHours = { routerDurationValue: 2, routerDurationUnit: "h" as const };
const sevenDays = { routerDurationValue: 7, routerDurationUnit: "d" as const };

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
