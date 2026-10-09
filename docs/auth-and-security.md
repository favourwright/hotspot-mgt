# Authentication & Security

Assumes you've read `docs/glossary.md` and `docs/architecture.md`.

This doc covers how login actually works end to end, and - deliberately - the real incidents that shaped the current design. The *why* here is almost entirely "we found a real bug in production and this is the fix," so the history is the explanation.

## How a login actually works

1. The browser calls Firebase Auth directly (client SDK) - `createUserWithEmailAndPassword` or `signInWithEmailAndPassword`. This is entirely between the browser and Google's servers; this app's own backend isn't involved yet.
2. On **registration only**, the client then calls `POST /api/auth/register` with the new Firebase user's ID token. This is the only place a `users/{uid}` Firestore document gets created, and the only place `role` is decided: if the email matches `SUPERADMIN_EMAIL` (or legacy `ADMIN_EMAIL`), role is `"superadmin"`; otherwise `"customer"`. (An `owner` role is only ever granted later, by completing tenant onboarding - see `docs/billing-and-payments.md`.)
3. The client then calls `POST /api/auth/session` with the ID token, which mints an **httpOnly session cookie** - see below for why this exists at all.
4. `providers/auth-provider.tsx` keeps a `Zustand` store (`stores/auth-store.ts`) in sync client-side via Firebase's `onIdTokenChanged` listener - this is what client components read (`useAuthStore`) to decide what to render (e.g. "Login" vs "Logout" in a nav bar).

Two genuinely separate credentials exist simultaneously after login, and it matters which one is used where:

| | ID token | Session cookie |
|---|---|---|
| Lifetime | ~1 hour, auto-refreshed | 5 days |
| Where it lives | In memory / attached manually per-request | httpOnly browser cookie, sent automatically |
| Who reads it | API routes, via an `Authorization: Bearer` header the client attaches itself | Server components, via `cookies()` - nothing to attach manually, the browser just sends it |
| Minted by | Firebase client SDK | `POST /api/auth/session`, which this app added |

## Why the session cookie exists at all

For a long time, this app had **no server-side authentication whatsoever**. Every `page.tsx` under `/admin` and `/superadmin` was a server component that fetched and rendered real data (payments, bank details, router credentials) based on nothing but the tenant existing - not who was asking. `proxy.ts` (the middleware) does no auth checking either; by original design, it explicitly defers all validation to "the layout below" - and the layouts were `"use client"` components, which can't run before the server component has already fetched and sent the data.

The actual exposure: any authenticated user - or literally anyone who could reach the URL at all, since there wasn't even a login check - received a tenant's real payment history, bank account details, and router IPs in the server-rendered response, before a single line of client-side authorization logic ever ran. A client-side "flash" of the UI (briefly showing protected content before redirecting an unauthorized viewer away) was the *visible* symptom that led to finding this - but fixing the flash alone would have done nothing, since the data was already in the HTML response by the time any client-side check could react to it.

The fix was to give server components a way to know who's asking, which meant adding actual server-side session verification where there had been none:

- `lib/server-auth.ts` - `getServerUser()` reads the session cookie, verifies it via the Firebase Admin SDK (`verifySessionCookie`, with revocation checking on), then resolves the caller's role/tenantId from the token's **custom claims** (see below). It falls back to a Firestore read only for accounts whose tokens predate claims, and backfills them on the way through.
- `lib/tenant-context.ts`'s `requireTenantOwner(slug)` - the single gate every `/{tenantSlug}/admin/*` page now calls *before* fetching any tenant data: resolves the tenant, verifies the session, confirms the caller owns this specific tenant (or is a superadmin, who gets view-only access - see below), and redirects/404s otherwise.
- `lib/server-auth.ts`'s `requireSuperAdmin()` - the equivalent gate for every `/superadmin/*` page.

One practical consequence worth knowing: anyone who was already logged in before this shipped has no session cookie yet (it's only minted by `/api/auth/session`, called from login/register) - they get redirected to `/auth` once, a one-time re-login, not a bug.

### The client-side "flash" itself - a separate, smaller bug

Independent of the data-exposure issue above, `app/[tenantSlug]/admin/layout.tsx` and `app/(onboarding)/layout.tsx` had a real rendering bug: they checked `if (loading) return null` before deciding whether to render their children, but never checked the actual authorization outcome before rendering - so for one render cycle, protected UI would paint before a `useEffect`-driven redirect could kick the user back out. `app/superadmin/layout.tsx` already had the correct pattern (`if (loading) return null; if (userRole !== "superadmin") return null;`) - the fix was just making the other two match it: render nothing until every redirect condition has been positively ruled out, not just until loading has finished.

## Crossing subdomains: the session cookie is not enough

Auth here has two halves, and only one of them crosses origins.

- The **session cookie** is scoped to the root domain (`sessionCookieDomain()`), so it is sent to the apex, `superadmin.ogawifi.online` and every `{slug}.ogawifi.online`. Server components authenticate fine everywhere.
- **Firebase's own client-side auth state is per-origin.** The JS SDK persists to IndexedDB, and `ogawifi.online` and `starlink.ogawifi.online` are different origins with different IndexedDBs. There is no Firebase setting that changes this.

So a tenant owner signed in at the apex who opens their subdomain is authenticated as far as every server render is concerned, and *signed out* as far as the browser is concerned. The visible symptoms are severe and look unrelated to each other: the admin layout sees `user === null` and redirects to `/auth`, and every API call that sends `Authorization: Bearer <idToken>` has no token to send. Superadmin is the worst case - `superadmin.ogawifi.online` opening a tenant's `{slug}.ogawifi.online/admin` is a third origin again.

The fix is a **bootstrap exchange**: `POST /api/auth/bootstrap` verifies the session cookie and returns `adminAuth.createCustomToken(uid)`; `restoreClientSession()` (`lib/session-client.ts`) signs in with it. `AuthProvider` runs this the first time `onIdTokenChanged` reports no user, so client auth follows the server session onto any subdomain. Four details are load-bearing:

- **`loading` stays `true` during the attempt.** Releasing it would let the admin layout see `loading:false, user:null` and redirect to `/auth` mid-restore - the exact bug this is meant to fix.
- **It is attempted once per mount** (`restoreAttempted` ref). A failed restore must not retry on every signed-out event.
- **The hint cookie.** `session_present` is a non-httpOnly companion set and cleared alongside the real session cookie, and exists only so the client can tell whether the exchange is worth a round trip. Without it every anonymous page view - the captive portal, a tenant storefront, `/auth` itself - would fire a request that can only 401. It carries no identity and is never trusted: forging it buys exactly one 401.
- **Sign-out must clear the server session, not just Firebase.** `clearSession()` deletes both cookies *before* `signOut()` fires the listener, so there is nothing left to restore from. A bare `signOut(auth)` leaves the cookie behind and the bootstrap signs the user straight back in - sign-out appears to do nothing. `components/tenant/tenant-nav.tsx` had exactly that bug; it was harmless until the bootstrap existed, and now routes through the shared `useAuth().logout`.

`POST`, not `GET`, is the CSRF boundary: the session cookie is `SameSite=Lax`, which keeps it off cross-site POSTs entirely, so another origin cannot drive the exchange on a visitor's behalf and read back a credential.

## Role and tenant live in the token, not in Firestore

**This reverses an earlier design, and the old behaviour is documented in places that may still be lying to you.** It used to be that every authenticated request re-read `users/{uid}` from Firestore to learn the caller's role - described at the time as a feature, because a role change took effect immediately rather than after the cookie's 5-day life.

The cost of that was one Firestore read *per request*: every API call, every server render, every token refresh in `auth-provider.tsx`. Combined with other unbounded reads, this was part of what exhausted the project's daily Firestore read quota (see `docs/decisions-and-gotchas.md`). Authentication was being paid for over and over to learn something that changes perhaps twice in an account's lifetime.

Role and `tenantId` are now **Firebase custom claims**, carried inside the ID token that is already being verified on every request. Resolving the caller costs nothing extra.

- `lib/auth-claims.ts` - pure helpers (`normalizeRole`, `claimsFrom`). Deliberately free of `firebase-admin` imports so client components can use it; the Admin SDK must not reach the browser bundle.
- `lib/auth-claims-admin.ts` - `syncUserClaims()` (server-only) writes claims. **Must be called anywhere `role` or `tenantId` changes**, or the token and the document drift apart: `/api/auth/register`, `/api/onboarding/create-tenant`, `/api/admin/fix-role`, `scripts/fix-admin-role.ts`.
- `backfillUserClaims()` - the same write, but at most once per account per process, used only by the read-path fallback.

### The consequences you have to design around

**A session cookie is a snapshot.** It carries whatever claims its ID token had when it was minted, and a server render cannot re-mint a cookie - `cookies()` is writable only from route handlers and server actions. So **any flow that changes a signed-in user's role must also call `refreshSession()`** (`lib/session-client.ts`), which forces a token refresh and re-mints the cookie. Onboarding does this when a customer becomes an owner; without it, the new owner would be locked out of their own dashboard.

**Accounts predating claims self-heal, but not instantly.** `POST /api/auth/session` backfills claims at mint time and tells the client to come back with a refreshed token, so each legacy account pays one read once rather than one per request for the cookie's whole life.

**A Firestore outage is not a logout.** `getServerUser()` catches a failed *cookie verification* and returns null, but deliberately lets a failed *document read* throw. Treating an unreachable database as "signed out" sends a valid session back to `/auth` in a loop - which happened, and is far worse than a visible error.

## Which tenant a request acts on

For an owner these are the same question, which is why the original `verifyOwnerWithTenant()` took the tenant from the caller's own account. For a superadmin they are not: a superadmin has `tenantId: null` by design, so that helper rejected them outright - meaning **every `/api/admin/*` route refused superadmins**, even though `requireTenantOwner()` explicitly lets them view those pages.

This was invisible for a long time because admin pages seed from server-rendered data and only *refetch* client-side, so the failure left the initial render on screen. It surfaced the moment a page was built that fetches entirely from the client.

The mechanism now:

- `lib/api-client.ts` attaches an **`x-tenant-slug`** header to every request, read from the browser's URL (`/{slug}/admin/...`).
- `verifyTenantAccessBySlug()` (`lib/auth-helpers.ts`) resolves and authorizes it: an owner is always scoped to their own tenant and a slug naming anyone else's is a 403; a superadmin must name one and may name any.

The header is a **hint, not a grant** - it is attacker-controllable and authorization is entirely server-side.

**Reads use it; writes deliberately do not.** All 17 mutating handlers stay on `verifyOwnerWithTenant()`, so a superadmin viewing a tenant remains read-only at the API layer, matching what the UI already enforces.

## Roles and what "superadmin can view, not edit" actually means

`verifyOwner()` (in `lib/auth-helpers.ts`) accepts both `"owner"` and `"superadmin"` tokens - this is the origin of every "a superadmin can see any tenant's admin area, but can't perform owner-only actions" behavior across the app. In practice this means: a superadmin visiting `/{tenantSlug}/admin/routers` sees the real data and the page renders, but every create/edit/delete button is conditionally hidden for that role in the UI - the server-side gate alone only decides *can this request be fetched*, not *can this specific action be performed*; each mutating component separately checks role before offering the action at all.

## A superadmin registering for the first time - a real timing bug

Recall from above: on registration, `/api/auth/register` is what decides and stores `role`. But `providers/auth-provider.tsx`'s `onIdTokenChanged` listener fires the instant Firebase Auth creates the user - which can be *before* `/api/auth/register` has actually created the Firestore document. If that listener's Firestore read loses that race, it finds no document yet and sets `userRole` to `null` for the rest of that browser session - permanently, since nothing re-triggers that listener again until the next full token refresh.

The fix in `register-form.tsx`: force a token refresh (`getIdToken(true)`) immediately after `/api/auth/register` responds, which re-fires `onIdTokenChanged` - by now the document genuinely exists, so the listener picks up the correct role. The deeper fix in `/api/auth/register` itself: it now re-checks the superadmin email match on *every* call, even for an already-existing account, and self-heals the stored role if it's wrong - so even if this exact race were somehow hit again (e.g. a stale server process with an outdated `SUPERADMIN_EMAIL` env var at the moment of registration - this happened for real, once, during local development), the account doesn't stay permanently misassigned; the very next time that route runs for that uid, it corrects itself.

## What Firestore security rules are (and aren't) doing here

Covered in `docs/data-model.md` - the short version repeated here because it matters for this doc's topic: rules constrain *direct* client-SDK access, which this app deliberately uses for almost nothing (`write: if false` nearly everywhere). The actual authorization logic - "is this the right tenant," "is this role allowed to do this" - lives in the API routes and the server-component gates described above, not in the rules file. Don't go looking in `firestore.rules` for business logic; it's a backstop, not the primary mechanism.
