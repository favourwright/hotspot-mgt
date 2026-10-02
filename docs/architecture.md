# Architecture

Assumes you've read `docs/glossary.md`. This doc answers: what does this product actually do, who uses it, and how is the code organized to serve them.

## What this product is

A multi-tenant SaaS platform that lets hotspot/Wi-Fi businesses sell internet access vouchers online. A hotspot business ("tenant") signs up, connects their MikroTik router(s), defines pricing plans, and their customers can then visit that tenant's own portal, pay with Paystack, and instantly receive hotspot login credentials — no cash, no manual voucher handling.

The platform itself (not any one tenant) also charges tenants for using it, via a configurable set of billing plans (flat monthly fee, a percentage of each sale, a hybrid of both, or free).

## The three roles, and what each one can actually do

See the glossary for the definitions — this is what each role's experience actually looks like in the app:

**Customer** — browses a specific tenant's public portal (`/{tenantSlug}`), picks a plan, pays via Paystack, immediately gets a hotspot username/password. Can view their own purchase history (`/{tenantSlug}/my-vouchers`) across any tenant they've bought from — one account works everywhere on the platform.

**Owner** — logs into their own tenant's admin area (`/{tenantSlug}/admin`): dashboard stats, manage routers (register new ones, including the whole WireGuard setup wizard — see `docs/router-and-wireguard.md`), manage locations, manage plans, view vouchers and payments, retry any that failed, see their own business/billing settings.

**Superadmin** — logs into `/superadmin`: sees every tenant, can suspend/activate a tenant's account, full CRUD over billing plans, platform-wide config (WireGuard server settings, who bears Paystack's fee). Can also *view* (read-only) any individual tenant's admin area for support purposes, but can never perform an owner-only action (create a router, edit a plan, etc.) on a tenant's behalf.

## Request flow — how a page actually gets built and served

This matters because the project had a real security bug stemming from getting this wrong (see `docs/auth-and-security.md`), so it's worth being precise:

1. A browser requests a URL, e.g. `/starlinkkonnect/admin/routers`.
2. `proxy.ts` (Next.js's middleware) runs first, for *every* request. In this app it does almost nothing useful — it only distinguishes "is the first URL segment a known platform route (`/admin`, `/auth`, `/superadmin`, etc.) or a tenant slug," and even that distinction isn't used for any actual security decision. It does **no authentication or authorization** — that's a deliberate (if easy to miss) property of this app's design, not an oversight: the comment in the code literally says to let the page/layout below handle validation.
3. The matching **server component** (a `page.tsx` or `layout.tsx` under `app/`) runs on the server. For anything under `/admin` or `/superadmin`, this is where real authorization now happens — it reads the session cookie, verifies it, checks the role, and only *then* fetches any data from Firestore. (This wasn't always true — see `docs/auth-and-security.md` for the incident where it wasn't, and what that cost.)
4. The server component passes whatever data it fetched as props into **client components** for anything interactive (tables with edit/delete buttons, dialogs, forms).
5. The client components hydrate in the browser and take over for any further interaction — further mutations go through `app/api/...` route handlers, which independently re-verify the caller's identity and role (never trusting anything the server component already decided, since API routes can be called directly, bypassing the page entirely).

## Folder tour

```
app/                   Every page and API route — see below
components/
  ui/                   shadcn/ui primitives (button, dialog, table, ...)
  admin/                Tenant-admin-only components (routers/locations/plans tables, dialogs)
  superadmin/            Superadmin-only components
  tenant/                Tenant-facing shared pieces (nav, sidebar, customer home)
  auth/                  Login/register forms
  shared/                Used across more than one of the above (checkout dialog, empty states)
hooks/                  TanStack Query hooks — one file per resource (use-routers.ts, use-plans.ts, ...)
services/               Thin wrappers around fetch/axios calls to this app's own API routes
lib/                    Everything else server-adjacent: Firebase setup, Firestore helpers, Paystack
                        client, MikroTik client, WireGuard manager client, auth helpers, session
                        cookie verification, tenant-ownership checks
stores/                 Zustand stores (auth state, onboarding wizard state)
providers/              React context providers wired up once near the root (auth listener, query client)
types/schemas.ts        Every Zod schema — the single source of truth for data shapes, see docs/data-model.md
deploy/                 systemd service file + nginx config for the production VPS
vps/wg-manager/         A separate, small Python service that runs on the VPS itself to manage
                        WireGuard peers at the OS level — not part of the Next.js app, deployed
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
    admin/                          Owner-only area (superadmin can view) — routers, locations,
                                     plans, vouchers, failed queue, settings, dashboard
  superadmin/                       Superadmin-only area — tenants, billing, billing plans, config
  api/
    auth/                           register, session (cookie mint/clear), check-slug
    onboarding/                     banks, plan-code, plans, create-tenant, verify-account
    admin/                          Every tenant-owner-scoped mutation/query (routers, locations,
                                     plans, vouchers, stats) — all require an authenticated owner
                                     (or superadmin) token tied to that specific tenant
    superadmin/                     Platform-wide mutations (tenants, billing-plans, stats) —
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
2. That data is passed as a prop into a **client component**, which uses it to seed a TanStack Query hook (`useRouters(initialRouters)`, etc.) via that hook's `initialData` option — so the first paint is instant, no loading spinner, using data the server already fetched.
3. Any create/edit/delete goes through a TanStack Query *mutation* hook, whose `onSuccess` calls `queryClient.invalidateQueries(...)` for that same query key.
4. Because the component is genuinely subscribed to that query (via step 2), invalidation triggers a real background refetch, and the table updates in place — no full page reload.

This sounds obvious, but for a while several of these tables only did steps 1 and 3 — they rendered straight off the server-passed prop and never actually subscribed via `useQuery`, so step 3's invalidation had nothing to refetch. It was silent, harmless-looking dead code (the mutation still *worked*, the UI just didn't *update* without a manual refresh) until it was specifically audited for and fixed across every affected table. If you ever add a new admin table, follow the 4-step pattern above exactly, or you'll reintroduce the same bug.

The exception is the superadmin tenants/billing-plans tables, which intentionally use a *different*, equally valid pattern: no `useQuery` subscription at all, just plain local React state that's manually updated from each mutation's own response. Either pattern is fine; what's not fine is defining a query hook, invalding it, and never actually subscribing to it anywhere.
