/**
 * The `?next=` validator, which is the only thing standing between our
 * sign-in page and being an open-redirect gadget.
 *
 * The captive portal has to send an unauthenticated visitor to `/auth` and
 * get them back afterwards with the router's session intact, so the
 * destination travels in a query parameter the client controls. An
 * unvalidated one lets an attacker borrow our domain's credibility for the
 * first hop of a phishing flow, right after the victim types their password.
 *
 * The cases that matter are the ones that look relative and are not:
 * `//evil.com` and `/\evil.com` are absolute to a browser, so a "starts with
 * a slash" check waves them straight through. Suffix confusion is the other
 * half: `ogawifi.online.evil.com` and `evilogawifi.online` both contain the
 * real domain as a substring.
 *
 * Run: npm run test:redirect
 */
process.env.NEXT_PUBLIC_APP_URL ??= "https://ogawifi.online";

const { safeRedirect } = await import("../lib/safe-redirect");

const BASE = "https://starlinkkonnect.ogawifi.online";

const cases: Array<[string | null, boolean, string]> = [
  ["/portal?mac=AA:BB&link-login-only=http://192.168.88.1/login", true, "relative, keeps the router session"],
  ["https://starlinkkonnect.ogawifi.online/portal?mac=AA", true, "a tenant subdomain"],
  ["https://ogawifi.online/", true, "the apex"],
  ["HTTPS://STARLINKKONNECT.OGAWIFI.ONLINE/portal", true, "host casing is not significant"],
  ["//evil.com", false, "protocol-relative, absolute despite the slash"],
  ["/\\evil.com", false, "backslash variant of the same trick"],
  ["https://evil.com/", false, "plainly elsewhere"],
  ["https://ogawifi.online.evil.com/", false, "our domain as a prefix of theirs"],
  ["https://evilogawifi.online/", false, "our domain as a suffix of theirs"],
  ["javascript:alert(1)", false, "not an http(s) scheme"],
  ["data:text/html,<script>alert(1)</script>", false, "not an http(s) scheme"],
  ["", false, "empty"],
  [null, false, "absent"],
];

let failed = 0;
for (const [input, shouldAllow, why] of cases) {
  const result = safeRedirect(input, BASE);
  const allowed = result !== null;
  const ok = allowed === shouldAllow;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${(allowed ? "allow " : "reject")}  ${why}` +
      (ok ? "" : `  (wanted ${shouldAllow ? "allow" : "reject"}, got ${String(result)})`)
  );
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
