# Deployment

Assumes you've read `docs/glossary.md` and `docs/architecture.md`.

## The production setup, as it actually exists today

- One Oracle Cloud VPS at `193.123.183.184`, hostname `mikhmon-server`.
- This app runs as a systemd service named `hotspot-mgt`, via `npm run start` (plain `next start`, not a custom server), listening on `127.0.0.1:3000` — not exposed directly.
- nginx reverse-proxies `127.0.0.1:3000` out to the world on **port 8080**, not port 80. This is not a stylistic choice: Apache already owns port 80 on this exact VPS, serving two other, unrelated, still-actively-used products (`mikhmon`, `globlinksadmin`) that predate this project and must never be touched or affected by anything this app's deployment does. Port 8080 was chosen specifically to coexist without going anywhere near Apache's configuration.
- No domain or SSL yet — the app is reachable at `http://193.123.183.184:8080`, plain HTTP. (If/when a domain and SSL are added, this plain-HTTP assumption shows up in a couple of real places that would need revisiting — see "Known consequences of plain HTTP" below.)
- The WireGuard manager (`vps/wg-manager/`) runs as its own separate systemd service (`wg-manager`), bound only to `127.0.0.1:51821` — see `docs/router-and-wireguard.md`.
- Firestore rules/indexes and the WireGuard manager are each deployed independently of the Next.js app itself — three separate deploy actions, not one combined pipeline.

## Deploying the Next.js app — why it's "build locally, rsync the output"

The obvious approach — `git pull` on the VPS, then `npm run build` there — was tried first and caused a real production incident: this VPS has 956MB of RAM and, at the time, no swap. A `next build` exhausted memory, hung for over 30 minutes, and eventually made the VPS fully unresponsive over both SSH and the cloud provider's own browser console, requiring a hard reboot from Oracle's dashboard to recover. 2GB of swap was added afterward as a safety net, but the deployment strategy changed permanently as the real fix: **never run a build on the VPS.**

The actual process:
```bash
# 1. On your local machine, with .env.local's NEXT_PUBLIC_* values matching
#    production exactly (see "the build-time env trap" below):
npm run build

# 2. Rsync the build output, excluding dev-only artifacts that are huge
#    and unnecessary for `next start` (together, several GB; everything
#    else is tens of MB):
rsync -az --delete \
  --exclude 'cache' --exclude 'dev' --exclude 'node_modules' --exclude 'turbopack' \
  -e "ssh -i <your-key>" \
  .next/ ubuntu@193.123.183.184:/home/ubuntu/hotspot-mgt/.next/

# 3. Keep the VPS's own git checkout in sync too (so the source there
#    isn't misleadingly stale — `next start` itself only needs .next/ and
#    node_modules/, but a stale source tree is confusing for anyone who
#    later SSHes in to investigate something):
ssh ubuntu@193.123.183.184 "cd /home/ubuntu/hotspot-mgt && git pull origin main"

# 4. Restart:
ssh ubuntu@193.123.183.184 "sudo systemctl restart hotspot-mgt"
```

`node_modules` on the VPS is **not** reinstalled as part of this (that's exactly the step that caused the OOM incident, historically triggered by `npm install`/build-related processes, not literally `next build` alone — either way, nothing package-related runs on the VPS during a routine deploy). Only run `npm install` there, deliberately and carefully, when `package.json` has genuinely gained a new dependency — which is rare; check `git diff` on `package.json` before assuming you need to.

### The build-time env trap

`NEXT_PUBLIC_*` variables are baked into the client-side JavaScript bundle **at build time** — not read at runtime. This means your *local* `.env.local`, not the VPS's, determines what ends up in the bundle you're about to deploy. Two real ways this has gone wrong:

- Local `.env.local` had `NEXT_PUBLIC_APP_URL` without the `:8080` port, while the VPS's actual config correctly had it — building with the local value would have shipped a client bundle making API calls to the wrong port in production. Always diff your local `NEXT_PUBLIC_*` values against the VPS's before building for a deploy, not after.
- Switching Paystack from test to live keys required rebuilding and redeploying specifically because `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` had changed — restarting the service with a new `.env.local` on the VPS alone does nothing for a value that's already compiled into static JS files from a previous build.

## Deploying Firestore rules/indexes

Entirely separate from the app deploy above — a different tool, a different target (Firebase, not the VPS):
```bash
firebase deploy --only firestore:rules,firestore:indexes
```
Run this any time `firestore.rules` or `firestore.indexes.json` change, independent of whether the app itself is also being redeployed that day. A newly added composite index can take a short while to finish building on Firebase's side after this command returns — a query that depends on it will fail with an explicit "index is currently building" error until it's ready, not silently return wrong results.

## Deploying the WireGuard manager

Also entirely separate — this is a plain file copy + service restart, not git-based:
```bash
scp -i <key> vps/wg-manager/app.py ubuntu@193.123.183.184:/opt/wg-manager/app.py
ssh ubuntu@193.123.183.184 "sudo systemctl restart wg-manager"
```
Restarting this service does not drop any live WireGuard tunnels — see `docs/router-and-wireguard.md` for why. Always `python3 -m py_compile` the file locally first to catch a syntax error before it reaches the one thing standing between the app and every tenant's router connectivity.

## CI

`.github/workflows/ci.yml` runs on every push/PR to `main`: `npm ci`, `npm run typecheck`, `npm run build`. Deliberately **excludes lint** — `npm run lint` is currently broken on an `eslint-plugin-react`/ESLint version mismatch that predates and is unrelated to this app's own code, reproducible even on an untouched file. CI does not deploy anything automatically; every deploy described above is still a manual, deliberate action.

## Known consequences of plain HTTP (worth knowing, not yet acted on)

- The session cookie (`docs/auth-and-security.md`) sets its `secure` flag based on the actual incoming request's protocol (`x-forwarded-proto`), specifically so it keeps working if/when HTTPS is added later, rather than assuming one or the other. No action needed when a domain/SSL eventually arrives, for this specific piece.
- The browser's `navigator.clipboard` API refuses to work outside a "secure context" (HTTPS or `localhost`) — every copy-to-clipboard button in this app (`lib/clipboard.ts`) has an `execCommand('copy')` fallback specifically because of this, since the production site is plain HTTP today.
- Anything sent to the production site today travels unencrypted, including login credentials and Paystack live-mode traffic to this app's own endpoints (Paystack's *own* Inline popup still talks to Paystack over HTTPS regardless — this concern is specifically about traffic to/from this app's own server). Adding a domain + SSL (`certbot`) is the known, not-yet-done next step; nothing about the current architecture blocks it, it just hasn't been prioritized yet.
