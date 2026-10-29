# Data Model

Assumes you've read `docs/glossary.md` and `docs/architecture.md`.

Every schema below is defined once, as the literal source of truth, in `types/schemas.ts` using Zod. If this doc and that file ever disagree, the file is right - but they shouldn't disagree, since this doc is meant to explain *why* each field exists, not restate what's already readable in the code.

## How Firestore is organized

`lib/firebase-collections.ts` defines every collection name and path in one place - never hardcode a collection name string anywhere else.

**Top-level collections:**
- `users` - one document per account, independent of role
- `tenants` - one document per hotspot business
- `billingPlans` - the platform's own subscription tiers (superadmin-managed)
- `platform` - a single config document (WireGuard server settings, who bears Paystack's fee)

**Legacy flat collections** (`locations`, `plans`, `vouchers`, `payments`) - these exist from before this app became multi-tenant, and are **no longer written to by anything**. A handful of orphaned client-side hooks still query them directly (see `docs/decisions-and-gotchas.md`) but no live feature depends on them. All real data now lives in tenant subcollections.

**Tenant subcollections** - every tenant's actual operational data lives nested under their own tenant document:
```
tenants/{tenantId}/routers/{routerId}
tenants/{tenantId}/locations/{locationId}
tenants/{tenantId}/plans/{planId}
tenants/{tenantId}/vouchers/{voucherId}
tenants/{tenantId}/payments/{paymentId}
tenants/{tenantId}/customers/{uid}
tenants/{tenantId}/voucherCredentials/{uid}
```
This is what actually makes multi-tenancy work at the data layer: a query against `tenants/{tenantId}/vouchers` can only ever see that one tenant's vouchers - there's no shared `vouchers` collection a bug could accidentally leak across tenants from.

## Schema-by-schema

### `User`
```ts
{ uid, email, role: "superadmin"|"owner"|"customer", tenantId: string|null, createdAt }
```
One document per Firebase Auth account, keyed by `uid`. `role` is assigned once, at registration (see `docs/auth-and-security.md` for exactly how). `tenantId` is only ever non-null for an `owner` - it's how an owner's own API requests get scoped to their tenant.

There's a legacy `"admin"` role value some old accounts might still have in Firestore from before the three-role system existed; every place that reads `role` treats `"admin"` as equivalent to `"owner"` on read, rather than migrating the stored data. Deliberate - never touch old data, just translate it every time it's read.

### `Tenant`
```ts
{
  id, slug, businessName, ownerUid, ownerEmail, status,
  planId, planName, platformFeePercent, monthlyFee,
  paystackCustomerCode, paystackSubscriptionCode, subscriptionStatus, nextBillingDate,
  paystackSubaccountCode, bankName, accountNumber, accountName,
  wireguardPublicKey, wireguardTunnelIp,
  emailOptOuts,
  portalMacNotice, supportPhone, supportPhoneIsWhatsapp,
  renewalExpiryMode, renewalDataMode,
  createdAt, updatedAt,
}
```
The most important and easiest-to-misunderstand split in this whole schema: **`planId`/`planName` point at the tenant's current billing plan, but `platformFeePercent`/`monthlyFee` are a snapshot, copied onto the tenant document once at signup and never updated again.** This is deliberate, not an oversight: a tenant's price is locked in the moment they sign up, the same way a real subscription service would never silently raise an existing customer's price just because the current plan's listed price changed. If a superadmin edits a `BillingPlan`'s price later, every *existing* tenant on that plan keeps paying what they originally agreed to - only *new* signups see the new price.

Limits (`maxCustomers`, etc.) work the opposite way on purpose - see the `BillingPlan` section below for why.

`status` is one of `pending | active | suspended | cancelled` - a suspended tenant's portal becomes inaccessible platform-wide.

`renewalExpiryMode` (`extend` | `reset`) and `renewalDataMode` (`carry` |
`reset`) are the tenant's house rules for what buying the same plan again
does to a customer who still has time or data left. Schema defaults rather
than a backfill, so every tenant keeps the original behaviour until an owner
changes it on `/{tenant}/admin/plans`. What they mean, and why the data
reset has to clear the router's counters too, is in
`docs/billing-and-payments.md`.

`emailOptOuts` is the owner's own notification settings: a list of the email keys they have switched off, **not** a map of every key to a boolean. An absent entry means send, which is what lets a newly added email default to on for every existing tenant without a migration, and makes a corrupt or partially-written field degrade into too much mail rather than silence. Only keys flagged `optional` in `lib/email-catalog.ts` have any effect; anything else in the list is ignored on read. → `docs/emails.md`

### `BillingPlan`
```ts
{
  id, name, description, billingModel: "flat"|"usage"|"hybrid"|"free",
  monthlyFee, platformFeePercent, transactionFeeFlat, billingInterval: "monthly"|"yearly",
  trialDays,
  limits: { maxLocations, maxRouters, maxCustomers },   // each: number | null (null = unlimited)
  features: { customBranding, apiAccess, prioritySupport },
  featureList: string[],    // marketing bullets shown on the onboarding card
  badge: string | null,     // e.g. "Most Popular"
  active, sortOrder,
  paystackPlanCode, paystackPlanAmount,   // cached Paystack Plan object + the amount it was created with
  createdAt, updatedAt, archivedAt,
}
```
This is the platform's own product catalog - what a tenant pays the *platform*, completely separate from what a tenant charges *their own customers* for vouchers (that's the unrelated `Plan` schema below - same English word, two different concepts in this codebase; always say "BillingPlan" for this one).

Full superadmin CRUD exists over this collection (`lib/billing-plans.ts`, `app/api/superadmin/billing-plans/`). Deleting one is smart, not a plain delete: if no tenant currently references that plan's `id`, it's permanently removed; if any tenant does, it's archived instead (`active: false`, kept in the database) - because a tenant's `Tenant.planId` pointing at a now-nonexistent document would be a dangling reference. `archivedAt`/`active: false` is the *only* soft-delete mechanism - there is deliberately no hard delete path for a plan still in use.

`limits` is read **live** at enforcement time (not snapshotted, unlike pricing above) - if a superadmin tightens a plan's `maxCustomers` after tenants are already on it, that change takes effect immediately for all of them. The asymmetry (pricing snapshotted, limits live) is intentional: price changes shouldn't retroactively apply, but what you're entitled to under a given plan should always reflect the plan's current real definition.

`paystackPlanCode`/`paystackPlanAmount` exist because Paystack has its own separate "Plan" object for recurring billing (see `docs/billing-and-payments.md`) - this caches that object's ID and detects drift (if `monthlyFee` is edited, `paystackPlanAmount` no longer matches, which signals the code needs to sync a new Paystack Plan before the next charge).

### `TenantCustomer`
```ts
{ uid, email, totalVouchers, totalSpent, joinedAt }
```
Lives at `tenants/{tenantId}/customers/{uid}` - one per (tenant, customer) pair, created the first time a specific customer buys anything from that specific tenant. This is what `BillingPlan.limits.maxCustomers` actually counts against, and what lets the purchase flow tell a *returning* customer of a tenant apart from a *brand-new* one (only brand-new customers can ever be blocked by a tenant being at its customer cap - see `docs/billing-and-payments.md`).

### `VoucherCredential`
```ts
{ uid, handle, suffix, password, updatedAt }
```
A customer's chosen wifi username and password at one tenant, at
`tenants/{tenantId}/voucherCredentials/{uid}`. Absent for most customers -
the feature is opt-in and everyone else keeps getting random codes.

The router username is `<handle>-<suffix>`, never the bare handle. The
suffix is four characters generated once and never rotated, and it is what
makes collisions between customers impossible and "is this name taken" a
question nobody can ask - which matters because a RouterOS hotspot login has
no rate limiting and no lockout. Full reasoning, and the password rules
(six characters, never equal to or containing the username), in
`lib/voucher-credentials.ts`. `npm run test:voucher-credentials`.

Two placement decisions, both load-bearing:

- **Per tenant, not per account.** A tenant's owner can read their own
  vouchers' passwords in the admin UI, which is right for a code on a
  router they run and would not be right if it were the same password that
  customer uses at every other tenant on the platform.
- **Its own subcollection, not a field on `TenantCustomer`.** That document
  is created by a purchase and is what `maxCustomers` counts, so writing one
  for somebody who has only opened their profile page would spend a seat the
  tenant is paying for and could block a real customer from buying.

Closed in both directions in `firestore.rules` - it holds a password in the
clear, and the customer reaches it through
`/api/tenant/[slug]/voucher-credentials`, which keys on the verified uid.

### `Router`
```ts
{
  id, name, connectionMethod: "wireguard"|"direct",
  routerIp, routerUser, routerPass,
  wireguardPublicKey, wireguardTunnelIp, wireguardInterfaceName, wireguardListenPort,
  status: "pending"|"online"|"offline", active,
  createdAt, updatedAt,
}
```
`routerIp` means different things depending on `connectionMethod`: for `"direct"`, it's the router's real, directly-reachable IP; for `"wireguard"`, it's the private tunnel IP assigned once the WireGuard tunnel is up (same value as `wireguardTunnelIp`). `wireguardInterfaceName`/`wireguardListenPort` are generated fresh per registration *attempt* (random, never hardcoded) specifically so two attempts - even for the same router, even a retry after a failure - can never collide with each other or with something already on the tenant's router. See `docs/router-and-wireguard.md`.

### `Location`
```ts
{ id, name, routerId, active, createdAt, updatedAt }
```
A physical/logical site (e.g. "Main Branch") that references one `Router` by ID. Router credentials are never duplicated onto a location - always fetched via `routerId` when needed, so a credential only ever lives in one place.

The schema permits many locations per router, but **the relationship is enforced as 1-1** in the UI and the API, because every router-side operation a location drives is router-wide rather than location-scoped. → [`docs/locations-and-routers.md`](locations-and-routers.md)

### `Plan` (a tenant's own voucher plan - not `BillingPlan`)
```ts
{
  id, locationId, locationName, name, price, duration,
  routerDurationValue, routerDurationUnit: "h"|"d",
  dataLimit, sharedUsers, mikrotikProfile, active, sameCredentials,
  createdAt,
}
```
What a tenant's *customers* actually buy - e.g. "2 Hours Unlimited" for ₦200. `price` is in kobo (Naira's smallest unit - ₦1 = 100 kobo), same convention everywhere money appears in this app. `mikrotikProfile` is the name of a RouterOS hotspot profile this plan maps onto - the thing that actually enforces speed/data limits at the router level once a voucher is created under it.

`sharedUsers` is the odd one out: a **display-only mirror** of that profile's
`shared-users`, which is how many devices one voucher can be signed in on at
once. The router owns the value and enforces it; the plan carries a copy so
the storefront, the portal and the receipt emails can show it without
reaching the router on every page view. It is copied from whichever profile
the plan points at when the plan is saved, never authored on its own - edit
it in isolation and the plan would advertise one number while the router
enforced another.

**Absent means unknown, not 1.** Plans saved before it was captured have
null, and so does a profile the router reports without the setting. Every
display path (`formatDeviceCount` / `formatDeviceLimit` in `lib/utils.ts`)
renders nothing at all in that case rather than defaulting, because the
number is part of what the customer is paying for. A plan backfills itself
the next time an owner saves it - and an edit made while the router is
unreachable keeps the stored value instead of clearing it, since an empty
profile list is "we could not ask", not "there is no limit".

### `Voucher`
```ts
{
  id, userId, userEmail, planId, planName, locationId, locationName, tenantId,
  username, password, duration, dataLimit, sharedUsers, dataLimitBytes,
  status: "active"|"expired"|"failed"|"superseded",
  renewalOf, supersededBy, supersededAt, renewal, routerUserReapedAt,
  paystackReference, failureReason, retryCount, lastRetryAt,
  createdAt, expiresAt,
}
```
Created immediately after a successful payment. `status: "failed"` means the *payment* succeeded but creating the actual hotspot user on the MikroTik router failed (network issue, wrong profile name, etc.) - the customer already paid and is entitled to access, so this never silently disappears; it shows up in the owner's "Failed Queue" for a one-click retry. This "payment succeeding always wins, a downstream technical failure never undoes it" rule shows up more than once in this codebase - see `docs/decisions-and-gotchas.md`.

**One voucher document is one purchase, but no longer always one router
user.** A customer buying the same plan again before it runs out has their
existing credential extended rather than being handed a second one, so
several voucher documents can share a `username` (see
`docs/billing-and-payments.md`). The newest is the live one; the ones it
replaced carry `status: "superseded"`, `supersededBy` and `supersededAt`,
and the renewal carries `renewalOf` pointing back.

`"superseded"` is a distinct status rather than an early `"expired"`
because two crons key off `"active"` and both would be wrong otherwise: the
expiry reminder would email "your access ends in an hour" about a plan that
was just topped up, and the close-out would mark it expired on a date that
no longer applies. The counts stay right either way - `totalVouchers`
counts every sale including this one, and `activeVouchers` counts the
credential once.

Anything joining router users to vouchers by username must now pick
deliberately rather than taking whichever row comes back last
(`indexVouchersByUsername` in `lib/hotspot-users.ts` keeps the newest and
drops superseded ones; `liveVoucherFor` in the same file is the one-user
form of the same rule). A plain `find` over an unordered query is the bug
this is here to prevent, and it shipped once: the hotspot-user detail
dialog showed a renewed login's *first* purchase date, and with it the
first payment's amount and reference.

`renewal` is written only by a renewal, and records what that renewal did
to the credential it took over: the two tenant modes in force at the time
(`expiryMode`, `dataMode`), the expiry the router was running to, the cap
it carried and its lifetime byte counters. Under the reset modes all three
of those are overwritten within the same second, so this is the only place
they survive - and storing the modes rather than reading them back off the
tenant means an owner changing a setting later does not revise what past
renewals are reported as having done. Absent on every voucher that is not a
renewal, and on renewals written before it existed.

`dataLimitBytes` is the `limit-bytes-total` the router user should carry,
written **before** the router is patched so a retry re-sends the same
absolute number instead of topping the customer up twice.
`routerUserReapedAt` is set by the `voucher-reap` cron when it deletes a
long-expired user from the router, and is what stops that deliberate
removal from being reported as drift forever (`docs/cron-jobs.md`).

### `Payment`
```ts
{
  id, userId, userEmail, planId, planName, locationId, tenantId,
  amount, paystackReference, status: "pending"|"success"|"failed", voucherId,
  subaccountCode, platformShareKobo, tenantShareKobo,
  createdAt,
}
```
One record per honoured voucher sale, written as the last step of fulfilment, so it always has a `voucherId`. `subaccountCode`/`platformShareKobo`/`tenantShareKobo` record what Paystack's subaccount split actually did for this specific transaction - see `docs/billing-and-payments.md`.

### Fulfilment ledgers, pending purchases and payment reviews
Three top-level collections, all server-only by rule:
```
pendingPurchases/{reference}  what a buyer agreed to pay for, before the charge
fulfilments/{reference}       what fulfilment decided and how far it got
paymentReviews/{reference}    charges that cleared and could not be honoured
```
A pending purchase is written by `/api/purchase/initiate` and holds the tenant, plan, location, buyer, intent, device, and the agreed amount with its price and fee parts and the split sent to Paystack. Fulfilment takes all of those from it. `expiresAt` (30 minutes) is informational only: a late payment that matches is still honoured. `deleteAt` (90 days) is purged by the reconcile cron. Shape in `lib/pending-purchases.ts`.

A ledger holds the decision (`intent`: mint, revive or extend, voucher id, username, password, and for a renewal the exact RouterOS patch), a lease (`leaseUntil`, `attempts`), and one progress flag per step (`bookkeepingApplied`, `router`, `voucherWritten`, `paymentWritten`, `state`, `notifiedAt`). It carries `deleteAt` (90 days); the `payment-reconcile` cron deletes ledgers past it, because the project is on Spark and Firestore TTL policies need Blaze. The payment document is the permanent record. A payment with no ledger is a sale fulfilled before the ledger existed and is read exactly as before. Shapes in `lib/fulfilment-runner.ts`; why in `docs/billing-and-payments.md`.

### `PlatformConfig`
A single document at `platform/config`:
```ts
{ paystackBearer: "account"|"subaccount", wireguard: { serverPublicKey, serverEndpoint, tunnelSubnet }, updatedAt }
```
`paystackBearer` controls who eats Paystack's own transaction fee - see `docs/billing-and-payments.md` for the exact semantics (this one's worth reading precisely, the naming is easy to misread). The `wireguard` block is this server's own WireGuard identity - every tenant router's tunnel connects back to this one fixed public key/endpoint.

### `Addon`, `AddonEntitlement`, and friends
Four collections support addons, three of which are closed to the client entirely:
```
addons/{key}                          public read  - a price list, nothing more
tenants/{id}/entitlements/{key}       server only  - who actually has one
subscriptionIndex/{subscriptionCode}  server only  - what a subscription pays for
addonPayments/{reference}             server only  - references already redeemed
```
`addons/{key}` holds only pricing; **which** addons exist is `lib/addon-catalog.ts`, in code, because an addon only does anything if a route calls `requireAddon` with its key. `BillingPlan.includedAddons` lets a plan bundle one. Entitlement is never a field on the tenant document - that document was owner-writable from the browser, and a self-grantable entitlement is not an entitlement. → `docs/addons.md`

## Firestore security rules, in one sentence

Every collection follows the same shape: reads are allowed selectively per-role/ownership (or `true` for things that are meant to be public, like a tenant's own existence or active `BillingPlan`s), and **writes are `if false` almost everywhere** - the only way data is ever created or changed is through a server API route using the Admin SDK, which bypasses these rules entirely. The rules exist to constrain direct client-SDK reads, not to be the primary authorization mechanism (that's the API routes' job - see `docs/auth-and-security.md`).
