/**
 * Who may have their login put back on the router.
 *
 * The gate this covers was `status === "failed"` for a fortnight, which
 * refused the one case the Recreate button in the hotspot-users view was
 * built for: a paid, `active` voucher whose router user is gone. Two
 * customers sat on plans they could not use because of it.
 *
 * Run: npm run test:voucher-recreate
 */
import { recreateVerdict } from "../lib/voucher-recreate";
import { routerExpiryComment } from "../lib/hotspot-users";

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = String(got) === String(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${got}`);
  if (!ok) console.log(`      wanted: ${want}`);
}

/** "patch" | "create" when allowed, otherwise the HTTP status it refuses with. */
function verdict(status: string, isRenewal: boolean, onRouter: boolean): string {
  const out = recreateVerdict({ status, isRenewal, onRouter });
  return out.ok ? out.mode : String(out.status);
}

console.log("The case this exists for\n");

// A reaped login behind a plan the customer is still paying for. This is
// FVI0O2UY, praiseuche05@gmail.com, running to 2026-11-07.
check("a live voucher whose user the reaper deleted", verdict("active", false, false), "create");
check("...and the same for a live renewal", verdict("active", true, false), "create");

console.log("\nThe original case, unchanged\n");

check("a failed sale with nothing on the router", verdict("failed", false, false), "create");
// A failed renewal finds its user present, because it shares the credential
// with the voucher it was topping up. That one is patched, never created.
check("a failed renewal standing on its own credential", verdict("failed", true, true), "patch");
check("a failed sale whose user somehow exists", verdict("failed", false, true), "create");

console.log("\nWhat must be refused\n");

check("a live voucher that is not missing at all", verdict("active", false, true), "409");
check("...including a live renewal", verdict("active", true, true), "409");
check("an expired plan has no access to restore", verdict("expired", false, false), "400");
check("a superseded voucher points at a later one", verdict("superseded", false, false), "400");
check("a status we do not recognise", verdict("", false, false), "400");
check("a legacy status we do not recognise", verdict("cancelled", false, false), "400");

console.log("\nThe statuses that can be refused before any router call\n");

// The route asks with `onRouter: false` before it has contacted the router.
// That reading must never refuse something the router could have allowed,
// so the only refusals at that point are the permanent ones.
for (const status of ["expired", "superseded", "nonsense"]) {
  check(`${status} is refused without asking the router`, verdict(status, false, false), "400");
}
check("active is not refused early", verdict("active", false, false), "create");
check("failed is not refused early", verdict("failed", false, false), "create");

console.log("\nThe comment a recreated login carries\n");

// Local time on purpose: `parseRouterExpiryComment` reads one back the same
// way, so a date that came off a comment survives the round trip.
const d = new Date(2026, 10, 7, 22, 26, 40);
check("rendered as the router writes it", routerExpiryComment(d), "2026-11-07 22:26:40");
check("single digits are padded", routerExpiryComment(new Date(2026, 0, 2, 3, 4, 5)), "2026-01-02 03:04:05");
check("midnight is not blank", routerExpiryComment(new Date(2026, 11, 31, 0, 0, 0)), "2026-12-31 00:00:00");

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
