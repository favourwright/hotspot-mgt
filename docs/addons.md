# Addons

Assumes you've read `docs/glossary.md` and `docs/billing-and-payments.md`.

An addon is a feature sold separately from the billing plan. A tenant either
has one or they don't, and code asks that question at the point where the
feature is used. The addons are `captive-portal`, `api-access` and
`voucher-generation` (`docs/voucher-generation.md`, which also has a metered
quota and credits on top of the on/off gate).

**Addons are independent of platform access.** A tenant can be fully paid up on
their billing plan and have a lapsed addon, or the reverse. Nothing in the
addon path reads `tenant.subscriptionStatus`, and nothing in the platform
billing path reads an entitlement. Keeping those two lifecycles separate is why
the webhook had to change (see "The webhook collision" below).

## The three pieces, and why they're separate

| Piece | Lives in | Changes how |
|---|---|---|
| **Which addons exist** | `lib/addon-catalog.ts` | A code change |
| **What each one costs** | Firestore, `addons/{key}` | A superadmin, at `/superadmin/addons` |
| **Who has one** | Firestore, `tenants/{id}/entitlements/{key}` | Only the server, from a verified payment |
| **Which plans bundle one** | Firestore, `billingPlans/{id}.includedAddons` | A superadmin, in the billing-plan dialog |

This is the same split as `lib/email-catalog.ts`, for the same reason, but the
argument is stronger here. An email catalog entry that vanished from a database
would break a `sendEmail()` call. An addon key that no code references does
something worse: it produces a feature that is listed, sellable and chargeable
while enforcing nothing anywhere.

That is not hypothetical. `BillingPlanFeatures` already defines
`customBranding`, `apiAccess` and `prioritySupport`. All three are editable in
the billing-plan dialog, and all three were checked in **zero** places in
this codebase. `apiAccess` has since been replaced by the `api-access`
addon (`lib/api-access.ts`), which plans bundle through `includedAddons`;
`customBranding` and `prioritySupport` are still unchecked. Allowing addons to be created from the UI would be a machine for
producing more of them, which is why `/superadmin/addons` has no create or
delete button.

## Adding a new addon

Five steps, three of them code. Budget a deploy.

**1. Add the key to `lib/addon-catalog.ts`.**

```ts
export const ADDON_KEYS = ["captive-portal", "sms-vouchers"] as const;

export const ADDON_CATALOG: Record<AddonKey, AddonCatalogEntry> = {
  // ...
  "sms-vouchers": {
    name: "SMS Vouchers",
    description: "Send voucher codes by SMS as well as email.",
    gates: ["POST /api/voucher/send-sms refuses without it"],
  },
};
```

Keep `gates` honest. It is rendered on the superadmin page so whoever sets a
price can see the blast radius without reading the code, and a gate added later
without updating this is visibly undocumented rather than invisible.

**2. Call the gate**, at the top of the route handler, after authentication and
before any side effect:

```ts
const { tenantId } = await verifyOwnerWithTenant(authHeader);
await requireAddon(tenantId, "sms-vouchers");
```

`requireAddon` takes `AddonKey`, not `string`, so a typo is a compile error
rather than a gate that silently matches nothing and blocks every tenant
forever. Catch `AddonRequiredError` and return **402**, not 403: this is "not
paid for", not "not allowed", and the client renders a buy prompt off that
distinction.

Hiding the button in the UI is presentation. The route is the boundary. If the
feature also has a hosted surface (as the captive portal does), gate that too:
a tenant can stop paying after the install already happened, and the route gate
alone would never notice.

**3. Deploy.** The addon now exists, with no document, which resolves to
not-entitled for everyone. Nothing is broken yet because nothing had it.

Then run:

```bash
npm run check:internal-plan
```

Company-owned accounts are comped by sitting on a plan that bundles every
addon, so a key added here and not added to that plan's `includedAddons`
takes the feature away from your own accounts the moment it is priced -
silently, the same way grandfathering being skipped does. The check reads
live Firestore and fails if an internal plan has fallen behind the catalog.

**4. Price it** at `/superadmin/addons`. Free, one-time, or subscription.

**5. Grandfather, if anyone is already using the feature.** See below. This
step is the one that causes an outage when skipped.

## Grandfathering: the step that bites

`getEntitlementState` fails closed. An addon with no entitlement resolves to
not-entitled, which is correct and is also why **adding a gate to an existing
feature takes it away from everyone currently using it, the moment you price
it.**

This has already happened once on this platform. The `captive-portal` gate was
deployed, the addon was set to one-time ₦20,000, and `starlinkkonnect`'s live
portal immediately started serving "Sign-in is unavailable" to the venue's wifi
customers, who could no longer buy vouchers. The fix took one command, but
nobody knew it was needed until someone looked.

```bash
npm run addons:seed                  # safe default: creates missing addons as FREE
npm run addons:seed -- --grandfather # BEFORE pricing: grants existing users a permanent entitlement
```

The default mode creates any unconfigured addon as `free`, which is
behaviourally identical to having no gate at all, so the deploy in step 3 is
never the thing that breaks. `--grandfather` currently knows how to find
captive-portal users (locations with `portalInstalledAt` set); a new addon
gating an existing feature needs its own equivalent query added to
`scripts/seed-addons.mts`.

Charging should start with new customers, not by taking something away from
people who already had it.

## How entitlement is decided

`lib/entitlements.ts`, one resolver, one gate, so there is a single place to
audit when asking "can this be bypassed". Three rules in order:

1. The addon's pricing model is `free`. On for everybody, no entitlement
   document exists at all, which keeps "turn this on for everyone" a one-field
   change rather than a backfill across every tenant.
2. The tenant's billing plan lists the key in `includedAddons`. Never written
   to the entitlement collection, so changing a plan's bundle takes effect
   immediately, and removing a key only withdraws the free grant. It can never
   revoke an addon a tenant separately paid for.
3. Otherwise there must be an entitlement document whose status still allows
   access.

Anything unexpected resolves to not-entitled. The two ways this can be wrong
are not symmetrical: wrongly denying a paying tenant is a support ticket,
wrongly granting is the paywall not existing.

### Status, and the grace window

`PAST_DUE_GRACE_MS` is 3 days. Paystack retries a failed invoice over several
days and fires `invoice.payment_failed` on the **first** attempt, not the last,
so treating that first signal as the end would black out a venue's wifi over a
card that was going to clear on retry.

| Status | Entitled? |
|---|---|
| `active`, period ahead | Yes |
| `active`, period passed | Only inside the grace window |
| `past_due` | Only inside the grace window |
| `cancelled` | Until the end of the period already paid for |
| `expired` | No |

Two behaviours in there look like bugs and are not:

- **`past_due` with no `pastDueSince` stays entitled.** That timestamp is ours
  to write, so its absence means our own data is wrong, and denying a paying
  tenant over our own missing field is the worse failure.
- **An `active` subscription past its `currentPeriodEnd` still lapses.** The
  status alone is not trusted, so a webhook we never received cannot become
  permanent free access.

`npm run test:entitlements` covers 14 cases over this table, with no Firestore.
Run it after touching any of it.

## The webhook collision

The thing most likely to go wrong, and the reason the webhook was rewritten.

A tenant has exactly **one** Paystack customer code. Their platform
subscription and every addon subscription they buy all carry it, differing only
by `subscription_code` and `plan_code`. The webhook originally resolved every
subscription event by customer code alone. With addons in play that meant:

- an addon's `subscription.create` overwrote `tenant.paystackSubscriptionCode`,
  silently severing platform billing from its real subscription;
- an addon's failed invoice marked the whole tenant `past_due`;
- an addon renewal sent a platform renewal email.

So events are routed by subscription code through `subscriptionIndex/{code}`
(`lib/subscription-index.ts`), a single get-by-id with no composite index and no
chance of two matches. `subscription.create` is the one event the index cannot
cover, because it is what populates it, so that is attributed by
`plan.plan_code` instead: every addon owns its Paystack Plan exclusively.

When ownership cannot be established the webhook **does nothing and logs**.
Guessing "it must be the platform subscription" is precisely the bug this
exists to prevent, and a no-op leaves money uncollected where a wrong guess
corrupts a billing record.

There is also a deliberate ordering race: Paystack can deliver
`subscription.create` before the browser returns the reference to
`/api/admin/addons/[key]/activate`. The index row is written either way, and
activation reads it back via `findSubscriptionForAddon`, so the entitlement ends
up linked regardless of which lands first.

## Why a payment can't be faked

`/api/admin/addons/[key]/activate` treats the browser's reference as a claim and
nothing more. In order:

1. **Verified against Paystack.** A reference is just a string until Paystack
   confirms it, and the status must be `success`.
2. **The amount must cover the addon's live price.** Without this a tenant
   could initialise their own 100 kobo charge and present that reference.
3. **The payer's email must be the tenant's owner email.** This is what stops
   one tenant replaying another's genuine reference, which would otherwise pass
   checks 1 and 2 perfectly.
4. **The reference is claimed exactly once**, by a Firestore `create` on
   `addonPayments/{reference}` that fails if the document already exists. Two
   concurrent requests cannot both win, and a reference cannot be re-presented
   later to extend a subscription for free.

Only then is anything written.

The entitlement is deliberately **not** a boolean on the tenant document.
`/tenants/{id}` was owner-writable from the browser until recently, meaning one
`updateDoc` would have granted every paid addon for free. `entitlements` is
closed to the client in both directions, as are `subscriptionIndex` and
`addonPayments`. → `docs/auth-and-security.md`

## What is and isn't actually gateable

Worth being honest about, because it shapes what is worth selling.

The captive-portal **install automation** is convenience. A competent tenant can
point `html-directory` at their own page in Winbox by hand, and no amount of
server-side checking prevents that.

The **hosted portal page** at `{slug}.ogawifi.online/portal` is the real moat.
It runs on our infrastructure, it is where checkout and the Paystack split
happen, and it is re-checked on every single request. An entitlement that lapses
stops the portal earning immediately, whatever is on their router.

So `uninstall-portal` is deliberately **ungated**: a lapse should never trap
someone's router in a state they cannot undo.

The customer-facing paywall page says nothing about billing. Its audience is the
venue's wifi customers, not the venue, and announcing to a room of strangers
that this business has not paid its bill would be a gratuitous humiliation on
top of an outage. The owner finds out through the admin UI and their email; the
real reason goes to the server log.

## Files

| File | What it owns |
|---|---|
| `lib/addon-catalog.ts` | Which addons exist, and what each gates |
| `lib/addons.ts` | Catalog reads, superadmin pricing, Paystack Plan sync |
| `lib/entitlements.ts` | `getEntitlementState`, `hasAddon`, `requireAddon`, grace window |
| `lib/subscription-index.ts` | Subscription code to platform-or-addon |
| `scripts/seed-addons.mts` | Safe seeding, and grandfathering |
| `scripts/test-entitlements.mts` | The grace-window table, no Firestore needed |
| `app/api/admin/addons/[key]/activate` | The only place an entitlement is granted |
| `app/api/superadmin/addons` | Pricing, keyed by addon |
