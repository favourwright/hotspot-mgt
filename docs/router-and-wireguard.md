# Routers & WireGuard

Assumes you've read `docs/glossary.md`. If you're unfamiliar with MikroTik/RouterOS/Winbox/WireGuard as concepts, read the relevant glossary entries first - this doc explains the *flow*, not the underlying networking concepts.

## Why this exists

Creating/managing hotspot vouchers on a MikroTik router means calling that router's own REST API (the `www-ssl` service). But most tenant routers sit behind a home or office internet connection with no public IP - nothing outside that network can normally reach them, which is usually exactly what you want, security-wise. WireGuard solves this by creating a persistent, encrypted tunnel between the tenant's router and this app's VPS, so the VPS can reach the router's API as if it were local.

"Direct IP" is the other, de-emphasized option - for the rare case where a router is already reachable at a fixed, public IP. It's pushed to an "advanced" fallback in the UI on purpose: exposing a router's admin interface directly to the internet carries real risk for anyone who doesn't already know exactly what that involves.

## The three moving pieces

1. **This Next.js app** - `components/admin/router-dialog.tsx` (the setup wizard UI) and `app/api/admin/routers/*` (the API routes it calls).
2. **The tenant's own router** - runs the commands the wizard gives them, in Winbox.
3. **`vps/wg-manager/`** - a small, separate Python (Flask) service that runs on the VPS itself, *not* part of the Next.js app, listening only on `localhost:51821`. It's the only thing that actually runs `wg` commands (which need root) - `lib/wg-manager.ts` talks to it over a shared secret header. Deployed and restarted independently of the Next.js app (see `docs/deployment.md`).

## The registration wizard, step by step

### Step 1 - Router details
Just name, MikroTik username, password. No validation against the real router happens here - and **can't**, by construction: there's no network path to the router yet. The tunnel doesn't exist until the steps below are complete. This is a real, structural limit, not an oversight - it was specifically raised and confirmed: credential testing has to wait until *after* the tunnel is confirmed reachable, which is the earliest point it's actually possible.

### Step 2 - Connect
The wizard generates a fresh, random `interfaceName` (e.g. `wg-hm-a3f9k2`) and `listenPort` for this *attempt* - never hardcoded, never reused - specifically so a fresh attempt, even a retry after a prior failure, can never collide with anything already on the tenant's router (their own unrelated VPN, or a leftover from an earlier attempt). This is why `Router.wireguardInterfaceName`/`wireguardListenPort` exist as stored fields - purely for support reference later.

Three commands are shown, to paste one at a time into a Winbox terminal:

1. **A pre-flight readiness check** (`buildReadinessCheckScript`) - read-only, changes nothing. It checks the RouterOS version (`:pick $ver 0 1 != "7"` - WireGuard needs RouterOS 7+) and whether anything already uses this attempt's generated interface name or port, printing a plain `READY` or `NOT READY - <reason>` so a non-technical user doesn't have to interpret raw command output. If `NOT READY` due to a name/port collision, there's a one-click "generate a new connection name and try again" - since the identity is random per attempt, this resolves the overwhelming majority of collisions without any real investigation needed.

   **A real RouterOS gotcha this script works around**: the whole script is wrapped in one outer `{ }` block. Without that wrapper, RouterOS executes each unbracketed `:local` line as a *separate* command when pasted into an interactive terminal - meaning a variable set on one line is already forgotten by the time the next line's `:if` tries to read it. This cost real debugging time against a live router before the root cause (not a logic bug, a terminal-pasting atomicity issue) was found. If you ever write another multi-line RouterOS script for this app, wrap it in `{ }` the same way.

2. **Create the WireGuard interface** - `/interface/wireguard add name=<interfaceName> listen-port=<listenPort>`.

3. **Show the interface's public key** - `/interface/wireguard/print`, which the tenant copies into a field in the wizard.

Once the public key is submitted, `POST /api/admin/routers/provision` runs:
- Calls the WireGuard manager's `/peer/add` to actually register this public key as a peer on the VPS's own `wg0` interface, which assigns a tunnel IP from the configured subnet - **`10.20.0.0/24`**, which is this product's own range and is deliberately *not* the `10.10.10.0/24` that other things on the same VPS use. See "The shared-subnet trap" below; this is not a cosmetic choice.
- Generates three more commands for the tenant to run (see Step 3).
- If the platform's own WireGuard server identity (`PlatformConfig.wireguard.serverPublicKey`/`serverEndpoint`) hasn't been set by a superadmin yet, the generated peer command contains literal placeholder text instead of real values - the UI shows an explicit warning in this case rather than letting the tenant paste garbage and silently fail.

### Step 3 - Finish
Three final commands, generated server-side (never hardcoded, since they embed the tenant-specific assigned tunnel IP and the per-attempt interface name):

1. `/ip/address add address=<assignedIp>/<prefix> interface=<interfaceName>` - gives the router's side of the tunnel an actual IP to respond from.
2. `/interface/wireguard/peers add interface=<interfaceName> public-key="<platform's public key>" endpoint-address=<platform's IP> endpoint-port=51820 allowed-address=<platform's tunnel IP>/32 persistent-keepalive=25s` - tells the router how to reach the platform's side. The allowed-address is **derived from the configured subnet** (first host of `PlatformConfig.wireguard.tunnelSubnet`), not hardcoded - it used to be a literal `10.10.10.1/32`, which is precisely how routers ended up back on the shared subnet regardless of configuration.
3. `/ip/firewall/filter add chain=input in-interface=<interfaceName> action=accept place-before=0` - **without this, the tunnel can come up perfectly and still be useless**: RouterOS's default firewall doesn't automatically trust a newly created interface, so inbound traffic on it (including the verification ping below) gets silently dropped unless explicitly allowed. This exact gap - handshake succeeds, nothing responds - is common enough that the diagnostics below were built specifically to catch it.

### Step 4 - Verify
The client polls `GET /api/admin/routers/tunnel-status/[ip]` every 3 seconds, up to 20 times (60 seconds total), until it reports reachable. Two genuinely different things are checked, and conflating them was a real bug this project fixed:

- **Ping** - does the assigned tunnel IP respond at all. This is what actually gates success.
- **WireGuard handshake state** (`wg show wg0 latest-handshakes`, independent of ping) - has an encrypted tunnel ever actually formed with this peer's public key.

Why both matter: a ping failure alone can't tell apart two completely different problems a tenant needs to fix in completely different ways:
- **No handshake at all** → the tunnel itself never formed. Likely causes: wrong public key pasted, the platform's endpoint/port unreachable, or the tenant's network blocking outbound UDP 51820 entirely.
- **Handshake occurred, ping still fails** → the encrypted tunnel is genuinely up; the problem is almost always that command 1 or 3 above (the IP address or the firewall rule) wasn't actually applied.

Before this distinction existed, both cases just produced the same unhelpful "could not connect, please verify you ran the commands correctly" after the full 60-second wait. Now the wizard shows one of two specific messages depending on which case it was, plus an inline, safe, read-only diagnostic command (`/interface/wireguard/peers print` - shows `last-handshake` directly) so the failure mode is visible immediately rather than guessed at. This was validated against a real tenant's real stuck router after the fact: their tunnel had, in fact, handshaken successfully two hours earlier and simply never responded to ping - exactly the second case above, previously indistinguishable from the first.

Once reachable, the wizard moves on to testing the MikroTik credentials from Step 1 (`POST /api/admin/routers/test-connection`) - this is the earliest point those credentials can actually be checked, now that there's finally a network path to the router. Only after both the tunnel *and* the credentials check out does the `Router` document actually get created.

## The shared-subnet trap - read this before changing any addressing

The VPS's `wg0` is **not exclusively ours**. Other products on the same box (Mikhmon) peer with the same WireGuard server, and a tenant's router may already have its own tunnel to it, on its own interface, long before this app ever touches it.

The per-attempt random `interfaceName` protects against a *name* collision. It does nothing about an *address* collision - and that is the one that actually breaks things.

**What went wrong.** A router already running Mikhmon's tunnel had `10.10.10.2/24` on its `wg0`. This app then provisioned a second tunnel and gave it `10.10.10.11/24` on `wg-hm-xxxxxx`. Two interfaces, same `/24`, so RouterOS created **two connected routes for `10.10.10.0/24` and load-balanced across them** (the `+` ECMP flag in `/ip/route/print`):

```
DAc+ 10.10.10.0/24  wg0           main  0
DAc+ 10.10.10.0/24  wg-hm-n00tcv  main  0
```

Replies from `10.10.10.11` then left via whichever interface the per-connection hash picked. When that was `wg0`, the packet arrived at the VPS inside Mikhmon's peer tunnel with a source address outside that peer's `allowed-ips`, and WireGuard's cryptokey routing **silently dropped it**.

**The symptom is deceptive**: handshakes succeed on both tunnels, because a handshake is endpoint-driven and never consults the routing table. `wg show` looks perfectly healthy. No traffic passes in either direction - and it broke the *other* product's tunnel too, not just ours. It was mistaken for "WireGuard won't connect after a power cut", because an ECMP hash reshuffles on reboot: the flows that mattered happened to pick the working path before, and didn't after. It had been broken the whole time.

**The fix, and the rule.** This product now owns `10.20.0.0/24`; the VPS's `wg0` carries a second address, `10.20.0.1/24`, alongside `10.10.10.1/24`. Different subnet means one unambiguous route per interface and no ECMP. No new interface, port or keypair was needed - the collision was the subnet, not the server.

> **Rule: never put this product's tunnel addresses in a subnet anything else on that VPS uses.** If you change `tunnelSubnet`, change it in all three places or provisioning will silently produce broken routers: `/opt/wg-manager/config.json` (`tunnelSubnet`, `reservedIps`), `PlatformConfig.wireguard.tunnelSubnet` in Firestore, and the VPS interface's own address.

Diagnosing a suspected recurrence, in order:

1. `/ip/route/print where dst-address~"10."` on the router - any `+` flag on two routes to the same prefix is this bug.
2. `/ip/address/print` - look for two interfaces holding addresses in one subnet.
3. From the VPS, `sudo wg show wg0 latest-handshakes` **and** a ping. A fresh handshake with 100% packet loss is the signature; they are different signals and only checking one will mislead you.

## Operational notes

- The WireGuard manager (`vps/wg-manager/app.py`) is deployed by copying the file directly to the VPS and restarting its systemd service (`wg-manager`) - it is **not** part of the Next.js build/deploy process, and has its own separate deploy step. See `docs/deployment.md`.
- Restarting the `wg-manager` service does **not** drop any existing tunnels - the actual WireGuard interface and its peers are a kernel-level (`wg`/`wg-quick`) construct, entirely independent of whether the small Flask wrapper around it happens to be running.
- The WireGuard manager only listens on `127.0.0.1:51821` - never exposed publicly, only reachable from the Next.js app running on the same VPS.
