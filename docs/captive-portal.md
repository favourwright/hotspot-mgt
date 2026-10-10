# The captive portal - install, uninstall, and what "restore" actually means

Assumes you've read `docs/router-and-wireguard.md` (how we reach a router at all) and `docs/locations-and-routers.md` (why a router backs exactly one location).

Installing the portal changes a tenant's own router. **Everything here is written around one constraint: a tenant may already have had a customised hotspot login page, and uninstalling must give it back - not replace it with MikroTik's stock pages.**

## It is gated behind an addon

Installing requires the `captive-portal` addon, and so does the hosted portal
page. `install-portal` returns **402** without it; `{slug}/portal` serves a
neutral "unavailable" page instead of the login form and plan list, re-checked
on every request.

`uninstall-portal` is deliberately **not** gated: a lapsed payment must never
trap a tenant's router in a state they cannot undo. → `docs/addons.md`

## What install does, in order

The order is load-bearing, and `install-portal/route.ts` says so inline. Briefly:

1. **Walled garden first.** Clients must be able to reach `ogawifi.online` *before* anything redirects them there. Swapping the pages first would send every customer to a host their own router still blocks.
2. **Create the directory.** `hotspot-oga`, from `PORTAL_HTML_DIRECTORY` in `lib/hotspot-portal.ts`. `/tool fetch` won't create one.
3. **Write the shim** - a one-line redirect page - over the REST API, falling back to `/tool fetch` if that's refused. MikroTik's stock pages are never overwritten; we write a *new* directory alongside them.
4. **Switch the hotspot over**, by pointing every hotspot server profile's `html-directory` at ours.
5. **Probe MAC-login support.** Informational; never fails the install.

Step 4 is the only destructive one, and it's the one uninstall has to undo.

## The restore contract

`setHotspotHtmlDirectory()` returns `previous`: **one entry per hotspot server profile**, each `{ id, name, htmlDirectory }`. Install stores that whole array on the location as `portalPreviousProfiles`, and uninstall replays it through `restoreHotspotHtmlDirectories()`, putting each profile back on its *own* directory.

Three rules this encodes, each of which was a real way to lose the tenant's pages:

- **Per-profile, not one value.** A router can carry several hotspot profiles pointing at different directories. The original code stored `previous[0]` only, so uninstall flattened every profile onto whatever the *first* one used. If the tenant's custom page lived on any other profile, it was gone - which in practice looked like "we reverted them to stock".
- **Never restore onto our own directory.** Both capture and restore filter out `PORTAL_HTML_DIRECTORY`. Without this, a second install captures `hotspot-oga` as the thing to restore, and uninstall then "restores" to our own portal. That fails silently in the worst way: the portal keeps serving, but step 2 of uninstall has already withdrawn the walled garden from under it, so clients are redirected to a host their router now blocks.
- **Install refuses to run twice.** A 409 if `portalInstalledAt` is already set. The dropdown only ever offers one of install/uninstall, so this catches a stale client or a direct API call - but it's the real guard, because a second capture is what destroys the record.

An empty `html-directory` from RouterOS means its default, which is `hotspot` - hence `||` rather than `??` when reading it.

## Fallbacks, and where a restore is still a guess

| Situation | What uninstall does |
| --- | --- |
| `portalPreviousProfiles` present | Restores each profile to its own directory. A true restore. |
| Only the legacy `portalPreviousHtmlDirectory` | Sets every profile to that one value. Correct on a single-profile router, lossy otherwise. |
| Neither recorded | Sets every profile to `hotspot`. **A guess at MikroTik's default, not a restore.** |
| A captured profile no longer exists | Skipped, and named in the response's `skipped`. The tenant deleted it while our portal was installed; there's nothing to put back. |

Locations installed before `portalPreviousProfiles` existed sit in row 2 or 3 and cannot be upgraded retroactively - the information was never captured. If that matters for a specific tenant, the honest fix is to ask them what their `html-directory` was, not to infer it.

## Things that deliberately aren't undone

- **The shim file stays on disk.** It's inert once no profile points at it, and leaving it makes a reinstall a single field change.
- **The walled garden is withdrawn, but only our entries** - matched on the `ogawifi portal` comment that `ensureWalledGardenHost` stamps them with (`removeOurWalledGardenEntries`). A tenant's own rules, and anything another tool added, are left alone.

## Gotcha: changing the root domain

Every router with the portal installed carries a walled-garden allow-list naming the **old** domain, and keeps blocking the new one until the portal is reinstalled from the location's admin page. DNS and nginx alone will not do it. → `docs/domain-and-tls.md`
