<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` - verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VPS Deployment Runbook

The exact command sequence for deploying this app - written so another agent can follow it mechanically. For *why* it's shaped this way (the OOM incident, the port-8080 coexistence with Apache, etc.), see `docs/deployment.md` - this section is deliberately just the steps.

The production VPS (`193.123.183.184`) also runs two unrelated, still-live products (`mikhmon`, `globlinksadmin`) under Apache on port 80. **Never touch Apache, port 80, or anything under those two products.** Everything below only ever touches this app's own systemd service (`hotspot-mgt`) and the separate `wg-manager` service.

SSH key: `~/.ssh/ssh-key-2026-06-06.key`. Run everything below from the repo root on your own machine, not on the VPS.

## 0. Pre-flight (every time, before touching the VPS)

```bash
npx tsc --noEmit && npm run build
```

Then diff build-time env vars against the VPS - a mismatch here ships a client bundle pointed at the wrong URL/port, silently, in production:

```bash
grep "^NEXT_PUBLIC_" .env.local | sort > /tmp/local-vars.txt
ssh -i ~/.ssh/ssh-key-2026-06-06.key ubuntu@193.123.183.184 \
  "grep '^NEXT_PUBLIC_' /home/ubuntu/hotspot-mgt/.env.local | sort" > /tmp/vps-vars.txt
diff /tmp/local-vars.txt /tmp/vps-vars.txt && echo IDENTICAL
rm /tmp/local-vars.txt /tmp/vps-vars.txt
```

That diff only covers `NEXT_PUBLIC_*`, and only their *values*, because those
are the ones baked into the bundle at build time. Server-side vars have the
opposite failure mode - they're read by `next start` at process start, so a
missing one never breaks the build and never fails a smoke test; the feature
that depends on it just silently does nothing. `.env.local` is gitignored and
no step below copies it, so a var added locally is simply absent in production
until someone puts it there by hand. Compare the var *names* too (never the
values - those legitimately differ):

```bash
npm run env:diff
```

To put a missing server-side var on the VPS, name it explicitly:

```bash
npm run env:push -- CRON_SECRET
```

That backs up the remote file first, replaces any existing definition rather
than appending a duplicate, restarts `hotspot-mgt`, and confirms the name
landed. It deliberately refuses to sync everything in one go: some values are
*meant* to differ (`SUPERADMIN_EMAIL`, `ADMIN_EMAIL`) and `CLOUDFLARE_API_TOKEN`
is local-only by design, so "copy whatever is missing" would be wrong.

A name present locally but not on the VPS is either something that needs
adding there (e.g. `MAILTRAP_*`, or email sends silently skip - see
`docs/emails.md`) or something deliberately local-only (`CLOUDFLARE_API_TOKEN`,
which is pushed to `/root/.secrets/cloudflare.ini` by `npm run cloudflare:token`
and never read by the app). Decide which, every time - don't assume.

Adding a server-side var to the VPS's `.env.local` needs a `systemctl restart
hotspot-mgt` to take effect, but **not** a rebuild - unlike a `NEXT_PUBLIC_*`
value, which is compiled into static JS and needs the full deploy below.

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

**Known current blocker (since 2026-10-02):** this fails with `could not read Username for 'https://github.com'` - the repo's GitHub remote now appears to require auth (it was anonymous-readable before). This step is safe to skip entirely: `next start` only needs `.next/` and `node_modules/`, never the source tree. Do **not** add a credential or deploy key to the VPS to work around this without asking the user first - that's a real security decision, not a routine deployment mechanic.

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

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

A newly added composite index can take a moment to finish building after this returns - a query depending on it will fail with an explicit "index is currently building" error until then, not silently misbehave.

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

`ogawifi.online` resolves through Cloudflare to this VPS, with a wildcard
certificate (`*.ogawifi.online`) issued over DNS-01 and renewed by
`certbot.timer`. None of it is touched by a routine deploy, and none of the
steps above change it.

Two things to know before editing anything in that area:

- `NEXT_PUBLIC_APP_URL` is the single source of truth for the root domain.
  `proxy.ts` (subdomain routing), `lib/server-auth.ts` (session cookie
  `Domain`) and `lib/hotspot-portal.ts` (the routers' walled garden) all
  derive from it. Changing it is a rebuild, not a restart.
- Changing the domain means **reinstalling the captive portal on every
  router**, because each one carries a walled-garden allow-list naming the
  old domain. DNS and nginx alone will not do it.

Full reproducible setup, including the Cloudflare token scopes, the certbot
command and the nginx vhost: `docs/domain-and-tls.md`.

**The certificate currently cannot renew.** The Cloudflare API token on the
VPS is invalid (`certbot renew --dry-run` fails with `9109`), so renewal will
fail in early December and HTTPS breaks on 2027-01-02. Fix: a new scoped
token in `.env.local` as `CLOUDFLARE_API_TOKEN`, then `npm run cloudflare:token`.

## Hard rules, every time

- Never touch Apache, port 80, or anything under `mikhmon`/`globlinksadmin`.
- Never run `npm install` or `npm run build` on the VPS.
- Never add credentials or a deploy key to the VPS without the user's explicit, informed sign-off first.
- A deploy isn't "done" until `BUILD_ID` matches and the external curl checks in step 4 all return `200`.
- Never price an addon without grandfathering existing users first (step 5b) - it is an outage, not a config change.
