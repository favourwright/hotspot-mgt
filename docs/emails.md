# Emails

Assumes you've read `docs/glossary.md`.

Every email this platform sends goes through Mailtrap's production **Sending**
API, and every one of them is drawn in code at the moment it is sent:
`lib/email-content.ts` turns a catalog key and a flat bag of variables into a
subject, an HTML body and a plain-text body, and Mailtrap only delivers them.
Nothing is stored in Mailtrap and there is no template ID anywhere.

Until 2026-11-27 it was the other way round: a script generated HTML that was
pasted into Mailtrap by hand, and each template's UUID was then copied into
`/superadmin/emails`. That made four copies of every email (the script, the
generated file, Mailtrap, the Firestore ID) that could each drift, and a new
email silently skipped until somebody did the pasting, which is how four of
them sat unsent for weeks (see `docs/open-items.md`). Both sibling projects
already rendered in code; this one now does too.

## The three pieces, and why they're separate

| Piece | Lives in | Changes how |
|---|---|---|
| **Which emails exist** | `lib/email-catalog.ts` | A code change |
| **What they say and look like** | `lib/email-content.ts` | A code change |
| **Which ones are sent** | Firestore, `emailConfig/templates` | A superadmin, at `/superadmin/emails` |
| **Who alerts go to, and the support address** | Firestore, `emailConfig/settings` | A superadmin, at `/superadmin/emails` |

The catalog is in code on purpose. If an entry could be deleted from a
database, a live `sendEmail()` call site would start referring to a key that no
longer exists; keeping it in code means the set of keys and the set of call
sites are checked against each other by the compiler. Firestore only ever holds
the one thing a superadmin decides: whether each email is switched on.

The practical payoff: **adding an email is three steps, all in code, and no
migration.** Add an entry to `EMAIL_CATALOG`, add its content to
`lib/email-content.ts`, call `sendEmail()` with its key. It appears on the
superadmin page switched off, with a preview and a test send, until somebody
switches it on.

## The three rules that hold at every call site

These are in `lib/email.ts` and are the reason it looks the way it does.

1. **It never throws.** Every call site is downstream of something that has
   already succeeded - a payment that cleared, a tenant that was created, a
   webhook Knomad Pay expects a `200` from. Mailtrap having a bad day must never
   turn any of those into an error. Same principle as the MikroTik failure in
   `docs/billing-and-payments.md`: a payment that already happened is never
   undone over a downstream problem.
2. **A switched-off email is a skip, not a failure.** An email that is off at
   `/superadmin/emails` is not sent, and a new email starts off. The page
   shows exactly which ones are on.
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

## The switches

`emailConfig/templates` keeps its name from the template-ID days so that
nothing had to be migrated, and `lib/email-switches.ts` reads it by three
rules:

- **No entry: off.** A new email ships silent until a superadmin turns it on.
- **An entry written before the change** (it still has a `templateId` field):
  **on only if it was enabled and had a template ID.** Those are exactly the
  emails that were being delivered before, so the switch to in-code rendering
  started sending nothing new on its own. In particular it could not turn on
  both `owner.voucher_sold` and `owner.sales_digest` where only one had a
  template.
- **An entry written since:** its `enabled` flag. Saving a row deletes the old
  `templateId`, so each entry moves to the plain rule the first time anyone
  touches it.

`npm run test:email-content` pins all three.

## Writing an email

Each email is one entry in `DEFS` in `lib/email-content.ts`: a subject, a
preheader, a heading, a lead, a list of blocks (steps, rows, credentials,
callout), an optional button and an optional note. They all share one shell,
so a palette or header change is made once and cannot drift. Every colour is a
token from `app/globals.css` baked to hex, and the layout is tables with inline
styles, because no email client supports `oklch()`.

Copy is written with `{{variable}}` placeholders against the names the
catalog entry declares. Three are added to every send automatically and
don't appear in the per-email lists: `app_url`, `support_email` and `year`.
There is no branching, on purpose: a body that cannot branch forces each
variable to always say something true, which is why the welcome email has a
`billing_note` sentence rather than a conditional line.

**Every value is HTML-escaped** in the body and left as plain text in the
subject and the text part. Mailtrap's Handlebars used to do the escaping; now
`fill()` does, and a business name with a `<` in it can never become markup in
somebody's inbox. A placeholder with no value renders blank, as before, and is
logged as `rendered blank for ...` so the call site gets fixed.

`npm run test:email-content` runs in CI and checks every body against its
catalog entry in both directions, that nothing renders with a dash (the
`&mdash;` entity included), that no entity or markup leaks into the subject
or text part, and the escaping. A catalog key with no content fails it.

`/superadmin/emails` has **Preview** (rendered with the sample values in
`lib/email-samples.ts`) and **Send me a test** on every row. The test goes to
the signed-in superadmin whatever the email's switch says, so a switched-off
email can be checked in a real inbox before anyone turns it on.

Money arrives pre-formatted (`₦2,500.00`, from `formatNaira`) and dates
pre-formatted as text. Call sites pass display-ready strings, never kobo
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

1. Add the entry to `lib/email-catalog.ts` (key, audience, variables).
2. Add its content to `DEFS` in `lib/email-content.ts`, and a sample for any
   new variable name to `lib/email-samples.ts`.
3. Call `sendEmail()` with the key, passing every declared variable.
4. `npm run test:email-content`, then preview it at `/superadmin/emails`.
5. After the deploy, **switch it on** at `/superadmin/emails`. It is off until
   then, which is the point: shipping code and starting to mail people are two
   decisions.

Changing the copy of an existing email is step 2 and a deploy. Each send
carries its catalog key as Mailtrap's `category`, so Mailtrap's stats can be
read per email; that field was refused alongside a `template_uuid`, which is
why it only arrived with this change.

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
is switched on at `/superadmin/emails` - a venue
selling thirty vouchers a day wants the digest, and mutes us if it gets
thirty emails.

Everything else about the jobs - the schedules, the runner, the shared
secret, and why `ok: false` goes nowhere - is in `docs/cron-jobs.md`.

## Billing emails

Nothing renews by itself (`docs/billing-and-payments.md`), so the billing emails are
reminders and a receipt: `owner.plan_fee_ending` before a free period or a paid month
ends, `owner.plan_fee_due` once it has, `owner.plan_fee_locked` when sales pause, and
`owner.addon_renewal_due` before an addon's paid period ends, all from the `plan-fee-due`
cron; `owner.subscription_renewed` (a key from the subscription days, kept so its switch
carries on) is the plan receipt, and `owner.purchase_received` the receipt for
an addon or credits, each sent by whichever call applied the payment, once.
