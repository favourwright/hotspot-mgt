# Billing & Payments

Assumes you've read `docs/glossary.md` and `docs/data-model.md`.

Two completely separate money flows exist in this app, and keeping them mentally separate is the key to understanding this whole doc:

1. **Customer → Tenant**: a customer buys a voucher from a tenant's portal. One-off charge, split automatically between the tenant and the platform.
2. **Tenant → Platform**: a tenant pays the platform for using it, per their chosen `BillingPlan`. Can be a one-off onboarding charge, a recurring subscription, or nothing at all (usage-based/free plans).

Both flows go through Paystack, but use different Paystack features.

## Flow 1: Customer buys a voucher

1. Customer picks a `Plan` on a tenant's portal, `CheckoutDialog` opens.
2. Paystack Inline (a JS popup, never leaves the page) collects payment. The charge config includes `subaccount` (the tenant's Paystack subaccount code, if they have one) and `bearer` — see "The subaccount split" below.
3. On success, the client calls `POST /api/payment/verify` with the Paystack reference — **the client never decides a payment succeeded on its own**; the server independently re-verifies the reference against Paystack's own API before doing anything.
4. The server checks: is this reference already processed (idempotency, in case of a double-submit)? Does the plan still exist and is it active? Does the paid amount exactly match the plan's price?
5. If all checks pass: a `Payment` record is written, the customer's `TenantCustomer` record is created or updated (see `docs/data-model.md`), and the server attempts to create the actual hotspot user on the tenant's MikroTik router.
6. If the MikroTik step fails, the `Voucher` is still created — just marked `status: "failed"` instead of `"active"` — and the payment is **never** rolled back or treated as failed. The customer paid, so they're entitled to access; a technical hiccup creating the router-side login is the tenant's problem to retry (from their Failed Queue), not the customer's.

### Before the popup ever opens: the purchase-limit check

If a tenant's `BillingPlan` has a `maxCustomers` limit and they're already at it, a **brand-new** customer (one with no existing `TenantCustomer` record for this tenant) is blocked — but only here, before Paystack is ever involved (`GET /api/tenant/[slug]/can-purchase`). An **existing** customer of that tenant can always keep buying, no matter how full the tenant's customer cap is. This ordering matters: once money has actually moved, `/api/payment/verify` will never turn around and refuse to fulfil it over a limit — the limit is enforced strictly before payment, never after.

### The subaccount split

A tenant's Paystack **subaccount** is created once, during onboarding (`createPaystackSubaccount`, before their `Tenant` document is even written — see "Tenant onboarding" below), with a `percentage_charge` equal to their billing plan's `platformFeePercent` at that moment. From then on, Paystack itself performs the actual revenue split on every charge that names that subaccount — this app never calculates or transfers money itself. After verifying a payment, the server just *records* what Paystack reports back (`subaccountCode`, `platformShareKobo`, `tenantShareKobo` on the `Payment` document) — bookkeeping, not the mechanism.

If the subaccount code Paystack actually applied doesn't match what this app expected, that mismatch is logged for an admin to investigate later — **never used as a reason to block the payment**. Same principle as the MikroTik failure above: a payment that already happened is never undone over a downstream inconsistency.

`platformFeePercent` (on the `Tenant` document) and Paystack's own subaccount `percentage_charge` are two separate stored values, set from the same source at subaccount-creation time so they start in sync — but nothing keeps them in sync afterward. If a plan's `platformFeePercent` is edited later via the Billing Plans CRUD, existing tenants' actual Paystack subaccounts are **not** automatically updated to match (consistent with pricing being snapshotted at signup, per `docs/data-model.md` — just worth knowing this extends to the Paystack-side configuration too, not only the Firestore field).

### Who pays Paystack's own cut: `paystackBearer`

`PlatformConfig.paystackBearer` (`"account"` or `"subaccount"`) is passed straight through, unmodified, as Paystack Inline's own `bearer` parameter. Per Paystack's own documented behavior for that parameter: `"account"` means the platform's main Paystack account absorbs Paystack's processing fee; `"subaccount"` means the tenant's subaccount absorbs it instead. **There is currently no UI to change this** — it has only ever run at its schema default, `"account"`. If you ever need to make this configurable, that's a real gap to fill, not just a missing nice-to-have.

## Flow 2: Tenant pays the platform

### Choosing a plan during onboarding

Onboarding's "Choose a plan" step fetches the live, active `BillingPlan` list from `GET /api/onboarding/plans` (a public, trimmed-down view — no Paystack codes or internal timestamps) — it is never a hardcoded list in the UI, so adding a 4th plan via the superadmin CRUD needs zero onboarding code changes.

### If the plan has a monthly fee

The very first month is charged **during onboarding itself**, before the `Tenant` document is even created:
1. `GET /api/onboarding/plan-code?planId=...` ensures a Paystack **Plan** object (Paystack's own recurring-billing concept, unrelated to this app's `Plan`/`BillingPlan`) exists for this billing plan, creating one on first use if needed, or updating it if the fee has since changed (`lib/billing-plans.ts`'s drift detection, via the cached `paystackPlanAmount`).
2. Paystack Inline charges the user against that Plan code, which — if successful — also establishes a Paystack **Subscription** for future recurring charges.
3. Only once that first charge is verified does `POST /api/onboarding/create-tenant` actually run: it creates the Paystack subaccount, creates the Paystack customer, and only after *both* of those succeed does it write the `Tenant` document and promote the user's role to `owner`.

If subaccount creation fails, nothing is created and nothing is charged — this ordering is itself the safety net; there's no Firestore transaction involved, just "don't create the tenant until every prerequisite has already succeeded." The one accepted residual risk: if the subaccount is created successfully but the tenant document write itself then fails, there's no automatic cleanup of that now-orphaned Paystack subaccount.

### If the plan is free or usage-only (no monthly fee)

The tenant document is created immediately, no payment step at all, `subscriptionStatus` stays `null`.

### Test card

Paystack's standard test card, used throughout this project's manual verification: `4084 0840 8408 4081` (any future expiry, any CVV).

## Test mode vs. live mode — a one-way door

Paystack keeps test and live keys, and every object created under them (Subaccounts, Plans, Customers), **completely separate**. Switching a deployment from test keys to live keys means:
- Every tenant's cached `paystackPlanCode` (created under test keys) is now invalid and must be cleared so it gets recreated fresh under live keys the next time it's needed.
- Existing test-mode tenants/subscriptions genuinely don't exist on the live side — they can't be "migrated," only recreated.

This already happened once in this project's history — switching live required a one-off script to null out every tenant's stale `paystackPlanCode`/`paystackPlanAmount` for exactly this reason.
