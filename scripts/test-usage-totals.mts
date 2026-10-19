/**
 * What "used" means while a session is still open.
 *
 * The admin dialog and the customer's own voucher page both read 0 B used
 * for the whole of a user's first session, because they summed
 * `/ip/hotspot/user`'s lifetime counters and RouterOS does not fold a
 * session into those until it ends.
 *
 * The numbers below are real, taken from a live router on 2026-10-19 over a
 * 10 minute window across 28 concurrent sessions. Two measurements pin the
 * behaviour, and both are encoded here because each one kills a plausible
 * alternative implementation:
 *
 *   1. All 56 user-counter readings moved by 0 while 51 of the 56 matching
 *      session counters moved, one by 132MB. So the lifetime counters are
 *      frozen for the life of a session, and adding the session's own bytes
 *      cannot double count.
 *   2. `active["limit-bytes-total"]` held to exactly
 *      `user limit - (user bytes-in + bytes-out)` on all 28, with zero drift.
 *      It is a login-time snapshot, not a live remaining-allowance, so
 *      `quota - it` just returns the frozen counters again.
 *
 * Run: npm run test:usage-totals
 */
import { totalBytesUsed } from "../lib/mikrotik";

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = String(got) === String(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(62)} ${got}`);
  if (!ok) console.log(`      wanted: ${want}`);
}

const user = (bytesIn: number, bytesOut: number) => ({
  "bytes-in": String(bytesIn),
  "bytes-out": String(bytesOut),
});
const session = (bytesIn: number, bytesOut: number) => ({
  "bytes-in": String(bytesIn),
  "bytes-out": String(bytesOut),
});

// The reported bug: a voucher's first session, so the router's lifetime
// counters are still at zero while the session has genuinely moved data.
check(
  "first session counts, instead of reading 0",
  totalBytesUsed(user(0, 0), [session(52_745_450, 1_120_022_983)]),
  1_172_768_433
);

// A returning customer: earlier sessions are in the lifetime counters, the
// current one is not, and both halves belong in the figure.
check(
  "earlier sessions plus the open one",
  totalBytesUsed(user(5_996_137_675, 17_183_391_723), [
    session(52_745_450, 1_120_022_983),
  ]),
  24_352_297_831
);

// The multi-device case observed on the live router: one username, two
// concurrent sessions. Reading only the first undercounted by the second.
check(
  "every open session, not just the first",
  totalBytesUsed(user(12_139_563_941, 145_962_774_169), [
    session(166_620_865, 1_534_416_410),
    session(65_605_836, 712_515_380),
  ]),
  160_581_496_601
);

// Offline: nothing open, so the lifetime counters are the whole answer and
// are correct at exactly this point, which is why they are trusted here.
check(
  "offline user reads the lifetime counters",
  totalBytesUsed(user(490_086_213, 9_534_415_812), []),
  10_024_502_025
);

// A genuinely unused voucher is 0, and must stay distinguishable from the
// unknown case below rather than collapsing into it.
check("unused voucher is 0, not null", totalBytesUsed(user(0, 0), []), 0);

// Unknown, not zero. An unreachable router or a user the router has never
// heard of must not render as "0 B used", which reads as a measurement.
check("no router record and no session is null", totalBytesUsed(null, []), null);
check(
  "router record with no counters at all is null",
  totalBytesUsed({}, []),
  null
);

// A user the router dropped mid-session: no user record, but a live session
// is still a real measurement and beats reporting nothing.
check(
  "session without a user record still counts",
  totalBytesUsed(null, [session(1_024, 2_048)]),
  3_072
);

// RouterOS omits a counter rather than sending "0" on a fresh record, and a
// malformed value must not poison the sum into NaN, which formats as the
// unreadable "NaN B" rather than failing visibly.
check(
  "absent counter treated as 0, not NaN",
  totalBytesUsed({ "bytes-in": "100" }, []),
  100
);
check(
  "unparseable counter treated as 0, not NaN",
  totalBytesUsed({ "bytes-in": "unexpected", "bytes-out": "50" }, []),
  50
);

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
