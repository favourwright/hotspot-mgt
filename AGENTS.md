<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Read this before changing anything

This file is the **operational** half: the deploy runbook and the rules that
have broken production when ignored. Everything explanatory lives in `docs/`,
and that is not optional background reading - most of it exists because
something went wrong in production and the fix is only obvious once you know
what it was.

Two entry points, in order:

1. **`docs/glossary.md`** - every other doc assumes it.
2. **`docs/decisions-and-gotchas.md`** - a terse index of every non-obvious
   choice and every real incident, each pointing at the doc with the full
   story. **Check this before touching an area you haven't touched before.**
   Several entries describe code that looks like a bug and is not. Every entry
   is one line: `grep -n -i '<area>' docs/decisions-and-gotchas.md` rather than
   reading all 12k tokens of it, and read it whole only when the greps come
   back thin in an area that is new to you.

Then whichever applies:

| Area | Doc |
| --- | --- |
| What the product is, how the code is organised, caching, paginated lists | `docs/architecture.md` |
| Schemas, tenant subcollections, which legacy collections are dead | `docs/data-model.md` |
| Sessions, custom claims, Firestore rules, past security holes | `docs/auth-and-security.md` |
| Both money flows, Knomad Pay splits, the three fulfilment paths | `docs/billing-and-payments.md` |
| The seven scheduled jobs, the runner, the shared secret | `docs/cron-jobs.md` |
| Portal install/uninstall, the restore contract, page-authoring rules | `docs/captive-portal.md` |
| Reaching a tenant's router at all | `docs/router-and-wireguard.md` |
| Why a router backs exactly one location | `docs/locations-and-routers.md` |
| Emails: in-code content, on/off switches, recipients, the three call-site rules | `docs/emails.md` |
| Addon keys, entitlement resolution, grandfathering | `docs/addons.md` |
| What tenants have paid the platform: the revenue ledger, its writers, reconciling | `docs/platform-revenue.md` |
| Tenants generating their own codes: batches, quota, credits, activation | `docs/voucher-generation.md` |
| The public API, webhooks and decision hooks: where each fact lives (tenant docs are generated at `/developers`) | `docs/public-api.md`, `docs/webhooks.md`, `docs/decision-hooks.md` |
| DNS, the wildcard cert, subdomain routing | `docs/domain-and-tls.md` |
| Why the deploy is shaped this way, the env traps | `docs/deployment.md` |
| Running it locally from nothing | `docs/local-setup.md` |
| **Known-broken things nobody has fixed yet** | `docs/open-items.md` |

`docs/open-items.md` is the one to check before you spend time debugging
something: it currently carries a dated TLS expiry that will take the whole
site down, plus three smaller things that look like bugs because they are.

A few habits this codebase expects, which are cheap and have each caught a
real defect:

- **Assert that every string replacement actually applied.** A silent no-op in
  a generated page shipped once and was caught only by a screenshot.
- **Scratchpad scripts must live inside the repo** or `tsx` cannot resolve
  `dotenv` and `firebase`. Write them at the repo root and delete after.
- **Never print a secret's value** - names only, in diffs and in output.
- **Downscale a screenshot before reading it.** A full-page 1600x1250 capture
  costs about 2700 tokens of context and stays there for the rest of the
  session; `sips -Z 900 shot.png` makes the same shot ~860 with no loss of
  what you were looking at. Crop to the region under review rather than
  capturing the page, and never re-read an image already in the conversation.
- **No em dashes or en dashes** anywhere: code, comments, docs, commit
  messages. Use a plain hyphen or reword.

# Deploying, and anything that touches the VPS

The full command sequence lives in **`docs/deploy-runbook.md`** and is written
so another agent can follow it mechanically. **Read it before running any of
it** - several steps exist because skipping them caused a real outage, and the
runbook is the only place that says which.

Open it when you are: deploying; changing an env var; adding or changing a
Firestore query, an addon price, a cron job, or a Firebase auth email; editing
`vps/wg-manager/app.py`; or touching the domain, DNS or TLS. If none of those
apply, you do not need it.

The hard rules below are the subset that costs something every time it is
broken, so they stay here rather than in the runbook.

## Hard rules, every time

- Never touch Apache, port 80, or anything under `mikhmon`/`globlinksadmin`.
- Never run `npm install` or `npm run build` on the VPS.
- Never create a `.env.local` in this repo - it outranks `.env.production`
  in every environment and silently ships test values to production.
  `npm run env:check` catches it; run it before every build.
- Never add credentials or a deploy key to the VPS without the user's explicit, informed sign-off first.
- A deploy isn't "done" until `BUILD_ID` matches and the external curl checks in step 4 all return `200`.
- Never price an addon without grandfathering existing users first (step 5b) - it is an outage, not a config change.
- A new cron job is not scheduled by deploying it - the user has to add it on cron-job.org (step 5c).
- Never point Firebase's action URL at `/auth/action` before that page is deployed and reachable (step 5d) - it breaks password reset for everyone, silently.
