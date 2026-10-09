# Architecture

Assumes you've read `docs/glossary.md`. This doc answers: what does this product actually do, who uses it, and how is the code organized to serve them.

## What this product is

A multi-tenant SaaS platform that lets hotspot/Wi-Fi businesses sell internet access vouchers online. A hotspot business ("tenant") signs up, connects their MikroTik router(s), defines pricing plans, and their customers can then visit that tenant's own portal, pay with Paystack, and instantly receive hotspot login credentials - no cash, no manual voucher handling.

The platform itself (not any one tenant) also charges tenants for using it, via a configurable set of billing plans (flat monthly fee, a percentage of each sale, a hybrid of both, or free).

## The three roles, and what each one can actually do

See the glossary for the definitions - this is what each role's experience actually looks like in the app:

**Customer** - browses a specific tenant's public portal (`/{tenantSlug}`), picks a plan, pays via Paystack, immediately gets a hotspot username/password. Can view their own purchase history (`/{tenantSlug}/my-vouchers`) across any tenant they've bought from - one account works everywhere on the platform.

**Owner** - logs into their own tenant's admin area (`/{tenantSlug}/admin`): dashboard stats, manage routers (register new ones, including the whole WireGuard setup wizard - see `docs/router-and-wireguard.md`), manage locations, manage plans, view vouchers and payments, retry any that failed, see their own business/billing settings.

**Superadmin** - logs into `/superadmin`: sees every tenant, can suspend/activate a tenant's account, full CRUD over billing plans, platform-wide config (WireGuard server settings, who bears Paystack's fee). Can also *view* (read-only) any individual tenant's admin area for support purposes, but can never perform an owner-only action (create a router, edit a plan, etc.) on a tenant's behalf.

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
lib/                    Everything else server-adjacent: Firebase setup, Firestore helpers, Paystack
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
  api/
    auth/                           register, session (cookie mint/clear), check-slug
    onboarding/                     banks, plan-code, plans, create-tenant, verify-account
    admin/                          Every tenant-owner-scoped mutation/query (routers, locations,
                                     plans, vouchers, stats) - all require an authenticated owner
                                     (or superadmin) token tied to that specific tenant
    superadmin/                     Platform-wide mutations (tenants, billing-plans, stats) -
                                     require an authenticated superadmin token
    tenant/[slug]/                  Public tenant lookup + the can-purchase enforcement check
    payment/verify/                 Server-side Paystack payment verification + voucher creation
    webhooks/paystack/              Receives events Paystack pushes to this app
    voucher/retry/                  Re-attempt a failed MikroTik voucher creation
```

A route group in parentheses, like `(auth)` or `(onboarding)`, is a Next.js convention: it organizes files without becoming part of the actual URL. `app/(auth)/auth/page.tsx` serves `/auth`, not `/(auth)/auth`.

## How client components get fresh data (and the bug that came from doing it halfway)

Every admin table (routers, locations, plans, failed vouchers, dashboard stats) follows the same pattern:

1. The **server component** (`page.tsx`) fetches the initial data once, on first page load.
2. That data is passed as a prop into a **client component**, which uses it to seed a TanStack Query hook (`useRouters(initialRouters)`, etc.) via that hook's `initialData` option - so the first paint is instant, no loading spinner, using data the server already fetched.
3. Any create/edit/delete goes through a TanStack Query *mutation* hook, whose `onSuccess` calls `queryClient.invalidateQueries(...)` for that same query key.
4. Because the component is genuinely subscribed to that query (via step 2), invalidation triggers a real background refetch, and the table updates in place - no full page reload.

This sounds obvious, but for a while several of these tables only did steps 1 and 3 - they rendered straight off the server-passed prop and never actually subscribed via `useQuery`, so step 3's invalidation had nothing to refetch. It was silent, harmless-looking dead code (the mutation still *worked*, the UI just didn't *update* without a manual refresh) until it was specifically audited for and fixed across every affected table. If you ever add a new admin table, follow the 4-step pattern above exactly, or you'll reintroduce the same bug.

The exception is the superadmin tenants/billing-plans tables, which intentionally use a *different*, equally valid pattern: no `useQuery` subscription at all, just plain local React state that's manually updated from each mutation's own response. Either pattern is fine; what's not fine is defining a query hook, invalding it, and never actually subscribing to it anywhere.

## Where data is cached, and why each layer exists

There was no server-side caching at all until a quota incident forced the question (`docs/decisions-and-gotchas.md`). TanStack Query was already in use and working correctly, but it caches **per browser tab** - a hundred visitors means a hundred cold caches and a hundred reads. It makes the app feel responsive for one user; it cannot make it cheap across users. That needs a cache on the server, and the two are not substitutes.

Four layers exist now, with deliberately different lifetimes and mechanisms:

| What | Where | Lifetime | Mechanism |
|---|---|---|---|
| Tenant by slug | `lib/tenant-cache.ts` | 60s + tag invalidation | `unstable_cache`, cleared on tenant edit/create |
| Dashboard stats | `lib/stats-cache.ts` | 60s | `unstable_cache`, **page-level only** |
| Per-tenant earnings | `lib/stats-cache.ts` | 60s | `unstable_cache`, keyed on the tenant id set |
| Router address + credentials | `lib/router-config.ts` | 5min | in-process `Map` |

Four things about this are load-bearing:

**The tenant lookup is the highest-volume read in the app.** Every page under `/{tenantSlug}` resolves the slug to a tenant - twelve call sites. React's `cache()` already deduplicated it *within* one request; this deduplicates it *across* requests. It is the read that scales with visitors rather than with your own clicking.

**Stats are cached at the page, not in the helper.** `/api/admin/stats` and `/api/superadmin/stats` deliberately call the uncached helpers, because the client refetches those immediately after an action that changes the numbers (retrying a failed voucher). Caching the helper would show a stale figure right after a user fixed something.

**Per-tenant earnings are N aggregations, never a document scan.** The superadmin billing page sums each tenant's successful payments separately, which is one aggregation query per tenant (`getTenantEarnings`). Firestore bills an aggregation at one read per 1000 index entries scanned, so a tenant with 4000 payments costs 4 reads rather than 4000 - fetching those documents to sum them in JS is literally the query shape that exhausted the quota (`docs/decisions-and-gotchas.md`). The cost still scales with tenant *count*, which is why it is page-level only and cached as one entry for the whole table rather than per tenant: one miss a minute, not one per tenant. If a client-pollable API route ever needs this, give it a denormalised running total on the tenant document instead of exposing this function.

**Router config is an in-process `Map`, not `unstable_cache`.** That value contains the router's password, and Next's data cache persists to `.next/cache` on disk. It also collapses concurrent misses onto one lookup, which matters because anything polling the router would otherwise pay two Firestore reads per tick - a 15s poll from one open tab is ~17,000 reads a day, which is the original quota bug wearing a different hat.

When a cached value must survive serialization, convert explicitly. `lib/tenant-cache.ts` round-trips `Date` fields through ISO strings in both directions, because the cache returns JSON and `TenantSchema` declares real `Date`s - callers would otherwise get strings that work until something calls a `Date` method on them.

## Reading live data off the router

`/{tenantSlug}/admin/users` is the one page whose data does not come from Firestore. It joins the platform's vouchers with the router's own hotspot users, read live over the tunnel (`lib/hotspot-users.ts`), and splits into two tabs: **Users** (one reconciled row per person) and **Active now** (live sessions).

Two rules it follows, which any future router-backed page should too:

- **Never fetch router data in a server component.** These reads cross a WireGuard tunnel to hardware in someone's shop; a server render that awaits them makes the page as slow and as failure-prone as the least reachable router. Everything router-dependent loads client-side with its own loading and error states, and an unreachable router returns `200` with a `reachable: false` flag rather than an error.
- **Neither source is complete, so show the disagreement.** Firestore knows who paid and for what; the router knows which users actually exist - including ones created by hand years before this app - and how expiry is really enforced. Where they disagree (sold but missing on the router, past expiry but still enabled) is surfaced as `drift`, because that is the information a tenant actually needs.
