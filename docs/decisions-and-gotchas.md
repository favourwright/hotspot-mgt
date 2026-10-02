# Decisions & Gotchas — Quick Index

A scannable list of every non-obvious choice and every real gotcha across this project, each pointing at the doc with the full story. Use this to jump straight to the relevant detail rather than re-reading everything; it's intentionally terse.

## Architecture decisions

- **Multi-tenancy is path-based (`/{tenantSlug}/...`), not subdomain-based.** Never weighed on paper against the alternative — just what was built from the first version. → `docs/architecture.md`
- **Zod schemas are the single source of truth** for both runtime validation and TypeScript types — never define a type separately from its schema. → `docs/data-model.md`
- **`tenantId` always comes from the verified auth token, never from the URL or request body** — with exactly one deliberate exception: `/api/payment/verify`, where the caller is a customer who has no `tenantId` of their own to verify against, so they're trusted to assert which tenant they're paying. → `docs/billing-and-payments.md`
- **`verifyOwner()` accepts both `"owner"` and `"superadmin"`** — the root of every "superadmin can view, but not act on, any tenant's data" behavior in the app. → `docs/auth-and-security.md`
- **A payment that already succeeded is never undone by a later technical failure.** Shows up twice: a MikroTik hotspot-user-creation failure still keeps the payment and voucher (just marks it `"failed"` for retry), and a Paystack subaccount mismatch is logged, never used to block the payment. → `docs/data-model.md`, `docs/billing-and-payments.md`
- **`BillingPlan` pricing is snapshotted onto a `Tenant` at signup; `BillingPlan` limits are read live.** Deliberate asymmetry — price changes shouldn't retroactively apply to existing tenants, but entitlements should always reflect the plan's current real definition. → `docs/data-model.md`
- **Deleting a `BillingPlan` is smart, not absolute**: permanent if unused, archived (never hard-deleted) if any tenant still references it. → `docs/data-model.md`
- **Legacy flat Firestore collections (`locations`, `plans`, `vouchers`, `payments`) are kept but dead** — nothing writes to them anymore; all real data is in tenant subcollections. A handful of orphaned hooks (below) still read from them, pointlessly. → `docs/data-model.md`

## Real incidents and the fixes they produced

- **No server-side auth existed at all, originally** (`proxy.ts`'s middleware explicitly deferred everything to client-side layout checks, by original design). This meant admin/superadmin pages fetched and served real tenant data regardless of who was asking. Fixed by adding an entire session-cookie + server-side verification layer that didn't exist before. → `docs/auth-and-security.md`
- **The visible "flash" of protected content before redirect** was a separate, smaller bug on top of the above: two layouts checked `loading` before rendering but never checked the actual auth *result* — present since the very first implementation of the tenant-admin layout, not a regression. → `docs/auth-and-security.md`
- **A brand-new superadmin registration could get silently stuck as `"customer"`** forever, due to a timing race between Firebase Auth's token listener and this app's own Firestore user-doc creation — made worse once by a long-running dev server holding a stale `SUPERADMIN_EMAIL` env value. Fixed both the race (force a token refresh after registration) and the underlying fragility (the register route now self-heals the role on every call, not just the first). → `docs/auth-and-security.md`
- **RouterOS silently loses variable scope** when a multi-line script is pasted into an interactive terminal unbracketed — each `:local` line executes as its own separate command. Fix: wrap the whole script in one outer `{ }` block. → `docs/router-and-wireguard.md`
- **A WireGuard tunnel can fully, successfully handshake and still be completely unreachable** — ping and handshake state are different signals, and conflating them (as the original reachability check did) makes two unrelated failure causes look identical. → `docs/router-and-wireguard.md`
- **Building on the production VPS directly caused a real outage** — 956MB RAM, no swap at the time, `next build` hung and eventually made the whole VPS unresponsive, requiring a hard reboot. Deployment strategy permanently changed to "build locally, rsync only the output" as a direct result. → `docs/deployment.md`
- **A TanStack Query mutation's `invalidateQueries` is a silent no-op if nothing actually subscribes to that query key.** Several admin tables defined the invalidation but rendered straight off server-passed props instead of `useQuery` — meaning a create/edit/delete appeared to "work" (the mutation succeeded) but the visible list never updated without a manual page reload. Not a crash, not an error — just quietly stale data. Fixed across every affected table by actually subscribing via `useQuery(initialData: ...)`. → `docs/architecture.md`
- **The sidebar's active-link highlighting used `pathname.startsWith(href)`**, which also matches any sibling route that happens to share the same prefix (`/superadmin/billing` matching `/superadmin/billing-plans`). Fixed to require a full path-segment boundary. Same latent bug existed in two separate sidebar components.
- **`@google-cloud/firestore` is an *optional* peer dependency of `firebase-admin`** and can silently fail to install, causing every Admin-SDK-dependent API route to fail with an opaque empty 500 — pin it as an explicit direct dependency in `package.json`, don't rely on it coming along for free. → `docs/deployment.md`
- **`NEXT_PUBLIC_*` env vars are baked in at build time, not read at runtime** — a mismatch between what's in the repo's build environment and what the production server actually needs (a missing port number, a stale test-mode key) ships silently and only shows up as a runtime symptom in production. → `docs/deployment.md`

## Things you'll find in the code that look like bugs but aren't

- **`"admin"` as a stored `role` value** — legacy, translated to `"owner"` on every read site, never migrated in Firestore. Deliberate "never touch old data" policy. → `docs/data-model.md`
- **A tenant's displayed price never changes even after a superadmin edits the plan they're on** — correct, not stale data. → `docs/data-model.md`
- **`PlatformConfig.paystackBearer` has no UI to change it** and always runs at its default. Also: the field's own code comment used to describe its two values backwards relative to Paystack's actual documented behavior for that parameter — fixed in `types/schemas.ts`, worth knowing in case you find an old explanation elsewhere that still has it backwards. → `docs/billing-and-payments.md`

## Dead code you'll encounter (safe to ignore, or a good first cleanup task)

- `hooks/use-vouchers.ts`, `use-all-vouchers.ts`, `use-active-users.ts`, `use-customer-plans.ts` — all query the legacy flat collections directly via the client Firestore SDK, and are imported by nothing anywhere in the app. Pre-multi-tenancy leftovers.
- `app/api/admin/fix-role/route.ts` — an emergency one-off endpoint from early development, explicitly commented as something to delete after use; still present, still unused in practice.

## Test fixtures worth knowing

- Paystack test card: `4084 0840 8408 4081`, any future expiry, any CVV. → `docs/billing-and-payments.md`, `docs/local-setup.md`
