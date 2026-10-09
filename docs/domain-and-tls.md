# Domain, DNS & TLS

How `ogawifi.online` was set up, end to end, and how to reproduce it from
nothing. Assumes you've read `docs/glossary.md` and `docs/deployment.md`.

This is the doc to follow if you ever move to a new domain, rebuild the VPS,
or stand up a second environment. Every command here was actually run; the
"why" notes are the things that cost time the first time round.

## What exists today

| Piece | Value |
|---|---|
| Domain | `ogawifi.online` (registered externally, DNS delegated to Cloudflare) |
| Authoritative NS | `georgia.ns.cloudflare.com`, `oswald.ns.cloudflare.com` |
| Cloudflare proxy | **Off** (grey cloud) on every record — DNS only |
| Apex / `www` / `*` / `superadmin` | `A` → `193.123.183.184` |
| Certificate | Let's Encrypt, `ogawifi.online` + `*.ogawifi.online`, RSA |
| Issued via | `certbot` + `dns-cloudflare` plugin (DNS-01) |
| TLS terminates at | nginx on the VPS, port **443** |
| App | `next start` on `127.0.0.1:3000`, proxied by nginx |
| Legacy entry point | `http://193.123.183.184:8080` still works (see "Port 8080") |

The shape of this is driven by one constraint that shows up everywhere
below: **Apache owns port 80 on this VPS**, serving two unrelated, still-live
products (`mikhmon`, `globlinksadmin`). Nothing in this setup may touch
port 80, Apache, or those products.

## Why Cloudflare, and why the proxy is off

Two independent decisions that are easy to conflate.

**Cloudflare for DNS** is not about CDN or DDoS. It is because the
certificate has to be a **wildcard** (`*.ogawifi.online`), every tenant gets
`{slug}.ogawifi.online`, and Let's Encrypt only issues wildcards over the
**DNS-01** challenge. DNS-01 means proving control by writing a TXT record,
which means certbot needs an API that can write to the zone. Cloudflare's
DNS API is free and has a first-party certbot plugin; the registrar's own
DNS did not. That is the entire reason the zone moved.

DNS-01 has a second benefit that matters a lot here: **it never needs
port 80.** The usual HTTP-01 challenge would have required Let's Encrypt to
reach `http://ogawifi.online/.well-known/...`, which on this box is Apache.
DNS-01 sidesteps that completely — renewal touches nothing but the DNS zone.

**The proxy (orange cloud) is off** deliberately. With it on, Cloudflare
terminates TLS at their edge and the origin sees Cloudflare's IPs. That
would break two things: the real client IP that the app and the hotspot
logic rely on, and — more importantly — captive-portal clients, whose
walled garden is configured by hostname and whose traffic must reach the
origin predictably. Turning it on later is possible but is a change to
re-test, not a free upgrade. Cloudflare will warn the zone is "not fully
protected"; that warning is expected and correct.

## Step 1 — Register the domain

Nothing special. Any registrar. Note what DNS records the registrar created
for you *before* you move away — see the trap in Step 2.

## Step 2 — Move DNS to Cloudflare

1. Add the site in Cloudflare (Free plan). Cloudflare scans the existing
   zone and imports what it finds.
2. **Review the imported records before continuing.** This is the step that
   bites: Cloudflare's scan is best-effort and silently misses records. The
   zone had pre-existing email records at the registrar that had to be
   re-added by hand:

   | Type | Name | Content |
   |---|---|---|
   | `MX` | `@` | `mx1.privateemail.com` (priority 10) |
   | `MX` | `@` | `mx2.privateemail.com` (priority 10) |
   | `CNAME` | `autoconfig` | `privateemail.com` |
   | `CNAME` | `autodiscover` | `privateemail.com` |
   | `CNAME` | `email` | `privateemail.com` |

   Losing these does not break the website — it silently breaks **email for
   the domain**, which nobody notices until someone reports a bounce. Copy
   the registrar's record list to a scratch file before switching, and diff
   it against Cloudflare's afterwards.

3. Add the app's own records, all **DNS only** (grey cloud):

   | Type | Name | Content | Why |
   |---|---|---|---|
   | `A` | `@` | `193.123.183.184` | The apex |
   | `A` | `www` | `193.123.183.184` | Conventional |
   | `A` | `*` | `193.123.183.184` | **Every tenant subdomain**, no per-tenant DNS work |
   | `A` | `superadmin` | `193.123.183.184` | Explicit, so it can't ever be shadowed by a tenant |

   The wildcard is what makes onboarding a tenant a pure database operation —
   no DNS change is ever needed to give a new tenant their subdomain.

4. Change the nameservers at the **registrar** to the two Cloudflare ones.
   Propagation is usually minutes but is allowed to take up to 24h; do not
   start Step 4 until `dig NS ogawifi.online` returns the Cloudflare pair,
   because certbot's DNS-01 check will otherwise be answered by a zone
   Cloudflare isn't serving yet.

Verify:
```bash
dig +short NS ogawifi.online           # the two cloudflare.com names
dig +short A  ogawifi.online           # 193.123.183.184
dig +short A  anything.ogawifi.online  # 193.123.183.184 (the wildcard)
dig +short MX ogawifi.online           # the privateemail pair, still intact
```

## Step 3 — Open port 443

**Two firewalls, both mandatory.** Oracle Cloud instances have a VCN
security list *and* a host firewall, and missing either produces the same
symptom: a connection that hangs rather than refuses, which looks like a DNS
or nginx problem and isn't.

1. **Oracle VCN** — Networking → Virtual Cloud Networks → your VCN → the
   subnet's Security List → Add Ingress Rule: source `0.0.0.0/0`, protocol
   TCP, destination port `443`.
2. **Host iptables** — Oracle's Ubuntu image ships with a restrictive
   `INPUT` chain ending in `REJECT`. The rule must go **before** that
   REJECT, which is why it's inserted at a position rather than appended:
   ```bash
   sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save      # or the rule is gone after a reboot
   ```
   `ufw` is inactive on this box; it is not in the path. Don't enable it
   without reconciling the existing iptables rules first.

Confirm the rule survived:
```bash
sudo grep 'dport 443' /etc/iptables/rules.v4   # must print something
```

## Step 4 — Wildcard certificate via DNS-01

**Create a scoped Cloudflare API token** (My Profile → API Tokens → Create
Token → Custom). It needs exactly:

- `Zone` → `DNS` → **Edit**
- `Zone` → `Zone` → **Read**
- Zone Resources: limited to `ogawifi.online`

Do not use a Global API Key: it is account-wide and unscoped, and it lives
in a file on the VPS from here on.

```bash
sudo apt install certbot python3-certbot-dns-cloudflare

sudo mkdir -p /root/.secrets
sudo tee /root/.secrets/cloudflare.ini >/dev/null <<'EOF'
dns_cloudflare_api_token = <the scoped token>
EOF
sudo chmod 600 /root/.secrets/cloudflare.ini   # certbot refuses it otherwise

sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  -d ogawifi.online \
  -d '*.ogawifi.online'
```

Quote `'*.ogawifi.online'` — an unquoted `*` is glob-expanded by the shell
against the current directory and certbot receives a filename.

`--dns-cloudflare-propagation-seconds 30` is the wait between writing the
TXT record and asking Let's Encrypt to look for it. The default (10s) is
optimistic; 30 has been reliable.

Certificate lands at `/etc/letsencrypt/live/ogawifi.online/`. The settings
above are written into
`/etc/letsencrypt/renewal/ogawifi.online.conf` and reused automatically by
`certbot renew` — the `certbot.timer` systemd unit runs that twice daily, so
renewal itself needs no further setup.

### The deploy hook — renewal is only half the job

`certbot renew` writes a new certificate file. **It does not tell nginx.**
nginx reads the certificate once, at start, and keeps serving the old one
until it is reloaded — so without a hook, roughly 30 days before expiry the
certificate silently renews and the site keeps serving the *old* one until
it expires and every tenant's HTTPS breaks at once.

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null <<'EOF'
#!/bin/sh
systemctl reload nginx
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

`deploy/` (not `post/`) is correct: it runs only when a certificate was
actually renewed, not on every no-op check.

Dry-run the whole path before trusting it:
```bash
sudo certbot renew --dry-run
```

## Step 5 — The nginx vhost

`/etc/nginx/sites-available/hotspot-mgt-ssl`, symlinked into
`sites-enabled/`:

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name ogawifi.online *.ogawifi.online;

    ssl_certificate     /etc/letsencrypt/live/ogawifi.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ogawifi.online/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Three things in there are load-bearing:

- **`server_name ogawifi.online *.ogawifi.online`** is what makes every
  tenant subdomain serve this app. The mapping from subdomain back to a
  tenant route happens in the app (`proxy.ts`), not here — nginx passes the
  host through untouched and the app does the rest.
- **`proxy_set_header Host $host`** must pass the *original* host. If this
  were pinned to a fixed value, `proxy.ts` would see one hostname for every
  tenant and subdomain routing would collapse.
- **`proxy_set_header X-Forwarded-Proto $scheme`** is what tells the app the
  request arrived over HTTPS, which is how the session cookie decides to set
  its `secure` flag (`docs/auth-and-security.md`).

### `http2 on;` does not work here

nginx on this VPS is **1.18**. The modern `http2 on;` directive is nginx
1.25+ and fails with `unknown directive "http2"`, taking the whole config
down with it. On 1.18 it is the older per-listener form, `listen 443 ssl
http2;` — which is what the config above uses. Check `nginx -v` before
copying a config from anywhere.

Apply:
```bash
sudo nginx -t && sudo systemctl reload nginx
```
Always `nginx -t` first. A bad config plus a reload on this box takes down
Apache's sites too, and those are other people's live products.

## Step 6 — Point the app at the domain

### `NEXT_PUBLIC_APP_URL` is the single source of truth

Set it on the VPS **and locally**:
```
NEXT_PUBLIC_APP_URL=https://ogawifi.online
```

Three separate pieces of the app derive their behaviour from this one value,
which is why it must be exactly right and have no trailing slash:

- `proxy.ts` → `rootDomain()`: the apex that `{slug}.` is matched against.
  Returns `null` for an IP, which is how the old `193.123.183.184:8080`
  entry point keeps working with path-based routing instead.
- `lib/server-auth.ts` → `sessionCookieDomain()`: the cookie's `Domain`, so
  one sign-in works across the apex, `superadmin.`, and every tenant
  subdomain. Without it a session set at the apex is never sent to
  `{slug}.ogawifi.online` and the owner is bounced straight back to sign-in.
- `lib/hotspot-portal.ts` → `walledGardenHosts()`: the hostnames a
  not-yet-paid captive-portal client is allowed to reach.

### This requires a rebuild, not a restart

`NEXT_PUBLIC_*` values are compiled into the client bundle at build time.
Editing `.env.local` on the VPS and restarting the service does **nothing**
for them. Build locally with the new value, then rsync — the full procedure
and the pre-flight diff are in `AGENTS.md`.

### Reserved slugs

Any hostname the platform itself uses must be in `RESERVED_SLUGS`
(`types/schemas.ts`), or a tenant could register that slug and shadow it.
Currently reserved for this reason: `superadmin`, `www`, `admin`, `api`,
`app`, `mail`, `autoconfig`, `autodiscover`, `email`, `cdn`, `onboarding`,
`portal`, `status`. The mail-related ones are there because of the
`privateemail` records above — a tenant on `autodiscover.ogawifi.online`
would break Outlook autodiscovery for the whole domain.

## Step 7 — Paystack

Update both, in the Paystack dashboard, to the HTTPS domain:

- Callback URL → `https://ogawifi.online`
- Webhook URL → `https://ogawifi.online/api/webhooks/paystack`

These point at live infrastructure with `pk_live` keys. A wrong value here
doesn't error — payments simply stop being confirmed.

## Step 8 — The routers

The captive portal depends on the domain being reachable *before* a client
has paid for internet, which is a router-side configuration, not a DNS one.

`walledGardenHosts()` (`lib/hotspot-portal.ts`) derives the allow-list from
the root domain and the installer writes it to each router:

```
ogawifi.online, *.ogawifi.online,          # the portal itself
*.paystack.co, *.paystack.com,             # inline script, API, checkout
fonts.googleapis.com, fonts.gstatic.com,   # pulled at render time
*.googleapis.com, *.firebaseapp.com
```

If the domain ever changes, **every already-installed router carries the old
allow-list** and must be reinstalled from the location's admin page — DNS
and nginx changing is not enough. See `docs/router-and-wireguard.md`.

## Verifying the whole thing

```bash
# DNS
dig +short NS ogawifi.online
dig +short A  someslug.ogawifi.online

# Certificate covers apex and wildcard, and isn't about to expire
sudo certbot certificates
echo | openssl s_client -connect ogawifi.online:443 -servername someslug.ogawifi.online 2>/dev/null \
  | openssl x509 -noout -dates -subject

# Renewal, end to end, including the nginx reload hook
sudo certbot renew --dry-run

# The app, over HTTPS, on apex and on a subdomain
curl -s -o /dev/null -w "%{http_code}\n" https://ogawifi.online/
curl -s -o /dev/null -w "%{http_code}\n" https://ogawifi.online/auth
curl -s -o /dev/null -w "%{http_code}\n" https://superadmin.ogawifi.online/
```

## Port 8080

`http://193.123.183.184:8080` still serves the app, from a second nginx
vhost (`/etc/nginx/sites-enabled/hotspot-mgt`). It predates the domain and
was kept as a fallback while the DNS and certificate were settling.

It is now a liability worth closing deliberately: it is plain HTTP, it
bypasses the certificate entirely, and because `rootDomain()` returns `null`
for an IP the subdomain routing silently doesn't apply there — the same app,
reachable two ways that behave differently. The options are to 301 it to
`https://ogawifi.online` or to remove the vhost and the iptables rule. Not
yet done.

## Known gaps

- **No HTTP→HTTPS redirect**, and there can't be a conventional one: port 80
  is Apache's. Anyone typing `http://ogawifi.online` reaches Apache, not
  this app. Links the app generates are all HTTPS, so this is mostly a
  typed-URL problem, but it is a real one.
- **Port 8080 is still open**, as above.
- **The Cloudflare API token on the VPS** was pasted into a chat during
  setup and should be rotated: create a new scoped token, replace the
  contents of `/root/.secrets/cloudflare.ini`, then
  `sudo certbot renew --dry-run` to confirm the new one works.
