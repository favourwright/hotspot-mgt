/**
 * The table that decides whether a signed-in browser is actually signed in.
 *
 * Worth pinning because every wrong answer here is painful in a different
 * way: too eager and it signs people out of a sign-in they are completing
 * or every time Firestore hiccups, too lax and the apex and `/auth` bounce
 * a visitor between each other forever, which is the bug this module was
 * written for. Pure by design - see lib/session-reconcile.ts.
 */
import {
  decideSessionCheck,
  verdictFromServer,
  type SessionSignals,
} from "../lib/session-reconcile";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(
      `        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function decide(signals: Partial<SessionSignals>) {
  return decideSessionCheck({
    signedInClientSide: true,
    hasHint: true,
    signInInFlight: false,
    forced: false,
    ...signals,
  });
}

console.log("decideSessionCheck - when to ask the server\n");

// Nothing to reconcile: the bootstrap exchange owns "cookie, no client".
check(
  "signed out client-side",
  decide({ signedInClientSide: false }),
  "nothing-to-do"
);
check(
  "signed out client-side, hint present",
  decide({ signedInClientSide: false, hasHint: true }),
  "nothing-to-do"
);

// The ordinary signed-in page view must cost no request at all.
check("signed in with a hint", decide({}), "trust-client");

// The reported loop: signed out on a subdomain, apex IndexedDB untouched,
// cookie and hint both gone domain-wide.
check(
  "signed in client-side with no hint",
  decide({ hasHint: false }),
  "ask-server"
);

// A sign-in in progress is the one time the client is correctly ahead of
// the server: Firebase mints the credential before the cookie exists.
check(
  "mid sign-in, no cookie yet",
  decide({ hasHint: false, signInInFlight: true }),
  "trust-client"
);
// And that wins over `force`, or /auth would end the sign-in it just took.
check(
  "mid sign-in beats force",
  decide({ hasHint: false, signInInFlight: true, forced: true }),
  "trust-client"
);

// A revoked cookie leaves the hint behind, so the cheap check says
// "trust" and is wrong. `force` is how /auth catches that case.
check("forced, hint present", decide({ forced: true }), "ask-server");
check(
  "forced with no client session is still nothing to do",
  decide({ forced: true, signedInClientSide: false }),
  "nothing-to-do"
);

// Signed in as another account on another subdomain: the shared cookie
// moved, this origin's IndexedDB did not. Reported: a superadmin token on a
// tenant page whose cookie was the owner's, and the owner's writes refused.
check(
  "hint names another account",
  decide({ clientUid: "superadmin", hintUid: "owner" }),
  "switch-account"
);
check(
  "another account beats force",
  decide({ clientUid: "superadmin", hintUid: "owner", forced: true }),
  "switch-account"
);
check(
  "hint names this account",
  decide({ clientUid: "owner", hintUid: "owner" }),
  "trust-client"
);
// Signing in as someone new: the old cookie still names the old account
// until establishSession() replaces it, and that is not a mismatch.
check(
  "mid sign-in as another account",
  decide({ clientUid: "new", hintUid: "old", signInInFlight: true }),
  "trust-client"
);
// Sessions minted before the hint carried a uid say "1", read as unknown.
check(
  "legacy hint names nobody",
  decide({ clientUid: "owner", hintUid: null }),
  "trust-client"
);

console.log("\nverdictFromServer - only an explicit no is a logout\n");

check("server said no", verdictFromServer(false), "stale");
check("server said yes", verdictFromServer(true), "ok");
// A 500, an unreachable Firestore, a dropped connection. Ending a valid
// session on one of these is the loop arrived at from the other side.
check("server could not say", verdictFromServer(null), "ok");

console.log(
  failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
