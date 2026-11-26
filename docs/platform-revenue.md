# Platform revenue

Assumes `docs/glossary.md` and `docs/billing-and-payments.md`.

What tenants have actually paid the platform, as opposed to what their plans
say they should pay (MRR). One ledger, `platformRevenue`, with one entry per
payment the platform keeps money from. Reports read only the ledger.

## Why a ledger, not a sum of every source

Money is recorded in several places: `billingCharges` (plans, addons,
signups), the credit ledger (manual top-ups), `payments` (sale commission).
Summing each one directly works until the second question: every source
needs a query per time window, every query needs its own index (a missing
one took the tenant dashboard down once already, `docs/decisions-and-gotchas.md`),
and every new way of paying means editing every report. With a ledger, a new
way of paying is one new writer, and the reports do not change.

It is also the fix for the gap that started it: addon payments were shown
nowhere, and "Subscription revenue" was MRR, worked out from `monthlyFee`,
so a tenant who had stopped paying looked the same as one who had paid.

## An entry

`platformRevenue/{id}`, built by `lib/platform-revenue.ts` (pure, tested by
`npm run test:platform-revenue`):

| Field | What |
| --- | --- |
| `source` | `plan` (a signup is a plan payment), `addon`, `credits`, `commission` |
| `kind` | Finer: `plan` or `signup`, the addon key, `manual`, `split` or `unsplit` |
| `tenantId` | Who paid |
| `amountKobo` | What the platform keeps: the price. Negative for a refund |
| `feeKobo` | Processing fee passed on to the payer, kept by the gateway |
| `method` | `knomadpay`, or `manual` for money taken off-platform |
| `reference` | The billing charge, or the credit ledger entry, it came from |
| `occurredAt` | When it was paid, as near as the writer knows |

## The rules every writer keeps

- **Same transaction or batch as the record of the money.** A charge is
  never `applied` without its entry, or the reverse.
- **The id is what it came from** (`revenueEntryId`): the charge reference,
  `credit_<ledger entry id>`, or `sale_<payment reference>`. Written with `set`, so a re-run rewrites
  the same entry instead of failing the payment beside it.
- **Never edited.** A refund or correction is a new, negative entry.
- **The price, not the amount charged.** `billingCharges.amountKobo` includes
  the passed-on fee, which the platform does not keep.

## Writers

| Where | What |
| --- | --- |
| `applyPlanCharge`, `applyAddonCharge` (`lib/billing-charges.ts`) | In the transaction that flips the charge to `applied` |
| `prepareSignupClaim`'s claim | In create-tenant's batch, dated at the claim (the gateway's paid time is not carried that far) |
| `adjustCredits` (`lib/voucher-generation.ts`) | A manual grant with an amount paid, in its transaction |
| Fulfilment's `createPayment` (`lib/voucher-fulfilment.ts`) | The sale's commission, in one batch with the payment document |

**Commission rides the payment document.** The runner builds the entry
(`saleRevenue`, from the same three cases `paymentDocument` records) and
hands both to `createPayment`, which commits them as one batch. So the step
order, and every crash-resume guarantee `npm run test:fulfilment-ledger`
proves, is unchanged: that test now also checks one entry per sale, for the
platform's share, after a crash at every step. An unknown split writes no
entry, as the payment writes a null share: never a zero. A payment that
already exists (an earlier attempt that died before recording it) has its
entry written on its own, which is also how sales from before the ledger
are covered if one is ever resumed.

**Gross sales and their count stay on `payments`.** Those are the tenant's
own sales, not money the platform kept.

**Online credit top-ups**, when built, are a billing charge of a new kind
and get their entry the same way, through `applied`.

## Reading

`getPlatformRevenue` (`lib/firestore-helpers.ts`, cached 60s): plans,
addons and credits, all time and since the 1st of the month in Lagos.
`getPlatformStats`: commission, all time and today. `getTenantEarnings`:
each tenant's commission and everything else they paid, separately, for the
billing table. The tenant-and-source queries are served by Firestore merging
the `tenantId` and `source` indexes; `check:indexes` confirms they run. Every one filters and
sums, so each has a composite index in `firestore.indexes.json` and an
`aggregate` case in `check:indexes`.

**Plans and addons start on 2026-11-25**, when they moved to Knomad Pay.
Earlier payments were held by Paystack, whose account is closed, and were
never stored in Firestore, so there is nothing to backfill them from. The
page says so. **Commission goes back to the first sale**: every payment
document is here, and the backfill matched the old `payments` total exactly.

## Reconciling

`npm run revenue:reconcile` compares every applied charge, every credit
grant with an amount, and every successful sale with a known share against
the ledger, and lists entries missing, entries
whose tenant or amount differs, and entries with no source. `--apply`
writes the missing ones and nothing else. Run it after adding a writer, and
whenever the billing page looks wrong: a forgotten writer is how money goes
missing from reports, and this is what finds it.
