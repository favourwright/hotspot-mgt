/**
 * When router-health may tell an owner that paid logins are missing.
 *
 * The email exists for one case - someone paid, their plan is running, and
 * the router has no login for them - and every other way a login leaves a
 * router has to stay quiet, or it becomes the "23 users need attention"
 * banner again, this time in the owner's inbox.
 *
 * Run: npm run test:missing-logins
 */
import {
  MISSING_LOGIN_GRACE_MS,
  missingLoginChanges,
  missingLoginList,
  type MissingLoginView,
} from "../lib/missing-logins";

const NOW = new Date("2026-11-27T16:00:00.000Z");
const HOUR = 60 * 60 * 1000;

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = String(got) === String(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${got}`);
  if (!ok) console.log(`      wanted: ${want}`);
}

function v(over: Partial<MissingLoginView> & { id: string }): MissingLoginView {
  return {
    username: over.id.toUpperCase(),
    locationId: "loc-a",
    status: "active",
    createdAt: new Date(NOW.getTime() - 3 * HOUR),
    routerUserReapedAt: null,
    routerUserMissingSince: null,
    ...over,
  };
}

const HERE = new Set(["loc-a"]);

/** Which ids are newly missing, then which are restored. */
function run(vouchers: MissingLoginView[], onRouter: string[], locations = HERE): string {
  const out = missingLoginChanges(vouchers, new Set(onRouter), locations, NOW);
  return `${out.newlyMissing.map((x) => x.id).join(",") || "-"} / ${
    out.restored.map((x) => x.id).join(",") || "-"
  }`;
}

console.log("The one case worth an email\n");

check("a running plan with no login and nothing explaining it", run([v({ id: "a" })], []), "a / -");
check("...but not a second time", run([v({ id: "a", routerUserMissingSince: NOW })], []), "- / -");
check(
  "...and again once it came back and went again",
  run([v({ id: "a" })], []),
  "a / -"
);

console.log("\nEverything that must stay quiet\n");

check("its login is on the router", run([v({ id: "a" })], ["A"]), "- / -");
check("the owner deleted it, or the reaper did", run([v({ id: "a", routerUserReapedAt: NOW })], []), "- / -");
check("an expired plan", run([v({ id: "a", status: "expired" })], []), "- / -");
check("a failed sale, which already has its own email", run([v({ id: "a", status: "failed" })], []), "- / -");
check(
  "a sale younger than one tick",
  run([v({ id: "a", createdAt: new Date(NOW.getTime() - MISSING_LOGIN_GRACE_MS + 1000) })], []),
  "- / -"
);
check("a voucher with no creation time", run([v({ id: "a", createdAt: null })], []), "- / -");
check(
  "a voucher at a location another router serves",
  run([v({ id: "a", locationId: "loc-b" })], []),
  "- / -"
);

console.log("\nComing back\n");

check(
  "a reported login that is back clears its stamp",
  run([v({ id: "a", routerUserMissingSince: NOW })], ["A"]),
  "- / a"
);
check(
  "...and a login that was never reported needs no write",
  run([v({ id: "a" })], ["A"]),
  "- / -"
);

console.log("\nThe list in the email\n");

check("a few, sorted", missingLoginList(["CT66J206", "A9ZZF4R5"]), "A9ZZF4R5, CT66J206");
check(
  "a reset router does not produce a wall of codes",
  missingLoginList(Array.from({ length: 14 }, (_, i) => `U${String(i).padStart(2, "0")}`)),
  "U00, U01, U02, U03, U04, U05, U06, U07, U08, U09 and 4 more"
);

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
