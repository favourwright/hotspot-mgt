# The captive portal - install, uninstall, and what "restore" actually means

Assumes you've read `docs/router-and-wireguard.md` (how we reach a router at all) and `docs/locations-and-routers.md` (why a router backs exactly one location).

Installing the portal changes a tenant's own router. **Everything here is written around one constraint: a tenant may already have had a customised hotspot login page, and uninstalling must give it back - not replace it with MikroTik's stock pages.**

## Buying from the portal requires an account

The portal sells plans, and every purchase needs a signed-in account, the
same as the tenant storefront. There is no anonymous path:
`resolvePurchaser` throws 401 without a token.

This was once the other way round, on the reasoning that someone behind a
paywall cannot sign up because the confirmation email is on the far side of
the internet they are buying. That does not hold for this app: registration
is plain email and password with no verification step and no OAuth popup, so
it only ever talks to Firebase, and `*.googleapis.com` is already in the
walled garden every install writes. A visitor with no data really can create
an account from the portal page.

`PortalPlans` sends them to `/auth?next=<current url>` on the **same host**,
which matters twice over: `/auth` is host-neutral in `proxy.ts`, and Firebase
persists auth per-origin, so signing in on the apex and coming back would
leave them signed out again. The `next` value is validated by
`lib/safe-redirect.ts` before anyone is sent to it - unvalidated, it would be
an open redirect hanging off our own sign-in page.

Signing in to the Wi-Fi with an existing voucher is unaffected and still
needs no account: that is the "Have a voucher?" form, which posts straight to
the router.

## Two routes, not one page

The portal is `/{slug}/portal` and `/{slug}/portal/plans`, and the split is
a performance decision tenants asked for by name.

Everything that sells a plan - the plan grid, the checkout dialog, Paystack's
`inline.js` - used to render on the portal itself. That made every device
that joined the wifi download the whole purchase path before it could type a
voucher code, and most of them already had one. Worse, `PortalCheckoutDialog`
was imported statically and rendered unconditionally with `open={false}`, so
its body ran on mount and **fetched Paystack's script on every single portal
visit**, buyer or not, from a third-party host, over a link the customer has
not paid for yet. It is `next/dynamic` now, mounted only once somebody opens
it.

What is left on the portal: the brand, the voucher form, one card linking to
the plans, the support line. One cached tenant read and one conditional
voucher lookup.

### The session query string is load-bearing

`mac`, `ip`, `link-login-only` and `link-orig` reach us **only** on the first
page the router redirects to. Any link between the two routes has to carry
them, which is what `portalSessionQuery` / `portalHref` in
`lib/captive-portal.ts` exist for. Build such a link by hand and two things
break, both silently:

- no `link-login-only` and a paid-for voucher cannot be handed to the router,
  so the customer pays and never gets online;
- no `mac` and the purchase carries no `deviceMac`, which is the condition
  `/api/payment/verify` uses to decide whether to return the credentials at
  all.

`error` is deliberately **not** carried. It describes one failed attempt on
the page it was issued for, and re-raising it after a navigation is an alert
about a form the customer has since left.

The error alert's "See the plans" link was an `#portal-plans` anchor into the
card below it. That card is now a different route, and an anchor to an id
that no longer exists scrolls nowhere and reads as a dead button - on the
alert shown to the customers most likely to buy.

## Two things the tenant controls

Both are fields on the tenant document, edited at
`/{slug}/admin/settings` (`components/tenant/portal-settings.tsx`,
`PATCH /api/admin/portal-settings`). The portal already loads that document,
so neither costs a read.

**`portalMacNotice`** shows a note about private/random MAC addresses under
the Connect button. **On by default**, because iOS and Android both ship
private addressing turned on, so the condition it warns about is the common
case rather than the exception. It is a schema default rather than a
backfill: every tenant document without the field reads as `true`, and an
owner who switches it off has `false` stored and stays off. The copy is ours
and fixed rather than a text field. Tenants arrived with wording from their old portals saying
a private address "may stop you from logging in" - it does not. Sign-in here
is a username and password posted to the router and a rotating address does
not block it. What it really breaks is being recognised between visits
(`lastVoucherForDevice` keys on the MAC) and a plan's `sharedUsers` device
count. A notice that predicts a failure the customer then does not hit
generates the support calls it was meant to prevent.

**`supportPhone`** and **`supportPhoneIsWhatsapp`** put a support line at the
foot of both routes. Stored E.164 by `lib/phone.ts`, which normalises the
four ways an owner types a Nigerian mobile.

The `tel:` link is the primary one on purpose: everyone reading this page is
behind the paywall, and a call rides the cellular radio rather than the wifi,
so it is the only channel here that works unconditionally.

The WhatsApp link uses the **`whatsapp://` scheme, never `wa.me`**. `wa.me`
is an HTTPS host and is not in the walled garden, so a `wa.me` link tapped
from the portal does nothing at all. The scheme opens the installed app with
no network whatsoever. The message still cannot be *sent* until the customer
has data. Fixing that means allowing WhatsApp's own servers through the
walled garden, which hands every unauthenticated client on the network free
messaging and calls - the tenant's decision, not a default to ship, and it
would only reach routers on their next portal reinstall anyway.

## Custom branding: a logo and an accent colour

A third thing the tenant controls, on the same settings page
(`components/tenant/branding-settings.tsx`, `PATCH /api/admin/branding`).
It is a **plan feature**, `BillingPlan.features.customBranding`, switched on
per plan in the billing-plan dialog and listed on plan cards - not an addon,
so it is never sold on its own and does not appear on the Addons page.
Saving needs a plan with it; clearing never does. The portal shows saved
branding only while the tenant's plan has it (`lib/portal-branding.ts`), and
falls back to the default look otherwise, so a downgrade is cosmetic and
moving back brings the same logo back. It never blocks a page: failing
closed the way the captive-portal paywall does would turn a plan change into
an outage. The check reads the cached plan, so it costs no Firestore reads.

**No file storage, on purpose.** Firebase Storage needs the paid plan and
the logo is small and shown from pages that already read the tenant, so it lives on the tenant document
as a data URI, capped at 6KB of image (`lib/branding.ts`). Firestore bills
per document, not per byte, and the portal already reads that document, so
the logo costs no reads at all.

The logo is a **square mark**: fitted inside a 96px square when it is
shrunk, previewed in a square on the settings page, and shown in a 64px
square on both kinds of portal page, so what the owner sees is what
customers see. A wide wordmark still works, letterboxed, but reads small.
The browser tries PNG first, then WebP at falling quality; the route then
re-checks everything, because the browser half is a courtesy:

- the type comes from the file's own first bytes, not the data URI's label;
- the dimensions are read from the image header by hand, since the only
  image library worth having (`sharp`) is a native module and would mean an
  `npm install` on the VPS;
- **SVG is refused**: it can carry script and would be served to the public.
  The settings page accepts one as *input*, because the canvas rasterises it.

The accent colour is spliced into CSS on two kinds of page, so
`normalizeAccentColor` lets nothing but `#rrggbb` out, and the button text
colour is computed for contrast rather than chosen by the owner.

**On the hosted pages** the logo is written into the HTML and the colour
replaces `--primary` through a `:root:root` style element. A wrapper's inline
style would not reach the checkout dialog, which renders at the end of the
body.

**On the router pages** it travels in `brand.json`, written beside
`plan.json` and read the same way. See "Where the branding comes from" below.

**In the app's own nav** the logo replaces the generated shape in the
top-left tile, on the customer pages and the admin dashboard alike.
`app/[tenantSlug]/layout.tsx` resolves it through the same
`getPortalBranding` call, so the plan decides it the same way, and hands it
down through `components/tenant/tenant-brand.tsx`. The accent colour is not
applied there: it themes the sign-in page, not the dashboard.

## It is gated behind an addon

Installing requires the `captive-portal` addon, and so does the hosted portal
page. `install-portal` returns **402** without it; `{slug}/portal` serves a
neutral "unavailable" page instead of the login form and plan list, re-checked
on every request.

`uninstall-portal` is deliberately **not** gated: a lapsed payment must never
trap a tenant's router in a state they cannot undo. → `docs/addons.md`

## What install does, in order

The order is load-bearing, and `install-portal/route.ts` says so inline. Briefly:

1. **Walled garden first.** Clients must be able to reach `ogawifi.online` *before* anything redirects them there. Swapping the pages first would send every customer to a host their own router still blocks. **Any host failing stops the install** with a 502, before anything is switched. It used to be reported and ignored. If the tenant's decision hook has a verification page, its host is added here too, under its own comment (`ogawifi hook`), so "Verify your account" works from behind the paywall. That one alone is not fatal.
2. **Create the directory.** `hotspot-oga`, from `PORTAL_HTML_DIRECTORY` in `lib/hotspot-portal.ts`. `/tool fetch` won't create one.
3. **Write the shim** - a one-line redirect page - over the REST API, falling back to `/tool fetch` if that's refused. MikroTik's stock pages are never overwritten; we write a *new* directory alongside them.
4. **Write every other page** (`routerPortalPages`), `brand.json`, `errors.txt` and `plan.json`.
5. **Check the files are there.** `missingPortalFiles` looks up each name in `REQUIRED_PORTAL_FILES` on the router, and any miss stops the install with a 502 while the tenant's own pages are still serving. A write that reported success is not proof; a missing file is a 404 in front of customers.
6. **Switch the hotspot over**, by pointing every hotspot server profile's `html-directory` at ours.
7. **Probe MAC-login support.** Informational; never fails the install.

Step 6 is the only destructive one, and it's the one uninstall has to undo.

## The restore contract

`setHotspotHtmlDirectory()` returns `previous`: **one entry per hotspot server profile**, each `{ id, name, htmlDirectory }`. Install stores that whole array on the location as `portalPreviousProfiles`, and uninstall replays it through `restoreHotspotHtmlDirectories()`, putting each profile back on its *own* directory.

Three rules this encodes, each of which was a real way to lose the tenant's pages:

- **Per-profile, not one value.** A router can carry several hotspot profiles pointing at different directories. The original code stored `previous[0]` only, so uninstall flattened every profile onto whatever the *first* one used. If the tenant's custom page lived on any other profile, it was gone - which in practice looked like "we reverted them to stock".
- **Never restore onto our own directory.** Both capture and restore filter out `PORTAL_HTML_DIRECTORY`. Without this, a second install captures `hotspot-oga` as the thing to restore, and uninstall then "restores" to our own portal. That fails silently in the worst way: the portal keeps serving, but step 2 of uninstall has already withdrawn the walled garden from under it, so clients are redirected to a host their router now blocks.
- **Install refuses to run twice.** A 409 if `portalInstalledAt` is already set. The dropdown only ever offers one of install/uninstall, so this catches a stale client or a direct API call - but it's the real guard, because a second capture is what destroys the record.

An empty `html-directory` from RouterOS means its default, which is `hotspot` - hence `||` rather than `??` when reading it.

## Fallbacks, and where a restore is still a guess

| Situation | What uninstall does |
| --- | --- |
| `portalPreviousProfiles` present | Restores each profile to its own directory. A true restore. |
| Only the legacy `portalPreviousHtmlDirectory` | Sets every profile to that one value. Correct on a single-profile router, lossy otherwise. |
| Neither recorded | Sets every profile to `hotspot`. **A guess at MikroTik's default, not a restore.** |
| A captured profile no longer exists | Skipped, and named in the response's `skipped`. The tenant deleted it while our portal was installed; there's nothing to put back. |

Locations installed before `portalPreviousProfiles` existed sit in row 2 or 3 and cannot be upgraded retroactively - the information was never captured. If that matters for a specific tenant, the honest fix is to ask them what their `html-directory` was, not to infer it.

## Things that deliberately aren't undone

- **The shim file stays on disk.** It's inert once no profile points at it, and leaving it makes a reinstall a single field change.
- **The walled garden is withdrawn, but only our entries** - matched on the two comments we stamp them with, `ogawifi portal` and `ogawifi hook` (`removeOurWalledGardenEntries`). A tenant's own rules, and anything another tool added, are left alone.

## The hook's verification host

A decision hook's verification page (`docs/decision-hooks.md`) has to be
reachable from behind the paywall, so its host is a walled-garden entry of its
own, comment `ogawifi hook` (`lib/hook-walled-garden.ts`). It is kept in step
from both sides:

- **install or reinstall** adds it, for that router;
- **saving a hook** with a new, changed or cleared verification page, or
  deleting the hook, swaps it on every router whose location has the portal
  installed, in the background, and stamps the outcome on the hook. The hooks
  page shows it: how many routers carry it, or which could not be reached.

The swap is `planWalledGardenSync` in `lib/mikrotik.ts`: it touches only
entries with the hook comment, so the portal's own entries and the tenant's
rules are never at risk. An offline router is named, not fatal; the next save
or reinstall catches it up.

## Gotcha: changing the root domain

Every router with the portal installed carries a walled-garden allow-list naming the **old** domain, and keeps blocking the new one until the portal is reinstalled from the location's admin page. DNS and nginx alone will not do it. → `docs/domain-and-tls.md`

## The pages we install, and the rules for editing them

`lib/hotspot-portal.ts` builds every page in the directory. They are not
the same kind of thing, and the difference decides where you can change
what:

| File | Rendered by | Why |
| --- | --- | --- |
| `rlogin.html`, `redirect.html` | **the router** | Answers an intercepted request with a real 302 to the login page. Every phone's connectivity check lands here |
| `login.html` | **us**, after a redirect | It has to take payment, which a router cannot do |
| `alogin.html` | **the router** | Shown for a moment after connecting; only displays values RouterOS already holds |
| `status.html` | **the router** | Same, plus the data-usage bar |
| `error.html` | **the router** | RouterOS's page for a failure it cannot hand to the login page |

### A missing page is a 404, not a fallback

RouterOS does **not** fall back to its built-in pages for a file missing
from a directory that exists. It answers 404. This doc used to say the
opposite, and on 2026-11-28 that cost a new tenant their portal on install:
we wrote no `rlogin.html`, so the router answered every phone's
connectivity check (Android's `generate_204`, Apple's
`hotspot-detect.html`) with a 404. A phone reads that as "connected, no
internet", not as a sign-in page, so it never opened its sign-in sheet and
nobody reached `login.html`. Typing the router's address by hand still
worked, because that serves `login.html` directly. That is why the only
symptom anyone reported was "connected without internet".

The redirect pages copy RouterOS's stock ones: the
`$(if http-status == 302)` and `$(if http-header == "Location")` lines are
servlet directives that make the router send a real 302, which is what
phones detect. `scripts/test-portal-pages.mts` (`npm run test:portal-pages`)
pins those lines, pins that every name in `REQUIRED_PORTAL_FILES` has a
builder, and pins that install checks the router before it switches.

**Adding a page** means adding it to `routerPortalPages`, to
`REQUIRED_PORTAL_FILES` if a customer can reach it, and bumping
`PORTAL_PAGES_VERSION` so existing portals get it.

The router-rendered pages stay on the router deliberately. Our origin is
HTTPS and the hotspot is plain HTTP on a LAN address - that mismatch is what
made the login form a blocked mixed-content submission - and a hosted page
would also need walled-garden entries just to be reachable.

`logout.html` is **not installed at all**, and the status page has no
disconnect button. Sessions end on the keepalive timeout, not by the
customer's choice. Nothing links to it, but anyone who types the router's
`/logout` address gets a 404 (see above).

### Three rules, all of which have already bitten

1. **No literal `$(` in script or style.** RouterOS substitutes every
   `$(...)` it finds anywhere in the file, including inside `<script>`.
   jQuery-style `$(sel)` is eaten before the browser ever sees it.
2. **Assume any variable may not substitute.** An unknown name is left
   verbatim, so `$(foo)` arrives as five literal characters. Every value goes
   through `clean()` in the page's own script, which drops anything still
   shaped like a placeholder rather than showing it to a customer.
3. **No backticks anywhere in the CSS or script, comments included.** Both
   are TypeScript template literals, so one backtick ends the string early
   and the rest of the file parses as code. It fails at build time, but the
   reported line is nowhere near the real cause - this cost a real debugging
   session over the word "quota" in a JSDoc comment.

A fourth, procedural: **assert that every string replacement actually
applied.** A brand-header edit once silently matched `alogin.html` and not
`status.html`, shipped, and was only caught by looking at a screenshot.

### Where the branding comes from

`alogin.html` and `status.html` fetch `brand.json` from the router the way
they fetch `plan.json`: short keys (`l` logo, `a` accent, `f` text colour),
`{}` for no branding, and every value re-checked in the page before use. No
walled-garden entry, no mixed content, no image request.

Unlike `plan.json` it is **not rewritten on every pass**.
`lib/portal-brand-sync.ts` builds a key from `PORTAL_PAGES_VERSION` and the
branding's version (or none, while the plan lacks the feature), and each location stores
the key it was last written with in `portalBrandSynced`. `router-health`
writes `brand.json` and every page in `routerPortalPages` only where that
key has fallen behind, and records it only when all of them landed. Three things move it: an
owner saving, a move to or from a plan with the feature, and a bump of
`PORTAL_PAGES_VERSION`.

That last one is how **a change to the page builders now reaches every
installed portal without a reinstall**. Bump it whenever
`buildAloginPage`/`buildStatusPage` change what they output. A location
installed before this existed has no key, so the first pass after the deploy
that added it rewrites the pages on every installed portal, once.

### Where the expiry date and data balance come from

Neither is a page variable RouterOS will hand you. The expiry lives in each
hotspot user's `comment`, and the session's `limit-bytes-total` is the
*remaining* allowance, reset on every login - a usage bar built from it reads
0% used forever.

Both therefore travel in `plan.json`, written into each installed portal
directory by `router-health` and fetched same-origin by the pages.

Note the status page is the one surface that gets *consumption* right for
free, and it cannot be copied. It derives used from `$(remain-bytes-total)`,
which RouterOS computes live at render time. That variable does not exist in
the REST API: an active entry carries `.id`, `address`, `bytes-in`,
`bytes-out`, `comment`, `idle-time`, `keepalive-timeout`,
`limit-bytes-total`, `login-by`, `mac-address`, `packets-in`, `packets-out`,
`radius`, `server`, `session-time-left`, `uptime`, `user`, and nothing else.
So the app has to sum usage itself; see `totalBytesUsed` in `lib/mikrotik.ts`
for which fields are live and which only look it.
`lib/plan-map.ts` builds it, merging Firestore's `expiresAt` with the
router's comment (the router wins) and the user profile's
`limit-bytes-total`. If that job stops, these pages go stale, not wrong.
→ `docs/cron-jobs.md`

## Sign-in errors, and the errors.txt we install

RouterOS reports a failed login by substituting `$(error)` into `login.html`,
which our shim forwards to the portal as a query parameter. Left alone the
customer reads the router's own words: *invalid username or password*, *no
more sessions are allowed for user HS-4KJ2P9XQ*. Accurate, and useless to
someone in a shop deciding whether to buy another plan.

All of those strings come from an `errors.txt` in the hotspot servlet
directory - which, since we install into a directory of our own, is a file we
control. So install writes one that emits a **stable token per cause**
(`oga-uptime-limit`, `oga-user-session-limit`), and `lib/hotspot-errors.ts`
maps tokens to customer-facing copy.

Tokens rather than prose, for two reasons:

1. **Exactness.** Matching *no more sessions are allowed for user X* means
   matching a sentence with a username in the middle of it, in wording that
   varies by RouterOS version and that a tenant can edit on their own router.
2. **URL safety.** The shim forwards `error=$(error)` and MikroTik offers no
   `-esc` variant for it, so a stock message containing `&` or `?` truncates
   the rest of the query string. Our tokens are `[a-z-]` only, and the
   generated file deliberately interpolates nothing - no `$(username)`, no
   `$(error-orig)`.

### Three fallbacks, in order

- **A token we know** gives the specific message.
- **Stock RouterOS wording** is pattern-matched, because a portal installed
  before this existed has no `errors.txt` of ours until it is reinstalled.
  Reinstalling upgrades it; nothing breaks in the meantime.
- **Anything else** gives a generic "Sign-in didn't work". It deliberately
  does not echo the router's text: a page that says "Sign-in didn't work" and
  then "invalid chap-id" underneath is worse than one that says neither.

`npm run test:portal-errors` pins the round trip, because the file and the
table are two places that must agree and nothing fails when they drift - the
page just quietly downgrades to the generic message.

### Each message decides whether to sell

A `offerPlans` flag separates "your plan ran out, here are the plans" from
"the network is full, wait a few minutes". Selling a plan to someone the
router has no capacity for would take their money for a connection they
cannot get, so the full-network and service-down cases deliberately do not
link to the plan list.

### Why an inline alert and not a toast

This is a form error the customer has to act on, and it arrives on a fresh
page load after the router bounced them back. A toast fades after a few
seconds, cannot be returned to, and sits in a corner away from the fields it
is about - so it takes the instructions away mid-read, on a phone, from
someone who is already stuck. Toasts confirm something that already worked;
an error blocking the task belongs next to the task.
