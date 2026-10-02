# Data Model

Assumes you've read `docs/glossary.md` and `docs/architecture.md`.

Every schema below is defined once, as the literal source of truth, in `types/schemas.ts` using Zod. If this doc and that file ever disagree, the file is right — but they shouldn't disagree, since this doc is meant to explain *why* each field exists, not restate what's already readable in the code.

## How Firestore is organized

`lib/firebase-collections.ts` defines every collection name and path in one place — never hardcode a collection name string anywhere else.

**Top-level collections:**
- `users` — one document per account, independent of role
- `tenants` — one document per hotspot business
- `billingPlans` — the platform's own subscription tiers (superadmin-managed)
- `platform` — a single config document (WireGuard server settings, who bears Paystack's fee)

**Legacy flat collections** (`locations`, `plans`, `vouchers`, `payments`) — these exist from before this app became multi-tenant, and are **no longer written to by anything**. A handful of orphaned client-side hooks still query them directly (see `docs/decisions-and-gotchas.md`) but no live feature depends on them. All real data now lives in tenant subcollections.

**Tenant subcollections** — every tenant's actual operational data lives nested under their own tenant document:
```
tenants/{tenantId}/routers/{routerId}
tenants/{tenantId}/locations/{locationId}
tenants/{tenantId}/plans/{planId}
tenants/{tenantId}/vouchers/{voucherId}
tenants/{tenantId}/payments/{paymentId}
tenants/{tenantId}/customers/{uid}
```
This is what actually makes multi-tenancy work at the data layer: a query against `tenants/{tenantId}/vouchers` can only ever see that one tenant's vouchers — there's no shared `vouchers` collection a bug could accidentally leak across tenants from.

## Schema-by-schema

### `User`
```ts
{ uid, email, role: "superadmin"|"owner"|"customer", tenantId: string|null, createdAt }
```
One document per Firebase Auth account, keyed by `uid`. `role` is assigned once, at registration (see `docs/auth-and-security.md` for exactly how). `tenantId` is only ever non-null for an `owner` — it's how an owner's own API requests get scoped to their tenant.

There's a legacy `"admin"` role value some old accounts might still have in Firestore from before the three-role system existed; every place that reads `role` treats `"admin"` as equivalent to `"owner"` on read, rather than migrating the stored data. Deliberate — never touch old data, just translate it every time it's read.

### `Tenant`
```ts
{
  id, slug, businessName, ownerUid, ownerEmail, status,
  planId, planName, platformFeePercent, monthlyFee,
  paystackCustomerCode, paystackSubscriptionCode, subscriptionStatus, nextBillingDate,
  paystackSubaccountCode, bankName, accountNumber, accountName,
  wireguardPublicKey, wireguardTunnelIp,
  createdAt, updatedAt,
}
```
The most important and easiest-to-misunderstand split in this whole schema: **`planId`/`planName` point at the tenant's current billing plan, but `platformFeePercent`/`monthlyFee` are a snapshot, copied onto the tenant document once at signup and never updated again.** This is deliberate, not an oversight: a tenant's price is locked in the moment they sign up, the same way a real subscription service would never silently raise an existing customer's price just because the current plan's listed price changed. If a superadmin edits a `BillingPlan`'s price later, every *existing* tenant on that plan keeps paying what they originally agreed to — only *new* signups see the new price.

Limits (`maxCustomers`, etc.) work the opposite way on purpose — see the `BillingPlan` section below for why.

`status` is one of `pending | active | suspended | cancelled` — a suspended tenant's portal becomes inaccessible platform-wide.

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
This is the platform's own product catalog — what a tenant pays the *platform*, completely separate from what a tenant charges *their own customers* for vouchers (that's the unrelated `Plan` schema below — same English word, two different concepts in this codebase; always say "BillingPlan" for this one).

Full superadmin CRUD exists over this collection (`lib/billing-plans.ts`, `app/api/superadmin/billing-plans/`). Deleting one is smart, not a plain delete: if no tenant currently references that plan's `id`, it's permanently removed; if any tenant does, it's archived instead (`active: false`, kept in the database) — because a tenant's `Tenant.planId` pointing at a now-nonexistent document would be a dangling reference. `archivedAt`/`active: false` is the *only* soft-delete mechanism — there is deliberately no hard delete path for a plan still in use.

`limits` is read **live** at enforcement time (not snapshotted, unlike pricing above) — if a superadmin tightens a plan's `maxCustomers` after tenants are already on it, that change takes effect immediately for all of them. The asymmetry (pricing snapshotted, limits live) is intentional: price changes shouldn't retroactively apply, but what you're entitled to under a given plan should always reflect the plan's current real definition.

`paystackPlanCode`/`paystackPlanAmount` exist because Paystack has its own separate "Plan" object for recurring billing (see `docs/billing-and-payments.md`) — this caches that object's ID and detects drift (if `monthlyFee` is edited, `paystackPlanAmount` no longer matches, which signals the code needs to sync a new Paystack Plan before the next charge).

### `TenantCustomer`
```ts
{ uid, email, totalVouchers, totalSpent, joinedAt }
```
Lives at `tenants/{tenantId}/customers/{uid}` — one per (tenant, customer) pair, created the first time a specific customer buys anything from that specific tenant. This is what `BillingPlan.limits.maxCustomers` actually counts against, and what lets the purchase flow tell a *returning* customer of a tenant apart from a *brand-new* one (only brand-new customers can ever be blocked by a tenant being at its customer cap — see `docs/billing-and-payments.md`).

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
`routerIp` means different things depending on `connectionMethod`: for `"direct"`, it's the router's real, directly-reachable IP; for `"wireguard"`, it's the private tunnel IP assigned once the WireGuard tunnel is up (same value as `wireguardTunnelIp`). `wireguardInterfaceName`/`wireguardListenPort` are generated fresh per registration *attempt* (random, never hardcoded) specifically so two attempts — even for the same router, even a retry after a failure — can never collide with each other or with something already on the tenant's router. See `docs/router-and-wireguard.md`.

### `Location`
```ts
{ id, name, routerId, active, createdAt, updatedAt }
```
A physical/logical site (e.g. "Main Branch") that references one `Router` by ID. Router credentials are never duplicated onto a location — always fetched via `routerId` when needed, so a credential only ever lives in one place.

### `Plan` (a tenant's own voucher plan — not `BillingPlan`)
```ts
{
  id, locationId, locationName, name, price, duration,
  routerDurationValue, routerDurationUnit: "h"|"d",
  dataLimit, mikrotikProfile, active, sameCredentials,
  createdAt,
}
```
What a tenant's *customers* actually buy — e.g. "2 Hours Unlimited" for ₦200. `price` is in kobo (Naira's smallest unit — ₦1 = 100 kobo), same convention everywhere money appears in this app. `mikrotikProfile` is the name of a RouterOS hotspot profile this plan maps onto — the thing that actually enforces speed/data limits at the router level once a voucher is created under it.

### `Voucher`
```ts
{
  id, userId, userEmail, planId, planName, locationId, locationName, tenantId,
  username, password, duration, dataLimit,
  status: "active"|"expired"|"failed",
  paystackReference, failureReason, retryCount, lastRetryAt,
  createdAt, expiresAt,
}
```
Created immediately after a successful payment. `status: "failed"` means the *payment* succeeded but creating the actual hotspot user on the MikroTik router failed (network issue, wrong profile name, etc.) — the customer already paid and is entitled to access, so this never silently disappears; it shows up in the owner's "Failed Queue" for a one-click retry. This "payment succeeding always wins, a downstream technical failure never undoes it" rule shows up more than once in this codebase — see `docs/decisions-and-gotchas.md`.

### `Payment`
```ts
{
  id, userId, userEmail, planId, planName, locationId, tenantId,
  amount, paystackReference, status: "pending"|"success"|"failed", voucherId,
  subaccountCode, platformShareKobo, tenantShareKobo,
  createdAt,
}
```
One record per voucher purchase attempt. `subaccountCode`/`platformShareKobo`/`tenantShareKobo` record what Paystack's subaccount split actually did for this specific transaction — see `docs/billing-and-payments.md`.

### `PlatformConfig`
A single document at `platform/config`:
```ts
{ paystackBearer: "account"|"subaccount", wireguard: { serverPublicKey, serverEndpoint, tunnelSubnet }, updatedAt }
```
`paystackBearer` controls who eats Paystack's own transaction fee — see `docs/billing-and-payments.md` for the exact semantics (this one's worth reading precisely, the naming is easy to misread). The `wireguard` block is this server's own WireGuard identity — every tenant router's tunnel connects back to this one fixed public key/endpoint.

## Firestore security rules, in one sentence

Every collection follows the same shape: reads are allowed selectively per-role/ownership (or `true` for things that are meant to be public, like a tenant's own existence or active `BillingPlan`s), and **writes are `if false` almost everywhere** — the only way data is ever created or changed is through a server API route using the Admin SDK, which bypasses these rules entirely. The rules exist to constrain direct client-SDK reads, not to be the primary authorization mechanism (that's the API routes' job — see `docs/auth-and-security.md`).
