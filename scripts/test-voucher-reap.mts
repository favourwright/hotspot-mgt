/**
 * When the reaper may delete a router user.
 *
 * Every case in the first two blocks is a real row from the 2026-11-01
 * incident on starlinkkonnect, where seven logins were deleted off the back
 * of a voucher that no longer owned the name and four of those took out a
 * plan the customer was still using. The dates are the real ones so that a
 * future change which reintroduces the bug fails here by name.
 *
 * Run: npm run test:voucher-reap
 */
import { chunk, reapVerdict, reapViewOf, type ReapView } from "../lib/voucher-reap";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-01T02:30:00.000Z");
const CUTOFF = new Date(NOW.getTime() - 14 * DAY); // 2026-10-18T02:30

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = String(got) === String(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(62)} ${got}`);
  if (!ok) console.log(`      wanted: ${want}`);
}

function v(over: Partial<ReapView> & { id: string }): ReapView {
  return {
    username: "1Z2YFD9A",
    status: "expired",
    expiresAt: null,
    archivedAt: null,
    routerUserReapedAt: null,
    ...over,
  };
}

/** What the cron asks: reap, or the reason it did not. */
function verdict(candidate: ReapView, siblings: ReapView[]): string {
  const out = reapVerdict(candidate, siblings, CUTOFF);
  return out.reap ? "reap" : out.reason;
}

console.log("The incident: an old voucher that no longer owns its name\n");

// ugochukwufranklin900@gmail.com. The Daily expired 2026-10-17, the Weekly
// on the same credential ran to 2026-10-31, and the reaper deleted the
// login 13 hours after that rather than a fortnight after it.
const oldDaily = v({ id: "6Z3DSXQm", expiresAt: new Date("2026-10-17T10:51:01Z") });
const laterWeekly = v({ id: "tnD9dTzw", expiresAt: new Date("2026-10-31T13:28:16Z") });
check(
  "the voucher the query found is not the one that owns the name",
  verdict(oldDaily, [oldDaily, laterWeekly]),
  "name-in-grace"
);
check(
  "...and the owning voucher is still reaped on its own schedule",
  verdict(laterWeekly, [oldDaily, laterWeekly]),
  "name-in-grace"
);
// Once the Weekly is itself a fortnight past, the name is finally free.
check(
  "...which arrives two weeks after the newest expiry",
  reapVerdict(
    laterWeekly,
    [oldDaily, laterWeekly],
    new Date("2026-11-15T00:00:00Z")
  ).reap,
  true
);

// praiseuche05@gmail.com: a seven-day plan bought at 00:29 and deleted at
// 02:30 the same night, off a Daily that had expired on 2026-10-17.
const deadDaily = v({
  id: "yWPagp5e",
  username: "FVI0O2UY",
  expiresAt: new Date("2026-10-17T01:50:08Z"),
});
const runningWeekly = v({
  id: "rouJO7iE",
  username: "FVI0O2UY",
  status: "active",
  expiresAt: new Date("2026-11-07T22:26:40Z"),
});
check(
  "a live plan on the same credential stops the delete outright",
  verdict(deadDaily, [deadDaily, runningWeekly]),
  "name-in-use"
);

console.log("\nWhat must still be reaped\n");

const lonely = v({ id: "solo", expiresAt: new Date("2026-10-01T00:00:00Z") });
check(
  "a name nobody reused answers exactly as it did before",
  verdict(lonely, [lonely]),
  "reap"
);
check(
  "a caller that knows of no siblings at all still reaps",
  verdict(lonely, []),
  "reap"
);
// The extend chain, which was never exposed to this bug: every document it
// replaced is superseded, and superseded documents hold no claim.
const chain = [
  v({ id: "FLR1Hkr4", status: "superseded", expiresAt: new Date("2026-10-01T12:57:10Z") }),
  v({ id: "qBoTgQJ6", status: "superseded", expiresAt: new Date("2026-10-02T13:57:10Z") }),
  v({ id: "uy1aRgHD", expiresAt: new Date("2026-10-03T13:57:10Z") }),
];
check(
  "a finished extend chain reaps on its newest document",
  verdict(chain[2], chain),
  "reap"
);
check(
  "...and a superseded document in it never blocks that",
  verdict(chain[0], chain),
  "reap"
);
// extendVoucher writes a `failed` document when the router patch does not
// land, while the voucher it meant to top up is still live and still owns
// the name. A failed row never had a user of its own to protect.
check(
  "a failed renewal holds no claim on the name",
  verdict(lonely, [lonely, v({ id: "bad", status: "failed", expiresAt: new Date("2026-12-01T00:00:00Z") })]),
  "reap"
);
// Archiving is refused while the user exists on the router, so an archived
// document cannot be the thing currently holding the name.
check(
  "an archived document holds no claim either",
  verdict(lonely, [
    lonely,
    v({ id: "arch", archivedAt: NOW, expiresAt: new Date("2026-12-01T00:00:00Z") }),
  ]),
  "reap"
);
check(
  "already done is not done twice",
  verdict(v({ ...lonely, routerUserReapedAt: NOW }), [lonely]),
  "already-reaped"
);

console.log("\nThe edges\n");

// A voucher bought and never logged in has not started its clock. Its login
// has to keep working, so the name is held indefinitely.
check(
  "an unactivated voucher holds its name with no expiry at all",
  verdict(lonely, [lonely, v({ id: "unused", status: "active", expiresAt: null })]),
  "name-in-use"
);
check(
  "a sibling on another username is ignored",
  verdict(lonely, [lonely, v({ id: "other", username: "SOMEONEELSE", status: "active" })]),
  "reap"
);
// Exactly on the horizon is past it: the cron's query uses `<=` on the same
// cutoff, so a voucher it hands us must be reapable on date alone.
check(
  "an expiry exactly on the cutoff is reapable",
  verdict(v({ id: "edge", expiresAt: CUTOFF }), [v({ id: "edge", expiresAt: CUTOFF })]),
  "reap"
);
check(
  "a claimant with no date cannot pin a name it never used",
  verdict(lonely, [lonely, v({ id: "nodate", status: "expired", expiresAt: null })]),
  "reap"
);

console.log("\nThe query chunking\n");

check("chunk splits at the boundary", JSON.stringify(chunk([1, 2, 3, 4, 5], 2)), "[[1,2],[3,4],[5]]");
check("chunk of an empty list is empty", chunk([], 30).length, 0);
check("chunk keeps a short list whole", JSON.stringify(chunk([1, 2], 30)), "[[1,2]]");

console.log("\nReading a raw Firestore document\n");

// The Admin SDK hands back Timestamps, older documents have no such field
// at all, and a cron must not throw on either.
const stamp = { toDate: () => new Date("2026-10-17T10:51:01Z") };
const parsed = reapViewOf("doc1", {
  username: "1Z2YFD9A",
  status: "expired",
  expiresAt: stamp,
});
check("a Timestamp becomes a Date", parsed.expiresAt?.toISOString(), "2026-10-17T10:51:01.000Z");
check("a missing field becomes null", parsed.archivedAt, "null");
check("a legacy document with no status reads as empty", reapViewOf("d", {}).status, "");
check("a legacy document with no username reads as empty", reapViewOf("d", {}).username, "");

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
