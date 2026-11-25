# Emails

Assumes you've read `docs/glossary.md`.

Every email this platform sends goes through Mailtrap's production **Sending**
API, and every one of them is a Mailtrap *template* - this codebase never
writes a subject line or a body. What the code supplies is a template UUID and
a flat bag of variables.

## The three pieces, and why they're separate

| Piece | Lives in | Changes how |
|---|---|---|
| **Which emails exist** | `lib/email-catalog.ts` | A code change |
| **Which Mailtrap template each one uses** | Firestore, `emailConfig/templates` | A superadmin, at `/superadmin/emails` |
| **Who alerts go to, and the support address** | Firestore, `emailConfig/settings` | A superadmin, at `/superadmin/emails` |
| **What they look like** | Mailtrap | Whoever edits the template |

The catalog is in code on purpose. If an entry could be deleted from a
database, a live `sendEmail()` call site would start referring to a key that no
longer exists; keeping it in code means the set of keys and the set of call
sites are checked against each other by the compiler. Firestore only ever holds
the mutable half - the template ID and an on/off switch.

The practical payoff: **adding an email is two steps and no migration.** Add an
entry to `EMAIL_CATALOG`, call `sendEmail()` with its key. It appears on the
superadmin page immediately, waiting for a template ID.

## The three rules that hold at every call site

These are in `lib/email.ts` and are the reason it looks the way it does.

1. **It never throws.** Every call site is downstream of something that has
   already succeeded - a payment that cleared, a tenant that was created, a
   webhook Paystack expects a `200` from. Mailtrap having a bad day must never
   turn any of those into an error. Same principle as the MikroTik failure in
   `docs/billing-and-payments.md`: a payment that already happened is never
   undone over a downstream problem.
2. **An unconfigured template is a skip, not a failure.** Until someone pastes
   a template UUID in, the email does not send. Nothing half-sends; no blank
   mail goes out. The superadmin page shows exactly which ones are live.
3. **Sends are awaited, not fired and forgotten.** A Next.js route handler can
   be torn down the moment it returns, which silently drops a floating promise.
   The cost is one HTTP round-trip on a path that has already done several.

## Configuration

Four environment variables, all documented in `.env.example`:

- `MAILTRAP_API_TOKEN` and `MAILTRAP_SENDER_EMAIL` - **both** required, or
  every send is skipped. The sender address must be on a domain verified in
  Mailtrap.
- `MAILTRAP_SENDER_NAME` - display name, defaults to `OgaWiFi`.
- `PLATFORM_ALERT_EMAIL` - **a fallback now, not the setting itself.** Alert
  recipients moved into Firestore (see below); this is only consulted when
  nothing has been configured there, so a fresh deployment still alerts
  somebody. Falls back further to `SUPERADMIN_EMAIL`.

`/superadmin/emails` shows a banner when the first two are missing, because
otherwise a correctly-configured template list would look fine while nothing
was actually being delivered.

## Recipients

Two values live at `/superadmin/emails` rather than in the environment, because
both change more often than a deploy:

- **Platform alert recipients** - a list, not one address. Every `platform.*`
  alert goes to all of them as a single message with several recipients, rather
  than one message each: these are internal operational alerts, so the
  recipients already know about each other.
- **Support address** - what user-facing templates receive as `support_email`.
  Kept separate from the alert list on purpose, since the inbox that should get
  a split-mismatch alert is rarely the one a customer should be writing to.

Saving an empty recipient list does not mean "alert nobody". It falls back to
the environment variable, because silently stopping every operational alert is
never what an empty form field was meant to express.

The Firestore documents (`emailConfig/templates` and `emailConfig/settings`)
are **server-side only in both directions** - `firestore.rules` denies the client SDK read and write, and the
superadmin page reads it through the Admin SDK during server rendering. It is
deliberately not under `platform/`, which is world-readable by rule.

## Writing a template

The admin page lists the exact variable names each email passes, and the
template should be written against those. Three are added to every send
automatically and don't appear in the per-email lists: `app_url`,
`support_email` and `year`.

Money arrives pre-formatted (`₦2,500.00`, from `formatNaira`) and dates
pre-formatted as text. Mailtrap is handed display-ready strings, never kobo
integers or timestamps.

## What an owner can switch off, and what they cannot

A tenant owner has their own switches at `/{slug}/admin/settings`, separate
from the superadmin ones at `/superadmin/emails`. The two do different things
and are not interchangeable: the superadmin switch is platform-wide and stops
an email for everybody, the owner's applies to their tenant alone.

**Only emails flagged `optional` in `lib/email-catalog.ts` can be switched
off**, and the flag carries the owner-facing copy for the toggle rather than
reusing `description`, which is written for whoever has to debug the email.
Today that is `owner.voucher_sold` and `owner.sales_digest` - the two whose
worst case is a noisy inbox.

Everything else is unconditional on purpose. An owner who muted "your payment
failed", "your router is offline" or "a voucher could not be issued" would be
opting out of finding out their business had stopped working, and the first
they would know is a customer complaining. If a future email belongs in the
optional set, flag it; the settings page and the API pick it up with no other
edit.

### Where the check lives, and why there

In `sendEmail()`, not at the call sites. Any owner-addressed send passes a
`tenantId`, and the check happens centrally, after the platform-level ones
and before anything is sent. The alternative - each notifier asking first -
fails the moment someone adds an email and forgets, and a switch that does
nothing is a worse bug than the noise it was meant to stop.

Storage is a **list of muted keys** on the tenant document
(`Tenant.emailOptOuts`, see `lib/notification-prefs.ts`), not a map of every
key to a boolean. An absent entry therefore means "send":

- a newly added email is on for every existing tenant with no migration
- a partially-written or corrupt field degrades into sending too much rather
  than going silent
- a failed Firestore read is treated as "no preferences", so an outage cannot
  quietly mute an owner's mail

Keys that are not `optional` are ignored on read as well as on write, so an
email that stops being optional immediately starts sending again even to
owners who had muted it, and a stale key from a deleted email is inert.

Clients cannot write it. `firestore.rules` denies every client write to
`/tenants/{id}`; the only path is `PATCH /api/admin/notifications`, which is
owner-only - a superadmin viewing a tenant can see the settings but not
change them.

## Adding or changing an email

The bodies are **generated**, not hand-written. `lib/email-catalog.ts` is the
authority on which keys exist, and the generator walks it:

```bash
npx tsx scripts/build-email-templates.mts   # writes email-templates/*.html
```

It also writes `email-templates/SUBJECTS.md` and checks each body against the
variable list its catalog entry declares, in both directions - a variable used
but not declared, or declared but never used, is reported. A catalog key with
no body at all prints `NO TEMPLATE`: the catalog says which emails exist, the
script's own `DEFS` holds their content, and adding an email means editing
both. The output is then pasted into Mailtrap by hand, and the template ID set
at
`/superadmin/emails` - there is no API step, which is why a brand-new email
**silently skips** rather than failing until someone does that.

One shell for all of them is deliberate: a palette or header change made once
rather than twenty times cannot drift. Every colour is a token from
`app/globals.css` baked to hex, and the layout is tables with inline styles,
because no email client supports `oklch()`.

A trap that has cost time twice: Mailtrap rejects `category` sent alongside
`template_uuid` with `'category' is not allowed with 'template_uuid'`. The
same applies to subject, text and html - a template send carries variables and
nothing else.

## Emails that cannot fire from a request

Four emails have no request behind them - `customer.voucher_expiring`,
`owner.sales_digest`, `platform.daily_digest`, and `owner.router_offline` -
because nothing is happening at the moment they are due. They are sent by the
scheduled jobs in `lib/cron-jobs.ts`.

Two things about those jobs matter specifically to email:

- **They act on transitions, not states.** `owner.router_offline` sends on the
  move *into* offline, never while offline. A router down overnight would
  otherwise mail the owner every tick until morning.
- **They record that they sent.** `expiryNotifiedAt` is the reason a reminder
  goes out once rather than on every tick of its whole warning window.

`owner.voucher_sold` and `owner.sales_digest` deliberately overlap: one fires
per sale, the other once a day. Which actually sends is decided by whichever
has a Mailtrap template ID configured at `/superadmin/emails` - a venue
selling thirty vouchers a day wants the digest, and mutes us if it gets
thirty emails.

Everything else about the jobs - the schedules, the runner, the shared
secret, and why `ok: false` goes nowhere - is in `docs/cron-jobs.md`.

## Billing emails

Nothing renews by itself (`docs/billing-and-payments.md`), so the billing emails are
reminders and a receipt: `owner.plan_fee_ending` before a free period or a paid month
ends, `owner.plan_fee_due` once it has, `owner.plan_fee_locked` when sales pause, and
`owner.addon_renewal_due` before an addon's paid period ends, all from the `plan-fee-due`
cron; `owner.subscription_renewed` (a key from the subscription days, kept so its Mailtrap
template carries on) is the receipt, sent by whichever call applied the payment, once.
