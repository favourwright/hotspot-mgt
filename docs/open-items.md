# Open Items

Known problems that are not fixed, with the date each was confirmed. This is
deliberately short-lived content: **delete an entry when it's resolved rather
than marking it done**, or this doc stops being trustworthy.

Anything here that is a *permanent* design constraint belongs in the doc for
its area instead, not here.

## Security work still open

*Added 2026-11-02.* The rest of this review shipped; these each need a decision or
access the code does not have.

1. **Read the report-only CSP, then enforce it.** `bash scripts/audit-vps.sh` shows
   the reports, after real checkouts and a portal login on a real router. Allow what
   is legitimate, then rename the header in `next.config.ts`. Enforcing without
   this risks breaking checkout.
2. **`routerPass` is still plaintext in Firestore** until someone turns encryption on.
   The code is done; the steps are in `docs/auth-and-security.md` ("Router passwords").
   Needs a new credential on the VPS, which needs sign-off.
3. **The app runs as `ubuntu`**, whose `sudo wg-quick` is effectively root, since a
   WireGuard config can run commands. Give the app its own user with no sudo.
   `/home/ubuntu` may not be traversable by another user, so this likely means moving
   the app directory and updating the runbook, the units and `push-env.sh`.
4. **VPS findings from `bash scripts/audit-vps.sh`** (2026-11-02). Each changes the
   box, so each needs sign-off. None touches Apache or the `10.10.10.0/24` subnet.
   - `iptables` accepts `wg0` to `wg0` with forwarding on, so traffic can pass between
     tunnel peers. Drop it for `10.20.0.0/24` only; the app reaches routers from the box
     itself, which does not use FORWARD.
   - `/opt/wg-manager/config.json` holds the manager's secret and is mode 644, so
     `www-data` can read it. `chmod 600` it.
   - Six old copies of `.env.local` (`.env.local.bak-*`, `.env.local.save`) sit in the app
     directory. Delete them; `/home/ubuntu` being 750 is what protects them today.
   - `next-server` listens on every interface, with only `iptables` keeping port 3000
     private. Bind it to `127.0.0.1`.
   - Ubuntu 22.04 standard support ends in April 2027. Plan the upgrade.
5. **The source checkout can go from the VPS** once `next.config.ts` ships with
   each deploy: it keeps the full source and `.git` on a box shared with other products.
   Keep `.next/`, `node_modules/`, `package.json`, `next.config.ts` and `.env.local`.
   Nothing reads the source at runtime and `public/` is empty (checked 2026-11-02).
6. **Logging a Firebase Auth error can write a live access token to the journal.**
   `firebase-admin` 14 errors carry the failed request, including its `Authorization`
   header, and `console.error(error)` prints all of it (seen 2026-11-02 on an uncaught
   `auth/internal-error`). Log `error.code` and `error.message` for these instead. The
   token lasts about an hour, but it acts as the service account.
7. **The legal wording is a draft.** `LICENSE` and the acceptable-use clause need a
   lawyer's review before anyone relies on them.

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

## Webhooks: steps before they deliver reliably

*Added 2026-10-30.*

1. **Deploy the indexes:** `firebase deploy --only firestore:indexes` (two
   `webhookDeliveries` composite indexes). Until they build, the delivery log and
   the retry cron fail. Rules are deny-all now and have their own deploy order
   (`docs/deploy-runbook.md`).
2. **Register `webhook-deliver` on cron-job.org**, every minute
   (`docs/cron-jobs.md`). Until then first attempts work and nothing is
   retried.
3. **Switch on `owner.webhook_disabled`** at `/superadmin/emails` (nothing to
   paste since emails are drawn in code). Until then an endpoint is still
   switched off after three days, silently.

## Decision hooks: steps before anyone can use them

*Added 2026-10-29.* Nothing here breaks anything while undone: the
`api-access` addon has no document yet, so nobody is entitled.

1. **`HOOK_SECRETS_KEY` on the VPS.** `openssl rand -base64 32`, then
   `npm run env:push -- HOOK_SECRETS_KEY`. Needs the owner's sign-off, like any
   credential. Never change it once a hook exists. Until it is set, the hooks
   page says hooks are unavailable.
2. **Deploy the index:** `firebase deploy --only firestore:indexes` (the `hookCalls`
   composite index). Then `npm run check:indexes`. Rules are deny-all now and have
   their own deploy order (`docs/deploy-runbook.md`).
3. **Switch on two emails** at `/superadmin/emails`: `owner.hook_failing` and
   `owner.hook_recovered`. Until then the breaker still works and the hooks
   page shows "Failing", but the owner is not emailed.
4. **Set up the API Access addon** at `/superadmin/addons`: price it (free
   makes it available to everyone). Then, in the billing-plan dialog, bundle
   it in every plan that should include it. **The "Internal" plan had the old
   "API Access" switch on**, so bundle it there to keep what that plan
   advertised. (Grandfathering is not needed today: no hook exists yet.)

## `owner.plan_fee_locked` is not switched on yet

*Added 2026-10-19. Updated 2026-11-27: emails are drawn in code now, so there
is nothing to paste - only a switch to flip.*

The code sends it, but an email nobody ever set up a Mailtrap template for
reads as **off** after the move to in-code rendering (`lib/email-switches.ts`),
so it still skips until somebody switches it on at `/superadmin/emails`.

It matters more than most. This is the email that tells an owner their voucher
sales have stopped. Until it is on, a tenant whose grace window closes finds
out when a customer fails to buy. The two warnings before it
(`owner.plan_fee_ending`, `owner.plan_fee_due`) are already on, but they both
promise a deadline that then passes in silence.

## Google will not let us brand the auth email landing page

*Confirmed 2026-10-14. Blocked on Google, not on us. Mostly worked around
2026-11-27: every link we send is rewritten onto `/auth/action` by
`lib/action-link.ts`, so this now affects only mail Firebase sends itself (the
`recoverEmail` undo link, and the password-reset fallback).*

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

## HSTS is at a one-day max-age until December

*Decided 2026-10-16, unblocked 2026-10-23.*

The original hold is resolved: the Cloudflare token was replaced on
2026-10-23 and `certbot renew --dry-run` now passes end to end, including
the `renewal-hooks/deploy/` nginx reload. `next.config.ts` sets
`Strict-Transport-Security: max-age=86400; includeSubDomains`.

**What is still open: the `max-age` is one day, not a year.** A dry run
proves the DNS-01 challenge works; it does not prove an *unattended*
renewal does. The first real renewal is due in early December. Once it has
run and the served certificate shows new dates, raise `max-age` to
`31536000`.

Do not add `preload`. Removal from the browser preload list takes months
and is not something that can be undone from here.

`includeSubDomains` is required rather than optional, because every tenant
is served at `{slug}.ogawifi.online` and an apex-only policy would leave all
of them downgradeable. One consequence worth remembering: HSTS applies to a
hostname on *every* port, so a browser that has visited the app will refuse
`http://ogawifi.online:8081` and `:8082` instead of showing the 403 those
now return. Both legacy products are reached by IP, which HSTS never covers.

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
