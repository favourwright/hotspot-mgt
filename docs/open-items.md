# Open Items

Known problems that are not fixed, with the date each was confirmed. This is
deliberately short-lived content: **delete an entry when it's resolved rather
than marking it done**, or this doc stops being trustworthy.

Anything here that is a *permanent* design constraint belongs in the doc for
its area instead, not here.

## The landing hero's backdrop bands when the pointer moves

*Confirmed 2026-10-16. Cosmetic; nothing functional depends on it.*

Faint curved contours slide across the hero's glow field when the cursor
moves toward the bottom of the section. They are hard to catch in a still
screenshot and obvious in motion.

**What it is.** Concentric rings from 8-bit alpha quantization in each
body's radial gradient. The falloff spans roughly 800px with about 120
levels of contrast against the base, so one alpha step moves the composite
by `120/255` of a level. Measured ring amplitude is 0.468 levels, which
matches that arithmetic. It is the floor of compositing a CSS gradient, not
a tuning problem.

**Why the dither does not remove it.** `components/marketing/hero/hero-backdrop.tsx`
overlays noise, but that layer sits on top of an already-composited image,
so it *masks* contours rather than dithering them - real dithering has to
perturb the signal before it is quantized, and CSS compositing offers no
hook for that. Masking works on a still image and fails in exactly one
case: a contour that moves while the grain stays put, which the eye
separates easily. Stepping the grain in time helps and did not settle it.

**Already tried, all kept because each is a genuine improvement, none of
which was the cause:** smoothstep stops on the base and both masks
(removes Mach bands at three-stop middles), a sampled-gaussian body falloff
that arrives with near-zero slope (removes the gradient terminus edge),
per-body opacity folded into the gradient stops, and opacity removed from
the drift keyframes (two fewer quantization passes).

**Do not re-derive the measurements.** Row-average scans cancel radial
structure and will report the field as clean; sampling regions that contain
text, a button or a dashed rule reports content edges as backdrop defects.
Both wasted real time. The method that works is to capture two pointer
states, difference them to cancel the static grain, then band-pass in 2D.

**If it gets fixed, the route is a canvas/WebGL field** where noise is
added before quantization. That costs the properties the current one was
built for: the backdrop is a server component today with no JavaScript, no
context to manage and no fallback path. Cheaper partial mitigations are
shorter pointer-parallax distances and fewer bodies, both of which reduce
how far the rings travel rather than removing them.

## Email verification is built but not switched on

*Added 2026-10-14.*

The code is in place and blocks nothing, but three manual steps are
outstanding and until they are done the feature is inert rather than broken:

1. **Four Mailtrap templates** need pasting and their IDs setting at
   `/superadmin/emails`: `customer.verify_email`, `customer.verify_new_email`,
   `owner.verify_email`, `owner.verify_new_email`. Until then every
   verification send *skips* - the routes report the failure honestly rather
   than claiming "check your inbox", so nobody is misled, but nothing sends.
2. **The Firestore index** for `customers.uid` (COLLECTION_GROUP) needs
   `firebase deploy --only firestore:indexes`. Without it the per-tenant
   customer record keeps a stale address after a change; the two copies that
   decide where mail actually goes are unaffected.
Deployed 2026-10-14; steps 1 and 2 are still outstanding.

## Google will not let us brand the auth email landing page

*Confirmed 2026-10-14. Blocked on Google, not on us.*

`/auth/action` is built, deployed and returning 200, but the project setting
that would send links to it is refused:

```
EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED   (400 INVALID_ARGUMENT)
```

Every candidate cause was checked and cleared: `ogawifi.online` is an
authorized domain, the page is live, and the credential can write the field -
a no-op PATCH of the identical value succeeds, and only a real change is
rejected. The Firebase console calls the same API and fails the same way,
reporting "An error occurred updating action URL".

**Nothing is broken and nothing is waiting on this.** Links land on Firebase's
own handler, which verifies emails, completes changes and resets passwords
exactly as before. The only loss is that one page is not ours.

Retry any time with:

```bash
npm run auth:action-url -- --set custom
```

If it ever needs escalating, other projects report the same refusal on the
same field with no public resolution, so it is a Firebase support case rather
than something to debug here.

## TLS cannot renew - hard deadline 2027-01-02

*Confirmed 2026-10-13. The only item here with a date attached to an outage.*

The Cloudflare API token on the VPS is invalid, so `certbot renew --dry-run`
fails with error `9109`. The running certificate is still valid and nginx is
serving it happily, which is exactly the failure mode: **an invalid DNS
token breaks nothing visible until the certificate expires.** Renewal is due
in early December and will fail silently; HTTPS for `ogawifi.online` and
every tenant subdomain breaks on **2027-01-02**.

Fix: issue a new scoped token, put it in `.env.production` as
`CLOUDFLARE_API_TOKEN`, then `npm run cloudflare:token` (which pushes it to
`/root/.secrets/cloudflare.ini` and re-runs the dry run). Token scopes and
the full setup: `docs/domain-and-tls.md`.

## The digest's "yesterday" is an hour out of phase with WAT

*Confirmed 2026-10-13.*

The VPS is `Etc/UTC`; the business runs on WAT (UTC+1). `sales-digest`
computes a closed "yesterday" window in the server's timezone, so a sale
between 23:00 and midnight WAT is reported in the *following* day's digest.
Totals are never double-counted or lost - just attributed to the wrong day.

Fix is one line in `deploy/hotspot-mgt.service`:

```
Environment=TZ=Africa/Lagos
```

Then `daemon-reload` and restart. Check first whether anything else reads the
server clock and expects UTC before changing it. → `docs/cron-jobs.md`

## The VPS source checkout cannot `git pull`

*Since 2026-10-02.*

Step 3 of the runbook fails with `could not read Username for
'https://github.com'` - the GitHub remote now wants auth where it used to be
anonymous-readable. **Safe to skip entirely**: `next start` only needs
`.next/` and `node_modules/`, never the source tree. The only cost is that
the VPS checkout drifts from `main`, so never read it as a source of truth
about what's deployed - compare `BUILD_ID` instead.

Adding a deploy key or credential to the VPS to fix this is a security
decision and needs the user's explicit sign-off first. Do not do it as a
routine deployment mechanic.

## The unused `default` hotspot profile points at our directory

*Confirmed 2026-10-12, on the production tenant's router.*

The `default` hotspot server profile has `html-directory=flash/hotspot-oga`
instead of `flash/hotspot`. Nothing serves from it today, so it is harmless -
but it means a profile nobody installed our portal on would serve our portal
if it were ever put into use, and it makes the router's config read as though
the portal is installed more widely than it is.

Resetting it is a single field change. Left alone so far because touching a
tenant's router config without a reason is its own risk.

## HSTS is held back until the certificate can renew

*Decided 2026-10-16.*

`next.config.ts` now sets the ordinary security headers (`nosniff`,
`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`), and
deliberately **not** `Strict-Transport-Security`.

It is the right header for this app. It is held back for one reason: the
wildcard certificate cannot currently renew and HTTPS breaks on 2027-01-02
(above). HSTS needs `includeSubDomains` here, because every tenant is a
subdomain - and that removes the browser's ability to fall back to plain
HTTP. The expiry would go from "every visitor sees a warning they can click
through" to "every visitor who has ever been here cannot reach the site at
all", for the whole `max-age`, with no server-side fix.

Add it once renewal works. Not before, and not with `preload`, which cannot
be undone on any useful timescale.

## `npm run lint` reports 65 pre-existing findings

*Surfaced 2026-10-16, when the lint run was fixed.*

Lint had been crashing on every file before it reached a single rule (see
`docs/decisions-and-gotchas.md`), so nothing in it had been read for a while.
With it running, the correctness rules were worked through and the rest were
left deliberately:

- **31 `no-unused-vars`, 11 `no-explicit-any`, 3 `no-unescaped-entities`,
  2 `prefer-const`, 1 `no-img-element`.** Mechanical. Worth a pass of its
  own; not worth burying a behavioural change under.
- **17 `react-hooks/set-state-in-effect`.** Two shapes, neither of them a
  bug today. Nine are a dialog resetting its form when `open` flips; React's
  own answer to that is a `key` on the dialog so it remounts, which is a
  structural change to nine components and needs each one's "what should
  survive a reopen" decided on purpose. The other eight read an external
  system on mount - `localStorage`, `matchMedia`, a script load, a Firestore
  subscription - which is the case the rule's own message calls legitimate
  and cannot distinguish from the bad one.

Nothing here blocks a deploy. `npm run lint` exiting non-zero does mean it
cannot gate CI until the list is cleared.
