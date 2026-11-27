# Voucher generation

Assumes `docs/glossary.md`, `docs/addons.md` and `docs/billing-and-payments.md`.

Tenants print their own voucher codes and sell them for cash. Built first
while online payments were down (2026-11), and shaped so the move to a
payment service later changes nothing here but where top-up credits come
from.

## The shape in one paragraph

A **batch** document holds every code it will create, with passwords,
before the router is touched. A runner puts them on the router as ordinary
`vc` hotspot users and lists each one in a **per-router index** of unused
codes. Nothing else in the app sees an unused code: no voucher document, no
count, no list, no API, no webhook. When somebody first logs in with one,
the profile's on-login script stamps the expiry into the router comment;
`router-health` notices that against the index and writes an ordinary voucher
document with `source: "generated"`. From then on expiry, close-out, reap,
drift and Recreate treat it like any other login.

## Why unused codes are not voucher documents

The first design gave them a voucher document with a new `"unused"` status.
It was dropped because of what reads `vouchers`:

- **`backfillExpiry` reads at most 500 vouchers with `status == "active"` and
  `expiresAt == null` per router-health tick.** That is exactly what a paid
  but never-used voucher looks like. A tenant printing 1,000 codes stored that
  way would fill the window, and paid vouchers would stop getting their expiry
  synced, in no particular order.
- **`totalVouchers`, the "today" count and the voucher list are unfiltered
  `count()`s and pages.** 1,000 printed cards would show as 1,000 sales the
  moment they were generated.
- **`source` cannot be queried.** Every voucher written before generation has
  no `source` field, and Firestore does not match a missing field with
  `== "purchase"`. Filtering would need a backfill write on every voucher ever
  sold.

Keeping unused codes out of `vouchers` makes all three non-problems. A used
code *should* count as a voucher, and does, from its first login.

## Data

| Where | What | Written by |
| --- | --- | --- |
| `tenants/{id}/voucherBatches/{batchId}` | Plan and location snapshot, every code with its password and status, the quota it cost, lease and attempts | Server only |
| `tenants/{id}/generatedCodeIndex/{routerId}` | `entries: ["USERNAME:batchId", ...]`, every unused code on that router | Server only |
| `tenants/{id}/generationUsage/{cycleKey}` | `used`: plan allowance drawn this billing cycle | Server only |
| `tenants/{id}/credits/voucher-generation` | `balance`: top-up credits on hand | Server only |
| `tenants/{id}/creditLedger/{id}` | Every change to a balance: grant, deduct, consume, release | Server only, never edited |
| `vouchers/{gen-<batchId>-<username>}` | The voucher, from first use. `source: "generated"`, `userId`/`userEmail` null, `cashSaleKobo` the price it sold at | router-health |
| `tenants/{id}.generatedCodeFormat` | Length, characters, prefix, password mode | The owner |
| `billingPlans/{id}.limits.maxGeneratedVouchers` | Codes per billing cycle; `null` unlimited, **default 0** | Superadmin |
| `platform/config.voucherGeneration` | `maxBatchSize` (max 500), `maxUnusedPerRouter` (max 10,000) | Superadmin |

The firestore rules deny the client everything already, so none of these is
reachable from a browser.

**The index is an array, not a map, on purpose.** A map key is a Firestore
field; a document holds at most 20,000 fields and 40,000 index entries, which
a busy router would hit before the 1 MiB size limit. The `entries` field is
exempted from indexing in `firestore.indexes.json`, and `maxUnusedPerRouter`
tops out at 10,000 so the document stays under half a megabyte.

**`maxGeneratedVouchers` defaults to 0, not null.** Every other limit uses
`null` for unlimited and defaults to it. Doing the same here would have given
every existing plan unlimited generation the moment the field shipped.

## Who configures what, at runtime

- **Superadmin, `/superadmin/addons`:** prices the `voucher-generation` addon
  (free, one-time or subscription), or leaves it a draft. Unconfigured means
  nobody has it.
- **Superadmin, billing-plan dialog:** "Generated codes per billing cycle",
  and "Included Addons" to bundle the addon into a plan.
- **Superadmin, tenant billing dialog:** grant the addon to one tenant, and
  grant or deduct credits with a reason. While payments are down this is how
  a top-up is sold: the tenant transfers, a superadmin grants.
- **Superadmin, `/superadmin/config`:** the batch and per-router ceilings.
- **Owner, `/admin/generate`:** code format, generate, print, export, void.

## Quota

`lib/voucher-generation-rules.ts`, all pure and tested.

- **Cycle:** the tenant's billing cycle, anchored on `nextBillingDate` and
  stepped by the plan's interval (a yearly plan gets a year-long cycle and its
  allowance is per year). A tenant with no billing date (free, usage-only,
  comped) is anchored on `tenant.createdAt`. Days clamp (an anchor on the 31st
  is the 30th in April and back on the 31st in May). A renewal that moves
  `nextBillingDate` on by one interval does not move the boundaries.
- **Drawing:** the cycle's allowance first, because it is lost at the end of
  the cycle, then credits, which never expire. A request the two together
  cannot cover is refused whole, never partly granted.
- **Reserved, then settled:** a batch's cost is taken in the transaction that
  creates it, so two batches at once cannot overspend. Codes that never reach
  the router are given back when the batch finishes, credits first (the last
  drawn, and the ones a tenant paid for), exactly once (`released` flips in
  the same transaction).
- **Voiding gives nothing back.** A printed code may already have been sold,
  and void-then-regenerate would otherwise mint for free.

## The runner

`lib/voucher-batch-runner.ts`, modelled on `lib/fulfilment-runner.ts` and
deliberately not the same ledger: that one carries payment rules (payment
written last, auto-login, receipts) that mean nothing here.

- **Leased** (3 minutes, extended after every chunk of 10), so the request
  that created the batch, the owner's page polling it, and `router-health`
  can all try to run it and only one does.
- **Runs after the response** (`after()`), because a few hundred codes over a
  WireGuard tunnel take longer than the proxy waits.
- **Index before status.** A code is added to the index before the batch
  records it as unused, so a code the batch calls unused is always one the
  activation sweep is watching.
- **"Is this one ours?" is answered by the password**, which was random and
  never left the batch document. That is how a resume, or a create whose
  answer was lost, recognises its own user; a user under the same name with
  another password is somebody else's, and the code is renamed.
- **A router that stops answering interrupts the run, it does not fail the
  codes.** The lease is dropped so the next poll or tick resumes it. After
  `MAX_BATCH_ATTEMPTS` (6) runs the remainder fails and its quota comes back.

`npm run test:voucher-generation` crashes the runner after every side effect
in turn and proves a resume ends with each code on the router once, indexed
once, and quota released once.

## Readers that had to learn about a voucher with no buyer

`Voucher.userId` and `userEmail` are nullable for `source: "generated"`.
Checked, and changed where needed:

- `voucher-expiry` reminder: already skipped vouchers with no email.
- `/api/voucher/retry` (also Recreate): does not email a generated code.
- `/api/voucher/[id]` and `/usage`: compare `userId` to the caller; null never matches.
- `/my-vouchers`, renewal, `lastVoucherForDevice`: keyed on `userId` or
  `deviceMac`, both null, so a generated code is never renewed onto or
  greeted as somebody's.
- Hotspot user detail dialog, voucher list, failed queue: show "Generated
  code" where the email would be.
- Public API and webhooks: `source` added, `customerUid`, `customerEmail` and
  `paymentReference` nullable. Generated codes emit no webhook events: they
  are not sales the platform saw.
- Drift view: an unused code is a router-only `vc` row, which raises no drift.

## Revenue

A generated code is sold for cash, so its money is never in `payments`, and
it would be missing from every revenue figure if it were not counted
separately.

- **Counted at first use, not at generation.** A printed card is stock, not a
  sale: it may never sell, be lost, or be voided. First use is the only point
  the platform knows a code was sold, and it is already when a generated code
  starts counting as a voucher, so the counts and the revenue agree. A card
  sold today and first used tomorrow counts tomorrow.
- **At the price the batch recorded.** The batch snapshots the plan's price
  (`plan.priceKobo`); activation copies it onto the voucher as
  `cashSaleKobo`. A later price change does not rewrite what was earned.
- **Beside `payments`, never in it.** A payment carries splits, receipts,
  webhooks and reconciliation that mean nothing for cash. The dashboard
  shows online and cash added together, split underneath; superadmin shows
  cash sales per tenant in their own column, with no commission, because
  none passed through the platform. The platform earns from generation
  through the addon, the allowance and credits instead.
- **Summed without a `source` filter.** Only generated vouchers carry
  `cashSaleKobo`, and `sum()` skips documents without the field, the same
  way platform commission skips payments from before `platformShareKobo`. It
  rides aggregations `getTenantStats` already ran, so it costs no extra read.
  The "today" one still needs a composite index (`createdAt`,
  `cashSaleKobo`): summing a field under a range filter on another does.
  Shipping without it took the tenant dashboard down until it was added.
- **Batches from before the price was recorded** are priced by
  `npm run generation:backfill-prices` from the plan's price at the time of
  the backfill: an estimate for a plan repriced since.

## Stock on hand

The generate page shows unused codes and what they sell for at their
batches' prices. Stock, not revenue: nothing counts as sold until first use.

Every write of a batch's codes goes through `codesWrite`, which also writes
`unusedCount` and `unusedValueKobo` on the batch, so the figure is two
`sum()`s over the batches instead of a read of every code. Two aggregations,
not one with two sums, because two sums at once need a composite index.
Writing the codes anywhere else would let the totals drift from them.

## Credit top-ups as platform income

While top-ups are sold by transfer, a superadmin granting credits can enter
what the tenant paid. It is stored on the ledger entry as
`amountReceivedKobo`, grants only (a deduct is a correction, not a refund),
and the same transaction writes a `credits` entry on the platform revenue
ledger, which is what the billing page's "Credit top-ups" reads
(`docs/platform-revenue.md`). An online top-up must not set it: its entry
comes from its billing charge, and would be counted twice.

## Buying credits online

A billing charge of kind `credits` (`lib/billing-charges.ts`), through the
same checkout, return page, Knomad Pay event and reconcile cron as a plan or
an addon. Nothing about it is new except what applying it does.

- **Priced at runtime.** `platform/config.voucherGeneration.creditPriceKobo`
  per credit and `minCreditPurchase`, on `/superadmin/config`. A price of 0,
  the default, keeps credits off sale, and the page keeps saying to ask.
  One purchase is capped at `MAX_CREDIT_PURCHASE` (10,000).
- **Owner only, with the addon.** Credits only generate codes, so the
  checkout route (`/api/admin/voucher-generation/credits/checkout`) refuses
  a tenant without it. The price is worked out there, never sent by the page.
- **Applied once, in one transaction** (`applyCreditsCharge`): the charge
  flips to `applied`, the balance goes up, a `purchase` entry goes on the
  credit ledger with id `charge_<reference>`, and the charge's revenue entry
  is written. Three reporters racing add the credits once.
- **Never `amountReceivedKobo`.** That is for money taken off-platform. The
  purchase's money is the charge, and its revenue entry counts it.
- **A receipt** (`owner.purchase_received`, also sent for addons) with the
  new balance, from the call that applied it.
- **Found on the page tenants already use.** "Buy credits" on the Top-up
  credits card of Generate codes, and the return page comes back there.

## Security

- **Codes have a floor of 6 characters, 10 for digit-only.** A hotspot login
  has no rate limiting and no lockout, and every unused code is a live login
  on the router, so a short code space is a guessable one. The page shows how
  guessable a format is.
- No 0/O or 1/I/L in lettered codes: they are typed off paper.
- Passwords live in the batch document and the voucher document, both
  server-only. Export and print happen in the owner's browser from the batch.

## Gates

`requireAddon("voucher-generation")` on generating only. Reading, exporting
and voiding are never gated, and codes already printed keep working: a lapse
must not strand cards a tenant has already sold. Generating also requires an
unlocked account (`requireUnlockedOwner`); voiding does not.

## Not built yet

- **Auto-void of old unused codes.** Deliberately not done: codes stay until
  the owner voids them.

## Files

| File | What |
| --- | --- |
| `lib/voucher-generation-rules.ts` | Cycle, quota and code arithmetic |
| `lib/generated-code-alphabets.ts` | The alphabets, client-safe |
| `lib/voucher-batch-runner.ts` | Putting a batch on the router; activation matching |
| `lib/voucher-generation.ts` | Firestore and router wiring |
| `lib/voucher-generation-http.ts` | 402 for the addon, everything else |
| `app/api/admin/voucher-generation` | Quota, format |
| `app/api/admin/voucher-batches/**` | List, generate, detail (and resume), void |
| `app/api/superadmin/tenants/[id]/generation-credits` | Quota and credit ledger; grant or deduct |
| `components/admin/voucher-generation-client.tsx` | The owner's page |
| `components/superadmin/generation-credits-panel.tsx` | Credits in the tenant billing dialog |
| `scripts/test-voucher-generation.mts` | The tests |
