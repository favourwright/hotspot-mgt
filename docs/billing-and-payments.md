# Billing & Payments

Assumes you've read `docs/glossary.md` and `docs/data-model.md`.

Two completely separate money flows exist in this app, and keeping them mentally separate is the key to understanding this whole doc:

1. **Customer → Tenant**: a customer buys a voucher from a tenant's portal. One-off charge, split automatically between the tenant and the platform.
2. **Tenant → Platform**: a tenant pays the platform for using it, per their chosen `BillingPlan`. Can be a one-off onboarding charge, a recurring subscription, or nothing at all (usage-based/free plans).

3. **Tenant → Platform, for an addon**: a tenant buys a feature sold separately from their plan. One-off or recurring, and **independent of flow 2** - a tenant can be paid up on their plan and lapsed on an addon, or the reverse. → `docs/addons.md`

All three go through Paystack, but use different Paystack features.

> A tenant has exactly **one** Paystack customer code, shared by flows 2 and 3.
> That is why subscription webhook events are routed by `subscription_code`
> through `subscriptionIndex`, never by customer code: resolving by customer
> alone made an addon's `subscription.create` overwrite the tenant's platform
> subscription. → `docs/addons.md`

## Fulfilment has three paths, and that is the point

A successful charge becomes a voucher through `fulfilVoucherPurchase`
(`lib/voucher-fulfilment.ts`). Three things can drive it:

1. **The buyer's browser**, calling `/api/payment/verify`. Fast, and the only
   one that can show credentials in the portal dialog and auto-login the
   device while the buyer is still looking at it.
2. **The `charge.success` webhook**, server-to-server, which does not care
   whether the browser survived. Keyed off the `planId`/`locationId`/
   `tenantId` metadata the checkout dialogs attach.
3. **The `payment-reconcile` cron**, every 15 minutes, which asks Paystack
   what it charged and compares that against what we recorded.

It is idempotent at two levels: a query for an existing payment with the
reference, and the payment document being created at a **deterministic id**
derived from that reference. `create()` fails if it exists, so of two callers
racing past the query exactly one proceeds. A random id behind a prior query
is a check-then-act, and it loses that race by issuing two vouchers for one
charge.

**Why three.** Until 2026-10-11 there was only the first, which meant
fulfilment lived exactly as long as the buyer's browser did. A customer paid
500 naira from a captive portal, the verify call never landed, and the result
was no payment record, no voucher, no email and no alert. The only evidence
the sale had happened at all was Paystack's own receipt to the customer. The
captive portal is where that call is weakest: the buyer is still behind the
paywall, and the bank's 3DS step navigates the page away mid-flow.

A charge that should deliberately never be fulfilled (a refund, a chargeback,
a test charge, one settled off-platform) gets a document in `reconcileSkips`
keyed by reference. Without it the job would reissue a voucher somebody
decided not to honour, on every tick.

## Flow 1: Customer buys a voucher

1. Customer picks a `Plan` on a tenant's portal, `CheckoutDialog` opens.
2. Paystack Inline (a JS popup, never leaves the page) collects payment. The charge config includes `subaccount` (the tenant's Paystack subaccount code, if they have one) and `bearer` - see "The subaccount split" below.
3. On success, the client calls `POST /api/payment/verify` with the Paystack reference - **the client never decides a payment succeeded on its own**; the server independently re-verifies the reference against Paystack's own API before doing anything.
4. The server checks: is this reference already processed (idempotency, in case of a double-submit)? Does the plan still exist and is it active? Does the paid amount exactly match the plan's price?
5. If all checks pass: a `Payment` record is written, the customer's `TenantCustomer` record is created or updated (see `docs/data-model.md`), and the server attempts to create the actual hotspot user on the tenant's MikroTik router.
6. If the MikroTik step fails, the `Voucher` is still created - just marked `status: "failed"` instead of `"active"` - and the payment is **never** rolled back or treated as failed. The customer paid, so they're entitled to access; a technical hiccup creating the router-side login is the tenant's problem to retry (from their Failed Queue), not the customer's.

### Before the popup ever opens: the purchase-limit check

If a tenant's `BillingPlan` has a `maxCustomers` limit and they're already at it, a **brand-new** customer (one with no existing `TenantCustomer` record for this tenant) is blocked - but only here, before Paystack is ever involved (`GET /api/tenant/[slug]/can-purchase`). An **existing** customer of that tenant can always keep buying, no matter how full the tenant's customer cap is. This ordering matters: once money has actually moved, `/api/payment/verify` will never turn around and refuse to fulfil it over a limit - the limit is enforced strictly before payment, never after.

### The subaccount split

A tenant's Paystack **subaccount** is created once, during onboarding (`createPaystackSubaccount`, before their `Tenant` document is even written - see "Tenant onboarding" below), with a `percentage_charge` equal to their billing plan's `platformFeePercent` at that moment. From then on, Paystack itself performs the actual revenue split on every charge that names that subaccount - this app never calculates or transfers money itself. After verifying a payment, the server just *records* what Paystack reports back (`subaccountCode`, `platformShareKobo`, `tenantShareKobo` on the `Payment` document) - bookkeeping, not the mechanism.

### Where the two flows meet: the superadmin billing page

`/superadmin/billing` is the one screen that shows both flows per tenant - the monthly fee they pay (flow 2) next to the platform's share of their voucher sales (flow 1). It deliberately lists **every** tenant, not just those on a flat fee: a tenant on a free or usage-only plan still earns the platform money on every voucher, and filtering on `monthlyFee > 0` used to hide exactly those.

One caveat the page surfaces rather than hides: a tenant with no Paystack subaccount has `platformShareKobo: 0` written on every payment (`/api/payment/verify`), because there is no split for Paystack to report. That zero is not "we earned nothing" - the whole charge settled into the platform's own account. The page labels those tenants **Unattributed** instead of showing ₦0, since the commission figure genuinely cannot be derived for them.

If the subaccount code Paystack actually applied doesn't match what this app expected, that mismatch is logged for an admin to investigate later - **never used as a reason to block the payment**. Same principle as the MikroTik failure above: a payment that already happened is never undone over a downstream inconsistency.

`platformFeePercent` (on the `Tenant` document) and Paystack's own subaccount `percentage_charge` are two separate stored values, set from the same source at subaccount-creation time so they start in sync - but nothing keeps them in sync afterward. If a plan's `platformFeePercent` is edited later via the Billing Plans CRUD, existing tenants' actual Paystack subaccounts are **not** automatically updated to match (consistent with pricing being snapshotted at signup, per `docs/data-model.md` - just worth knowing this extends to the Paystack-side configuration too, not only the Firestore field).

### Who pays Paystack's own cut: `paystackBearer`

`PlatformConfig.paystackBearer` (`"account"` or `"subaccount"`) is passed straight through, unmodified, as Paystack Inline's own `bearer` parameter. Per Paystack's own documented behavior for that parameter: `"account"` means the platform's main Paystack account absorbs Paystack's processing fee; `"subaccount"` means the tenant's subaccount absorbs it instead. **There is currently no UI to change this** - it has only ever run at its schema default, `"account"`. If you ever need to make this configurable, that's a real gap to fill, not just a missing nice-to-have.

## Flow 2: Tenant pays the platform

### Choosing a plan during onboarding

Onboarding's "Choose a plan" step fetches the live, active `BillingPlan` list from `GET /api/onboarding/plans` (a public, trimmed-down view - no Paystack codes or internal timestamps) - it is never a hardcoded list in the UI, so adding a 4th plan via the superadmin CRUD needs zero onboarding code changes.

### If the plan has a monthly fee

The very first month is charged **during onboarding itself**, before the `Tenant` document is even created:
1. `GET /api/onboarding/plan-code?planId=...` ensures a Paystack **Plan** object (Paystack's own recurring-billing concept, unrelated to this app's `Plan`/`BillingPlan`) exists for this billing plan, creating one on first use if needed, or updating it if the fee has since changed (`lib/billing-plans.ts`'s drift detection, via the cached `paystackPlanAmount`).
2. Paystack Inline charges the user against that Plan code, which - if successful - also establishes a Paystack **Subscription** for future recurring charges.
3. Only once that first charge is verified does `POST /api/onboarding/create-tenant` actually run: it creates the Paystack subaccount, creates the Paystack customer, and only after *both* of those succeed does it write the `Tenant` document and promote the user's role to `owner`.

If subaccount creation fails, nothing is created and nothing is charged - this ordering is itself the safety net; there's no Firestore transaction involved, just "don't create the tenant until every prerequisite has already succeeded." The one accepted residual risk: if the subaccount is created successfully but the tenant document write itself then fails, there's no automatic cleanup of that now-orphaned Paystack subaccount.

### If the plan is free or usage-only (no monthly fee)

The tenant document is created immediately, no payment step at all, `subscriptionStatus` stays `null`.

### Test card

Paystack's standard test card, used throughout this project's manual verification: `4084 0840 8408 4081` (any future expiry, any CVV).

## Comping a tenant: plan, waiver, and which one you want

Two separate mechanisms, and picking the wrong one produces a comp that does
not comp anything.

**A plan change** is what a company-owned account wants. Moving a tenant onto
a plan with `monthlyFee: 0` and `platformFeePercent: 0` is permanent, needs
no end date, and is the only one of the two that stops a recurring charge -
there is nothing to charge. Done from `/superadmin/tenants` -> Manage
Billing.

**A fee waiver** (`tenants/{id}/feeWaivers`, resolved by `lib/fee-waivers.ts`)
waives the **plan fee only**, for a window, against the tenant's own plan.
`planId` never changes, so when the window closes they are back on what they
chose with nothing to migrate. This is what a promo code or a trial grants.

Three things about waivers that are easy to get wrong:

- **A waiver never touches the commission.** The split is Paystack's
  subaccount `percentage_charge`, not something this app sends per charge, so
  no waiver can reach it. An account that should also keep 100% of its sales
  needs a plan with `platformFeePercent: 0` *and* its subaccount updated to
  match (`POST /api/superadmin/tenants/[id]/paystack-split`).
- **A waiver does not stop an active Paystack subscription.** Paystack drives
  recurring charges off its own subscription object. Waiving the fee records
  what the tenant owes us and changes nothing about what Paystack collects.
  The dialog warns about this; the fix is a plan change, not a waiver.
- **Expiry is read-time, not a job.** Nothing runs when a window closes.
  `isWaiverActive` compares against the clock, so there is no state to get
  stuck and no cron to forget. `npm run test:waivers` covers the boundaries.

Waivers are revoked, never deleted, so the history still answers "was this
tenant comped last March".

## Promo codes

A coupon (`coupons/{CODE}`, `lib/coupons.ts`) waives a **new** tenant's plan
fee for a fixed number of days from signup. Managed at
`/superadmin/coupons`; entered on the last onboarding step.

The code is the document id, so redemption is a get-by-id with no index, two
codes cannot differ only by case, and uniqueness is free - the same trick
`subscriptionIndex` uses.

What holds this together:

- **The browser never decides anything.** `/api/onboarding/validate-coupon`
  is advisory, exists so the form can say something useful, and is
  authenticated so it is not a free oracle for guessing codes. Every
  rejection returns the same message for the same reason. `create-tenant`
  re-validates and redeems the code itself, and the waiver's duration comes
  back from that transaction rather than from the request body.
- **Redemption is a transaction**, because `maxRedemptions` is otherwise a
  check-then-act that two simultaneous signups both pass.
- **It redeems before the work it authorises.** A signup that fails later
  burns one slot on a promo code. Redeeming afterwards risks the opposite: a
  tenant already created with their fee waived and no coupon left to record
  why. The cheaper mistake was chosen deliberately.
- **The tenant document and its waiver are written in one batch.** A tenant
  created with a waived fee and no waiver document would be free forever
  with nothing explaining it.
- **A coupon cannot grant a permanent waiver.** `durationDays` is required
  and capped. A comp that never ends is a decision about one account and
  belongs on a plan a superadmin assigns by hand, not on a string somebody
  can paste into a form.
- **`durationDays` is not editable** after creation, because the waiver
  documents already record what each redeemer was actually given. Make a new
  code instead.

A redeemed code is never deleted, only switched off: it is the only record of
why someone's fee is waived.

`npm run test:coupons` covers the validity edges.

> **Not yet built: what happens when the window closes.** The waiver stops
> matching, the tenant owes their plan fee again, and nothing collects it.
> There is no card on file, because the signup charge was skipped - and a
> Paystack subscription cannot be started without a successful charge to
> authorise it. Until that flow exists, a promo code hands out free months
> with no ending. Do not issue one in production yet.

## Test mode vs. live mode - a one-way door

Paystack keeps test and live keys, and every object created under them (Subaccounts, Plans, Customers), **completely separate**. Switching a deployment from test keys to live keys means:
- Every tenant's cached `paystackPlanCode` (created under test keys) is now invalid and must be cleared so it gets recreated fresh under live keys the next time it's needed.
- Existing test-mode tenants/subscriptions genuinely don't exist on the live side - they can't be "migrated," only recreated.

This already happened once in this project's history - switching live required a one-off script to null out every tenant's stale `paystackPlanCode`/`paystackPlanAmount` for exactly this reason.
