# Scheduled Jobs

Assumes you've read `docs/glossary.md` and `docs/deployment.md`.

Seven jobs, all in `lib/cron-jobs.ts`, all reached through one route:
`POST /api/cron/<job>` (`GET` works too - some runners only issue GET).

| Job | Schedule (UTC) | What it does |
| --- | --- | --- |
| `router-health` | every 15 min | Router online/offline transitions, `Voucher.expiresAt` backfill, rewrites `plan.json` on every installed portal, rewrites `brand.json` and the router pages where a portal's branding key is behind (`lib/portal-brand-sync.ts`), turns first-used generated codes into vouchers and resumes stalled generation batches (`docs/voucher-generation.md`) |
| `voucher-expiry` | every 10 min | Emails customers an hour before access ends, and closes out vouchers whose date has passed |
| `payment-reconcile` | every 15 min | Asks Knomad Pay what was paid and fulfils anything we never recorded; applies billing payments never reported back; makes missing payees |
| `sales-digest` | daily, 06:00 UTC (07:00 WAT) | Yesterday's sales to each tenant owner, plus the platform digest to superadmins; stores the dashboards' daily figures for the last two days (`lib/stats-rollup.ts`) |
| `plan-fee-due` | daily, 07:00 UTC | The plan-fee emails: before a free period or paid month ends, when it has, and when the grace window runs out and sales stop; and before an addon's paid period ends |
| `voucher-reap` | daily, 03:30 UTC | Deletes the hotspot users of vouchers that expired more than 14 days ago |
| `webhook-deliver` | every minute | Retries tenants' webhook deliveries that are due, on the backoff in `lib/webhook-events.ts` |

### `webhook-deliver` - **not yet registered**

Added with outbound webhooks. Every delivery's first attempt happens without
it, straight after the event; **until it is added at cron-job.org, nothing
is ever retried**, so an endpoint that is down for one minute misses that
event for good.

- URL: `https://ogawifi.online/api/cron/webhook-deliver`
- Method: `POST`
- Schedule: every minute
- Header: `x-cron-secret: <CRON_SECRET>`

Bounded to 50 deliveries and about 45 seconds a tick. It reads one query per
tick even with nothing due, which is about 1,440 reads a day on Spark.

### `voucher-reap`

Registered and running daily since 2026-10-25. Its first two attempts
returned 404 and looked like a missing route: the job had been added at
cron-job.org without the `x-cron-secret` header, and the dispatcher answers
an unauthenticated caller with 404 on purpose so it learns nothing about
which jobs exist (`app/api/cron/[job]/route.ts`). A 404 from this endpoint
means the secret, not the URL.

- URL: `https://ogawifi.online/api/cron/voucher-reap`
- Method: `POST`
- Schedule: daily, 03:30 UTC
- Header: `x-cron-secret: <CRON_SECRET>`

### `plan-fee-due`

Registered at cron-job.org and running. This doc said otherwise for a long
time, which is worth knowing about: the entry was written when the job was
added and never updated when it was scheduled, so the only record of it
being live was the access log. **Confirm from the log rather than from here**
if it ever matters:

```bash
grep plan-fee-due /var/log/nginx/access.log | tail
```

It carries more weight than it used to. An unpaid plan fee used to gate
nothing, so this job failing silently cost nothing but silence. It now sends
all three warnings around a grace window that pauses new voucher sales
(`PlatformConfig.planFeeGraceDays`), so a run that stops happening means
tenants going from trading to not selling with no email at any point. Worth
a glance at the cron-job.org failure history when touching anything here.

Its settings, for reference:

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
they owe money when they do not is worse than saying nothing. The deadline
printed in that email comes from the same `PlanFeeState` that enforces it, so
the date the tenant is held to and the date they were given cannot drift.

**The third email is a tenant scan, not a third pass over waivers.** Walking
`feeWaivers` only ever finds tenants who had one, and a tenant who simply
cancelled their subscription has no waiver document at all - so that loop has
never known they exist. That did not matter when an unpaid fee gated nothing.
Now that it stops them trading, locking somebody silently because their lapse
took the wrong shape would be the worst version of this feature, so
`notifyNewlyLockedTenants` reads every tenant and resolves the few that could
plausibly be due. The stamp is `planFeeLockNotifiedAt` on the **tenant**
document rather than on a waiver, for the same reason, and
`invalidateBillingLock` clears it on every path that can clear a lock - so a
tenant who pays, lapses again a year later and locks again is told again.

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

**A username that a later voucher still uses is never deleted either**, and
that rule had to be learnt the hard way. See below.

Four more things worth knowing before changing it:

- **14 days is a grace period, not a round number.** A customer who comes
  back the week after their plan ran out gets their old user revived in
  place, keeping the username they chose (`reviveHotspotUser` in
  `lib/mikrotik.ts`). Reaping sooner throws that away to save a row. It also
  gives a wrongly closed-out voucher a fortnight to be noticed before the
  evidence on the router is gone.
- **A login this job took by mistake is put back from the product, not by
  hand.** The reconciliation view shows the voucher as "sold through the
  platform but missing on the router" and its Recreate action rebuilds the
  user with the expiry and data cap the voucher already carries, clearing
  `routerUserReapedAt` as it goes (`app/api/voucher/retry/route.ts`).
- **`routerUserReapedAt` is what keeps the drift report quiet.** Without it
  every reaped voucher reads as "sold through the platform but missing on
  the router" - true, and exactly the growing warning this job exists to
  stop producing.
- **The 14 days is counted from whichever voucher owns the username now,
  not from the one the query returned.** This is the fix for a real
  incident, and the reasoning is in `lib/voucher-reap.ts`. A voucher's
  username stopped being its own property when renewal shipped: a revive
  puts a new purchase onto a credential the customer already had and leaves
  the old document sitting there as `expired`. Reaping off that old document
  deletes the login the new plan depends on, which happened seven times on
  one tenant on the nights of 2026-10-29 to 11-01, four of them taking out a
  plan that was still running - including a seven-day plan deleted two hours
  after it was bought. Extend chains were never exposed to it, because
  `extendVoucher` marks the document it replaces `superseded` and this
  query only asks for `expired`.
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
the gateway what was paid in the last 24 hours, compares against our
`payments`, and **fulfils** rather than merely alerting - the customer paid,
the work is idempotent, and a job that only reports still leaves someone
waiting for a human to read a log.

Two more passes, for Knomad Pay: billing payments (`billingCharges`) of the last three
days that were paid but never reported back are applied, once, the same way the
dashboard would; a paid signup still unclaimed after a day is reported, for someone to
finish or refund. And tenants on Knomad Pay with no payee get one made from their bank
details, so a signup whose payee could not be made at the time starts selling once it
can; what needs a person (an unmatched bank, a name that does not agree) is reported.

`FULFILMENT_GRACE_MS` (10 min) keeps it from racing the webhook. The
`reconcileSkips` collection is how a charge that was deliberately never
fulfilled stays unfulfilled instead of being replayed on every pass, and a
reference in `paymentReviews` is skipped the same way: it has already been
recorded and emailed.

It also finishes sales that stalled partway. A stalled sale has a ledger and
no payment, so it looks orphaned here, and fulfilment resumes it once its
lease has lapsed; one still within its lease counts as skipped.

It asks Knomad Pay about this app's own pending purchases of the last day,
one by one, so there is no provider list to page through.

Each tick also deletes up to 100 fulfilment ledgers past their `deleteAt`
(`ledgersPurged` in the summary). That is a Firestore TTL policy's job, but
TTL needs the Blaze plan and the project is on Spark; a ledger holds a voucher
password, so they cannot be kept forever.

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

**It also stores the dashboards' daily figures** (`runStatsRollup`, after
the emails so it never delays them): yesterday and the day before, for every
active or suspended tenant and for the platform, into one month document
each (`docs/data-model.md`). Two days so a missed morning is filled the
next. Nothing breaks if it stops: the dashboards count any day the store
lacks live, at a read or two more, and `npm run stats:backfill` restores the
stored days. What is lost for good is the snapshot (active vouchers, MRR,
tenant counts) for each morning it did not run. If one tenant fails, the
platform's days are skipped rather than stored short, and the error is in
the job's `errors`. Per tenant: 3 aggregations per day recomputed, 2
snapshot counts and one write.

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
