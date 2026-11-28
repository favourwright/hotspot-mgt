/**
 * The files a portal directory must hold, and the install order that
 * guarantees them.
 *
 * On 2026-11-28 a new tenant installed the portal and no phone ever saw it:
 * install wrote no rlogin.html, so the router answered every phone's
 * connectivity check with a 404, which phones read as "no internet" rather
 * than "sign in". Nothing failed and nothing logged. This pins the three
 * things that would let that happen again silently:
 *
 *  1. a required file that no builder writes;
 *  2. redirect pages that stop sending a real 302, which is the signal the
 *     phones detect;
 *  3. an install route that switches the hotspot over before checking the
 *     files are on the router, or without checking the walled garden.
 *
 * Run: npm run test:portal-pages
 */
import { readFileSync } from "node:fs";

const {
  REQUIRED_PORTAL_FILES,
  buildPortalShim,
  buildRedirectPage,
  routerPortalPages,
} = await import("../lib/hotspot-portal");

let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`);
}

// ------------------------------------------------ every required file is written

const pages = routerPortalPages({ brandName: "Test Venue" });
const written = new Set(pages.map(([name]) => name));
// login.html is the shim, written separately by install.
written.add("login.html");

check(
  "routerPortalPages writes each filename once",
  written.size === pages.length + 1,
  pages.map(([name]) => name).join(", ")
);

for (const required of REQUIRED_PORTAL_FILES) {
  check(`${required} is written by install`, written.has(required));
}

for (const essential of ["rlogin.html", "redirect.html", "login.html"]) {
  check(
    `${essential} is in REQUIRED_PORTAL_FILES`,
    (REQUIRED_PORTAL_FILES as readonly string[]).includes(essential)
  );
}

for (const [name, contents] of pages) {
  check(`${name} is not empty`, contents.trim().length > 0);
}

check("the shim is not empty", buildPortalShim("https://x.example/portal").length > 0);

// ------------------------------------------------ the redirect pages send a 302

for (const kind of ["rlogin", "redirect"] as const) {
  const page = buildRedirectPage(kind);
  const lines = page.split("\n");
  check(
    `${kind}.html opens with the 302 status directive`,
    /^\$\(if http-status == 302\).+\$\(endif\)$/.test(lines[0]),
    lines[0]
  );
  check(
    `${kind}.html sets Location to link-redirect`,
    lines[1] === '$(if http-header == "Location")$(link-redirect)$(endif)',
    lines[1]
  );
  check(
    `${kind}.html has a meta refresh fallback`,
    page.includes('<meta http-equiv="refresh" content="0; url=$(link-redirect)">')
  );
}

check(
  "rlogin.html carries the WISPr login URL",
  buildRedirectPage("rlogin").includes("<LoginURL>$(link-login-only)?target=xml</LoginURL>")
);

// ------------------------------------------------ install checks before it switches

const route = readFileSync(
  new URL("../app/api/admin/locations/[id]/install-portal/route.ts", import.meta.url),
  "utf8"
);

const at = (needle: string) => route.indexOf(needle);
const switchAt = at("await setHotspotHtmlDirectory(");
const fileCheckAt = at("await missingPortalFiles(");
const gardenCheckAt = at("if (!garden.success)");

check("install switches the hotspot over exactly once", switchAt > 0 && route.indexOf("await setHotspotHtmlDirectory(", switchAt + 1) === -1);
check("install checks the files are on the router", fileCheckAt > 0);
check("the file check uses REQUIRED_PORTAL_FILES", /missingPortalFiles\([\s\S]*?REQUIRED_PORTAL_FILES/.test(route));
check("the file check comes before the switch", fileCheckAt > 0 && fileCheckAt < switchAt);
check("install stops on a walled-garden failure", gardenCheckAt > 0);
check("the walled-garden check comes before the switch", gardenCheckAt > 0 && gardenCheckAt < switchAt);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
