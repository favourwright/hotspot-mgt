/**
 * The router-side half of the captive portal.
 *
 * MikroTik serves the hotspot login page from its own flash and substitutes
 * `$(...)` placeholders as it does. We install a small shim that does
 * nothing but forward those values to the real portal, which we host.
 */

/**
 * A directory of our own under the router's `hotspot/`, so MikroTik's stock
 * pages are left exactly where they are. Reverting is then a single
 * `html-directory` change rather than restoring overwritten files -- and a
 * tenant who had already customised their portal doesn't lose it.
 */
export const PORTAL_HTML_DIRECTORY = "hotspot-oga";

/**
 * Hosts a client must reach *before* logging in. Without these the portal
 * is unreachable and the customer sees a blank page with no explanation,
 * so this list is the difference between the feature working and failing
 * closed.
 */
export function walledGardenHosts(rootDomain: string): string[] {
  return [
    // The portal itself, on whichever tenant subdomain they arrive at.
    rootDomain,
    `*.${rootDomain}`,
    // Paystack: the inline script, its API, and the checkout page.
    "*.paystack.co",
    "*.paystack.com",
    // Fonts and Firebase, which our pages pull at render time.
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "*.googleapis.com",
    "*.firebaseapp.com",
    // Avatars and brand icons (lib/utils.ts: getAvatarUrl, getBrandIconUrl).
    // The only external image host this app has - everything else is served
    // from our own origin. Missing here, every avatar and brand icon on a
    // pre-login page silently fails to load while the page itself renders
    // fine, which reads as "images are broken" rather than as a firewall.
    "api.dicebear.com",
  ];
}

/**
 * The shim RouterOS serves as `login.html`.
 *
 * Deliberately has no styling, no script dependency and no network calls of
 * its own: it runs in the half-second before the client has any internet,
 * inside whatever cut-down browser the OS decided to open. A `<meta>`
 * refresh works with JavaScript disabled; the script is a faster path when
 * it's available; the link is there for when neither fires.
 *
 * `-esc` variants are used wherever MikroTik offers one, since these values
 * land in a query string -- an unescaped `link-orig` containing its own
 * `?foo=bar` would otherwise truncate everything after it.
 */
export function buildPortalShim(portalUrl: string): string {
  const query = [
    "mac=$(mac-esc)",
    "ip=$(ip)",
    "link-login-only=$(link-login-only)",
    "link-orig=$(link-orig-esc)",
    "error=$(error)",
  ].join("&");

  const target = `${portalUrl}?${query}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connecting…</title>
<meta http-equiv="refresh" content="0; url=${target}">
<script type="text/javascript">window.location.replace("${target}");</script>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:3rem 1rem;color:#1b1f22">
<p>Taking you to the sign-in page…</p>
<p><a href="${target}">Continue</a></p>
</body>
</html>
`;
}

/**
 * The most recent voucher bought on this device at this tenant, if any.
 *
 * Lets the portal tell a returning customer their plan expired instead of
 * showing the same blank form a first-time visitor sees. Returns null for
 * anything unexpected -- a missing index, an unreachable Firestore -- since
 * a failed lookup should cost a nicety, never the portal itself.
 */
export async function lastVoucherForDevice(
  tenantId: string,
  mac: string | null
): Promise<{
  planName: string;
  status: string;
  createdAt: Date | null;
} | null> {
  if (!mac) return null;

  try {
    const { adminDb } = await import("@/lib/firebase-admin");
    const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

    const snapshot = await adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .where("deviceMac", "==", mac)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const data = snapshot.docs[0].data();
    return {
      planName: data.planName ?? "",
      status: data.status ?? "",
      createdAt: data.createdAt?.toDate?.() ?? null,
    };
  } catch (error) {
    console.error("Device voucher lookup failed:", error);
    return null;
  }
}

/* ------------------------------------------------- router-rendered pages */

/**
 * `alogin.html` and `status.html` are rendered **by the router**, not by us.
 *
 * This is the opposite choice from `login.html`, and deliberately so. The
 * login shim has to redirect to our origin because the whole point is to
 * take payment, which a router cannot do. These two only ever display
 * values RouterOS already holds, so hosting them would buy nothing and cost
 * everything: our origin is HTTPS and the hotspot is plain HTTP on a LAN
 * address, which is what made the login form a blocked mixed-content
 * submission, and a hosted page would also need walled-garden entries to be
 * reachable at all. Rendered on the router, neither problem exists.
 *
 * The one thing RouterOS will not hand a page is the calendar expiry date.
 * It lives in each hotspot user's `comment`, which is not a page variable.
 * So the platform writes `plan.json` (PLAN_MAP_FILE) into this same
 * directory on every router-health pass (lib/cron-jobs.ts) and the pages
 * look the username up in it over a same-origin fetch. The same file also
 * carries the data allowance, because the router's own session
 * `limit-bytes-total` is the *remaining* allowance and resets each login,
 * so a usage bar built from it reads 0% used forever.
 *
 * ## Three rules for anything added to these pages
 *
 * 1. **No literal `$(` in script or style.** RouterOS substitutes every
 *    `$(...)` it finds anywhere in the file, including inside `<script>`.
 *    jQuery-style `$(sel)` would be eaten before the browser ever saw it.
 * 2. **Assume any variable may not substitute.** An unknown name is left in
 *    the output verbatim, so `$(foo)` arrives as the five characters
 *    `$(foo)`. Every value below is run through `clean()` in the page's own
 *    script, which drops anything still looking like a placeholder rather
 *    than showing it to a customer.
 * 3. **No backticks anywhere in the CSS or script, comments included.**
 *    Both are TypeScript template literals, so one backtick ends the string
 *    early and the rest of the file is parsed as code. It fails loudly at
 *    build time, but the reported line is nowhere near the real cause.
 */

/** Baked from the design tokens: `oklch()` is not safe on these browsers. */
const PORTAL_CSS = `
*{box-sizing:border-box}
body{margin:0;padding:24px 16px;background:#f3f4f6;color:#090b0c;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
font-size:15px;line-height:1.5;-webkit-text-size-adjust:100%}
.brand{max-width:420px;margin:0 auto 16px;text-align:center}
.card{max-width:420px;margin:0 auto;background:#fff;border:1px solid #e3e7e8;
border-radius:14px;padding:22px;box-shadow:0 1px 2px rgba(9,11,12,.05)}
h1{margin:0;font-size:25px;font-weight:600;letter-spacing:-.02em}
.sub{margin:4px 0 0;font-size:14px;color:#67787c}
.rows{margin:20px 0 0;padding:0}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
padding:11px 0;border-top:1px solid #e3e7e8}
.row:first-child{border-top:0}
.k{margin:0;font-size:13px;color:#67787c;flex:none}
.v{margin:0;font-size:14px;font-weight:600;text-align:right;
word-break:break-word}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.lead{margin:0;padding:14px;background:#f1f3f3;border-radius:10px;
text-align:center}
.lead .big{display:block;font-size:22px;font-weight:600;letter-spacing:-.02em}
.lead .cap{display:block;font-size:12px;color:#67787c;margin-top:2px}
.warn .big{color:#e7000b}
.meter{margin:0}
.mhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.bar{margin-top:8px;height:8px;border-radius:999px;background:#e3e7e8;
overflow:hidden}
.bar i{display:block;height:100%;border-radius:999px;background:#c6005c;width:0}
.meter .cap{display:block;margin-top:6px;font-size:12px;color:#67787c}
.meter.low .bar i{background:#e7000b}
.meter.low .v{color:#e7000b}
.btn{display:block;margin-top:18px;padding:12px;border-radius:10px;
background:#c6005c;color:#fdf2f8;text-align:center;text-decoration:none;
font-weight:600;font-size:15px}
.btn.ghost{background:#fff;color:#67787c;border:1px solid #e3e7e8;
margin-top:10px;font-weight:500}
.hide{display:none}
`.trim();

/**
 * Shared client script.
 *
 * `clean` is the load-bearing part: it rejects a value that is empty, that
 * RouterOS left as an unsubstituted `$(name)`, or that is a zero counter,
 * and the caller then hides that row entirely. Showing "Data left: 0" to
 * someone on an unmetered plan would be worse than showing nothing.
 */
const PORTAL_SCRIPT = `
function clean(v){
  if(!v)return null;
  v=String(v).trim();
  if(!v||v==="0"||v==="N/A")return null;
  // An unsubstituted placeholder arrives verbatim; never show one.
  if(v.charAt(0)==="\\u0024"&&v.charAt(1)==="(")return null;
  return v;
}
function show(id,value){
  var el=document.getElementById(id);
  if(!el)return false;
  var v=clean(value);
  if(v===null){var r=document.getElementById(id+"-row");if(r)r.className="row hide";return false;}
  el.textContent=v;return true;
}
function bytes(n){
  n=parseFloat(n);
  if(!isFinite(n)||n<=0)return null;
  var u=["B","KB","MB","GB","TB"],i=0;
  while(n>=1024&&i<u.length-1){n/=1024;i++;}
  return (n<10&&i>0?n.toFixed(1):Math.round(n))+" "+u[i];
}
/** "2 days, 4 hours" down to "12 minutes". Null once it is in the past. */
function untilText(target){
  var ms=target.getTime()-Date.now();
  if(ms<=0)return null;
  var mins=Math.floor(ms/60000),hrs=Math.floor(mins/60),days=Math.floor(hrs/24);
  function p(n,w){return n+" "+w+(n===1?"":"s");}
  if(days>0)return p(days,"day")+", "+p(hrs-days*24,"hour");
  if(hrs>0)return p(hrs,"hour")+", "+p(mins-hrs*60,"minute");
  return p(Math.max(mins,1),"minute");
}
/**
 * The plan map the platform refreshes on every router-health pass, keyed by
 * username: "e" is the expiry as an ISO string, "q" the plan's configured
 * byte quota. Same-origin, so no CORS and no mixed content.
 *
 * Both fields are optional and the page renders whatever it gets. A missing
 * or stale map leaves those blocks hidden rather than failing: the live
 * counters RouterOS substituted are still worth showing on their own.
 */
function loadPlan(){
  var name=document.body.getAttribute("data-username");
  if(!clean(name))return;
  var x=new XMLHttpRequest();
  x.open("GET","plan.json?t="+Date.now(),true);
  x.onreadystatechange=function(){
    if(x.readyState!==4)return;
    var entry=null;
    try{ if(x.status===200)entry=JSON.parse(x.responseText)[name]; }catch(e){}
    if(!entry)return;
    if(entry.e)showExpiry(entry.e);
    if(entry.q)showData(entry.q);
  };
  try{x.send();}catch(e){}
}
function showExpiry(raw){
  var d=new Date(raw);
  if(isNaN(d.getTime()))return;
  var left=untilText(d);
  var row=document.getElementById("expiry-row");
  var big=document.getElementById("expiry-left");
  var cap=document.getElementById("expiry-when");
  if(!row||!big||!cap)return;
  if(left===null){row.className="lead warn";big.textContent="Expired";
    cap.textContent="Buy a new plan to get back online";}
  else{big.textContent=left;
    cap.textContent="left, until "+d.toLocaleString(undefined,
      {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}
  row.className=row.className.replace(" hide","");
}
/**
 * The data meter.
 *
 * The quota argument is the plan's configured total and has to come from
 * the map. The
 * page's own limit-bytes-total is the *session* budget, which RouterOS
 * resets to whatever is left of the allowance each time the client
 * reconnects, so a percentage built from it would read 0% used on every
 * login. remain-bytes-total is live and already accounts for every earlier
 * session, so used is derived from it rather than from the session
 * counters.
 */
function showData(quota){
  var row=document.getElementById("data-row");
  if(!row)return;
  var remain=parseFloat(clean(document.body.getAttribute("data-remain")));
  quota=parseFloat(quota);
  if(!isFinite(quota)||quota<=0||!isFinite(remain)||remain<0)return;
  if(remain>quota)remain=quota;
  var used=quota-remain, pct=Math.round(used/quota*100);
  var fill=document.getElementById("bar-fill");
  // A sliver for a barely-touched plan, so the bar never looks broken.
  if(fill)fill.style.width=Math.min(100,Math.max(pct,used>0?2:0))+"%";
  var left=document.getElementById("data-left");
  if(left)left.textContent=bytes(remain)+" left";
  var cap=document.getElementById("data-used");
  if(cap)cap.textContent=bytes(used)+" of "+bytes(quota)+" used ("+pct+"%)";
  if(remain/quota<=0.1)row.className="meter low";
  row.className=row.className.replace(" hide","");
  // The meter supersedes the plain row; showing both says it twice.
  var plain=document.getElementById("remain-row");
  if(plain)plain.className="row hide";
}
`.trim();

interface PageValues {
  /** The tenant's own name, so the page is not anonymous. */
  brandName: string;
}

function shell(
  title: string,
  head: string,
  body: string,
  script: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${head}
<style>
${PORTAL_CSS}
</style>
</head>
${body}
<script type="text/javascript">
${PORTAL_SCRIPT}
${script}
</script>
</html>
`;
}

/**
 * `alogin.html`: the page RouterOS shows the instant a login succeeds.
 *
 * Its stock job is to bounce the client straight to whatever they were
 * originally asking for, and that still has to happen - a customer who just
 * paid wants their page, not ours. So this shows the plan details for a few
 * seconds and then continues on its own, with a button for anyone who does
 * not want to wait.
 *
 * Worth knowing: on iOS and Android the captive-portal assistant closes its
 * own window as soon as it detects working internet, which it often does
 * within a second or two of this page loading. The countdown is a ceiling,
 * not a promise, and the status page is where these numbers really live.
 */
export function buildAloginPage({ brandName }: PageValues): string {
  return shell(
    "You're online",
    "",
    `<body data-username="$(username)"
      data-redirect="$(link-redirect)"
      data-status="$(link-status)">
<header class="brand">
  <h1>${escapeHtml(brandName)}</h1>
  <p class="sub">You're connected. Enjoy the internet.</p>
</header>
<main class="card">
  <div class="lead hide" id="expiry-row">
    <span class="big" id="expiry-left"></span>
    <span class="cap" id="expiry-when"></span>
  </div>

  <div class="rows">
    <div class="row" id="user-row">
      <p class="k">Account</p><p class="v mono" id="user"></p>
    </div>
  </div>

  <a class="btn" id="go" href="$(link-redirect)">Continue<span id="tick"></span></a>
  <a class="btn ghost" href="$(link-status)">View my plan</a>
</main>`,
    `
show("user",document.body.getAttribute("data-username"));
loadPlan();
(function(){
  // Falls back to the status page: link-redirect is empty when the client
  // had no original destination, and an empty href would reload this page.
  var to=clean(document.body.getAttribute("data-redirect"))
      || clean(document.body.getAttribute("data-status"));
  var go=document.getElementById("go"), tick=document.getElementById("tick");
  if(!to){ if(go)go.className="btn hide"; return; }
  go.href=to;
  var n=6;
  var id=setInterval(function(){
    n--;
    if(tick)tick.textContent=" ("+n+")";
    if(n<=0){clearInterval(id);window.location.replace(to);}
  },1000);
})();`
  );
}

/**
 * `status.html`: what the customer sees when they check on their plan.
 *
 * Unlike alogin this one is read at leisure, so it carries the full picture:
 * how long is left, how much data has gone, and the disconnect link.
 *
 * Keeps RouterOS's own `refresh-timeout` meta refresh so the counters stay
 * live, which is what `status-autorefresh` on the user profile is for.
 */
export function buildStatusPage({ brandName }: PageValues): string {
  return shell(
    "Your plan",
    `<meta http-equiv="refresh" content="$(refresh-timeout-secs)">`,
    `<body data-username="$(username)"
      data-uptime="$(uptime)"
      data-remain="$(remain-bytes-total)"
      data-in="$(bytes-in-nice)"
      data-out="$(bytes-out-nice)">
<header class="brand">
  <h1>${escapeHtml(brandName)}</h1>
  <p class="sub">You're online</p>
</header>
<main class="card">
  <div class="lead hide" id="expiry-row">
    <span class="big" id="expiry-left"></span>
    <span class="cap" id="expiry-when"></span>
  </div>

  <div class="meter hide" id="data-row">
    <div class="mhead">
      <p class="k">Data</p>
      <p class="v" id="data-left"></p>
    </div>
    <div class="bar"><i id="bar-fill"></i></div>
    <span class="cap" id="data-used"></span>
  </div>

  <div class="rows">
    <div class="row" id="user-row">
      <p class="k">Account</p><p class="v mono" id="user"></p>
    </div>
    <div class="row" id="remain-row">
      <p class="k">Data left</p><p class="v" id="remain"></p>
    </div>
    <div class="row" id="used-row">
      <p class="k">This session</p><p class="v" id="used"></p>
    </div>
    <div class="row" id="uptime-row">
      <p class="k">Connected for</p><p class="v" id="uptime"></p>
    </div>
  </div>
</main>`,
    `
(function(){
  // Read through data attributes rather than spliced into JS string
  // literals: a username carrying a quote would otherwise be a syntax
  // error in the only page every customer sees.
  function attr(n){return document.body.getAttribute("data-"+n);}
  show("user",attr("username"));
  show("uptime",attr("uptime"));
  // The plain "Data left" row is the fallback for the 3-in-66 users with no
  // quota configured, and for a client whose plan.json lookup missed. It is
  // hidden once the meter renders, which says the same thing far better.
  show("remain",bytes(attr("remain")));
  // Down and up are reported separately. These are session counters, not
  // the plan total, which is why the row is labelled as such.
  var i=clean(attr("in")), o=clean(attr("out"));
  show("used", i&&o ? i+" down, "+o+" up" : (i||o));
})();
loadPlan();`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The per-user map the two pages read.
 *
 * Deliberately the smallest thing that works: one object keyed by username,
 * with short keys because this is parsed by a page and never read by a
 * person. "e" is the expiry as an ISO string, "q" the plan's configured
 * byte quota. Both are optional, so a user with a quota and no expiry still
 * gets a data meter.
 *
 * Rewritten in full on every router-health pass rather than patched, so a
 * user removed on the router disappears from it on the next tick instead of
 * lingering forever.
 */
export interface PlanMapEntry {
  expiry?: Date;
  /** `limit-bytes-total` as configured on the user, not on the session. */
  quota?: number;
}

export function buildPlanMap(entries: Map<string, PlanMapEntry>): string {
  const out: Record<string, { e?: string; q?: number }> = {};
  for (const [username, entry] of entries) {
    const value: { e?: string; q?: number } = {};
    if (entry.expiry) value.e = entry.expiry.toISOString();
    if (entry.quota && entry.quota > 0) value.q = entry.quota;
    if (value.e || value.q !== undefined) out[username] = value;
  }
  return JSON.stringify(out);
}

/** Filename the pages fetch, relative to the portal directory they sit in. */
export const PLAN_MAP_FILE = "plan.json";
