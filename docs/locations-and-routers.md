# Locations and Routers - why it's 1-1

Assumes you've read `docs/data-model.md` (for `Location` and `Router`) and `docs/router-and-wireguard.md`. For how portal install/uninstall handles the tenant's own pages, see [`docs/captive-portal.md`](captive-portal.md).

**A router backs exactly one location.** This is enforced in the UI and in the API, but *not* in the schema - `Location.routerId` is a plain reference with no uniqueness constraint, and `Router` holds no reference back. The constraint is a deliberate choice, not a modelling accident, and this doc exists because the code reads like the opposite choice was made.

## The mismatch this resolves

The schema describes many-locations-per-router:

- `LocationSchema` (`types/schemas.ts`) holds `routerId`; `RouterSchema` holds nothing pointing back.
- Nothing in Firestore rules or indexes constrains `routerId`.
- `limits.maxLocations` and `limits.maxRouters` are tracked as two separate numbers, which only makes sense if the counts were expected to diverge.

But **every router-side operation a location drives is router-wide, not location-scoped.** Each route under `/api/admin/locations/[id]/` resolves the location to its router via `getRouterForLocation()` (`lib/router-config.ts`) and then talks to the router with no further scoping. The location id is a lookup key for credentials, not a partition:

| Operation | Where | Actually scoped by |
| --- | --- | --- |
| Portal install / uninstall | `app/api/admin/locations/[id]/install-portal/`, `uninstall-portal/` | Router |
| Hotspot profiles | `app/api/admin/locations/[id]/profiles/` | Router |
| Active sessions | `app/api/admin/locations/[id]/active-sessions/` | Router |
| Hotspot users | `lib/hotspot-users.ts` | Router list, joined to location-scoped vouchers |
| Plans, vouchers | Firestore subcollections | Location - the only thing truly partitioned |

So without the guard, a second location on the same router doesn't get its own anything. It shares the first one's state, silently.

## What actually breaks without the guard

Two failures, neither of which raises an error - both look like success:

**1. Portal install clobbers the other location.** `PORTAL_HTML_DIRECTORY` is the module-level constant `"hotspot-oga"` (`lib/hotspot-portal.ts`) - one directory for the whole router - and `setHotspotHtmlDirectory()` points *every* hotspot server profile on the router at it. Installing for location B overwrites location A's portal. Worse, the shim redirects to `https://<slug>.<host>/portal`, which is tenant-scoped rather than location-scoped, so A's customers land on B's checkout.

**2. Uninstall then restores onto our own directory.** Install used to record `portalPreviousHtmlDirectory: directory.data?.previous?.[0] ?? "hotspot"`. On B's install the previous directory is *already* `"hotspot-oga"`, so B stored our own directory as the thing to restore. Uninstall then points the router back at `hotspot-oga` - which still exists, because the shim is deliberately left on disk - so our portal keeps serving after an uninstall that reported success, with the walled garden withdrawn from under it. Customers get sent to a page their own router now blocks. The tenant's original pages aren't recoverable from what we stored.

Install now rejects a second install with a 409 while one is live, and both capture and restore skip any profile already pointing at our own directory, so this specific path is closed independently of the 1-1 guard.

There's a subtler one in the user list: `getMergedHotspotUsers()` pulls the full user list off the router and joins it against `getTenantVouchersByLocation(tenantId, locationId)`. Location B therefore shows every voucher user location A created, but with no matching voucher - so they render as manually-created users rather than as A's sold vouchers.

## The guard, as implemented

Three places:

- `components/admin/add-location-dialog.tsx` - routers already backing a location render disabled, labelled "in use by \<location\>". The empty state distinguishes "no online routers" from "every online router is taken", because those need different fixes.
- `components/admin/locations-table.tsx` - passes the live `locations` list into the dialog so the picker reflects the current state, not the server snapshot.
- `app/api/admin/locations/route.ts` - rejects a duplicate `routerId` with a 409 naming the location that holds it, so the API isn't weaker than the UI. It's a single-field equality query on `routerId`, so it needs no composite index.

**Not covered:** nothing detects or repairs *existing* duplicates. The guard blocks creation only. If you need the invariant to hold for data that predates it, query each tenant's `locations` subcollection for repeated `routerId` values first.

## If we ever want real many-to-1

The unit that actually partitions a hotspot on RouterOS is the **hotspot server** - one per interface or bridge, each with its own server profile, HTML directory, and user and session namespace. That, not the router, is what a location should map to.

The data model change is one field: `Location` gains `hotspotServer: string` (the RouterOS server name), chosen at creation from a list probed off the router. `routerId` stays as-is. The work is in making every router call respect it:

| Area | Change |
| --- | --- |
| `lib/hotspot-portal.ts` | `PORTAL_HTML_DIRECTORY` becomes a function of the location, e.g. `hotspot-oga-<locationId>` |
| `lib/mikrotik.ts` | `setHotspotHtmlDirectory()` targets one server profile rather than all; add a `listHotspotServers()` probe |
| `install-portal`, `uninstall-portal` | Store and restore the previous directory per server profile |
| `profiles/` | Filter or name-prefix profiles per location |
| `hotspot-users`, `active-sessions` | Filter by the server the user or session belongs to |
| Walled garden | No change - it's the same host either way, and stays router-wide |

Plus a server-picker in the location dialog. This is only worth doing if tenants actually run multiple hotspot areas off one router, which we have no evidence of yet.

**Having shipped the guard first doesn't block this.** Removing it is the guard plus the 409. The only cost is one migration: existing locations have no `hotspotServer` and need backfilling with each router's default server - which is cheap precisely because, by then, every router has exactly one location by construction.
