# Deployment

Assumes you've read `docs/glossary.md` and `docs/architecture.md`.

## The production setup, as it actually exists today

- One Oracle Cloud VPS at `193.123.183.184`, hostname `mikhmon-server`.
- This app runs as a systemd service named `hotspot-mgt`, via `npm run start` (plain `next start`, not a custom server), listening on `127.0.0.1:3000` - not exposed directly.
- nginx reverse-proxies `127.0.0.1:3000` out to the world on **port 443** (HTTPS) and, still, **port 8080** (plain HTTP). Neither is port 80: Apache already owns port 80 on this exact VPS, serving two other, unrelated, still-actively-used products (`mikhmon`, `globlinksadmin`) that predate this project and must never be touched or affected by anything this app's deployment does. Port 8080 was chosen originally to coexist without going anywhere near Apache's configuration; 443 was added with the domain, and was free because Apache only ever wanted 80.
- The app is served at **`https://ogawifi.online`**, with a wildcard certificate covering `*.ogawifi.online` so every tenant gets their own subdomain. The full setup - Cloudflare DNS, the DNS-01 certificate, the nginx vhost, and how to reproduce all of it - is in [`docs/domain-and-tls.md`](domain-and-tls.md).
- `http://193.123.183.184:8080` now only issues a 301 to `https://ogawifi.online`. It used to proxy the app directly; keeping two live entry points with different routing behaviour was a liability - see `docs/domain-and-tls.md`.
- The WireGuard manager (`vps/wg-manager/`) runs as its own separate systemd service (`wg-manager`), bound only to `127.0.0.1:51821` - see `docs/router-and-wireguard.md`.
- Firestore rules/indexes and the WireGuard manager are each deployed independently of the Next.js app itself - three separate deploy actions, not one combined pipeline.

## Deploying the Next.js app - why it's "build locally, rsync the output"

The obvious approach - `git pull` on the VPS, then `npm run build` there - was tried first and caused a real production incident: this VPS has 956MB of RAM and, at the time, no swap. A `next build` exhausted memory, hung for over 30 minutes, and eventually made the VPS fully unresponsive over both SSH and the cloud provider's own browser console, requiring a hard reboot from Oracle's dashboard to recover. 2GB of swap was added afterward as a safety net, but the deployment strategy changed permanently as the real fix: **never run a build on the VPS.**

The actual process:
```bash
# 1. On your local machine. NODE_ENV=production, so .env.production (the LIVE
#    values) is picked automatically. Run `npm run env:check` first - see
#    "the build-time env trap" below:
npm run build

# 2. Rsync the build output, excluding dev-only artifacts that are huge
#    and unnecessary for `next start` (together, several GB; everything
#    else is tens of MB):
rsync -az --delete \
  --exclude 'cache' --exclude 'dev' --exclude 'node_modules' --exclude 'turbopack' \
  -e "ssh -i <your-key>" \
  .next/ ubuntu@193.123.183.184:/home/ubuntu/hotspot-mgt/.next/

# 3. Keep the VPS's own git checkout in sync too (so the source there
#    isn't misleadingly stale - `next start` itself only needs .next/ and
#    node_modules/, but a stale source tree is confusing for anyone who
#    later SSHes in to investigate something):
ssh ubuntu@193.123.183.184 "cd /home/ubuntu/hotspot-mgt && git pull origin main"

# 4. Restart:
ssh ubuntu@193.123.183.184 "sudo systemctl restart hotspot-mgt"
```

`node_modules` on the VPS is **not** reinstalled as part of this (that's exactly the step that caused the OOM incident, historically triggered by `npm install`/build-related processes, not literally `next build` alone - either way, nothing package-related runs on the VPS during a routine deploy). Only run `npm install` there, deliberately and carefully, when `package.json` has genuinely gained a new dependency - which is rare; check `git diff` on `package.json` before assuming you need to.

### The build-time env trap

`NEXT_PUBLIC_*` variables are baked into the client-side JavaScript bundle **at build time** - not read at runtime. This means your local `.env.production`, not the VPS's `.env.local`, determines what ends up in the bundle you're about to deploy. Three real ways this has gone wrong:

- Local `.env.local` had `NEXT_PUBLIC_APP_URL` without the `:8080` port, while the VPS's actual config correctly had it - building with the local value would have shipped a client bundle making API calls to the wrong port in production. Always diff your local `NEXT_PUBLIC_*` values against the VPS's before building for a deploy, not after.
- Switching Paystack from test to live keys required rebuilding and redeploying specifically because `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` had changed - restarting the service with a new `.env.local` on the VPS alone does nothing for a value that's already compiled into static JS files from a previous build.
- `.env.local` held the production `NEXT_PUBLIC_APP_URL` with the localhost one commented out above it, to be swapped by hand. Left on the production value, local sign-in broke in a way that looks nothing like an env problem: the session cookie went out with `Domain=ogawifi.online`, the browser rejected it for an invalid domain, every page then saw no session, and sign-in bounced straight back to `/auth?redirect=...` with no server-side error anywhere. The Paystack keys were toggled the same way, which meant local dev charged live cards. That is what the two-file split below exists to prevent.

### Which env file holds what

Two files on your machine, same variable names in both, nothing ever
commented in or out:

| File | Where | Loaded by | Holds |
| --- | --- | --- | --- |
| `.env.production` | your machine | `npm run build` | **LIVE** values, the complete set |
| `.env.development.local` | your machine | `npm run dev` | **TEST / LOCAL** values, the complete set |
| `.env.local` | **the VPS only** | `next start` there | the live server-side secrets, read at runtime |

Both local files are gitignored. `.env.example` is the template for each; copy
it twice and fill each with the matching half.

`npm run build` runs with `NODE_ENV=production`, so it picks `.env.production`
on its own, and that build is what deploys. This is the whole point: a deploy
can no longer ship `http://localhost:3000` or test keys because someone was
last working locally.

Nothing ships either file to the VPS, and nothing needs to. `NEXT_PUBLIC_*`
values arrive already compiled into `.next/`; the server-side secrets
`next start` reads at runtime come from the VPS's own `.env.local`, put there
one at a time with `npm run env:push -- <NAME>`.

#### Never create a `.env.local` in this repo

Lookup order, highest priority first:

```
process.env > .env.$NODE_ENV.local > .env.local > .env.$NODE_ENV > .env
```

`.env.local` sits **above** `.env.production` and is loaded in every
environment except `test`. So a `.env.local` holding test values does not just
serve local dev - it silently overrides `.env.production` during the deploy
build, and the bundle you ship is built from test values with nothing failing
anywhere to say so. That is precisely the arrangement this replaced.

The `.development.` in `.env.development.local` is what scopes it to
`next dev`. Keep it.

```bash
npm run env:check
```

fails if a `.env.local` appears, and if the two files drift out of step -
a name filled in one and blank or absent in the other. It prints names only,
never values. Run it before every deploy; it is step 0 of the runbook.

A blank in `.env.production` is the direction that hurts: it builds clean,
passes every smoke test, and the feature silently does nothing in production.

#### Scripts under `tsx` get none of this

Next.js resolves the file from `NODE_ENV`; a script run with `tsx` sees only
what `dotenv` is pointed at. `scripts/load-env.mts` is the one place that
decision lives, and every maintenance script calls it. It reads
`.env.production` first, because these scripts talk to the live Firebase
project and the live VPS, then fills blanks from `.env.development.local`.

It deliberately does not just call `dotenv.config` twice: `dotenv` skips a
variable that is already set and counts `NAME=` as set, to the empty string,
so a name left blank in `.env.production` would shadow the filled one and the
script would run with an empty credential instead of an obviously missing one.
Any new script must use `loadScriptEnv()` rather than its own `dotenv` call.

### The opposite trap: server-side vars

Server-side variables fail in the mirror image of the above. They're read by
`next start` at process start, so a missing one never breaks the build and
never fails a smoke test - the feature that needs it just silently does
nothing. `MAILTRAP_*` absent means every email quietly skips. `CRON_SECRET`
absent means the cron endpoint refuses every request.

Neither local env file is in git and no deploy step copies either, so a
variable added locally is simply absent in production until someone puts it
on the VPS by hand. Compare the *names* - `.env.production`'s against the
VPS's `.env.local`, those being the two places a live value lives:

```bash
npm run env:diff
```

To add one, name it explicitly:

```bash
npm run env:push -- CRON_SECRET
```

That backs up the remote file first, replaces any existing definition rather
than appending a duplicate, restarts `hotspot-mgt`, and confirms the name
landed. It deliberately refuses to sync everything in one go, because "copy
whatever is missing" would be wrong here: some values are *meant* to differ
(`SUPERADMIN_EMAIL`, `ADMIN_EMAIL`), and `CLOUDFLARE_API_TOKEN` is local-only
by design - it's pushed to `/root/.secrets/cloudflare.ini` by
`npm run cloudflare:token` and never read by the app.

So a name present locally but not on the VPS needs a decision every time, not
a reflex.

Adding a server-side variable needs a `systemctl restart hotspot-mgt` to take
effect, but **not** a rebuild - unlike a `NEXT_PUBLIC_*` value, which is
compiled into static JS.

### Dependencies are not covered by the deploy

If `package.json` gained a dependency since the last deploy, that needs a
deliberate, separate `npm install` **on the VPS** - the rsync ships `.next/`
only. Check with `git diff <last-deployed-sha>..HEAD -- package.json`. And see
the OOM warning above before running anything heavy there.

## Deploying Firestore rules/indexes

Entirely separate from the app deploy above - a different tool, a different target (Firebase, not the VPS):
```bash
firebase deploy --only firestore:rules,firestore:indexes
```
Run this any time `firestore.rules` or `firestore.indexes.json` change, independent of whether the app itself is also being redeployed that day. A newly added composite index can take a short while to finish building on Firebase's side after this command returns - a query that depends on it will fail with an explicit "index is currently building" error until it's ready, not silently return wrong results.

## Deploying the WireGuard manager

Also entirely separate - this is a plain file copy + service restart, not git-based:
```bash
scp -i <key> vps/wg-manager/app.py ubuntu@193.123.183.184:/opt/wg-manager/app.py
ssh ubuntu@193.123.183.184 "sudo systemctl restart wg-manager"
```
Restarting this service does not drop any live WireGuard tunnels - see `docs/router-and-wireguard.md` for why. Always `python3 -m py_compile` the file locally first to catch a syntax error before it reaches the one thing standing between the app and every tenant's router connectivity.

## CI

`.github/workflows/ci.yml` runs on every push/PR to `main`: `npm ci`, `npm run typecheck`, `npm run build`. Deliberately **excludes lint** - `npm run lint` is currently broken on an `eslint-plugin-react`/ESLint version mismatch that predates and is unrelated to this app's own code, reproducible even on an untouched file. CI does not deploy anything automatically; every deploy described above is still a manual, deliberate action.

## HTTPS, and what it changed

The production site was plain HTTP for its whole first life, and three
places in the codebase were written around that. All three were written to
survive the switch rather than assume it, so adding the certificate needed
no code change:

- The session cookie (`docs/auth-and-security.md`) sets its `secure` flag from the incoming request's actual protocol (`x-forwarded-proto`), which nginx passes through. It started setting `secure` by itself the moment HTTPS was live. Note the *other* cookie change the domain did require: `sessionCookieDomain()` now scopes the cookie to `ogawifi.online` so one sign-in covers every tenant subdomain.
- `navigator.clipboard` refuses to work outside a secure context, so every copy button (`lib/clipboard.ts`) has an `execCommand('copy')` fallback. Now that `:8080` only redirects, every page that renders a copy button is served over HTTPS and that fallback is dead weight - harmless, and still correct for local dev over plain HTTP.
- Traffic to the app's own endpoints - logins, Paystack verification calls - is now encrypted everywhere the app is actually served.

One thing HTTPS did *not* fix: there is no HTTP→HTTPS redirect, because port 80 belongs to Apache. Typing `http://ogawifi.online` reaches Apache, not this app.
