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

It is idempotent because of a **ledger document**, `fulfilments/{reference}`,
created at a deterministic id derived from the reference. `create()` fails if
it exists, so of two callers racing exactly one proceeds; the other finds a
live lease and reports `in_progress`. A random id behind a prior query is a
check-then-act, and it loses that race by issuing two vouchers for one charge.

### Verified, decided, written down, then carried out

The ledger holds the decision as well as the claim. Before the router is
touched, fulfilment writes what it is about to do (mint, revive or extend;
the voucher id; the username and password; for a renewal, the exact RouterOS
patch) and `lib/fulfilment-runner.ts` carries it out step by step:
bookkeeping, router, voucher document, payment document, emails. Each step
either records that it happened or is safe to repeat.

The reason is a bug the earlier design had. It wrote the payment document
first and then talked to the router, so a process that died in between left
a payment with no voucher, and every later caller found the payment, said
"already done", and stopped. Now whoever arrives next - the browser
retrying, the webhook, the cron - finds an unfinished ledger whose lease
(3 minutes) has lapsed, claims it in a transaction, and finishes the sale.

Details that matter if you touch it:

- **The payment document is written last**, at its deterministic id, so one
  exists only for a sale that has a voucher behind it. A sale in progress has
  a ledger and no payment, which is exactly what makes the reconcile cron
  pick it up if it stalls.
- **A renewal's patch is computed once and stored.** It is derived from the
  router's comment; recomputing it on a resume would read the date the first
  attempt already extended and extend it again.
- **A resume never mints blind.** It looks the username up first; a user with
  our marker is ours from the first attempt and is revived, a user without
  one is somebody else's and the voucher fails into the Failed Queue instead.
- **Auto-login happens only on the first attempt.** A resume minutes later
  does not log a device in on the buyer's behalf.
- **Emails are at least once.** A crash between sending and recording costs a
  duplicate, never a missing email.
- **The voucher document is written once.** Not repeated on a resume, because
  an owner may have retried a failed voucher from the Failed Queue in the
  meantime, and a blind re-write would put it back to `"failed"`.
- **The ledger holds the password, so it is server-only** by rule, and it is
  never on the payment document, which customers and owners can read.

`npm run test:fulfilment-ledger` stops the runner after every side effect in
turn and proves a resume finishes with one voucher, one payment, one counter
increment and the emails sent.

### Server-side checkout and the cutover

A charge with no `pendingPurchases` record was either started before
server-side checkout shipped, or started by something other than our server.
`PlatformConfig.serverCheckoutRequiredSince` (the "Require server-started
checkout" switch on the superadmin Config page) separates the two: while it
is off, such charges are fulfilled the way they always were; once on, one that
Paystack says was **paid** after that moment goes to Payment reviews as
`unauthorised_charge` (decision D3). A charge whose amount or currency does
not match its record also goes to review (D4). See `lib/charge-authority.ts`,
which `npm run test:purchase-initiate` covers.

Switch it on about an hour after deploying, so a customer who opened the old
checkout page just before the deploy is not caught.

### A charge that cleared and cannot be honoured

Some refusals happen after the money moved: the plan or location was switched
off mid-checkout, the router is gone or inactive, the amount or currency does
not match. These used to return an error and store nothing. Now each writes a
`paymentReviews/{reference}` document and, the first time only, sends
`platform.payment_review` to the platform recipients. The buyer is told
support is on it and not to pay again, rather than the internal reason. The
reconcile cron treats a reference under review as handled.

A buyer mismatch (someone presenting another customer's reference) is not a
review case: the charge is real and its own buyer's webhook fulfils it.

They are resolved at `/superadmin/payment-reviews` (`lib/payment-reviews.ts`),
one of two ways:

- **Fulfil anyway** runs ordinary fulfilment with `overrideReview`, which
  waives the checks a person can overrule (something switched off, an amount
  or currency mismatch) and nothing else. A tenant, plan, location or router
  that no longer exists still cannot be fulfilled against, so those reviews
  offer only a refund. No auto-login: the buyer left the portal long ago.
- **Mark refunded** is recorded after refunding in the Paystack dashboard,
  not instead of it; refunds are irreversible and deliberately not issued
  from here. It also writes `reconcileSkips/{reference}` in the same
  transaction, so the reconcile job can never issue a voucher for it.

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

1. Customer picks a `Plan` on a tenant's storefront or captive portal, and the checkout dialog opens (`CheckoutDialog` or `PortalCheckoutDialog`). It calls `can-purchase` to preview whether they may buy and what a repeat purchase would do.
2. On Pay, the dialog calls `POST /api/purchase/initiate`. The server runs `checkPurchaseEligibility` (billing lock, plan/location/router active, `maxCustomers`, measured against customers active in the last 30 days), works out the amount and split with `computeCheckoutSplit`, writes a `pendingPurchases/{reference}` record, and creates the Paystack transaction itself, with `subaccount`, `bearer` and `transaction_charge` exactly as the browser used to send them (see "The subaccount split" below). It returns an access code.
3. Paystack Inline (a JS popup, never leaves the page) is opened with `resumeTransaction(accessCode)`, so it can only pay the transaction the server created. On success, the client calls `POST /api/payment/verify` with the reference - **the client never decides a payment succeeded on its own**; the server independently re-verifies the reference against Paystack's own API before doing anything.
4. The server checks: is this reference already processed (idempotency, in case of a double-submit)? Is the caller the buyer the checkout record names? Do the paid amount and currency match the record? Are the plan, location and router still there and active? With a record, the record decides the tenant, plan, location, buyer and "who is this for" answer; the request and the charge's metadata do not.
5. If all checks pass: a `Payment` record is written, the customer's `TenantCustomer` record is created or updated (see `docs/data-model.md`), and the server attempts to create the actual hotspot user on the tenant's MikroTik router.
6. If the MikroTik step fails, the `Voucher` is still created - just marked `status: "failed"` instead of `"active"` - and the payment is **never** rolled back or treated as failed. The customer paid, so they're entitled to access; a technical hiccup creating the router-side login is the tenant's problem to retry (from their Failed Queue), not the customer's.

### What a repeat purchase actually does

Step 5 used to be "always create another hotspot user". It is not any more,
and the reason is worth understanding before changing it, because it is the
router and not a policy preference that fixes the shape.

Two facts decide everything here:

1. **Expiry is wall-clock from first login, not from purchase.** The
   profile's `on-login` script stamps `now + duration` into the user's
   comment the first time they connect (`docs/cron-jobs.md`, last section).
   So a customer renewing early genuinely has unused days left.
2. **A RouterOS user has exactly one profile, and the profile is what
   carries speed, duration and the data cap.** Two plans cannot share one
   credential.

**The buyer is asked, because this cannot be inferred.** The first version
worked it out from their history alone. On the day it shipped a customer
bought the same daily plan three times in nineteen minutes, meaning to hand
two of the codes to other people, and all three stacked onto his own login:
one code carrying three days, two friends with nothing. Buying for yourself
and buying for someone else are identical from the outside, so the checkout
dialog asks and the answer rides on the charge.

`intent` is `"reuse"` or `"fresh"`, attached to the Paystack **metadata**
rather than to the verify request. That is what lets the `charge.success`
webhook and the reconciliation cron fulfil a sale the same way the browser
would have. Absent or unrecognised means `"reuse"`, which is the behaviour
that shipped first, so an old reference is unaffected.

`resolveVoucherAction` in `lib/voucher-renewal.ts` takes that answer:

| Answer | Their history | What happens |
| --- | --- | --- |
| `fresh` | anything | A new random code. Nothing they hold is touched, **including their saved profile login**. |
| `reuse` | same plan, running | **Extended in place.** The comment date moves out and `limit-bytes-total` goes up. |
| `reuse` | same plan, never used | Refused before Paystack opens. Nothing to extend: the clock has not started. |
| `reuse` | a login of theirs sitting idle | **Reused.** The new plan goes onto that code, counters reset, nothing carried over. |
| `reuse` | nothing usable | A new code. |

Two things about the idle-login row. It is **not** restricted to the same
plan: the login is dead either way, so a customer moving from Daily to
Weekly keeps the code they know and the router stops collecting a user per
sale. And a *live* login is never taken over whatever plan it carries, since
one RouterOS user holds one profile and swapping it would silently change a
plan somebody is in the middle of using.

Holding an unused code no longer refuses the sale outright, only the `reuse`
half of it. Buying a code for somebody else is an ordinary purchase whatever
is sitting unused in your own inbox, and refusing it was the other half of
the same wrong guess.

**What the buyer sees.** `can-purchase` returns an `options` object
describing what a purchase would do, and
`components/shared/purchase-intent-choice.tsx` renders the question - only
when there is genuinely something to decide, which is neither a first
purchase nor a buyer whose logins are all busy. Nothing is preselected and
the Pay button says `Choose who this is for` until they answer: the
automatic decision is precisely what went wrong, and this is the moment it
was being made.

**A renewal still writes a voucher document.** It has to: revenue sums
`payments`, but `totalVouchers` and the superadmin's
`totalVouchersAllTenants` are live `count()` queries over the vouchers
collection, and the payment stores a `voucherId`. A renewal that wrote no
document would under-count sales forever. So one purchase is still one
voucher document - several of them can now share a `username`, and the one
they replaced is marked `"superseded"`.

Three details that are easy to get wrong and hard to notice:

- **By default the new expiry counts from the current expiry, not from
  now.** That is the point of the default: top up with two days left on a
  seven-day plan and you get nine. Counting from now confiscates the
  remainder and looks identical from the outside - which is why the tenant
  setting that does exactly that is announced to the buyer before they pay
  (next section).
- **By default the new cap is `old limit + plan allowance`, and "uncapped"
  is sticky.** RouterOS measures lifetime counters against one number, so
  adding to the limit is what carries the unused data over. A user already
  on unlimited never acquires a cap from a capped plan - that would be
  taking something away mid top-up. `limit-bytes-total` of `0`, empty or
  absent all mean no limit, and reading any of them as a number caps
  someone at zero bytes.
- **Both targets are absolute, written to Firestore before the router is
  patched.** "Whatever is there now, plus the plan" is a read-modify-write,
  and the retry path would top the customer up twice. `npm run
  test:voucher-renewal` covers all of this.

### The two settings that change what renewing means

Tenants asked for renewals that start the plan again rather than stack, and
both halves of it are now their choice, on `/{tenant}/admin/plans`:

| Setting | Off (the default, and what shipped) | On |
| --- | --- | --- |
| `Tenant.renewalExpiryMode` | `extend` - the plan is added to what was left | `reset` - the plan starts again from the moment it is paid for |
| `Tenant.renewalDataMode` | `carry` - unspent data carries over | `reset` - the plan's allowance, and the router's counters cleared |

Tenant-wide rather than per plan, deliberately: it is a house rule about
what renewing means, and a tenant whose Daily reset while their Weekly
accumulated would have to explain the difference to the same customer. Both
are schema defaults rather than a backfill, so every existing tenant keeps
today's behaviour until an owner changes it.

Five things about them that are not obvious:

- **`reset` on the expiry means `now + duration`, stamped into the comment
  immediately.** It does **not** put the credential back to unactivated so
  the clock restarts at next login. That would write a null expiry onto a
  running voucher - the exact shape `resolveVoucherAction` reads as "bought
  and never used" - and would leave a customer with a live session on a user
  the `on-login` script will not re-stamp until they reconnect.
- **A reset expiry can land *earlier* than what the customer had.** Renew a
  Daily with three days of a Weekly still running and the credential now
  ends tomorrow. The checkout dialog says so in words before the Pay button
  (`components/shared/purchase-intent-choice.tsx`), because a buyer shown
  only the new date has no way to tell that their remaining days paid for
  it.
- **`reset` on the data is a cap *and* a counter reset.** RouterOS measures
  lifetime counters against `limit-bytes-total`, so setting the cap alone
  would leave a customer who had spent 4 of 5GB sitting at 5GB used against
  a 5GB limit: already exhausted, on a plan they just paid for.
  `resetHotspotUserCounters` runs after the patch, and the retry path reads
  the mode off `Voucher.renewal` so a retried renewal clears them too. A
  double reset can only over-deliver, which is the right direction for the
  one error this can make.
- **`reset` on the data drops the uncapped stickiness.** The plan is applied
  as bought, so an uncapped credential renewing onto a capped plan becomes
  capped. The setting's help text says so.
- **The modes are recorded on the voucher, not looked up later.**
  `Voucher.renewal` stores the two modes plus the expiry, cap and byte
  counters that were in force before the renewal ran. That is the only
  record of what a reset discarded once the router has been rewritten, and
  it means an owner switching a setting next month does not rewrite what
  last month's renewals are reported as having done.

A renewal also re-applies the plan's MikroTik **profile** to the router
user, and falls back to the previous voucher's `deviceMac` when the renewal
itself has none. Both are staleness fixes rather than features: a tenant who
edited the plan's profile since the first purchase would otherwise have the
new voucher document claiming the new speed and duration while the router
went on enforcing the old profile, and a renewal bought from the storefront
rather than the portal would make the newest voucher for the code one with
no device, losing `lastVoucherForDevice` and the portal's "welcome back"
card for a customer who changed nothing.

**Refusing an unused voucher happens only before payment.** The pre-check is
in `GET /api/tenant/[slug]/can-purchase`, which now takes `planId` and
`locationId`. Fulfilment deliberately does not act on that verdict: once
money has moved, the rule this codebase holds everywhere is that a payment
which already succeeded is never undone by anything downstream, so an unused
voucher that got past the pre-check simply produces a second one.

### Credentials a customer chose for themselves

A customer can set a wifi username and password at `/{tenant}/profile`, and
their vouchers are then issued under it instead of a random code. The whole
design, and the enumeration problem that shapes it, is in
`lib/voucher-credentials.ts`. Three things that matter at this layer:

- **The customer does not own the router username.** They pick a handle and
  the router gets `<handle>-<suffix>`, with a four-character suffix
  generated once per customer and never rotated. That is what makes every
  handle always available, so there is no "is this taken" question anyone
  can ask - and a hotspot login has no rate limiting or lockout behind it.
- **A second purchase after the first expired revives the same router user**
  (`reviveHotspotUser`), counters reset and comment back to `vc`. Their
  username is fixed, so there is nowhere else for it to go, and creating it
  again would fail on the duplicate name.
- **A chosen credential is skipped when they already hold a live voucher at
  that location.** Their handle maps to one RouterOS user and a live one is
  carrying a different plan's profile. The new plan gets a random code and
  the one they know keeps running untouched.

### Before the popup ever opens: the purchase-limit check

`maxCustomers` counts customers who have paid the tenant in the last 30 days (`TenantCustomer.lastPurchaseAt`, `lib/active-customers.ts`), not everyone who ever has. The window is worked out at read time, so a seat frees itself with no job to run. It was a lifetime count until 2026-11, which filled up with one-time visitors and could never go down, while the fee it sits beside is monthly.

If a tenant is at their limit, a **brand-new** customer (one with no existing `TenantCustomer` record for this tenant) is blocked - but only here, before Paystack is ever involved (`GET /api/tenant/[slug]/can-purchase`). Anyone who has **ever** bought from that tenant can keep buying, however long ago that was, which means a tenant can sit above their limit when lapsed customers return. The captive portal's plans page does not decide this: it renders with no idea who is looking, and when it tried, it disabled Buy for the existing customers the limit exempts. This ordering matters: once money has actually moved, `/api/payment/verify` will never turn around and refuse to fulfil it over a limit - the limit is enforced strictly before payment, never after.

### The subaccount split

A tenant's Paystack **subaccount** is created once, during onboarding (`createPaystackSubaccount`, before their `Tenant` document is even written - see "Tenant onboarding" below), with a `percentage_charge` equal to their billing plan's `platformFeePercent` at that moment. From then on, Paystack itself performs the actual revenue split on every charge that names that subaccount - this app never calculates or transfers money itself. After verifying a payment, the server just *records* what Paystack reports back (`subaccountCode`, `platformShareKobo`, `tenantShareKobo` on the `Payment` document) - bookkeeping, not the mechanism.

### Where the two flows meet: the superadmin billing page

`/superadmin/billing` is the one screen that shows both flows per tenant - the monthly fee they pay (flow 2) next to the platform's share of their voucher sales (flow 1). It deliberately lists **every** tenant, not just those on a flat fee: a tenant on a free or usage-only plan still earns the platform money on every voucher, and filtering on `monthlyFee > 0` used to hide exactly those.

One caveat the page surfaces rather than hides: a tenant with no Paystack subaccount has `platformShareKobo: 0` written on every payment (`/api/payment/verify`), because there is no split for Paystack to report. That zero is not "we earned nothing" - the whole charge settled into the platform's own account. The page labels those tenants **Unattributed** instead of showing ₦0, since the commission figure genuinely cannot be derived for them.

The expected tenant share is computed by `expectedTenantShareKobo`
(`lib/paystack-fees.ts`), which derives it from the same
`computeCheckoutSplit` that decided what to send - so the expectation and the
instruction cannot drift apart. **It has to account for the fee bearer.** When
a plan puts Paystack's fee on the subaccount, the tenant receives exactly that
much less, and an expectation of "price minus the platform's percentage" is
wrong by the fee on every single sale. That is not hypothetical: the first
comped tenant generated a split-mismatch alert on every voucher they sold, for
a split behaving exactly as configured. `npm run test:split`.

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
discounts the **plan fee only**, for a window, against the tenant's own plan.
The discount is a percentage or a flat sum, and 100% is a full waiver - which
is the common case, and why the collection is still named for it.
`planId` never changes, so when the window closes they are back on what they
chose with nothing to migrate. This is what a promo code or a trial grants.

**Every waiver carries an end date**, enforced by the API and not offered by
the UI. An open-ended comp belongs on a plan, where it shows on the tenant's
own billing and does not depend on a subcollection document nobody looks at.
`isWaiverActive` still reads a missing end date as "no end", so a document
written before that was settled keeps working rather than silently switching
off: tolerant on read, strict on write.

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

A coupon (`coupons/{CODE}`, `lib/coupons.ts`) discounts a **new** tenant's
plan fee. `discountType` is `percent` (1-100) or `amount` (kobo), and
`durationDays` says how long before full price starts. Managed at
`/superadmin/coupons`; entered on the last onboarding step.

### What a partial discount actually discounts

**The signup charge, not a recurring rate.** Paystack Inline either charges a
Plan's amount and establishes a subscription, or charges an arbitrary amount
and does not - there is no subscribing at one price while taking another. So:

- **100% off** - nothing is charged, no subscription exists, and the tenant
  is asked for full price when the window closes. That payment is what
  subscribes them.
- **Partial** - the reduced amount is charged once at signup as a **one-off**,
  so `subscriptionStatus` stays null. Full price is collected the same way
  when the window closes.

`applyFeeDiscount` is the only place the arithmetic lives: it floors at the
fee, so a flat discount larger than the plan fee is a full waiver rather than
a refund, and it rounds percentages rather than truncating so an odd kobo
amount does not nkechi the same side on every charge. `npm run test:coupons`.

A discount only reads sensibly when `durationDays` is about a billing period.
"20% off for 30 days" is "first month 20% off"; "20% off for 3 days" charges
a discounted month now and asks for a full one in three days. Nothing stops
it, and the dialog says so.

**A coupon and a plan trial do not stack.** A redeemed code governs outright
and the trial applies only when none was entered. Deliberately not "whichever
is better": once a discount can be partial there is no single axis to compare
on, and a rule nobody can predict is worse than one that is simply stated.
What the tenant is about to pay is on the confirm screen before they pay it.

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
- **`durationDays` and the discount are not editable** after creation,
  because the waiver documents already record what each redeemer was
  actually given. Make a new code instead.
- **The charge is computed twice, server-side both times.**
  `/api/onboarding/validate-coupon` returns the exact sum for the button,
  including Paystack's fee computed against the *discounted* amount; then
  `create-tenant` recomputes it from the redeemed coupon before accepting
  the payment. The browser never works out its own price. Subtracting a fee
  calculated on the full price would agree only while passthrough is off.

A redeemed code is never deleted, only switched off: it is the only record of
why someone's fee is waived.

`npm run test:coupons` covers the validity edges.

When the window closes the tenant lands in `payment-due` and is prompted to
pay from their own settings page - see below.

## What a tenant owes, and the two directions out of it

`getPlanFeeState` (`lib/fee-waivers.ts`) resolves one of five states, and
the decision itself is `decidePlanFeeStatus`, kept pure so
`npm run test:waivers` can exercise the ordering:

| State | Meaning |
|---|---|
| `no-fee` | The plan has no monthly fee. Never asked for money. |
| `waived` | A live waiver. Shown struck through with its end date. |
| `subscribed` | Paystack is billing them. Offers cancellation. |
| `past-due` | Paystack is retrying a card. **Offers nothing.** |
| `payment-due` | Never subscribed, cancelled, or a waiver that has closed. Starts a grace window; see below. |

Two orderings are load-bearing. A free plan and a live waiver both outrank
whatever `subscriptionStatus` happens to say, so a comped tenant is never
chased. And `past_due` is deliberately not `payment-due`: Paystack is already
retrying and will resolve it, so prompting the tenant as well would take a
second payment for the same period.

Nothing is stored. A waiver closing writes nothing anywhere - the clock moves
and the answer changes - so no job has to run on time for a tenant to be
billed correctly.

### Paying, from `payment-due`

The settings page offers "Continue your plan", which runs the same Paystack
Inline charge against the same Plan code that onboarding uses, and therefore
establishes the subscription the skipped signup charge never did. The verify
step repeats onboarding's two checks: the amount must match the plan plus the
expected fee, and the payment must belong to the caller's own email.

`paystackSubscriptionCode` is deliberately **not** written here. The
`subscription.create` webhook populates it, routed by subscription code
through `subscriptionIndex`, which is the whole reason that index exists.

### The grace window, and what stops when it closes

`payment-due` used to gate nothing at all - a tenant behind on their plan fee
kept selling vouchers indefinitely, and the `plan-fee-due` email was the
entire mechanism. A tenant who took a free trial and then ignored the email
had the whole product for nothing, permanently.

It now starts a clock. `PlanFeeState` carries three more fields, all derived
at read time like the rest of this file:

| Field | Meaning |
|---|---|
| `dueSince` | When the debt started: the latest of the last waiver's end, the last `nextBillingDate`, and the account's creation - whichever has already passed. |
| `locksAt` | `dueSince` plus `PlatformConfig.planFeeGraceDays` (default 3). |
| `locked` | Whether that moment has arrived. |

**Nothing is stored, and no job enforces this.** A tenant locks because the
clock moved past `locksAt`, and unlocks on the next request after they pay,
with nothing to unwind. `resolvePaymentDueSince` takes the *latest* candidate
on purpose: taking the earliest would give a tenant whose trial ended in March
and who then paid for April no grace at all when April lapsed.

`npm run test:waivers` walks the boundary, including the inclusive edge
(exactly `locksAt` is locked) and the rule that `past-due` can never lock -
Paystack is mid-retry on a card there, and cutting a tenant off for our own
impatience would be taking the payment and the business.

**Three emails, all from the `plan-fee-due` cron**, which is the only thing
that tells an owner any of this: `owner.plan_fee_ending` before a waiver
closes, `owner.plan_fee_due` when it has (carrying the exact date sales
pause), and `owner.plan_fee_locked` when that date arrives. The last is sent
from a scan over tenants rather than over waivers, because a tenant who
cancelled a subscription never had one - see `docs/cron-jobs.md`. If that job
is not registered, a tenant goes from trading to not selling with no email at
any point.

**What a lock does** is in `lib/billing-lock.ts`, and the short version is:
new voucher sales stop at the portal, and every owner write is refused with a
402. Vouchers already sold are untouched - they are hotspot users on the
tenant's own router and keep working whether this app is reachable or not.
Reading anything still works, because the sales figures are the argument for
paying. Billing itself is exempt, or the lock would have no exit.

**It is not `Tenant.status = "suspended"`.** That flag makes
`requireTenantOwner` call `notFound()`, which would lock the owner out of the
page where they could pay, and it blacks out the tenant's public pages, which
punishes their customers rather than them. Suspension stays the manual
platform-level action it always was.

The window is a platform setting rather than a per-plan one
(`PlatformConfig.planFeeGraceDays`, edited at `/superadmin/config`): it is the
same promise to every tenant, and a grace period that varied by tier is a
difference nobody can explain on a support call. Zero is legitimate and means
the lock lands the same day. **Shortening it applies immediately to every
tenant already past due**, so it can pause accounts the moment it is saved.

### Paying before a waiver ends

A tenant inside a trial or promo can settle up early, and this is deliberately
*not* the same charge as the one above.

Opening the Paystack Plan would subscribe them today, which charges today and
throws away the free days they are paying to keep. So `GET` returns
`mode: "prepay"` with an amount and **no plan code**, the browser opens a plain
one-off charge stamped `metadata.purpose = "plan_fee_prepay"`, and the `POST`
that verifies it creates the recurring subscription server-side with
`start_date` set to one interval after the waiver closes
(`createPaystackSubscription`). The month they just bought covers the first
month after the free window; renewal picks up from there.

Two consequences worth knowing:

- **The webhook has to stand back.** `charge.success` for the platform
  normally means "paid now, due in thirty days" and moves `nextBillingDate`
  accordingly. For a prepayment that would bring the next charge forward past
  the month they bought, so the handler checks that metadata and breaks early,
  leaving the dates to the billing route.
- **Scheduling needs a reusable card token.** Bank transfer and USSD charges
  are not tokenised, and `verifyPaystackPayment` returns
  `authorizationCode: null` for them. The month is still recorded and the
  response carries `scheduled: false` with a notice saying renewal is not set
  up - rather than failing a payment that already succeeded, or leaving the
  tenant believing they are on autopay when they are not.

### Changing plan, as the owner

`PATCH /api/admin/billing/plan` is the third way out of an unpaid fee, and is
deliberately **not** behind the billing lock. A tenant who cannot afford their
tier has to be able to reach a cheaper one, or the only remaining option is to
abandon the account - which collects nothing and loses the customer.

It is not the onboarding flow, and reusing that was considered and rejected:
`create-tenant` grants a fresh waiver whenever the chosen plan has
`trialDays`, so a tenant bounced back through it would collect a new free
month on every lapse, and its bank step would re-create a subaccount they
already have. What *is* reused is `Step2ChoosePlan`, so a plan card reads the
same whether you are choosing it at signup or switching to it two years in.

**The commission moves here, unlike in the superadmin equivalent.** That one
leaves Paystack alone on purpose, because editing plans is bulk work that must
never silently move money for everyone on a tier. This is one tenant, acting
for themselves, who was shown the new rate before confirming - and leaving the
split behind would mean an owner on a cheaper tier keeps paying the old
commission on every voucher until somebody notices. The subaccount is updated
first and the plan only changes if that succeeded, so the two can never
disagree.

**Downgrading below current usage is allowed, with an acknowledgement.** The
tenant who needs a cheaper plan is usually the one already over its limits -
that is generally why they were on the larger tier. Refusing would put them
back to "pay or leave", so `lib/plan-change.ts` names what freezes instead and
the dialog requires a tick. Nothing is deleted: limits are enforced at
*creation*, so the third router keeps serving customers and they simply cannot
register a fourth. `maxCustomers` is the sharper one, because it is checked
before a sale - existing customers keep buying, new ones cannot until fewer
than the limit have bought in the last 30 days. The
server re-measures usage at `PATCH` time rather than trusting the counts the
dialog was rendered from. `npm run test:plan-change` covers it, including the
`null`-means-unlimited case that would otherwise report every unlimited plan
as a breach of everything.

### Cancelling, from `subscribed`

Same card, same dialog. It disables **the tenant's own platform
subscription**, read from their tenant document - never resolved from the
Paystack customer code, which is shared with every addon subscription they
own, so cancelling by customer would take their captive portal down with
their plan.

Paystack needs an `email_token` to disable a subscription and only returns it
at creation time, which this app never stored, so the subscription is fetched
first to read it.

The route writes **nothing** to Firestore. The `subscription.disable` webhook
already sets `subscriptionStatus` and sends the cancellation email; a second
writer would mean drift or two emails. The dialog says the cancellation was
sent rather than pretending the page is already updated.

Cancelling is "will not renew", not "stopped now" - they keep the period they
paid for. The dialog says so, with the date, and requires typing the business
name, because this is a billing action people take by accident.

## Test mode vs. live mode - a one-way door

Paystack keeps test and live keys, and every object created under them (Subaccounts, Plans, Customers), **completely separate**. Switching a deployment from test keys to live keys means:
- Every tenant's cached `paystackPlanCode` (created under test keys) is now invalid and must be cleared so it gets recreated fresh under live keys the next time it's needed.
- Existing test-mode tenants/subscriptions genuinely don't exist on the live side - they can't be "migrated," only recreated.

This already happened once in this project's history - switching live required a one-off script to null out every tenant's stale `paystackPlanCode`/`paystackPlanAmount` for exactly this reason.
