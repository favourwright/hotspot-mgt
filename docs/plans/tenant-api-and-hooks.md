# Plan: tenant API, decision hooks and event webhooks

*Written 2026-10-29. Status: **designed, nothing built**. This is a plan of
action, not a description of the system: when a phase ships, move what is true
into the area docs (`docs/billing-and-payments.md`, `docs/data-model.md`, ...)
and delete that phase from here.*

This plan comes out of a long design review. Every round of that review found
bugs in the previous round's fixes, so the rule for this plan is: **no more
design rounds. Each phase is built as real code with its tests, and the code is
what gets reviewed.** Where the review made assumptions that the code turned
out to contradict, section 1 records the correction so nobody reintroduces it.

---

## 0. What we are building, in order

| Phase | What | Why this order | Size |
| --- | --- | --- | --- |
| 1 | Resumable fulfilment ledger | Fixes a **live money bug** that exists today, independent of everything else | M |
| 2 | Server-side checkout initiation (`pendingPurchases`) | Makes any pre-purchase gate enforceable rather than advisory; closes client-controlled metadata | M |
| 3 | Pre-purchase decision hook (`voucher.pre_purchase`) | The differentiator. Smallest vertical slice of "tenant logic runs before a sale" | L |
| 4 | Public REST API v1 (API keys, read endpoints) | Machine access to tenant data | L |
| 5 | Outbound event webhooks | Push instead of poll; replaces the "post-purchase hook" idea | M |
| 6 | Docs (OpenAPI), polish, write endpoints | Only once 1-5 are real | M |

Phases 1 and 2 are worth doing **even if hooks and the API are never built**:
they fix real ways a paying customer can be stranded today.

Hard gate between phases: a phase is not done until its test scripts pass, its
docs are moved into the area docs, and (for 3, 4 and 5) the SSRF and auth test
tables pass. **No tenant can save a hook URL or webhook URL until the Phase 3
SSRF suite passes.**

---

## 1. Corrections from reading the code

The review converged on a design while assuming a serverless Next.js app with
server-side Paystack initialization. The code says otherwise. These override
anything in the conversation that disagrees.

1. **Hosting is one long-lived process, not serverless.** `next start` under
   systemd on the VPS (`docs/deployment.md`). Consequences:
   - **No Redis, Upstash or QStash.** Rate limits, breaker state and caches
     live **in process memory**, which is the pattern the codebase already
     uses (`lib/doc-cache.ts`, `lib/router-config.ts`). Redis earns its place
     only if the app ever runs as more than one process (a second VPS, pm2
     cluster mode), because then each process would hold its own counters.
     Keep every limiter and breaker behind a small interface so that swap
     touches one file. See section 3a for the rules in-memory state follows
     here.
   - `after()` from `next/server` (stable since 15.1, project is on Next
     16.3.4) works under `next start` with no `waitUntil` shim. But work queued
     in `after()` is lost if the process restarts mid-task, so **anything that
     must happen** (webhook deliveries, review records) goes through Firestore,
     not memory.
2. **Paystack is opened client-side with Inline v2** (`hooks/use-paystack.ts`,
   `popup.newTransaction(config)`), and **the browser generates the
   reference**: `hs_${Date.now()}_${userId.slice(0, 8)}` in
   `components/shared/checkout-dialog.tsx`, a MAC-derived suffix in
   `components/portal/portal-checkout-dialog.tsx`. Subaccount, bearer and
   `transaction_charge` are also set in the browser from server-computed
   values. So today, anyone with the public key can open a charge with any
   metadata.
3. **References are `hs_<millis>_<suffix>`**, not `ogw_`. Paging in
   `lib/transactions.ts` splits the cursor on the *first* underscore, so any
   new suffix must contain no underscore (hex is fine).
4. **The amount check is `plan.price + estimatePaystackFee(...)`**, built by
   `computeCheckoutSplit` in `lib/paystack-fees.ts`. Any pending record stores
   that number, never `plan.price`.
5. **Fulfilment has three drivers**, not two: `/api/payment/verify`, the
   `charge.success` webhook, and the `payment-reconcile` cron
   (`lib/cron-jobs.ts`). All three call `fulfilVoucherPurchase`. Any change
   must keep all three reaching the same decision.
6. **Router offline is already handled**: a failed provision writes a
   `"failed"` voucher, notifies both sides and lands in the Failed Queue for
   `/api/voucher/retry`. No `paid -> provisioned -> fulfilled` state is needed.
7. **The deterministic payment id plus `create()` is the right race guard**
   and stays. The new ledger state rides on that same document.
8. **Renewals are not a separate path.** A renewal is an ordinary purchase
   that `resolveVoucherAction` turns into `extend`, inside the same
   fulfilment. They pass through the same gate automatically; there is no
   "renewal exemption" to design.
9. **There are no free plans** (`price: z.number().int().positive()`) and **no
   owner-issued vouchers** (`app/api/admin/vouchers/route.ts` is GET only).
   The only voucher-writing path outside fulfilment is
   `/api/voucher/retry`, which re-provisions an existing failed voucher and is
   not a sale. So the elaborate "exempt" mechanism from the review is not
   needed. One ESLint/grep guard (Phase 2) is enough.
10. **Customers are per-tenant** (`TENANT_COLLECTIONS.customers`). No
    cross-tenant uid problem.
11. **`BillingPlanFeatures.apiAccess` already exists and is checked nowhere**
    (`docs/decisions-and-gotchas.md`). Phase 4 either wires it or replaces it
    with an addon; it must not stay a flag that enforces nothing.

---

## 2. Decisions needed from you

These are product decisions. Each blocks the phase named, not the ones before
it. My recommendation is first.

| # | Decision | Recommendation | Blocks |
| --- | --- | --- | --- |
| D1 | Has a tenant actually asked for hooks or an API? | Ask the top tenants before Phase 3. Phases 1-2 go ahead regardless. | 3, 4 |
| D2 | For the motivating age case: built-in or hook? | Ship a built-in **date of birth at signup + per-tenant minimum age** first if that is all anyone asks for. Hooks are for logic we cannot know. | 3 |
| D3 | A successful charge arrives with **no pending record**, after cutover | Do not auto-fulfil. Write a `paymentReviews` record, alert superadmin, decide refund by hand. Legacy references from before cutover are still fulfilled. | 2 |
| D4 | A charge whose amount or currency does not match its pending record | Same as D3: review record, no voucher, no silent drop. | 2 |
| D5 | Hook payload PII | Send `uid` and `email` only. No phone, no device MAC. Add a line to the privacy policy (NDPA). | 3 |
| D6 | How hooks and the API are sold | One addon per capability via `lib/addon-catalog.ts`. Gate *creating and editing*, never *executing* (see 5.9). If priced, grandfather first (runbook 5b). | 3, 4 |
| D7 | Can the API create vouchers without a Paystack charge? | No, not in v1. It bypasses the platform commission and needs its own pricing decision. | 6 |
| D8 | Re-check hooks on renewals? | Yes, renewals are purchases and run the hook like any other. A tenant who wants otherwise filters by plan. | 3 |

D3 and D4 deliberately depart from "a payment that already succeeded is never
undone". It is not undoing a sale: it is declining to honour a charge that our
server never authorised. That needs its own line in
`docs/decisions-and-gotchas.md` when Phase 2 ships, or someone will "fix" it.

---

## 3. Invariants every phase keeps

- `tenantId` comes from a verified token, an API key record, or a
  server-written pending record. Never from a URL, body or charge metadata.
- Money that moved is never silently dropped. Every refusal after a
  successful charge leaves a durable record and an alert.
- Every fulfilment step is resumable from what Firestore says, not from what
  the caller says.
- Every new query is bounded (`limit()`), every new list pages the way
  `lib/transactions.ts` does, and `npm run check:indexes` passes.
- Nothing tenant-supplied is fetched except through `safeFetch` (Phase 3).
  Router calls in `lib/mikrotik.ts` stay completely separate: private
  WireGuard addresses are legitimate there and must never be allowed here.
- Secrets: names only in logs, diffs and output. Never a value.
- No em dashes or en dashes in code, comments, docs or commit messages.

---

## 3a. Gotchas this plan must not repeat

Each of these has already happened in this codebase or follows directly from
a rule it holds. Each phase's review checks them.

**In-memory state**
- **Bound every map.** The VPS has 956 MB and an OOM in its history
  (`docs/cron-jobs.md`). Every limiter, breaker and cache map has a size cap
  with eviction and a periodic sweep of expired entries. An unbounded
  `Map<keyId, counters>` keyed by anything attacker-controlled (a uid, a
  forged key id) is a memory leak on demand: only create an entry **after**
  authentication succeeds.
- **Restarts are routine.** Every deploy restarts the process and systemd has
  `Restart=always`, so breakers close and limits reset several times a week.
  That is acceptable for limits. It is not acceptable for emails: a breaker
  that re-trips after each restart must not re-send "your hook is failing".
  Stamp the alert in Firestore (`breakerAlertedAt` on the hook) and act on
  transitions, the way the crons do.
- **Reuse `lib/doc-cache.ts`** for hook config and API key records rather
  than a new cache. Its contract is "every writer must invalidate", so the
  hook CRUD routes and the key revoke route invalidate, and **revocation is
  immediate** instead of "within 60 seconds".

**Firestore**
- **Rules first.** New collections are denied by default (no wildcard match
  in `firestore.rules`), but each one gets an explicit `allow read, write: if
  false` block with a comment, as `reconcileSkips` and `addonPayments` have.
  This codebase has twice shipped a rule that let a client escalate
  (`/tenants/{id}`, `/users/{uid}`). Nothing here is client-readable.
- **Customers and owners can read payment documents** (`payments` rule).
  So nothing secret goes on a payment doc: not voucher passwords, not hook
  decisions, not ledger internals. That is why the Phase 1 ledger lives in a
  separate server-only collection.
- **Read quota.** The whole app has been taken down by the daily read quota
  (`8 RESOURCE_EXHAUSTED`) from query frequency, not data size. A public API
  hands that frequency to tenants' scripts. Every API request is at most one
  bounded query, list responses are short-lived cached per tenant, and each
  tenant has a daily request cap sized against the project's quota, not
  against what feels generous.
- **Register every new query shape** in `scripts/check-firestore-indexes.mts`
  and run `npm run check:indexes`. A missing composite index passes `tsc`,
  build and tests and fails only in production.

**Email and cron**
- **The three email rules hold** (`docs/emails.md`): sends never throw, an
  unconfigured template is a silent skip, sends are awaited. So emails are
  awaited, never put in `after()`; `after()` is only for logs we can afford
  to lose.
- **A new email does nothing until its Mailtrap template is pasted.** The
  breaker-tripped and payment-review emails are operational, so: mark them
  non-optional in the catalog, add an `open-items.md` entry until they are
  live, and make sure the same state is visible in the UI (hooks page,
  superadmin reviews page) so nothing depends on the email arriving.
- **`ok: false` from a cron goes nowhere.** The `webhook-deliver` job and the
  reconcile job's review records must alert through an email, not through the
  job's return value.
- **A new cron job is not scheduled by deploying it.** It needs adding on
  cron-job.org (runbook 5c), behind `x-cron-secret`.

**Money and gates**
- **An addon only enforces anything if a route calls `requireAddon` with its
  key.** `apiAccess` is the existing example of a flag that gates nothing.
  Add a test asserting each new addon key is referenced by at least one gate.
- **The reconcile cron fulfils any charge with voucher metadata.** At the
  Phase 2 cutover it must switch to the pending record in the same deploy,
  or it will helpfully issue vouchers for the unauthorised charges D3 says
  must go to review.
- **The webhook resolves voucher sales before subscription routing.** Keep
  the pending-record lookup inside that existing branch; subscription and
  addon charges share the Paystack customer code and must never reach it.

**Small but real**
- API timestamps are ISO 8601 UTC. `formatDate`/`formatDay` (Africa/Lagos) are
  for display only.
- Before trusting any lint-based guard, confirm `npm run lint` actually
  reaches rules: it once crashed on every file for weeks. This plan uses CI
  greps for its guards for that reason.
- New references keep the `hs_<millis>_<hex>` shape; paging splits on the
  first underscore.

---

## 4. Phase 1: resumable fulfilment ledger

> **Status 2026-10-29: built, not reviewed, not deployed.** Code in
> `lib/fulfilment-runner.ts` and `lib/voucher-fulfilment.ts`, tests in
> `npm run test:fulfilment-ledger`, area docs updated. Where the build
> differs from the design below:
>
> - The ledger has two states, `started` and `complete`. "Needs review" is
>   not a ledger state; refused charges never get a ledger and go straight to
>   `paymentReviews`.
> - A renewal's ledger stores the full RouterOS patch and voucher document,
>   not just the action: recomputing them on a resume would extend twice.
> - The webhook answers 503 only for `in_progress`. Other errors still answer
>   200 as before, with the reconcile cron as the backstop; the transient
>   error allowlist is not built.
> - The superadmin page is at `/superadmin/payment-reviews`. The
>   stranded-payment listing script (4.6) was dropped from this update.
> - Concurrency between two live callers is covered by the pure
>   `nextLedgerAction` table and the `create()` guard, not by a test against
>   real Firestore.

### 4.1 The bug

`lib/voucher-fulfilment.ts` writes the payment document (`paymentRef.create`)
**before** any router work. If the process dies between that `create()` and
`voucherRef.set()`:

- the next caller (browser retry, webhook replay, reconcile cron) finds the
  payment via the `paystackReference` query and returns
  `ok: true, outcome: "already", voucherId: undefined`;
- nothing ever resumes, and nobody is told.

The `code === 6` race branch has the same flaw: the loser returns "already"
while the winner is still working, and the winner can still crash. This is a
smaller copy of the 2026-10-11 incident in the file header.

Related gaps found while reading, fixed in the same phase:

- `payment-reconcile` reads **only the first page** of Paystack transactions
  (`perPage=100`, no paging). A day with more than 100 successful charges
  across the platform silently skips the rest.
- `verifyPaystackPayment` and the reconcile list fetch have **no timeout**.
- Every refusal before `paymentRef.create()` (tenant missing, plan missing or
  inactive, amount mismatch, location inactive, router inactive) returns
  `fail(...)` after the money moved, stores nothing, and tells nobody. The
  reconcile cron then re-tries it every 15 minutes for 24 hours and gives up.
- No currency check.
- `paymentData.status !== "success"` is unreachable (the helper already fails
  on it). Remove it.
- Customer counters increment before router work; a resume must not count
  twice.
- (The review also claimed a throwing `notify*` call could turn a sale into a
  500. It cannot: `lib/notifications.ts` returns rather than throws, per the
  email rules. No change needed; keep them awaited.)

### 4.2 The ledger: `fulfilments/{reference}` (top-level, server-only)

A separate collection, not fields on the payment doc, for three reasons:
customers and owners can read payment docs through `firestore.rules`, and the
ledger holds the voucher password; revenue sums `payments`, so ledger
internals should not live on revenue rows; and the legacy "payment exists ->
already" checks keep working unchanged.

```ts
{
  reference, tenantId,
  state: "started" | "complete" | "needs_review",
  leaseUntil: Timestamp,        // now + 2 minutes, renewed by the holder
  attempts: number,
  // The decision, persisted BEFORE the router is touched:
  intent: {
    action: "mint" | "revive" | "extend",
    voucherId: string,          // pre-allocated doc id, never regenerated
    username: string,
    password: string,
    previousVoucherId: string | null,   // for extend / superseded marking
  },
  bookkeepingApplied: boolean,  // customer counters done
  paymentWritten: boolean,
  notifiedAt: Timestamp | null,
  createdAt, deleteAt           // 90 days, purged by the reconcile cron (Spark: no TTL)
}
```

`create()` on this doc (id = reference) becomes the race guard. The payment
doc is still written at its deterministic id with `create()`, now at step 6,
so exactly one exists per charge and it appears only for a sale we honoured.

Why the action is persisted: `extendVoucher` marks the old voucher
`"superseded"`, so re-running `resolveVoucherAction` on a retry would see
different history and choose a different action than the first attempt.

Refused charges go to `paymentReviews` (4.4), never to `payments`.

### 4.3 The step sequence

`fulfilVoucherPurchase` becomes a small state machine. The decision of what to
do next is a **pure function**, `nextFulfilmentStep(paymentDoc, now)`, so it
can be tested exhaustively without Firestore or a router.

1. **Look up** the ledger doc by reference, and the payment doc by
   deterministic id (not by query).
   - payment doc exists with no ledger doc -> legacy sale, `already` as today.
   - `complete` -> return the voucher (`outcome: "already"`).
   - `started`, lease live -> return `outcome: "in_progress"`. The verify
     route answers 202 and the browser polls; the webhook answers 503 so
     Paystack retries; the cron skips.
   - `started`, lease expired -> claim the lease in a transaction (compare
     `leaseUntil`, bump `attempts`) and resume at step 4.
   - `needs_review` -> return the same generic message as a bad reference.
   - Legacy payment doc with no `voucherId`: the stranding bug's footprint,
     handled by the one-off script (4.6).
2. **Verify** with Paystack (10s timeout), check status, amount, currency
   `NGN`, buyer, tenant, plan, location and router exactly as today. Any
   refusal here writes `paymentReviews` and alerts (4.4).
3. **Decide and claim in one write**: run `resolveVoucherAction`, generate or
   reuse credentials, pre-allocate the voucher doc id, then `create()` the
   ledger doc with `state: "started"`, the `intent`, and a lease. That
   `create()` is the race guard; the loser sees `started` and follows step 1.
4. **Bookkeeping** in a transaction that flips the ledger's
   `bookkeepingApplied` from false to true and increments the customer
   counters in the same transaction.
5. **Router**, idempotent and keyed by the persisted intent:
   - mint/revive: look the username up first; a user that exists with our
     platform-managed comment is success, not a collision.
   - extend: already writes absolute expiry and byte cap
     (`docs/decisions-and-gotchas.md`), so re-running it is safe. Marks
     `previousVoucherId` superseded.
   - router unreachable: unchanged behaviour, a `"failed"` voucher for the
     Failed Queue. That still counts as `complete` for the ledger: the sale is
     recorded and the existing retry path owns it.
6. **Record**: `set()` the voucher on the pre-allocated id, `create()` the
   payment doc (code 6 = already written, fine), then flip the ledger to
   `complete`. Order matters: the voucher and payment exist before anything
   says the sale is done.
7. **Notify** (awaited, as now), then set `notifiedAt`. A resume that finds
   `complete` with `notifiedAt: null` sends them; one that finds it set does
   not, so a crash costs at most a duplicate email, never a missing one.

Nothing here is a Firestore transaction spanning the router call. It is a
persisted-intent pattern: write what you are about to do, do it idempotently,
record that it is done.

### 4.4 `paymentReviews`

Top-level collection, doc id = reference, so repeated arrivals are one record.

```ts
{ reference, tenantId | null, kind, detail, amountKobo, currency,
  chargedEmail, createdAt, resolvedAt: null, resolution: null }
// kind: "amount_mismatch" | "currency_mismatch" | "tenant_missing"
//     | "plan_inactive" | "location_inactive" | "router_inactive"
//     | "unauthorised_charge" (Phase 2) | "no_buyer"
```

- Superadmin email on first write (a new email: Mailtrap template plus ID,
  `docs/emails.md`, and an `open-items.md` entry until it is pasted).
- `payment-reconcile` treats an existing review as handled, like
  `RECONCILE_SKIPS`, instead of retrying it all day.
- A minimal superadmin list page with "fulfil anyway" and "mark refunded".
  Fulfil anyway calls the same `fulfilVoucherPurchase` with an override
  recorded on the review.

### 4.5 Call sites

- `/api/payment/verify`: handle `in_progress` (202) and keep its response
  shape otherwise.
- Webhook `charge.success`: on `in_progress` or a transient error, return
  **503** so Paystack retries. Return 200 only after the outcome is durably
  recorded (payment doc or review). Define transient as an allowlist: network
  errors, Paystack 5xx, Firestore `UNAVAILABLE`/`DEADLINE_EXCEEDED`.
  Everything else is permanent and has already written a review.
- `payment-reconcile`: page through all results, add a timeout, and also pick
  up ledger docs stuck in `started` with an expired lease (a bounded query
  on `state` + `leaseUntil`, registered in `check:indexes`).

### 4.6 Migration

No backfill of existing payments: a payment doc with no ledger doc is a
legacy sale and is read exactly as today. One script (repo root, deleted
after, bounded with `limit()` per tenant) lists payment docs with no
`voucherId`, which are sales stranded by the current bug, for a human to
resolve. Expect zero or very few.

### 4.7 Tests (`scripts/test-fulfilment-ledger.mts`, `npm run test:fulfilment-ledger`)

- Table test of `nextFulfilmentStep` over every state x lease x field shape.
- Crash injection: the fulfilment steps take an injectable "stop after step
  N" hook; for each N, a second call must finish the job with exactly one
  voucher, one router user, one counter increment and one set of emails.
- Replay: the same reference through verify, webhook and reconcile in any
  order produces one voucher.
- Concurrency: two callers at once; one completes, the other gets
  `in_progress` or `already`, never a second voucher.
- Each refusal kind writes exactly one `paymentReviews` record.

---

## 5. Phase 2: server-side checkout initiation

> **Status 2026-10-29: built, not reviewed, not deployed.** Code in
> `app/api/purchase/initiate`, `lib/pending-purchases.ts`,
> `lib/charge-authority.ts`, `lib/purchase-eligibility.ts`,
> `lib/rate-limit.ts`; both checkout dialogs resume a server-created
> transaction. Tests: `npm run test:purchase-initiate`,
> `npm run check:checkout-paths`. Where the build differs from the design:
>
> - The cutover is a switch on the superadmin Config page that stores the
>   moment it was turned on (`serverCheckoutRequiredSince`), and "before
>   cutover" is judged by Paystack's `paid_at`, not the reference.
> - The pending record also stores `priceKobo` and `feeKobo`, so the split
>   check uses what was agreed rather than today's plan.
> - The guard is `check:checkout-paths` (no browser code opens its own
>   voucher charge). The broader "nothing else writes vouchers" grep was not
>   built: voucher documents are legitimately updated by several crons.
> - `/api/tenant/[slug]/checkout-amount` is no longer called by anything.
>   Left in place; remove it in a later cleanup.
> - The bypass, tamper and ownership cases are covered by the pure tests
>   and the code paths, not by an end-to-end test against real Paystack.

### 5.1 Shape

```
Browser                         Server
POST /api/purchase/initiate --> auth (resolvePurchaser)
  { tenantSlug, planId,         per-user rate limit
    locationId, intent,         checkPurchaseEligibility()
    deviceMac?, deviceIp? }     [Phase 3: decision hook]
                                computeCheckoutSplit()
                                reference = hs_<millis>_<16 hex>
                                write pendingPurchases/{reference}
                                Paystack POST /transaction/initialize
                     <--------  { reference, accessCode, amount }
popup.resumeTransaction(accessCode)
  ... customer pays ...
POST /api/payment/verify { reference }  (webhook and cron in parallel)
```

Inline v2 supports `resumeTransaction(accessCode)`, so the popup UX on the
portal and storefront stays the same. Only the place the transaction is
created moves.

### 5.2 `checkPurchaseEligibility` (`lib/purchase-eligibility.ts`)

One function, called by `can-purchase`, `checkout-amount` (or its
replacement), `getPortalCheckoutConfig` and `initiate`, so they cannot drift:

- tenant exists and is not billing locked (`isTenantBillingLocked`);
- plan exists, is active, belongs to the tenant;
- location is active and its router is active;
- `maxCustomers`, counting only a buyer with no customer record yet.

`can-purchase` keeps returning the reuse/renew `options` preview on top.

### 5.3 `pendingPurchases/{reference}` (top-level)

```ts
{ reference, tenantId, userId, userEmail, planId, locationId,
  intent, deviceMac, deviceIp,
  amountKobo, transactionChargeKobo, currency: "NGN",
  subaccountCode, bearer,
  hookDecision: { hookId, requestId, allowed } | null,   // Phase 3
  createdAt, expiresAt,   // logical: createdAt + 30 min, for UI only
  deleteAt }              // createdAt + 90 days, purged by the reconcile cron
```

- **Expiry is logical.** A charge that lands after `expiresAt` with a
  matching amount is still fulfilled: the money moved. Purging keys on
  `deleteAt`, never on `expiresAt`, so the record survives for reconciliation.
- The Paystack initialize call sends exactly what the browser sends today:
  lift `amount`, `email`, `reference`, `subaccount`, `bearer`,
  `transaction_charge` and the metadata keys (`planId`, `locationId`,
  `tenantId`, `userId`, `intent`, `deviceMac`, `deviceIp`) **from the current
  code in both checkout dialogs**, not from memory. The metadata stays so the
  webhook and the reconcile cron can still find the tenant before reading the
  pending record. Add `npm run test:split` coverage that the server call and
  the old client config produce the same split.

### 5.4 Fulfilment reads from the pending record

After cutover, `fulfilVoucherPurchase` takes a `reference` and reads plan,
location, tenant, buyer, intent, device and amount **from the pending
record**. Request bodies and charge metadata are ignored for anything that
decides money or ownership.

- Charge amount must equal `amountKobo`, currency `NGN`, reference must match.
  Mismatch -> `paymentReviews` (D4).
- `/api/payment/verify` requires the signed-in uid to equal
  `pending.userId`, with the same generic error as a bad reference. The
  documented exception that verify trusts a client-asserted `tenantId` goes
  away; update that gotcha line.
- No pending record: reference minted before the cutover timestamp -> legacy
  path (today's behaviour). After cutover -> `paymentReviews` kind
  `unauthorised_charge`, no voucher (D3).

### 5.5 Remove the client-side path

- Delete reference generation and the direct `newTransaction` config from
  both dialogs.
- A guard so nothing else can open a voucher charge or write a voucher: a
  CI grep (`npm run check:voucher-writers`) failing if `newTransaction(` or a
  write to `TENANT_COLLECTIONS.vouchers` appears outside an allowlist
  (`lib/voucher-fulfilment.ts`, `app/api/voucher/retry/route.ts`, the
  addon/billing flows that open non-voucher charges). Grep, not an ESLint
  rule: `no-restricted-imports` has no per-file allowlist option and is
  bypassed by dynamic imports.

### 5.6 Rate limits

In-memory sliding window (`lib/rate-limit.ts`, interface allows a shared store
later): `initiate` 10/min per uid. No per-tenant cap on `initiate` itself: that
would throttle a tenant's own busy evening.

### 5.7 Ops

- Expiry of `pendingPurchases` past `deleteAt`: the project is on Spark, so
  no Firestore TTL policy. Extend `purgeExpiredLedgers` in the reconcile cron
  to cover it, bounded per tick.
- `npm run check:indexes` for any new query.
- Deploy order: server routes first (both paths accepted), then the client
  switch, then set the cutover timestamp once no legacy checkouts are open
  (an hour is plenty). **The webhook, verify route and reconcile cron all
  switch to the pending record in the same deploy as the cutover**: the
  reconcile cron in particular fulfils anything with voucher metadata today,
  and left alone it would issue vouchers for unauthorised charges.
- The cutover timestamp is a `PlatformConfig` field read through its
  existing cache, not an env var, so it can be set without a rebuild.

### 5.8 Tests (`npm run test:purchase-initiate`)

- Bypass: a successful charge with no pending record after cutover produces a
  review and no voucher, via verify, a signed webhook, and the cron.
- Tamper: amount, currency, plan or uid differing from the record.
- Late payment past `expiresAt` with a matching amount is fulfilled.
- Ownership: another signed-in user presenting the reference gets the generic
  error and no credentials.
- Eligibility parity: `can-purchase` and `initiate` agree on every case.

---

## 6. Phase 3: pre-purchase decision hook

Runs inside `initiate`, after eligibility and before Paystack. If it blocks,
no charge is ever created, so no refund is ever needed.

### 6.1 Scope of v1

- One event: `voucher.pre_purchase`.
- **At most one active hook per tenant per event.** No chaining, so no
  ordering or shared-budget problems.
- Optional `planIds` / `locationIds` filters (null = all).
- No `modifications`, `finalAmount` or `metadata` in the response. The tenant
  never touches the price or the split.

### 6.2 Schema: `tenants/{tenantId}/hooks/{hookId}`

```ts
{ id, name, event: "voucher.pre_purchase", url,
  secretCiphertext, secretKeyVersion,      // AES-256-GCM, see 6.6
  previousSecretCiphertext, previousSecretExpiresAt,  // rotation overlap
  timeoutMs,            // default 2000, max 2500
  failStrategy: "block" | "allow",   // required, chosen explicitly
  planIds: string[] | null, locationIds: string[] | null,
  active, createdAt, updatedAt, createdBy }
```

Breaker state and counters are in memory, not on this document (no hot doc).

### 6.3 Contract (versioned from day one)

Request, `POST` to the tenant URL:

```
Content-Type: application/json
OgaWiFi-Event: voucher.pre_purchase
OgaWiFi-Request-Id: req_<hex>
OgaWiFi-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
```
```json
{
  "apiVersion": "<release date>",
  "id": "req_...",
  "event": "voucher.pre_purchase",
  "createdAt": "<ISO 8601>",
  "data": {
    "customer": { "uid": "...", "email": "..." },
    "plan": { "id": "...", "name": "...", "priceKobo": 50000 },
    "location": { "id": "...", "name": "..." },
    "purchase": { "intent": "reuse" }
  }
}
```

- The body is stringified **once** and the same string is signed and sent.
- During a secret rotation, two `v1=` values are sent (old and new).
- Tenants must ignore unknown fields; we only add fields within a version.

Response: a **2xx** with a JSON body that is exactly one of

```json
{ "allowed": true }
{ "allowed": false, "reason": "Shown to the customer", "code": "AGE_RESTRICTION" }
```

Anything else is a **failure**, and the hook's `failStrategy` applies: non-2xx
(including 3xx, which is never followed), timeout, body over 10 KB, invalid
JSON, `allowed` not strictly `true` or `false`. A 500 carrying
`{"allowed": true}` is a failure.

`reason`: plain text, trimmed, max 200 characters, rendered as text (never
HTML); empty or oversized falls back to a generic message. `code`:
`[A-Z0-9_]{1,64}` or dropped.

### 6.4 `safeFetch` (`lib/safe-fetch.ts`)

The only way the app fetches a tenant-supplied URL. Built on `undici`
(`Agent` passed as `dispatcher` to undici's own `request`; not `node-fetch`,
whose `agent` option silently ignores an undici Agent).

- Before connecting: `https:` only, port 443 only, hostname not a raw IP in
  any notation (decimal, octal, hex, bracketed IPv6), no credentials in the
  URL.
- Inside the Agent's `connect.lookup(hostname, opts, cb)`: resolve with
  `all: true`, check **every** address, and answer in the shape Node asked
  for (`opts.all` -> array, else address + family). The address checked is
  the address connected to, so DNS rebinding has no window.
- Address check is an **allowlist**: parse with `ipaddr.js` (exact version
  pinned, since `range()` names are the contract), unwrap IPv4-mapped IPv6
  after narrowing on `kind() === "ipv6"`, require `range() === "unicast"`.
  This covers loopback, private, CGNAT, link-local, metadata, multicast,
  reserved, ULA, 6to4 and NAT64 without a hand-kept list.
- One overall deadline covering DNS, connect, TLS, headers and body.
- Body read as Buffers, counted in **bytes**, stream destroyed on overflow,
  decoded once at the end.
- `redirect` never followed; success is `200 <= status < 300`.
- Injectable resolver and transport for tests (a local mock server is,
  correctly, blocked by the real guard).

Save-time URL validation runs the same checks, including resolution, as a UX
courtesy only. The call-time check is the security control.

### 6.5 Execution (`lib/decision-hooks.ts`)

1. Find the tenant's active hook for the event that matches the plan and
   location (through `lib/doc-cache.ts`, invalidated by every hook write
   route, so an edit or disable takes effect on the next purchase).
2. Allowed-decision cache: key `tenantId:uid:planId:locationId`, 10 seconds,
   absorbs double clicks. Blocks are not cached.
3. Per-tenant hook call cap, generous (600/min), alert the tenant at 80%. Over
   the cap, apply the hook's own `failStrategy`: a `block` hook is not
   silently turned off by a traffic spike, which would also hand attackers a
   bypass by flooding.
4. Circuit breaker, in memory per hook:
   - consecutive failure counter, reset on any success (a valid `allowed:
     false` is a success); failures older than 5 minutes age out;
   - trips at 10; while open, apply `failStrategy` without calling;
   - half-open: one probe at a time (in-process mutex), at most every 30s;
     probe success closes the breaker and clears the counter;
   - email the tenant on trip and on recovery, stamped on the hook doc
     (`breakerAlertedAt`, `breakerRecoveredAt`) so restarts, which reset the
     breaker, do not re-send the same alert; the hooks page shows the live
     state whether or not the email template is configured yet.
   A tripped breaker on a `block` hook **pauses sales**. That is the tenant's
   chosen behaviour; the docs and the trip email say so plainly. Nothing ever
   auto-disables a hook.
5. Call log written with `after()`: `tenants/{tenantId}/hookCalls/{id}` with
   request id, outcome, status, latency, error class, `deleteAt` 30 days (purged by cron; the project is on Spark).
   Never the raw response body beyond the parsed fields.
6. The decision (hook id, request id, allowed) is stored on the pending record.

### 6.6 Secrets

- 32 random bytes, shown once at creation and at rotation, never again.
- Stored AES-256-GCM with a key from a new env var `HOOK_SECRETS_KEY`
  (32 bytes, base64), `secretKeyVersion` so the key itself can rotate.
  Decrypt on use; never log either form. Add the var name to
  `npm run env:check` and `docs/deployment.md`; the value goes on the VPS only
  with your sign-off.
- Rotation keeps the old secret valid for 24 hours and signs with both.

### 6.7 Routes (owner auth via `verifyOwnerWithTenant`, `tenantId` from the token)

```
GET    /api/admin/hooks
POST   /api/admin/hooks                 create, returns secret once
PATCH  /api/admin/hooks/[id]            name, url, timeout, strategy, filters, active
DELETE /api/admin/hooks/[id]
POST   /api/admin/hooks/[id]/test       sample payload via safeFetch, 5/min
POST   /api/admin/hooks/[id]/rotate-secret
GET    /api/admin/hooks/[id]/calls      last 100, paged
```

### 6.8 UI

A Hooks page in the tenant admin: create/edit dialog (scrollable content,
`DialogFooter` outside the scroll area, as in `plan-dialog.tsx`), an explicit
fail-strategy choice with the consequence spelled out, the secret-once view,
the test button with the full response, the call log, and breaker state.

### 6.9 Gating (D6)

`requireAddon` on create and edit. **Execution is never gated**: if the addon
lapses, an existing `block` hook keeps enforcing (an age check that turns
itself off because an invoice failed is worse than either alternative). The
tenant can still disable or delete. Grandfather before pricing (runbook 5b).

### 6.10 Tests

- `npm run test:safe-fetch`: hostile table. `localhost` variants, `127.1`,
  `0177.0.0.1`, `2130706433`, `0x7f000001`, `[::1]`, `[::ffff:127.0.0.1]`,
  `169.254.169.254`, `100.64.0.1`, `fc00::1`, `fe80::1`, `64:ff9b::7f00:1`,
  `2002:7f00:1::`, a hostname resolving to a private address, one resolving
  to a mix of public and private, a 302 to an internal address, ports other
  than 443, `http:`. Plus slow-drip body, oversized body, multibyte UTF-8
  split across chunks.
- `npm run test:decision-hooks`: contract (strict boolean, non-2xx with
  `allowed: true`, malformed JSON, reason/code caps), both fail strategies,
  breaker trip / probe / close, over-cap behaviour, signature format checked
  against the documented verifier, and the assertion that a blocked initiate
  creates no pending record and no Paystack transaction.

### 6.11 Tenant documentation (`docs/public/decision-hooks.md`, later the docs site)

Contract, signature verification against the **raw body** with a length check
before `timingSafeEqual`, rejecting timestamps older than 5 minutes or more
than 1 minute in the future, the fail-strategy consequences, "use the
signature, not an IP allowlist", the rate cap, and an age-check example.

---

## 7. Phase 4: public REST API v1

### 7.1 Keys

- Format `ogw_live_<keyId>_<secret>`: `keyId` 16 base62 chars, `secret` 32
  base62 chars (no `_` in either, so splitting is unambiguous).
- `apiKeys/{keyId}` top-level: `tenantId`, `name`, `secretHash` (SHA-256 hex
  of the secret; random high-entropy secrets need no slow hash), `last4`,
  `scopes`, `environment: "live"`, `createdBy`, `createdAt`, `revokedAt`,
  `lastUsedAt`.
- Verification: parse, read by `keyId` through `lib/doc-cache.ts` (the
  revoke route invalidates, so revocation is immediate on this single
  process; the TTL is only the backstop), check environment, compare hashes with
  `timingSafeEqual` after a length check. Every failure is the same 401.
- `tenantId` comes only from the key record.
- `lastUsedAt` and usage counters aggregated in memory, flushed at most once a
  minute per key (no hot document, no per-request write).
- Owner UI: create (shown once), list (name, `ogw_live_<keyId>_...last4`,
  scopes, last used), revoke. Max 10 active keys per tenant.

### 7.2 Request handling (`lib/public-api.ts`)

One wrapper every `/api/v1` route uses: auth, scope check, rate limit, request
id, error envelope, logging. Routes contain only the query.

- Envelope, frozen at v1:
  `{ "data": ..., "nextCursor": "..." | null }` on success,
  `{ "error": { "type", "code", "message", "requestId" } }` on failure.
- Status codes: 200, 201, 400, 401, 403, 404, 409, 422, 429, 500, 503.
- Rate limits: per key and per tenant, in memory, plus a **per-tenant daily
  request cap** sized against the Firestore read quota (section 3a), and a
  short (about 10s) per-tenant cache on list responses so a polling script
  costs one read per window, not one per call; `RateLimit-Limit`,
  `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After` on 429.
- Cursor paging only, the `lib/transactions.ts` way (`createdAt` +
  `__name__`, cursor split on the first underscore), `limit` max 100. No
  totals: counts cost reads.
- No CORS headers. Server-to-server only.
- Versioning: additive changes within v1; breaking changes are v2;
  deprecations announced with a `Sunset` header.

### 7.3 Scopes and endpoints (read-only first)

| Scope | Endpoints |
| --- | --- |
| `plans:read` | `GET /api/v1/plans`, `GET /api/v1/plans/{id}` |
| `locations:read` | `GET /api/v1/locations` |
| `vouchers:read` | `GET /api/v1/vouchers`, `GET /api/v1/vouchers/{id}` |
| `payments:read` | `GET /api/v1/payments`, `GET /api/v1/payments/{reference}` |
| `customers:read` | `GET /api/v1/customers`, `GET /api/v1/customers/{uid}` |

Never exposed: router IP, user or password; voucher passwords (v1); bank
details; subaccount codes; anything from another tenant. Each resource has an
explicit public serializer, never a spread of the Firestore document.

Confirm against `docs/domain-and-tls.md` that `/api/v1` is served on the main
app host and is not rewritten by subdomain routing.

### 7.4 Gating

Wire it to either `BillingPlanFeatures.apiAccess` or a new addon (D6), checked
at key creation **and** at request time (unlike hooks, an API with a lapsed
entitlement should stop; failing closed here harms nobody's customers).

### 7.5 Tests (`npm run test:public-api`)

Key parsing and the uniform 401, revoked and wrong-environment keys, scope
denials, cross-tenant isolation (a key never reads another tenant's ids),
serializers never emitting forbidden fields, paging walked end to end against
a raw collection read, rate limit headers.

---

## 8. Phase 5: outbound event webhooks

This replaces the "post-purchase hook" from the review: informational events
are one system, decision hooks are another.

- Events (v1): `voucher.issued`, `voucher.renewed`, `voucher.failed`,
  `payment.succeeded`.
- **Outbox in Firestore**, written at the point the fact becomes true (the
  ledger's step 6/7), with a deterministic event id such as
  `voucher.issued:<voucherId>`, so the three fulfilment drivers produce one
  event. `tenants/{tenantId}/events/{eventId}` plus a delivery doc per
  endpoint.
- Delivery: first attempt in `after()`; a new cron job `webhook-deliver`
  every minute retries due deliveries with exponential backoff for about 24
  hours (8 attempts). It must be registered on cron-job.org (runbook 5c).
- Same `safeFetch`, same signature header, an `id` the tenant dedupes on,
  `apiVersion` in every payload.
- Endpoint auto-disables after 3 days of continuous failure (fine here: these
  are informational), with an email. Delivery log and manual redeliver in the
  UI.
- Endpoints: `tenants/{tenantId}/webhookEndpoints/{id}`, max 5, same secret
  handling as hooks.
- Tests: dedupe across the three drivers, backoff schedule, disable rule,
  signature.

---

## 9. Phase 6: documentation, then later work

- OpenAPI 3.1 generated from the zod schemas the routes already validate
  with, served as a static reference page. Guides: quick start with curl,
  verifying signatures, errors, paging, rate limits.
- First write endpoints, each with `Idempotency-Key` from day one (stored
  24h in Firestore, same key + different body = 422). Candidates: plan
  create/update, location active toggle. Voucher creation waits on D7.

Deliberately deferred: SDKs, Postman collection, test mode (real routers get
provisioned, so it needs its own design), field selection, response
`modifications` / price changes, multiple hooks per event, more hook events,
IP allowlists, usage-based billing, anomaly detection.

---

## 10. Cross-cutting checklist

**New dependencies:** `undici`, `ipaddr.js` (exact version pinned).

**New env vars:** `HOOK_SECRETS_KEY` (Phase 3). Never in a `.env.local`;
`npm run env:check` before every build.

**Runbook touchpoints** (`docs/deploy-runbook.md`): new Firestore queries ->
`check:indexes`; cron purges for `pendingPurchases.deleteAt` and
`hookCalls.deleteAt` (no TTL policies on Spark); new cron job `webhook-deliver`; new emails (review
alert, breaker tripped/recovered, rate cap warning, endpoint disabled) need
Mailtrap templates and IDs; any addon price -> grandfather first.

**New test scripts in `package.json`:** `test:fulfilment-ledger`,
`test:purchase-initiate`, `check:voucher-writers`, `test:safe-fetch`,
`test:decision-hooks`, `test:public-api`, plus webhook delivery tests.

**Docs to update as each phase ships:** `billing-and-payments.md` (ledger,
initiate, reviews), `data-model.md` (new collections and fields),
`decisions-and-gotchas.md` (D3/D4, in-memory state, execution-not-gated,
the verify `tenantId` exception removed), `cron-jobs.md`, `emails.md`,
`addons.md`, `auth-and-security.md` (API keys, safeFetch, router fetch kept
separate), plus new `docs/public-api.md` and `docs/decision-hooks.md`.

**Separate finding, not in scope:** `mikrotikRequest` fetches
`http://${routerIp}` with Basic auth and `routerIp` is tenant-supplied.
Consider restricting router IPs to the WireGuard tunnel subnet. Do not route
it through `safeFetch`.

---

## 11. Definition of done, per phase

| Phase | Done when |
| --- | --- |
| 1 | Ledger tests pass incl. crash injection at every step; migration script run; reconcile pages fully; reviews page live; docs moved |
| 2 | Bypass, tamper, late-payment and ownership tests pass; both dialogs use `resumeTransaction`; cutover set; `check:voucher-writers` in CI |
| 3 | SSRF table and contract tests pass **before** the create route is reachable; tenant docs published; addon gated and grandfathered |
| 4 | Isolation and serializer tests pass; entitlement wired; paging walked end to end |
| 5 | Dedupe across all three fulfilment drivers proven; cron registered on cron-job.org |

Deploy only on your go-ahead, following `docs/deploy-runbook.md`; a deploy is
done when `BUILD_ID` matches and the step 4 curls return 200.
