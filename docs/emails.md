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

## What is wired, and what isn't

Everything in the catalog marked `wired` fires today from an existing
server-side seam. Two entries are marked `planned`:
`customer.voucher_expiring` and `owner.router_offline`. Both need something to
run on a schedule, and **this app has no cron of any kind** - no Cloud
Functions, no systemd timer for the app, nothing in `scripts/`. They are listed
so their templates can be configured ahead of time, and so the gap is visible
rather than forgotten.

Voucher expiry in particular has no stored deadline to schedule against:
`expiresAt` is written `null` and expiry is derived at read time
(`lib/hotspot-users.ts`). An expiry reminder needs that decided first.

## One thing worth knowing about the Paystack webhook

`charge.success` and `invoice.payment_succeeded` share a branch in
`app/api/webhooks/paystack/route.ts`, but only the invoice event sends the
"subscription renewed" email. `charge.success` also arrives for one-off charges
that happen to resolve to a tenant, and a renewal email for one of those would
simply be wrong.
