/**
 * The role -> destination mapping that sign-in and the `/auth` gate share.
 *
 * Worth a test because two callers depend on it agreeing with itself, and
 * because the failure mode of getting it wrong is a redirect loop, which
 * is miserable to debug from a screenshot.
 *
 * `tenantSlug` is passed everywhere a slug is needed, so nothing here
 * reaches Firestore. The lookup path it skips is covered by its own
 * `null`-on-failure contract in `lib/owner-redirect.ts`.
 */
import {
  goToPostLoginDestination,
  postLoginHref,
  type AuthedRole,
} from "../lib/post-login-destination";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Records what the component would have navigated to. */
function fakeRouter() {
  const calls: { method: string; path: string }[] = [];
  return {
    calls,
    router: {
      push: (path: string) => calls.push({ method: "push", path }),
      replace: (path: string) => calls.push({ method: "replace", path }),
    } as never,
  };
}

async function destination(
  role: AuthedRole | null,
  tenantSlug: string | null,
  replace = false
) {
  const { calls, router } = fakeRouter();
  await goToPostLoginDestination(router, {
    role,
    tenantSlug,
    replace,
  });
  return calls[0];
}

console.log("postLoginHref - the synchronous form used for nav links\n");
check("superadmin", postLoginHref("superadmin", null), "/superadmin");
check("owner with slug", postLoginHref("owner", "starlink"), "/starlink/admin");
// Null, not a guess: a nav item pointing at the wrong tenant is worse
// than one that appears a tick late.
check("owner, slug not loaded", postLoginHref("owner", null), null);
check("customer", postLoginHref("customer", null), "/");
check("role unknown", postLoginHref(null, null), "/");

console.log("\ngoToPostLoginDestination - what sign-in and the gate do\n");

const su = await destination("superadmin", null);
check("superadmin path", su?.path, "/superadmin");
check("superadmin pushes by default", su?.method, "push");

const owner = await destination("owner", "starlink");
check("owner path", owner?.path, "/starlink/admin");

// The gate replaces so Back does not return to a page that re-bounces.
const gated = await destination("owner", "starlink", true);
check("gate replaces", gated?.method, "replace");

const customer = await destination("customer", null);
// `/` is the venue storefront on a tenant subdomain and the landing page
// on the apex, which is why one answer serves both.
check("customer path", customer?.path, "/");

// A signed-in owner whose tenant cannot be resolved still has to land
// somewhere; `/` is public and always renders.
const stranded = await destination("owner", null);
check("owner without a tenant falls back", stranded?.path, "/");

const unknown = await destination(null, null);
check("unknown role path", unknown?.path, "/");

console.log(
  failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
