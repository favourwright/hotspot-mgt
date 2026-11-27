# Architecture

Assumes you've read `docs/glossary.md`. This doc answers: what does this product actually do, who uses it, and how is the code organized to serve them.

## What this product is

A multi-tenant SaaS platform that lets hotspot/Wi-Fi businesses sell internet access vouchers online. A hotspot business ("tenant") signs up, connects their MikroTik router(s), defines pricing plans, and their customers can then visit that tenant's own portal, pay with Paystack, and instantly receive hotspot login credentials - no cash, no manual voucher handling.

The platform itself (not any one tenant) also charges tenants for using it, via a configurable set of billing plans (flat monthly fee, a percentage of each sale, a hybrid of both, or free).

## The three roles, and what each one can actually do

See the glossary for the definitions - this is what each role's experience actually looks like in the app:

**Customer** - browses a specific tenant's public portal (`/{tenantSlug}`), picks a plan, pays on Monnify's checkout (through Knomad Pay), immediately gets a hotspot username/password. Can view their own purchase history (`/{tenantSlug}/my-vouchers`) across any tenant they've bought from - one account works everywhere on the platform.

**Owner** - logs into their own tenant's admin area (`/{tenantSlug}/admin`): dashboard stats, manage routers (register new ones, including the whole WireGuard setup wizard - see `docs/router-and-wireguard.md`), manage locations, manage plans, view vouchers and payments, retry any that failed, see their own business/billing settings.

**Superadmin** - logs into `/superadmin`: sees every tenant, can suspend/activate a tenant's account, full CRUD over billing plans, platform-wide config (WireGuard server settings, who bears the payment fee, and whether it is passed on). Can also *view* (read-only) any individual tenant's admin area for support purposes, but can never perform an owner-only action (create a router, edit a plan, etc.) on a tenant's behalf.

## Request flow - how a page actually gets built and served

This matters because the project had a real security bug stemming from getting this wrong (see `docs/auth-and-security.md`), so it's worth being precise:

1. A browser requests a URL, e.g. `/starlinkkonnect/admin/routers`.
2. `proxy.ts` (Next.js's middleware) runs first, for *every* request. In this app it does almost nothing useful - it only distinguishes "is the first URL segment a known platform route (`/admin`, `/auth`, `/superadmin`, etc.) or a tenant slug," and even that distinction isn't used for any actual security decision. It does **no authentication or authorization** - that's a deliberate (if easy to miss) property of this app's design, not an oversight: the comment in the code literally says to let the page/layout below handle validation.
3. The matching **server component** (a `page.tsx` or `layout.tsx` under `app/`) runs on the server. For anything under `/admin` or `/superadmin`, this is where real authorization now happens - it reads the session cookie, verifies it, checks the role, and only *then* fetches any data from Firestore. (This wasn't always true - see `docs/auth-and-security.md` for the incident where it wasn't, and what that cost.)
4. The server component passes whatever data it fetched as props into **client components** for anything interactive (tables with edit/delete buttons, dialogs, forms).
5. The client components hydrate in the browser and take over for any further interaction - further mutations go through `app/api/...` route handlers, which independently re-verify the caller's identity and role (never trusting anything the server component already decided, since API routes can be called directly, bypassing the page entirely).

## Folder tour

```
app/                   Every page and API route - see below
components/
  ui/                   shadcn/ui primitives (button, dialog, table, ...)
  admin/                Tenant-admin-only components (routers/locations/plans tables, dialogs)
  superadmin/            Superadmin-only components
  tenant/                Tenant-facing shared pieces (nav, sidebar, customer home)
  auth/                  Login/register forms
  shared/                Used across more than one of the above (checkout dialog, empty states)
hooks/                  TanStack Query hooks - one file per resource (use-routers.ts, use-plans.ts, ...)
services/               Thin wrappers around fetch/axios calls to this app's own API routes
lib/                    Everything else server-adjacent: Firebase setup, Firestore helpers, Knomad Pay
                        client, MikroTik client, WireGuard manager client, auth helpers, session
                        cookie verification, tenant-ownership checks
stores/                 Zustand stores (auth state, onboarding wizard state)
providers/              React context providers wired up once near the root (auth listener, query client)
types/schemas.ts        Every Zod schema - the single source of truth for data shapes, see docs/data-model.md
deploy/                 systemd service file + nginx config for the production VPS
vps/wg-manager/         A separate, small Python service that runs on the VPS itself to manage
                        WireGuard peers at the OS level - not part of the Next.js app, deployed
                        and run independently (see docs/router-and-wireguard.md and docs/deployment.md)
```

### The `app/` tree, by who it's for

```
app/
  page.tsx                          Public landing page
  faq/page.tsx                      Public FAQ
  (auth)/auth/page.tsx              Login/register (shared by every role)
  (onboarding)/onboarding/...        The "become a tenant" signup wizard
  [tenantSlug]/
    page.tsx                        A tenant's public customer-facing portal
    my-vouchers/, voucher/           Customer's own purchase history / a single voucher's detail
    admin/                          Owner-only area (superadmin can view) - routers, locations,
                                     plans, vouchers, failed queue, settings, dashboard
  superadmin/                       Superadmin-only area - tenants, billing, billing plans, config
                                     (WireGuard, payment fee defaults, unpaid-fee grace window)
  api/
    auth/                           register, session (cookie mint/clear), check-slug
    onboarding/                     banks, payment, plans, create-tenant, verify-account
    admin/                          Every tenant-owner-scoped mutation/query (routers, locations,
                                     plans, vouchers, stats) - all require an authenticated owner
                                     (or superadmin) token tied to that specific tenant
    superadmin/                     Platform-wide mutations (tenants, billing-plans, stats) -
                                     require an authenticated superadmin token
    tenant/[slug]/                  Public tenant lookup + the can-purchase enforcement check
    payment/verify/                 Server-side payment verification (asks Knomad Pay) + voucher creation
    purchase/initiate/              The only place a voucher charge starts
    webhooks/knomad-pay/            Receives the events Knomad Pay pushes to this app
    voucher/retry/                  Re-attempt a failed MikroTik voucher creation
```

A route group in parentheses, like `(auth)` or `(onboarding)`, is a Next.js convention: it organizes files without becoming part of the actual URL. `app/(auth)/auth/page.tsx` serves `/auth`, not `/(auth)/auth`.

### Account-level notices

A notice that is a *standing condition* - an unconfirmed email address, an
overdue plan fee - goes in the `NoticeStack`
(`components/system/notice-stack.tsx`) and nowhere else. `AdminNotices`
resolves them for owners, `TenantNav` for customers, and the order between
them is decided in one place: money before data quality, because an overdue
fee can stop the business trading and an unconfirmed address cannot.

Inline alerts are the opposite thing - a form that failed, a router that did
not answer - and stay next to what they are about.

**`app/[tenantSlug]/admin/layout.tsx` is a server component purely so this
can fetch.** The guard, the nav and the shell are unchanged in
`components/tenant/admin-shell.tsx`, which is still a client component because
its redirects read the live auth store; the layout renders the notices on the
server and hands them in as a prop. Before this, the plan-fee notice needed
`firebase-admin` and the layout was `"use client"`, so it had been put in the
dashboard page instead - visible on one route, and missing from the settings
page it told owners to go to.

## How client components get fresh data (and the bug that came from doing it halfway)

Every admin table (routers, locations, plans, failed vouchers, dashboard stats) follows the same pattern:

1. The **server component** (`page.tsx`) fetches the initial data once, on first page load.
2. That data is passed as a prop into a **client component**, which uses it to seed a TanStack Query hook (`useRouters(initialRouters)`, etc.) via that hook's `initialData` option - so the first paint is instant, no loading spinner, using data the server already fetched.
3. Any create/edit/delete goes through a TanStack Query *mutation* hook, whose `onSuccess` calls `queryClient.invalidateQueries(...)` for that same query key.
4. Because the component is genuinely subscribed to that query (via step 2), invalidation triggers a real background refetch, and the table updates in place - no full page reload.

This sounds obvious, but for a while several of these tables only did steps 1 and 3 - they rendered straight off the server-passed prop and never actually subscribed via `useQuery`, so step 3's invalidation had nothing to refetch. It was silent, harmless-looking dead code (the mutation still *worked*, the UI just didn't *update* without a manual refresh) until it was specifically audited for and fixed across every affected table. If you ever add a new admin table, follow the 4-step pattern above exactly, or you'll reintroduce the same bug.

The exception is the superadmin tenants/billing-plans tables, which intentionally use a *different*, equally valid pattern: no `useQuery` subscription at all, just plain local React state that's manually updated from each mutation's own response. Either pattern is fine; what's not fine is defining a query hook, invalding it, and never actually subscribing to it anywhere.

## Paginated lists

`lib/transactions.ts` is the reference implementation. `lib/vouchers-list.ts`
is a deliberate copy of it serving `/{slug}/admin/vouchers` and
`/{slug}/admin/failed`, which were the two lists that still loaded
everything. Copy the shape rather than inventing a third one.

**When this is worth doing.** An unconverted list page fetches every row and
filters the array in the browser. That is fine at a few hundred rows and is
the shape of the read-quota incident at a few thousand - one Firestore read
per document, per page view, per viewer. Convert a list when its collection
grows without bound.

No list in the app is unbounded now. `getTenantVouchers` still exists and is
still unbounded by default, but its remaining callers all pass `max` for a
fixed number of rows - if you reach for it without one, that is the thing
this section is about.

Two things the voucher conversion had to decide that the transactions one
did not:

- **The free-text search had to go.** It matched username, email *or*
  location, as a substring, over an array the page had already downloaded.
  That only worked because the page read everything, which is the cost being
  removed. It is an exact lookup on username or email now. Location is not
  in it: unlike a username, nobody can reliably type a location's name
  exactly, and a lookup that silently needs them to is worse than not
  offering one.
- **"Retry all" on the failed queue stopped being able to mean "all".** It
  iterates the rows on screen, and those are now a page. The button says
  "Retry all" only when the page *is* the whole queue and "Retry this page"
  otherwise, because the alternative is telling an owner with 300 failures
  that they retried all of them when 20 were tried. The failed queue also
  pages in 20s rather than 25s, since every retry is a round trip to a
  router.

The failed queue is also the one list where the totals have to be
recountable off page one: a retry removes a row from the set the count
describes, so `/api/admin/vouchers` takes a `recount` flag for exactly that
case. Paging alone never recounts.

### The shape

1. The **server component** fetches page one and the totals, so the table and
   the stat cards are right on first paint. It deliberately ignores any
   filter in the URL - reading them there would re-run the route on every
   keystroke, which is what `history.replaceState` in the client exists to
   avoid.
2. Everything after that - turning a page, changing a filter, a lookup - goes
   through an **API route** (`/api/admin/transactions`) guarded by
   `verifyTenantAccessBySlug`, like the rest of `/api/admin/*`.
3. **Any filter change resets paging.** A cursor is a position in one
   specific ordered query; carrying it into a different one points at a row
   that may not be in the results at all.

### The cursor, and two traps

The cursor is `<millis>_<documentId>`, and both halves matter.

- **Order by `createdAt` *and* `__name__`.** Timestamps tie - two vouchers
  bought in the same second is normal on a busy portal - and a cursor that
  cannot break the tie either repeats a row on the next page or skips one.
- **Split the cursor on the FIRST underscore.** Payment ids are
  `hs_<millis>_<random>`, so splitting from the right puts part of the id
  into the timestamp, yields `NaN`, and silently drops the cursor. "Next"
  then returns page one for ever. This shipped and was caught only by walking
  every page in a script and comparing the ids against a raw collection read.
  Do that to any cursor you write; it takes a minute and it is the only thing
  that actually proves paging works.

The query fetches `limit(pageSize + 1)` and slices the extra row off, which
answers "is there a next page" without a second query or a count.

### Totals come from aggregations, not from the rows

With one page loaded, the rows on screen are not the answer. `count()` and
`sum()` run over the *same* filter the table uses and read the matching
documents without sending them. Two rules that came out of getting this
wrong:

- Money totals count successful charges only, **and go to zero** when the
  list is filtered to a status that is not successful. Showing the all-time
  collected figure beside a list of failed charges reads as though those
  charges collected it.
- "Today" deliberately ignores the date filter: it is a fixed reference point
  next to the filtered figures, not another view of them. It is also a real
  Lagos day - see `startOfTodayInDisplayZone`, never `setHours(0,0,0,0)`.

### Search becomes a lookup

Firestore has no substring or case-insensitive matching, so a free-text
search box cannot survive server-side paging: it would only ever see the page
you happen to be on. The transactions page therefore has a **lookup** - an
exact reference or email, answered by its own query, with its own empty state
saying it has to match exactly. Paging is hidden while a lookup is showing,
because those results are not a page of anything.

If a list genuinely needs fuzzy search over everything, that is an argument
for an external index, not for loading the collection.

### The UI pieces

`SurfaceCardFooter` takes `variant="toolbar"`, which aligns it with
`SurfaceCardHeader` and adds a top gutter - that is where the row count and
the page buttons live. The default variant keeps `ui/card`'s own gutter
padding for a single full-width button, which is what the storefront and
portal plan cards use, so do not change it.

While a page loads, render `Skeleton` rows sized to the current page rather
than a spinner, so the card and its footer keep their height. Blank the stat
values **only** when the totals are actually being refetched - on a page turn
they have not changed, and flickering them is three numbers moving for no
reason.

## Where data is cached, and why each layer exists

There was no server-side caching at all until a quota incident forced the question (`docs/decisions-and-gotchas.md`). TanStack Query was already in use and working correctly, but it caches **per browser tab** - a hundred visitors means a hundred cold caches and a hundred reads. It makes the app feel responsive for one user; it cannot make it cheap across users. That needs a cache on the server, and the two are not substitutes.

The layers, with deliberately different lifetimes and mechanisms:

| What | Where | Lifetime | Mechanism |
|---|---|---|---|
| Tenant by slug | `lib/tenant-cache.ts` | 60s + tag invalidation | `unstable_cache`, cleared on tenant edit/create |
| Tenant document by id | `lib/tenant-cache.ts` | one request | React `cache()`, no staleness at all |
| Tenant dashboard stats | `lib/stats-cache.ts` | 5min + tag invalidation | `unstable_cache`, cleared by every sale, retry and first use of a generated code |
| Tenant fleet (setup done, offline routers) | `lib/tenant-fleet.ts` | 15min + tag invalidation | `unstable_cache`, cleared by every router/location create, delete and edit and by `router-health` on each online/offline transition; read by the admin layout's nav and the router-offline notice |
| Superadmin overview | `lib/stats-cache.ts` | 5min | `unstable_cache` |
| Billing page lifetime figures | `lib/stats-cache.ts` | 60s | `unstable_cache` |
| Per-tenant earnings | `lib/stats-cache.ts` | 60s | `unstable_cache`, keyed on the tenant id set |
| A tenant's active plans | `lib/plans-cache.ts` | 60s + invalidation | `createDocCache`, cleared on any plan write |
| Billing plan by id | `lib/billing-plans.ts` | 5min + invalidation | `createDocCache`, cleared on every plan write |
| Addon catalog entry | `lib/entitlements.ts` | 5min + invalidation | `createDocCache`, cleared by `lib/addons.ts` |
| Platform config | `lib/platform-config.ts` | 5min + invalidation | `createDocCache` under React `cache()` |
| Router address + credentials | `lib/router-config.ts` | 5min | in-process `Map` |

`createDocCache` (`lib/doc-cache.ts`) is `router-config`'s cache with the
router-specific parts removed: TTL, in-flight collapsing, explicit
invalidation. **Every writer of a cached document must call `invalidate`** -
that is the whole contract, and it is why only documents written by routes in
this same process are in there. Anything a webhook or another instance can
write (an entitlement, `nextBillingDate`) is deliberately React-cached
only, where the worst case is one request's worth of staleness.

These things about this are load-bearing:

**The tenant lookup is the highest-volume read in the app.** Every page under `/{tenantSlug}` resolves the slug to a tenant - twelve call sites. React's `cache()` already deduplicated it *within* one request; this deduplicates it *across* requests. It is the read that scales with visitors rather than with your own clicking.

**Tenant stats are cleared by their writers, so the API route reads the cache too.** They used to be cached at the page only, with `/api/admin/stats` calling the uncached helper so a refetch right after a retry saw the new count. The cost of that was the client's refetch on window focus: an owner tabbing back to the dashboard paid a full recompute each time, whether or not anything had sold, so reads scaled with tab switches. Now `invalidateTenantStats` (`lib/stats-invalidate.ts`) runs where the figures change - the payment write at the end of fulfilment, a successful retry, `activateGeneratedCodes` - before the client refetches, and both readers share the cache. The 5-minute lifetime is only the backstop for changes nothing invalidates (a voucher expiring, a router added). A new writer of sales or voucher status must call it. `/api/superadmin/stats` still calls the uncached `getPlatformStats`; nothing on the client polls it.

**The overview pages show this month, not all time.** Money and sales on both dashboards are "this month so far" in Lagos with the same point last month beside them; all-time lives on the pages the cards link to (Transactions, Vouchers, superadmin Billing), opened with `?from=` the 1st. A month is read as one stored document of finished days (`statsMonthly`, `platformStatsMonthly`, written nightly by `sales-digest` - `lib/stats-rollup.ts`) plus a live aggregation from the first day that document lacks, so a missed nightly run costs a read, never a wrong figure (`lib/stats-period.ts`, `npm run test:stats-period`). State - active and failed vouchers, tenants by status, MRR - stays live. The stored days are also what the trend charts under the cards draw ("Month so far", a running total against last month; "Last 30 days", daily columns), so the charts cost no reads of their own. They are hand-drawn SVG in `components/system/charts.tsx`, no chart library, with series colours from `--series-*` in `globals.css` (checked for colour-blind separation on the inset panel in both modes) and every chart card linking to a report page (`/{tenant}/admin/reports`, `/superadmin/reports`, `lib/reports.ts`) where its figures are read in full: a month picker over the last twelve months, the month day by day as chart and table, its online/cash or income-source mix, and the twelve months as a chart you can click into. The report is the charts' accessible equivalent, so the dashboard carries no table toggle. A report costs 12 month-document reads plus the dashboard's live tail for the current month, cached per month under the same tag a sale clears. The cached stats' keys carry a shape version (`tenant-stats-v3`): bump it with any change to what is cached, or the previous deploy's entries are served to new code for up to five minutes, missing the new fields.

**Per-tenant earnings are N aggregations, never a document scan.** The superadmin billing page sums each tenant's successful payments separately, which is one aggregation query per tenant (`getTenantEarnings`). Firestore bills an aggregation at one read per 1000 index entries scanned, so a tenant with 4000 payments costs 4 reads rather than 4000 - fetching those documents to sum them in JS is literally the query shape that exhausted the quota (`docs/decisions-and-gotchas.md`). The cost still scales with tenant *count*, which is why it is page-level only and cached as one entry for the whole table rather than per tenant: one miss a minute, not one per tenant. If a client-pollable API route ever needs this, give it a denormalised running total on the tenant document instead of exposing this function.

**The highest-volume reads are on the two pages nobody has to log in for.** The storefront and the captive portal render once per visitor, and the portal renders once per device that joins a venue's wifi. One portal render used to cost around `8 + N` reads for `N` plans - and three of those eight were the *same billing plan document*, fetched by the entitlement check, the fee-bearer resolution and the customer-limit check in turn. With the plan list, the billing plan, the addon and the platform config all cached it is roughly `4` flat, independent of the number of plans.

**Router config is an in-process `Map`, not `unstable_cache`.** That value contains the router's password, and Next's data cache persists to `.next/cache` on disk. It also collapses concurrent misses onto one lookup, which matters because anything polling the router would otherwise pay two Firestore reads per tick - a 15s poll from one open tab is ~17,000 reads a day, which is the original quota bug wearing a different hat.

When a cached value must survive serialization, convert explicitly. `lib/tenant-cache.ts` round-trips `Date` fields through ISO strings in both directions, because the cache returns JSON and `TenantSchema` declares real `Date`s - callers would otherwise get strings that work until something calls a `Date` method on them.

## Reading live data off the router

`/{tenantSlug}/admin/users` is the one page whose data does not come from Firestore. It joins the platform's vouchers with the router's own hotspot users, read live over the tunnel (`lib/hotspot-users.ts`), and splits into two tabs: **Users** (one reconciled row per person) and **Active now** (live sessions).

Two rules it follows, which any future router-backed page should too:

- **Never fetch router data in a server component.** These reads cross a WireGuard tunnel to hardware in someone's shop; a server render that awaits them makes the page as slow and as failure-prone as the least reachable router. Everything router-dependent loads client-side with its own loading and error states, and an unreachable router returns `200` with a `reachable: false` flag rather than an error.
- **Neither source is complete, so show the disagreement.** Firestore knows who paid and for what; the router knows which users actually exist - including ones created by hand years before this app - and how expiry is really enforced. Where they disagree (sold but missing on the router, past expiry but still enabled) is surfaced as `drift`, because that is the information a tenant actually needs.
