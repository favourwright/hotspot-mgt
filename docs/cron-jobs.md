# Scheduled Jobs

Assumes you've read `docs/glossary.md` and `docs/deployment.md`.

Six jobs, all in `lib/cron-jobs.ts`, all reached through one route:
`POST /api/cron/<job>` (`GET` works too - some runners only issue GET).

| Job | Schedule (UTC) | What it does |
| --- | --- | --- |
| `router-health` | every 15 min | Router online/offline transitions, `Voucher.expiresAt` backfill, rewrites `plan.json` on every installed portal |
| `voucher-expiry` | every 10 min | Emails customers an hour before access ends, and closes out vouchers whose date has passed |
| `payment-reconcile` | every 15 min | Asks Paystack what it charged in the last 24h and fulfils anything we never recorded |
| `sales-digest` | daily, 06:00 UTC (07:00 WAT) | Yesterday's sales to each tenant owner, plus the platform digest to superadmins |
| `plan-fee-due` | daily, 07:00 UTC | Warns an owner before a waived plan fee comes back, and tells them once it has |
| `voucher-reap` | daily, 03:30 UTC | Deletes the hotspot users of vouchers that expired more than 14 days ago |

### `voucher-reap` - **not yet registered**

Added with voucher renewal. Like `plan-fee-due`, **deploying it schedules
nothing** - until someone adds it at cron-job.org, routers keep accumulating
dead logins exactly as they did before.

- URL: `https://ogawifi.online/api/cron/voucher-reap`
- Method: `POST`
- Schedule: daily, 03:30 UTC
- Header: `x-cron-secret: <CRON_SECRET>`

### `plan-fee-due` - **not yet registered**

Added with fee waivers and promo codes. **Deploying it schedules nothing**,
so until someone adds it at cron-job.org a tenant whose free period ends is
never told, and finds out only if they open their settings page.

To add it:

- URL: `https://ogawifi.online/api/cron/plan-fee-due`
- Method: `POST`
- Schedule: daily, 07:00 UTC
- Header: `x-cron-secret: <CRON_SECRET>` - a **header**, not
  `Authorization: Bearer`, which has been got wrong before and returns a bare
  `{"error":"Not found"}`

Daily rather than every few minutes on purpose: it is about a date, not a
moment, and the warning window is three days wide. It stamps
`endingNotifiedAt` and `dueNotifiedAt` on the waiver so each send happens
once rather than on every tick, the same way `expiryNotifiedAt` works for
voucher expiry.

Before the "now due" email it re-resolves the tenant's state and sends
nothing unless they genuinely owe: another waiver may cover them, they may
have moved to a free plan, or they may have already paid. Telling someone
they owe money when they do not is worse than saying nothing.

## The runner is cron-job.org, not systemd

**`deploy/hotspot-cron@*.timer` exists in the repo but is not installed on the
VPS.** Nothing in `systemctl list-timers` matches `hotspot-cron@*`. The
schedule lives in an external cron-job.org account hitting the public HTTPS
endpoint, which is why the access log shows the jobs arriving from
`116.203.x.x` with a `cron-job.org` user agent:

```bash
ssh -i ~/.ssh/ssh-key-2026-06-06.key ubuntu@193.123.183.184 \
  "sudo grep -h '/api/cron' /var/log/nginx/access.log | tail -20"
```

That is the fastest way to answer "did this job actually run", and the only
way from this side - we have no access to the cron-job.org account from the
codebase. **Check it before concluding a job is broken.** A job that was
never scheduled externally looks identical, from in here, to one that is
failing.

The timer units are kept because they're the fallback if the external runner
is ever dropped, and because they record the intended schedule. One
difference matters if you ever install them: the `sales-digest` unit says
`07:00`, which on this UTC box is 08:00 WAT, while cron-job.org is set to
06:00 UTC for 07:00 WAT. The unit is the one that's wrong.

## `CRON_SECRET` is the boundary, not the network

nginx proxies `/api/cron` like every other path, so it is reachable from the
internet no matter who is calling it. Auth is the `x-cron-secret` **header**,
compared with `crypto.timingSafeEqual`.

- It is **not** `Authorization: Bearer`. Sending that gets you
  `{"error":"Not found"}`, which reads exactly like a wrong job name. This
  has already cost one debugging session.
- An unset `CRON_SECRET` closes the endpoint rather than opening it. An
  unauthenticated job runner is worse than a job that never runs.
- A wrong secret and an unknown job both return a bare 404, deliberately: an
  unauthenticated caller learns nothing about which jobs exist.

Running one by hand:

```bash
curl -s -X POST https://ogawifi.online/api/cron/voucher-expiry \
  -H "x-cron-secret: $CRON_SECRET"
```

## The three rules every job obeys

1. **Bounded.** The VPS is 956MB with an OOM in its history, so nothing walks
   an unbounded collection or holds a whole tenant's vouchers in memory.
2. **Idempotent.** A job firing every 15 minutes re-runs the same work all
   day. Anything that sends email records that it did, and acts on
   *transitions* rather than on states.
3. **Partial failure is fine.** One unreachable router must not stop the other
   tenants being processed. Each unit of work is caught individually and
   named in `errors`, and the job still returns 200 - failing the request
   would just make the runner retry work that already half-succeeded.

Rule 3 has a consequence worth stating plainly: **`ok: false` goes nowhere.**
No email, no alert, no dashboard. The summary is returned to the caller and
logged with `console.info`, and since the response is a 200 the external
runner has nothing to flag either. If a job starts erroring every tick, the
only places that show it are the journal and whatever downstream symptom the
missing work eventually produces.

```bash
ssh -i ~/.ssh/ssh-key-2026-06-06.key ubuntu@193.123.183.184 \
  "sudo journalctl -u hotspot-mgt --no-pager | grep '\[cron\]' | tail -20"
```

## `router-health` is a heartbeat two features depend on

Reaching a router is the expensive part, so everything needing one shares the
single connection. Two of those are not obviously part of a "health" job:

- **`Voucher.expiresAt` backfill.** The router owns expiry (see below), so
  this is how a real expiry date reaches Firestore for any purchase the
  auto-login path in `/api/payment/verify` missed.
- **`plan.json`.** The router-rendered status and alogin pages read this file
  to show a customer their expiry and data allowance. It is rewritten whole
  on every pass and only into directories a location actually has installed
  (`portalHtmlDirectory`), so an uninstalled portal never gets a stray file.

If this job stops, those pages show **stale** dates rather than wrong ones,
and new vouchers silently never get an `expiresAt`.

## `voucher-expiry` does two unrelated things

The reminder (`customer.voucher_expiring`, one hour ahead, stamped with
`expiryNotifiedAt` so it sends once) and the **close-out** - flipping
`status` to `"expired"` with an `expiredAt` stamp once `expiresAt` has
passed.

The close-out was added in October 2026 because **nothing in the codebase had
ever written `status: "expired"` to a voucher.** The crons synced the expiry
*date* and never the *status*, so every voucher stayed `"active"` forever and
`/admin/users` accumulated a permanent, growing "the platform and the router
disagree about them" warning - one per plan that had ever run out.

Two deliberate choices in that fix:

- It keys off **our** `expiresAt`, not the router's verdict. That is what the
  customer was sold, and it still holds when the router is unreachable.
- It does **not** suppress the other drift case, "past its expiry date but
  still enabled on the router". That one is a real router-side enforcement
  failure - someone still online on a dead plan - and marking the voucher
  expired must not hide it.

That second case needed one correction of its own, in October 2026. **The
two sides do not expire a voucher at the same moment, and for an hour that
is normal rather than drift.** This job closes a voucher out within minutes,
because it runs every 10. The router clamps `limit-uptime` only when its
per-profile sweeper next fires, and `profileSweepIntervalMinutes` caps that
at 60 - so every plan of 12 hours or longer, daily included, is swept
hourly. In between, the platform says expired and the router has not acted
yet, and both are behaving exactly as designed.

Reported as drift, that produced "N users need attention" on every single
daily-plan expiry. On 2026-10-15 three customers at one location expired
within thirteen minutes of each other and all three were flagged for the
next hour, with nothing wrong on either side. `routerSweepGraceMs` in
`lib/hotspot-users.ts` now gives the router its own sweep interval plus a
five-minute margin before the disagreement counts, reading that interval
from the same function that configured the scheduler so the page cannot
expect the router to react faster than we ever asked it to. Past the
window it still shouts, because by then it is the real failure.
`npm run test:hotspot-drift`.

The 10-minute interval must stay well inside `EXPIRY_WARNING_MS`, or a
voucher can expire between two ticks with nobody warned.

## `voucher-reap` and the one thing it must never do

Nothing ever removed a user from a router. Every sale created one, every
expiry left it there disabled, and a hotspot running for a year accumulated
thousands of dead logins - which is the real reason `/admin/users` gets
slower every month and the reason a tenant looking at their own router in
Winbox mostly sees rubbish.

Renewing in place (`docs/billing-and-payments.md`) slows that growth for
repeat customers. This job bounds it for everyone else: once a voucher has
been expired for **14 days**, its hotspot user is deleted and the voucher is
stamped `routerUserReapedAt`.

**A router user with no voucher behind it is never touched.** Those are the
tenant's own, made by hand in Winbox, often predating this app and often the
ones keeping their family online. The reconciliation view exists to show
them, not to clean them up. So the job is driven entirely from voucher
documents - it starts from something we sold and deletes the one user that
voucher names - and never from the router's user list.

Three more things worth knowing before changing it:

- **14 days is a grace period, not a round number.** A customer who comes
  back the week after their plan ran out gets their old user revived in
  place, keeping the username they chose (`reviveHotspotUser` in
  `lib/mikrotik.ts`). Reaping sooner throws that away to save a row. It also
  gives a wrongly closed-out voucher a fortnight to be noticed before the
  evidence on the router is gone.
- **`routerUserReapedAt` is what keeps the drift report quiet.** Without it
  every reaped voucher reads as "sold through the platform but missing on
  the router" - true, and exactly the growing warning this job exists to
  stop producing.
- **It keeps a cursor, in `cronState/voucher-reap`.** A reaped voucher still
  matches "expired and old", so a plain query would return the same finished
  rows forever and never reach new ones, and filtering on the stamp does not
  work either because Firestore cannot match a field older documents do not
  have. The cursor is the `expiresAt` of the last voucher examined, and each
  run takes the next slice above it. It trails real time by at least the
  14-day window, so a voucher whose `expiresAt` is backfilled late by
  `router-health` still lands well above the mark.

## `payment-reconcile` is the last line of defence

Full story in `docs/billing-and-payments.md`. The short version: it asks
Paystack what it charged in the last 24 hours, compares against our
`payments`, and **fulfils** rather than merely alerting - the customer paid,
the work is idempotent, and a job that only reports still leaves someone
waiting for a human to read a log.

`FULFILMENT_GRACE_MS` (10 min) keeps it from racing the webhook. The
`reconcileSkips` collection is how a charge that was deliberately never
fulfilled stays unfulfilled instead of being replayed on every pass.

## `sales-digest` and the UTC window

Sends `owner.sales_digest` per tenant, and `platform.daily_digest` to
superadmins. Only for a day that actually had a sale - a daily "you sold
nothing" email is its own reason to mute us.

The window is **yesterday in full, in the server's timezone**, deliberately
closed rather than "the last 24 hours" so a late or double run cannot count
the same sale twice. The VPS is `Etc/UTC` and the business runs on WAT
(UTC+1), so the digest's "yesterday" is an hour out of phase with the
tenant's: a sale between 23:00 and midnight WAT lands in the following day's
digest. Known and open - see `docs/open-items.md`.

The platform digest has a guard worth preserving: if the attention scan
throws, it says so rather than rendering "Nothing needs attention." A false
all-clear is worse than an error.

## Adding a job

1. Add the name to `CronJobName` and `CRON_JOBS` in `lib/cron-jobs.ts`. The
   route validates against that list, so an unlisted name 404s.
2. Write the runner to the three rules above, returning a
   `summary` of counts and an `errors` array.
3. Add a timer unit in `deploy/` for the record, then **add the real schedule
   on cron-job.org** - the unit alone schedules nothing.
4. If it queries across tenants, it needs a `COLLECTION_GROUP`-scoped index in
   `firestore.indexes.json`, deployed separately (runbook step 5).

## How a voucher's expiry is known at all

Worth reading before touching any of the above, because it is not obvious.

**The router owns expiry, and it is not wall-clock time from purchase.** A
voucher is created with `comment: "vc"`, meaning unactivated. On the
customer's **first login**, the profile's `on-login` script computes
`now + duration` and writes that datetime into the user's comment; a
router-side scheduler expires anyone whose comment date has passed. So "2
Hours" means two hours from first use, and a voucher bought at 9am and first
used at 5pm dies at 7pm.

Purchase time therefore tells you nothing, and `Voucher.expiresAt` is filled
from two places, neither of which guesses:

1. **The auto-login in `/api/payment/verify`** - for a portal purchase the app
   logs the device in immediately, and that *is* the first login, so the
   expiry is known exactly then and costs nothing to record.
2. **`router-health`**, for everything that missed (no device attached, or
   auto-login failed). It reads the comments back with
   `parseRouterExpiryComment` and fills any voucher still holding `null`.
