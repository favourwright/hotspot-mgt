<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` - verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

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
   story. **Scan this before touching an area you haven't touched before.**
   Several entries describe code that looks like a bug and is not.

Then whichever applies:

| Area | Doc |
| --- | --- |
| What the product is, how the code is organised, caching, paginated lists | `docs/architecture.md` |
| Schemas, tenant subcollections, which legacy collections are dead | `docs/data-model.md` |
| Sessions, custom claims, Firestore rules, past security holes | `docs/auth-and-security.md` |
| Both money flows, Paystack splits, the three fulfilment paths | `docs/billing-and-payments.md` |
| The six scheduled jobs, the runner, the shared secret | `docs/cron-jobs.md` |
| Portal install/uninstall, the restore contract, page-authoring rules | `docs/captive-portal.md` |
| Reaching a tenant's router at all | `docs/router-and-wireguard.md` |
| Why a router backs exactly one location | `docs/locations-and-routers.md` |
| Mailtrap templates, recipients, the three call-site rules | `docs/emails.md` |
| Addon keys, entitlement resolution, grandfathering | `docs/addons.md` |
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
- **No em dashes or en dashes** anywhere: code, comments, docs, commit
  messages. Use a plain hyphen or reword.

# VPS Deployment Runbook

The exact command sequence for deploying this app - written so another agent can follow it mechanically. For *why* it's shaped this way (the OOM incident, the port-8080 coexistence with Apache, etc.), see `docs/deployment.md` - this section is deliberately just the steps.

The production VPS (`193.123.183.184`) also runs two unrelated, still-live products (`mikhmon`, `globlinksadmin`) under Apache on port 80. **Never touch Apache, port 80, or anything under those two products.** Everything below only ever touches this app's own systemd service (`hotspot-mgt`) and the separate `wg-manager` service.

SSH key: `~/.ssh/ssh-key-2026-06-06.key`. Run everything below from the repo root on your own machine, not on the VPS.

## 0. Pre-flight (every time, before touching the VPS)

```bash
npx tsc --noEmit && npm run build
```

There are two local env files and no `.env.local`. `npm run build` reads
**`.env.production`** (live values); `npm run dev` reads
`.env.development.local` (test values). Same names in both. First check they
have not drifted, and that no `.env.local` has appeared to shadow them:

```bash
npm run env:check
```

A blank in `.env.production` is the dangerous direction: it builds clean,
passes every smoke test below, and the feature silently does nothing in
production. A `.env.local` is worse - it outranks `.env.production` in *every*
environment, so test values in it get baked straight into the deploy build.
`env:check` fails on either.

Then diff build-time env vars against the VPS - a mismatch here ships a client bundle pointed at the wrong URL/port, silently, in production:

```bash
grep "^NEXT_PUBLIC_" .env.production | sort > /tmp/local-vars.txt
ssh -i ~/.ssh/ssh-key-2026-06-06.key ubuntu@193.123.183.184 \
  "grep '^NEXT_PUBLIC_' /home/ubuntu/hotspot-mgt/.env.local | sort" > /tmp/vps-vars.txt
diff /tmp/local-vars.txt /tmp/vps-vars.txt && echo IDENTICAL
rm /tmp/local-vars.txt /tmp/vps-vars.txt
```

That diff covers `NEXT_PUBLIC_*` *values* only, because those are what gets
baked into the bundle. Server-side vars fail the opposite way - missing one
never breaks the build and never fails a smoke test, the feature just
silently does nothing - so compare the *names* too:

```bash
npm run env:diff
npm run env:push -- CRON_SECRET   # to add one, named explicitly
```

`env:diff` compares `.env.production`'s names against the VPS's `.env.local`,
because those are the two places a *live* value lives. A name present locally
but not on the VPS is either something that needs adding there or something
deliberately local-only (`CLOUDFLARE_API_TOKEN`). Decide which, every time -
"copy whatever is missing" is wrong here. Why, and what `env:push` does to the
remote file: `docs/deployment.md`.

Adding a server-side var needs a `systemctl restart hotspot-mgt`, but **not** a
rebuild - unlike a `NEXT_PUBLIC_*` value, which needs the full deploy below.

If `package.json` gained a dependency since the last deploy (`git diff <last-deployed-sha>..HEAD -- package.json`), that needs a deliberate, separate `npm install` on the VPS - never assume it's covered by the steps below.

## 1. Build locally - never on the VPS

```bash
npm run build
```

Never run `npm run build` or `npm install` on the VPS itself. It caused a real outage once (956MB RAM, no swap at the time, the build hung and eventually took the whole VPS offline, requiring a hard reboot). This is the load-bearing reason the process looks like this at all.

## 2. Ship the build output

```bash
rsync -az --delete \
  --exclude 'cache' --exclude 'dev' --exclude 'node_modules' --exclude 'turbopack' \
  -e "ssh -i ~/.ssh/ssh-key-2026-06-06.key" \
  .next/ ubuntu@193.123.183.184:/home/ubuntu/hotspot-mgt/.next/
```

## 3. Keep the VPS's source checkout in sync (best-effort, skippable)

```bash
ssh -i ~/.ssh/ssh-key-2026-06-06.key ubuntu@193.123.183.184 \
  "cd /home/ubuntu/hotspot-mgt && git fetch origin && git status --short"
```

If that shows local changes on the VPS, don't blindly `git pull` or `reset --hard` over them - diff each one against what's already committed upstream first (`git diff origin/main:<path> <path>` on the VPS) and only discard a file once it's confirmed byte-identical to what pulling would give you anyway. Then:

```bash
ssh -i ~/.ssh/ssh-key-2026-06-06.key ubuntu@193.123.183.184 \
  "cd /home/ubuntu/hotspot-mgt && git pull origin main"
```

**This step currently fails** (`could not read Username for
'https://github.com'`) and is safe to skip - `next start` only needs `.next/`
and `node_modules/`. Do not add a credential or deploy key to the VPS to work
around it without asking the user first. → `docs/open-items.md`

## 4. Restart and verify

```bash
ssh -i ~/.ssh/ssh-key-2026-06-06.key ubuntu@193.123.183.184 "
  sudo systemctl restart hotspot-mgt
  sleep 3
  sudo systemctl is-active hotspot-mgt
  sudo journalctl -u hotspot-mgt --no-pager -n 20
"
```

Confirm the deployed build is actually the one you just built:

```bash
diff <(cat .next/BUILD_ID) \
     <(ssh -i ~/.ssh/ssh-key-2026-06-06.key ubuntu@193.123.183.184 "cat /home/ubuntu/hotspot-mgt/.next/BUILD_ID") \
  && echo MATCH
```

External smoke test - the app is served over **HTTPS on `ogawifi.online`** only. Port 8080 now just 301s there, and port 80 is Apache's and must never be touched:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://ogawifi.online/
curl -s -o /dev/null -w "%{http_code}\n" https://ogawifi.online/onboarding
curl -s -o /dev/null -w "%{http_code}\n" https://ogawifi.online/auth
# A tenant subdomain, which exercises the wildcard cert and proxy.ts routing:
curl -s -o /dev/null -w "%{http_code}\n" https://superadmin.ogawifi.online/
```

A deploy isn't done until `BUILD_ID` matches and every one of those returns `200`.

## 5. Firestore rules/indexes - separate from the app deploy, only when they changed

**If this deploy touches any Firestore query, check its index first:**

```bash
npm run check:indexes
```

A query that gains a `where` on a field it already orders by needs a
composite index, and **nothing in the build catches a missing one**: `tsc`
passes, `npm run build` passes, every test passes, and it fails at runtime
with `9 FAILED_PRECONDITION` on the one page that runs it. It has shipped
twice - once taking `/admin/users` down completely, once leaving the
transactions email lookup broken from the day it shipped until somebody
happened to paste an email into it. `check:indexes` runs every query shape
the app uses against the live project and names the call site of any that
has no index.

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

A newly added composite index can take a moment to finish building after this returns - a query depending on it will fail with an explicit "index is currently building" error until then, not silently misbehave. Re-run `npm run check:indexes` after the deploy to confirm it finished.

## 5b. Addon paywalls - only when adding or pricing one

**Pricing an addon takes the feature away from everyone already using it.**
Entitlement resolution fails closed, so the moment an addon stops being free,
every tenant without an entitlement loses whatever it gates. This has already
caused one live outage: pricing `captive-portal` left a venue's wifi customers
unable to sign in or buy vouchers, with nothing in the UI saying why.

Before changing an addon from free to paid, always:

```bash
npm run addons:seed -- --grandfather
```

That grants a permanent entitlement to tenants already using the feature, so
charging starts with new customers instead of taking something away. The plain
`npm run addons:seed` is the safe-by-default version and creates any
unconfigured addon as **free**, which is what keeps the deploy that introduces a
gate from being the thing that breaks production.

After touching `lib/entitlements.ts`, run the grace-window table:

```bash
npm run test:entitlements
```

Full workflow for adding a new addon, including why the key list is in code and
not in the database: `docs/addons.md`.

## 5c. Scheduled jobs - only when adding one

**Deploying a new cron job schedules nothing.** The runner is an external
cron-job.org account that no part of this repo can see or configure, so a job
added to `CRON_JOBS` sits there unrun until the user adds the entry by hand.
Give them the exact details to paste: the URL
(`https://ogawifi.online/api/cron/<job>`), the method, the schedule, and the
`x-cron-secret` header - it is a **header**, not `Authorization: Bearer`,
which has already been got wrong once and returns a bare `{"error":"Not found"}`.

The systemd units in `deploy/` are a kept fallback and are **not** installed.
Before concluding a job is broken, check it actually ran:

```bash
ssh -i ~/.ssh/ssh-key-2026-06-06.key ubuntu@193.123.183.184 \
  "sudo grep -h '/api/cron' /var/log/nginx/access.log | tail -20"
```

A failing job returns 200 and alerts nobody, by design. → `docs/cron-jobs.md`

## 5d. Firebase console - the action URL, only when touching auth emails

Every Firebase email link (verification, email change, **password reset**)
lands on `/auth/action`. It is one project-wide value, not a per-template one,
however the console's "customize action URL" control makes it look - so there
is no way to move one flow at a time, which is why the handler covers all four
modes.

```bash
npm run auth:action-url                      # read what is set now
npm run auth:action-url -- --set custom      # point at /auth/action
npm run auth:action-url -- --set default     # roll back to Firebase's page
```

**Google currently refuses this change** with
`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`, through both the console and the API, and
it is not a misconfiguration at our end - see `docs/open-items.md`. Links keep
landing on Firebase's own handler, which works; only the branding is blocked.
The script reports the reason in one line and changes nothing when refused.

It also refuses to set `custom` unless the page already returns 200 and its
host is an authorized domain, and reads the value back afterwards.

**Flipping it before the page is live breaks every action link at once,
including password resets already sitting in someone's inbox.** Order is:
deploy, confirm the page externally, then set it.

The handler must keep covering `verifyEmail`, `verifyAndChangeEmail`,
`recoverEmail` and `resetPassword`. Dropping one does not fail anywhere - the
email still sends and the link still resolves, it just lands on a page that
cannot finish the job. → `docs/auth-and-security.md`

## 6. WireGuard manager - separate from everything above, only when `vps/wg-manager/app.py` changed

```bash
python3 -m py_compile vps/wg-manager/app.py   # catch a syntax error before it reaches the VPS
scp -i ~/.ssh/ssh-key-2026-06-06.key vps/wg-manager/app.py ubuntu@193.123.183.184:/opt/wg-manager/app.py
ssh -i ~/.ssh/ssh-key-2026-06-06.key ubuntu@193.123.183.184 \
  "sudo systemctl restart wg-manager && curl -s http://127.0.0.1:51821/health"
```

`config.json` on the VPS (`/opt/wg-manager/config.json`) is **not** in the repo and is copied by no step here - it holds the shared secret and the tunnel subnet. Changing the tunnel subnet means changing it in three places that must agree: this file, the VPS interface's own address, and `PlatformConfig.wireguard.tunnelSubnet` in Firestore. A mismatch doesn't error - it provisions routers that silently can't be reached. See `vps/wg-manager/README.md`.

Restarting this service does not drop any live WireGuard tunnels - those are a kernel-level (`wg`/`wg-quick`) construct, independent of whether this small Flask wrapper around it happens to be running.

## Domain, DNS and TLS - not part of a deploy

Nothing in a routine deploy touches any of this. Two things to know before you
edit anything near it:

- **`NEXT_PUBLIC_APP_URL` is the single source of truth for the root domain.**
  `proxy.ts` (subdomain routing), `lib/server-auth.ts` (session cookie
  `Domain`) and `lib/hotspot-portal.ts` (the walled garden) all derive from
  it. Changing it is a rebuild, not a restart. It is set in `.env.production`
  (live) and `.env.development.local` (local), never in a `.env.local`.
- **Changing the domain means reinstalling the captive portal on every
  router**, because each one carries a walled-garden allow-list naming the old
  domain. DNS and nginx alone will not do it.

Full setup, Cloudflare token scopes, certbot and the nginx vhost:
`docs/domain-and-tls.md`.

> **The certificate cannot currently renew and HTTPS breaks on 2027-01-02.**
> → `docs/open-items.md`

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
