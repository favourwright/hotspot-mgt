# Open Items

Known problems that are not fixed, with the date each was confirmed. This is
deliberately short-lived content: **delete an entry when it's resolved rather
than marking it done**, or this doc stops being trustworthy.

Anything here that is a *permanent* design constraint belongs in the doc for
its area instead, not here.

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
3. **The Firebase console action URL** must be pointed at
   `https://ogawifi.online/auth/action` - **after** that page is deployed, not
   before. See step 5d in `AGENTS.md`.

Until step 3, links keep landing on Firebase's own handler, which works and is
simply unbranded.

## TLS cannot renew - hard deadline 2027-01-02

*Confirmed 2026-10-13. The only item here with a date attached to an outage.*

The Cloudflare API token on the VPS is invalid, so `certbot renew --dry-run`
fails with error `9109`. The running certificate is still valid and nginx is
serving it happily, which is exactly the failure mode: **an invalid DNS
token breaks nothing visible until the certificate expires.** Renewal is due
in early December and will fail silently; HTTPS for `ogawifi.online` and
every tenant subdomain breaks on **2027-01-02**.

Fix: issue a new scoped token, put it in `.env.local` as
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
