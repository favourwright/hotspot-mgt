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
| `vouchers/{gen-<batchId>-<username>}` | The voucher, from first use. `source: "generated"`, `userId`/`userEmail` null | router-health |
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

## Security

- **Codes have a floor of 8 characters, 10 for digit-only.** A hotspot login
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

- **Buying top-ups.** Waits for the payment service. It will post a credit
  grant with a provider reference to the same ledger; nothing else changes.
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
