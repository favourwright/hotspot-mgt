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

## The one place rules were the primary mechanism, and were wrong

`/tenants/{tenantId}` used to be `allow read: if true` with `allow update: if
isSuperAdminOrOwner(tenantId)` and no field restrictions. An owner is
authenticated in their own admin UI, so a single `updateDoc` from the browser
console could set `platformFeePercent: 0`, clear `monthlyFee`, flip
`subscriptionStatus` to `"active"`, or swap `planId` for a richer tier. The
public read also handed `accountNumber`, `accountName`, `bankName` and the
Paystack customer/subscription/subaccount codes to anyone who could guess a
tenant id.

Both are now closed (`read: if isSuperAdminOrOwner`, `update: if false`). The
app makes **no client-side writes anywhere** - every write already went through
the Admin SDK - so this removed a capability nothing used.

This is also why addon entitlements live in a closed subcollection rather than
as a field on the tenant: a flag the tenant can write is not a paywall.
→ `docs/addons.md`

## Email verification, and why it blocks nothing

**A customer registers from behind the captive portal's paywall, where their
inbox is unreachable.** The walled garden allows our domain, Paystack,
fonts/googleapis, firebaseapp and dicebear - no webmail, and adding webmail
would be free unmetered browsing for anyone in range. So at the moment a
customer signs up to buy, they cannot read an email of any kind. That single
fact decides the whole design:

- **Nothing is gated on verification.** A customer buys, connects and gets
  their voucher unverified. An owner completes onboarding and runs a portal
  unverified. A gate here would not improve data quality, it would end
  purchases.
- **It is not a security control, it is a data-quality one.** Nobody fakes
  their email to buy their own voucher. What actually happens is `gmial.com`,
  and the cost is the voucher email - the customer's only lasting copy of
  their credentials - going nowhere.
- **The notice is the entire mechanism**, and it only renders for a signed-in
  account, which is the first moment there is anything to act on.

It is mounted in exactly two places, one per audience: `TenantNav` for
customers and the tenant admin layout for owners. Not in pages - dropping it
into individual pages is how it first ended up on two of them, absent from the
rest, and once rendered outside the app shell entirely. `AppShell` lays its
children out as bands, so a fragment in the nav puts it under the nav on every
page with no per-page wiring.

One useful thing falls out of that placement rather than needing a rule: the
portal page does not render `TenantNav`, so a buyer mid-purchase is never
nagged about an inbox they cannot reach from behind the paywall.

The notice carries **one** action. It used to also link to the page where the
address can be changed, which turned a one-line banner into a decision - and
that route is already where the person ends up: the account page is in the
nav, and the notice renders there too, directly above the card that offers
the change.

That also means **OTP was the wrong tool** and was not built. Firebase has no
email OTP, so it would have been a custom build with its own rate-limiting
and brute-force surface, to buy an experience advantage - staying in one tab
on a phone - that only pays off in the one place verification cannot happen
at all.

### Verification is useless without a way to change the address

Telling someone their email is unreachable and offering no way to correct it
is a dead end, so the two shipped together. `components/auth/account-email-card.tsx`
is shared by the customer profile page (`/{slug}/profile`, which did not exist
before) and tenant settings.

**The one rule the change flow follows: never require control of the old
mailbox.** Not controlling it is the commonest reason to want the change, so
the confirmation link goes to the **new** address and the old one is only ever
notified. A typo'd signup therefore self-heals: sign in, change the address,
confirm from the new inbox. Firebase sends its own revocation mail to the old
address afterwards (`RECOVER_EMAIL`), which is the right shape for a safety
net - it cannot block anything.

The case that genuinely cannot self-heal is **typo'd email + lost password +
signed out**: no credential and no mailbox, and the password reset goes to the
dead address. That needs `adminAuth.updateUser` by hand. The live session is
the asset, which is why the profile page must stay reachable without a
re-login.

### A card about an account must know whose account it is

`AccountEmailCard` and `NotificationSettings` both appear on tenant settings,
which a superadmin can open for any tenant. Both originally read the signed-in
user, so a superadmin saw **their own** email address with live buttons, and
notification switches that moved and then snapped back on a 403.

Neither could actually write to the tenant - `verifyOwnerWithTenant` refuses a
superadmin on every write - which is precisely why it was easy to miss. The
damage was in the reading: a superadmin "fixing" a tenant's wrong email would
have changed their own.

Both now take the owner's `uid` and compare it against the signed-in user.
Not the owner, and they render read-only with the tenant's real values. The
same rule that already governs the API ("a superadmin can view, not act") now
governs what the page claims to be about.

### Re-auth is enforced on the server, not by the dialog

Changing an email is a full account takeover if a stolen session can do it
unchallenged: move the recovery address, then reset the password to it. The
client SDK's `verifyBeforeUpdateEmail` would refuse a stale session itself
with `auth/requires-recent-login` - but we mint the link with the Admin SDK
(`generateVerifyAndChangeEmailLink`) so the email can go through Mailtrap
branded like the other 23, and **the Admin SDK does not enforce that.**

So `lib/email-identity.ts` checks `auth_time` on the caller's token against a
5-minute window. `auth_time` is when the user last really authenticated and -
unlike `iat` - does not move on a token refresh, so the check cannot be
satisfied by calling `getIdToken(true)`. Only `reauthenticateWithCredential`
moves it, which is exactly what the password dialog does. Required whether or
not the current address is verified: the threat is the live session, and if
anything it is worse unverified, since the real owner gets no warning they
can read.

### Where our copies of the address catch up

The change commits when the user clicks a link - possibly on another device,
possibly signed out - so there is no moment we can hook to write the copies.
`reconcileEmail()` instead reads Firebase Auth as the authority and fixes
whatever differs: `users/{uid}.email`, `tenants/{id}.ownerEmail`, and each
`tenants/*/customers/{uid}.email` (needs the `COLLECTION_GROUP` override on
`customers.uid`). It runs from the action handler when the user happens to be
signed in there, and from `/api/auth/register` - which the login form now
calls on every sign-in, making true what that route's comments already
claimed.

**`Voucher.userEmail` and `Payment.userEmail` deliberately do not follow.**
They record who bought what, at the address they bought it under. Rewriting
them would quietly revise history, the same reasoning that forbids deleting a
voucher document to clear reconciliation drift - and a receipt that no longer
matches the one Paystack sent is worse than one addressed to an old inbox.

## The custom action handler at `/auth/action`

> **Built, deployed, and currently unreachable.** Google refuses the project
> setting that would point links at it - see "Why it is not switched on"
> below. Links still land on Firebase's own handler, which works. Nothing in
> the verification or email-change feature depends on this; only the branding
> of the landing page does.

The intent is that all Firebase email links land on our own page rather than
`<project>.firebaseapp.com/__/auth/action`.

**It is on the apex and must stay there.** The authorized-domain list takes no
wildcards, so a per-tenant subdomain could never be listed; one fixed URL is
authorised once and serves every tenant. Returning to a subdomain afterwards
is our own `window.location` redirect, with the `continueUrl` validated
through `lib/safe-redirect.ts` - it arrives in a query string and ends up in a
navigation, which is precisely the gadget that module exists to close.

### `ActionCodeSettings.url` is the continue URL, not the handler

Two different things, and conflating them is a silent defect: the handler is
the project-level `callbackUri`, while `url` on a generated link is only where
the user goes **after** the action completes. Setting `url` to `/auth/action`
sends the "Continue" button back to the handler with no code in the query
string, where it correctly reports the link as incomplete - a dead end at the
end of an otherwise successful flow.

`continueUrl()` in `lib/email-identity.ts` returns `/auth` on the apex. The
apex is forced, not chosen: a continue URL must be an authorized domain, and
tenant subdomains can never be listed.

### It has to handle every mode, not just verification

Pointing a template at this page takes Firebase's own handler out of the loop
for that template - and **password reset was already in production**. A
handler that only knew about `verifyEmail` would leave resets landing on a
page that shrugged: the email still sending, the link still valid, nobody able
to finish, and nothing failing anywhere to tell us.

| Mode | Handled by |
| --- | --- |
| `verifyEmail` | `applyActionCode` |
| `verifyAndChangeEmail` | `applyActionCode`, then reconcile |
| `recoverEmail` | `applyActionCode` - the undo link sent to the **old** address |
| `resetPassword` | `verifyPasswordResetCode` then `confirmPasswordReset`, with the new-password form |

Anything else says so plainly rather than rendering a blank card. Codes are
inspected with `checkActionCode` before being spent, so an expired link
produces "ask for a new one" instead of a raw error - which is where people
otherwise give up and email support.

### Why it is not switched on

`notification.sendEmail.callbackUri` is a single project-wide value, and
Google rejects changing it:

```
PATCH .../admin/v2/projects/hotspot-mgt/config?updateMask=notification.sendEmail.callbackUri
400 INVALID_ARGUMENT  EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED
```

It is not a misconfiguration on our side, and we checked each candidate:

- `ogawifi.online` **is** in the authorized-domains list.
- `/auth/action` **is** deployed and returns 200.
- The credential **can** write the field: a deliberate no-op PATCH of the
  same value succeeds. Only an actual change is refused.
- The Firebase console hits this same API, which is why it fails there too
  with its own unhelpful "An error occurred updating action URL".

Other projects report the same pattern on the same field, unresolved - sender
name and reply-to save fine while the action URL and subject are refused.
Plausibly an anti-abuse lock, since those are exactly the fields that would
let someone redirect auth links elsewhere, but that is inference and not
documented by Google.

Reproduce or roll forward with `npm run auth:action-url`, which prints the
reason in one line instead of a stack dump.

### The deploy ordering, for when it is allowed

Flipping the setting before the page is live breaks every action link at once,
**including password resets already in someone's inbox**. So: deploy, check
`/auth/action` externally, then set it. The script enforces both - it refuses
to set `custom` unless the page returns 200 and its host is authorized.

There is no partial migration. One value serves verification, email change and
password reset, which is why the handler covers all four modes rather than
only the one we set out to brand.

The password reset *email* still comes from Firebase's own sender and template,
deliberately: `sendEmail()` treats an unconfigured Mailtrap template as a skip
rather than a failure, which is right for a notification and unacceptable for
an account-recovery path. Moving it to Mailtrap needs a fail-loud mode first.

## What Firestore security rules are (and aren't) doing here

Covered in `docs/data-model.md` - the short version repeated here because it matters for this doc's topic: rules constrain *direct* client-SDK access, which this app deliberately uses for almost nothing (`write: if false` nearly everywhere). The actual authorization logic - "is this the right tenant," "is this role allowed to do this" - lives in the API routes and the server-component gates described above, not in the rules file. Don't go looking in `firestore.rules` for business logic; it's a backstop, not the primary mechanism.
