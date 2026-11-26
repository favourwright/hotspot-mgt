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

`PAST_DUE_GRACE_MS` is 3 days: an addon whose paid period has run out keeps working
that much longer, so a venue's wifi does not go dark the minute a month ends while the
owner is paying for the next one.

| Status | Entitled? |
|---|---|
| `active`, period ahead | Yes |
| `active`, period passed | Only inside the grace window |
| `past_due` | Only inside the grace window (Paystack-era records only) |
| `cancelled` | Until the end of the period already paid for (Paystack-era records only) |
| `expired` | No |

Payments write only `active` with a period end; the clock decides the rest. An `active`
entitlement past its `currentPeriodEnd` lapses after the grace window whatever its
status says, so a payment that never came cannot become permanent free access.

`npm run test:entitlements` covers 14 cases over this table, with no Firestore.
Run it after touching any of it.

## How an addon is paid for

Like the plan (`docs/billing-and-payments.md`, Flow 2): one-off payments through Knomad
Pay, recorded in `billingCharges/{reference}` before the checkout opens
(`lib/billing-charges.ts`). Nothing renews by itself.

- **A subscription addon** is bought a period at a time (a month, or a year). Paying
  extends the entitlement's `currentPeriodEnd` from where the paid time ends, or from
  the payment if it has lapsed, and it can be renewed in the period's last week
  (`quoteAddonPeriod`, `lib/billing-periods.ts`). A few days before it runs out the
  owner gets `owner.addon_renewal_due` from the `plan-fee-due` cron.
- **A one-time addon** is bought once and never expires.

`POST /api/admin/addons/[key]/checkout` starts the payment at the addon's live price;
the marketplace leaves for Monnify's checkout, which comes back to the tenant's
`/payment-return`, which reports the reference to
`POST /api/admin/billing/charges/[reference]`. Knomad Pay's event and the
`payment-reconcile` cron apply it too if that never arrives.

## Why a payment can't be faked

The browser names a reference and nothing more. What the payment is for (which tenant,
which addon, what price) was recorded by the server when it was started, and
`confirmBillingCharge`:

1. **asks Knomad Pay**, which has checked the payment with Monnify (reference, amount
   asked and paid, currency) before calling it succeeded;
2. **checks the amount and the payer** against the record, so a charge started for one
   thing cannot be read as another;
3. **only the owner of the tenant it was started for** can report it;
4. **applies it once**, in a transaction that flips the record to `applied`, so two
   reporters, or a replayed reference, cannot buy a second period.

The entitlement is deliberately **not** a boolean on the tenant document.
`/tenants/{id}` was owner-writable from the browser until recently, meaning one
`updateDoc` would have granted every paid addon for free. `entitlements` and
`billingCharges` are closed to the client in both directions. → `docs/auth-and-security.md`

## What is and isn't actually gateable

Worth being honest about, because it shapes what is worth selling.

The captive-portal **install automation** is convenience. A competent tenant can
point `html-directory` at their own page in Winbox by hand, and no amount of
server-side checking prevents that.

The **hosted portal page** at `{slug}.ogawifi.online/portal` is the real moat.
It runs on our infrastructure, it is where checkout and the sale's split
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
| `lib/addons.ts` | Catalog reads, superadmin pricing |
| `lib/entitlements.ts` | `getEntitlementState`, `hasAddon`, `requireAddon`, grace window |
| `lib/billing-charges.ts` | Starting a payment, and applying it once |
| `lib/billing-periods.ts` | What a payment buys: the period rules |
| `scripts/seed-addons.mts` | Safe seeding, and grandfathering |
| `scripts/test-entitlements.mts` | The grace-window table, no Firestore needed |
| `app/api/admin/addons/[key]/checkout` | Starting an addon payment |
| `app/api/admin/billing/charges/[reference]` | The dashboard reporting a payment |
| `app/api/superadmin/addons` | Pricing, keyed by addon |
