# Open Items

Known problems that are not fixed, with the date each was confirmed. This is
deliberately short-lived content: **delete an entry when it's resolved rather
than marking it done**, or this doc stops being trustworthy.

Anything here that is a *permanent* design constraint belongs in the doc for
its area instead, not here.

## The landing page's gradient fields: how the banding was fixed

*Resolved 2026-10-17. Kept here only until somebody is tempted to
rebuild these from smooth gradients again; delete it then.*

The hero backdrop and the media cards banded visibly, worst of all
while the pointer moved. Five passes failed to fix it: smoothstep
ramps on every gradient stop, a sampled-gaussian falloff that lands
with zero slope, folding element opacity into the gradient, removing
blend modes, and three separate attempts at a dither overlay.

**Why none of that worked.** Every one of them was shaping or masking an
8-bit gradient. Banding is quantization, and a dither drawn on top of
an already-composited image cannot remove a contour - it only makes one
harder to see, which fails in exactly the case that mattered here: a
contour that moves while the grain stays still, because the eye
separates a sliding structure from a fixed texture.

**What worked.** `components/marketing/gradient-field.tsx`: a field of
small circles under a heavy blur. Blur runs *after* rasterization and
averages neighbouring pixels, so the quantization steps are gone rather
than disguised. Many small circles also leave no long shallow ramp for a
contour to form along. The stage renders at quarter scale with a
quarter of the blur and is scaled back up by four, which cuts the filter
to a sixteenth of the pixels and adds roughly two bits of effective
precision through the interpolation on the way up.

**If you are tempted to go back to composed gradients, do not.** The
measurements that chased this are also worth not repeating: row-average
scans cancel radial structure and will report a banded field as clean,
and sampling any region containing text, a button or a rule reports
content edges as backdrop defects. Both cost real time. The method that
works is to capture two states, difference them to cancel static grain,
then band-pass in 2D.

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

## `owner.plan_fee_locked` is not in Mailtrap yet

*Added 2026-10-19.*

The body is generated at `email-templates/owner.plan_fee_locked.html` and the
code sends it, but a brand-new email **silently skips** until someone pastes
the template into Mailtrap and sets its ID at `/superadmin/emails` - there is
no API step for this.

It matters more than the usual version of this chore. This is the email that
tells an owner their voucher sales have stopped. Until it is wired, a tenant
whose grace window closes finds out when a customer fails to buy. The two
warnings before it (`owner.plan_fee_ending`, `owner.plan_fee_due`) are already
configured and have been reworded for the grace window, so those will send -
but they both promise a deadline that then passes in silence.

The `plan-fee-due` cron that sends all three is registered and running, so the
two warnings will go out as soon as this deploys. It is only the third that is
missing.

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
