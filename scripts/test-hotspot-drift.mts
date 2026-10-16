/**
 * When the admin Users page is entitled to say the platform and the router
 * disagree.
 *
 * This is the second time that banner has cried wolf, which is why it is
 * pinned here rather than read carefully once more.
 *
 * The first time, nothing ever wrote `status: "expired"` to a voucher, so
 * every expired plan produced a permanent warning. The second time, on
 * 2026-10-15, three daily-plan customers at one location expired within
 * thirteen minutes of each other and all three were flagged for the next
 * hour: our close-out runs every 10 minutes, the router's per-profile
 * sweeper runs hourly for any plan of 12 hours or more, and the gap between
 * the two is two systems working correctly and disagreeing about it.
 *
 * So the cases below are mostly about *timing*: the same voucher, in the
 * same state, is quiet inside the sweep window and loud outside it.
 *
 * Run: npm run test:hotspot-drift
 */
import { buildRow, routerSweepGraceMs } from "../lib/hotspot-users";
import type { HotspotUser } from "../lib/mikrotik";
import type { Voucher } from "../types/schemas";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const MINUTE = 60_000;

const DAILY = { routerDurationValue: 1, routerDurationUnit: "d" as const };
const TWO_HOUR = { routerDurationValue: 2, routerDurationUnit: "h" as const };

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = String(got) === String(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(56)} ${got}`);
  if (!ok) console.log(`      wanted: ${want}`);
}

function voucher(over: Partial<Voucher>): Voucher {
  return {
    id: "v1",
    userId: "u1",
    userEmail: "a@example.com",
    planId: "plan-daily",
    planName: "Daily 1 Device",
    locationId: "loc-a",
    locationName: "WashingtonLodge",
    username: "SY573YNR",
    password: "SY573YNR",
    duration: "1 Day",
    status: "expired",
    paystackReference: "hs_1",
    retryCount: 0,
    createdAt: new Date("2026-10-15T12:00:00.000Z"),
    expiresAt: null,
    ...over,
  } as Voucher;
}

function routerUser(over: Partial<HotspotUser> = {}): HotspotUser {
  return {
    ".id": "*1",
    name: "SY573YNR",
    password: "SY573YNR",
    profile: "Daily",
    comment: "2026-10-16 11:00:00",
    ...over,
  } as HotspotUser;
}

console.log("How long the router is given\n");

// 1440 minutes / 12 = 120, clamped to 60, plus the 5-minute margin. The
// clamp is the surprise: daily, weekly and monthly all sweep hourly.
check("daily plan", routerSweepGraceMs(DAILY) / MINUTE, 65);
check("monthly plan is no faster", routerSweepGraceMs({ routerDurationValue: 30, routerDurationUnit: "d" }) / MINUTE, 65);
// 120 / 12 = 10.
check("two-hour plan", routerSweepGraceMs(TWO_HOUR) / MINUTE, 15);
// 120 / 12 = 10, but the floor is 5.
check("one-hour plan hits the floor", routerSweepGraceMs({ routerDurationValue: 1, routerDurationUnit: "h" }) / MINUTE, 10);
check("a plan we cannot find assumes the slowest", routerSweepGraceMs(null) / MINUTE, 65);

console.log("\nThe 2026-10-15 incident, hour by hour\n");

// Expired 20 minutes ago. Our close-out has already run; the router's
// hourly sweeper has not. Both sides are healthy and this must stay quiet.
const justExpired = voucher({
  expiresAt: new Date(NOW.getTime() - 20 * MINUTE),
});
check(
  "20 minutes past due, router has not swept yet",
  buildRow(routerUser(), justExpired, NOW, DAILY).drift,
  "null"
);
check(
  "...and it still reads as expired to the owner",
  buildRow(routerUser(), justExpired, NOW, DAILY).status,
  "expired"
);

// Same row, past the window. The router has had its hour and has not
// clamped, so somebody could still be online on a dead plan. Still loud.
const longExpired = voucher({
  expiresAt: new Date(NOW.getTime() - 90 * MINUTE),
});
check(
  "90 minutes past due, router still has not swept",
  buildRow(routerUser(), longExpired, NOW, DAILY).drift,
  "Past its expiry date but still enabled on the router"
);

// A two-hour plan is swept every 10 minutes, so 20 minutes of silence is
// already too generous for it. The window is per plan, not a constant.
check(
  "20 minutes past due on a two-hour plan is too long",
  buildRow(routerUser(), justExpired, NOW, TWO_HOUR).drift,
  "Past its expiry date but still enabled on the router"
);

console.log("\nThe cases the grace window must not silence\n");

check(
  "the router swept, we never closed out",
  buildRow(
    routerUser({ "limit-uptime": "1s" }),
    voucher({ status: "active", expiresAt: new Date(NOW.getTime() - 20 * MINUTE) }),
    NOW,
    DAILY
  ).drift,
  "Expired on the router while the platform still lists it as active"
);
check(
  "sold but the router has never heard of it",
  buildRow(null, justExpired, NOW, DAILY).drift,
  "Sold through the platform but missing on the router"
);
check(
  "both sides agree it is finished",
  buildRow(routerUser({ "limit-uptime": "1s" }), longExpired, NOW, DAILY).drift,
  "null"
);
check(
  "a voucher that has not run out",
  buildRow(
    routerUser(),
    voucher({ status: "active", expiresAt: new Date(NOW.getTime() + 60 * MINUTE) }),
    NOW,
    DAILY
  ).drift,
  "null"
);
// A user the tenant made by hand in Winbox. Its comment date passing is
// between it and the router, and was never our business to report.
check(
  "a router-only user past its own comment date",
  buildRow(routerUser({ comment: "2026-10-15 09:00:00" }), null, NOW, null).drift,
  "null"
);

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
