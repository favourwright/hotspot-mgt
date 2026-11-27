/**
 * Every link we email for an account action opens our own /auth/action page,
 * carrying exactly what that page reads and nothing it should not.
 *
 * Why it matters: the project's action URL setting is stuck on Firebase's
 * default (EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED), so this rewrite is the only
 * thing putting reset and verification links on our page. A regression here
 * fails quietly: the email still sends and the link still works, on the
 * wrong page.
 *
 * Run: npm run test:action-link
 */
import { ownActionLink } from "../lib/action-link";

const HANDLER = "https://ogawifi.online/auth/action";
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) {
    console.log(`FAIL  ${label}${detail ? `: ${detail}` : ""}`);
    failures++;
  }
};

const firebase =
  "https://hotspot-mgt.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=CODE-123_abc&apiKey=AIzaSECRET&continueUrl=https%3A%2F%2Fogawifi.online%2Fauth&lang=en";
const out = new URL(ownActionLink(firebase, HANDLER));

check("host is ours", out.host === "ogawifi.online", out.host);
check("path is the handler", out.pathname === "/auth/action", out.pathname);
check("mode carried", out.searchParams.get("mode") === "resetPassword");
check("oobCode carried intact", out.searchParams.get("oobCode") === "CODE-123_abc");
check("continueUrl carried", out.searchParams.get("continueUrl") === "https://ogawifi.online/auth");
check("lang carried", out.searchParams.get("lang") === "en");
check("apiKey dropped", !out.searchParams.has("apiKey"));

for (const mode of ["verifyEmail", "verifyAndChangeEmail"]) {
  const link = `https://hotspot-mgt.firebaseapp.com/__/auth/action?mode=${mode}&oobCode=X&apiKey=K`;
  check(`${mode} rewritten`, new URL(ownActionLink(link, HANDLER)).host === "ogawifi.online");
}

// A shape we do not recognise is passed through rather than broken.
const odd = "https://hotspot-mgt.firebaseapp.com/__/auth/action?foo=bar";
check("unknown shape untouched", ownActionLink(odd, HANDLER) === odd);
const noCode = "https://hotspot-mgt.firebaseapp.com/__/auth/action?mode=resetPassword";
check("missing code untouched", ownActionLink(noCode, HANDLER) === noCode);

console.log(failures === 0 ? "ok  action links" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
