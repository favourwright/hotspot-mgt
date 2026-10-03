# Project Structure & Conventions

## Routing Conventions
- Use Next.js App Router with route groups: `(auth)`, `(customer)`, `(admin)`
- All admin pages live under `/admin/` path and are protected by middleware
- All API routes live under `/app/api/` and use the Next.js Route Handler pattern
- Customer-facing pages are at the root level of the `(customer)` group

## Component Conventions
- All components are functional components with TypeScript props interfaces
- Props interfaces are defined at the top of the file and named `[ComponentName]Props`
- Use named exports for components, not default exports (except for page.tsx files which must use default export)
- Keep components small and focused. If a component exceeds 150 lines, split it

## Data Fetching
- Server Components fetch data directly using Firebase Admin SDK
- Client Components use `useEffect` + Firebase client SDK for realtime or user-specific data
- API routes handle all mutations (POST, PATCH, DELETE) and sensitive reads
- Never call MikroTik API or Paystack API from client-side code

## API Route Conventions
- Every API route validates its input with Zod before processing
- Every API route verifies the Firebase Auth token from the `Authorization: Bearer <token>` header
- Admin-only routes additionally check that the decoded token's role is `admin`
- All API routes return consistent JSON: `{ success: true, data: ... }` or `{ success: false, error: "..." }`

## Firestore Conventions
- Use typed converter functions for all Firestore reads and writes
- Never store router passwords in plaintext on the client - only read/write router credentials from server-side API routes
- All Firestore collection names are defined as constants in `/lib/firebase-collections.ts`
- Timestamps are always stored as Firestore `serverTimestamp()` not JS Date objects

## Error Handling
- API routes always return appropriate HTTP status codes (200, 400, 401, 403, 404, 500)
- MikroTik call failures do NOT fail the payment - payment is recorded as success, voucher is recorded as `failed` status, and it appears in the admin retry queue
- All errors are logged with context (which router, which voucher, which user) for admin visibility

## TypeScript Conventions
- Strict mode enabled
- No `any` types - use `unknown` and narrow with type guards
- All Firestore document shapes defined in `/types/index.ts`
- Use `zod` schemas for API input validation and infer TypeScript types from them

## Styling Conventions
- Tailwind CSS utility classes only - no custom CSS files except globals.css
- Use shadcn/ui components as the base for all UI elements
- Customer-facing UI: clean, simple, mobile-first
- Admin UI: data-dense, desktop-first but still responsive
- Color scheme: defined in tailwind.config.ts, use CSS variables from shadcn

## Security Conventions
- Firebase Auth token verified on every API route
- Router credentials (IP, username, password) only ever read/written in server-side API routes
- Paystack webhook/verification only ever happens server-side
- Firestore security rules: customers can only read/write their own documents. Admin can read/write everything. Router credentials collection is denied to all client-side access.
- Environment variables prefixed with `NEXT_PUBLIC_` only for non-sensitive values
