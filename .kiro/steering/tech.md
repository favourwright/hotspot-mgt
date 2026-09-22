# Tech Stack

## Frontend & Backend
- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui

## Authentication
- **Provider**: Firebase Authentication
- **Method**: Email and password
- **Roles**: customer, admin (stored in Firestore /users/{uid})

## Database
- **Provider**: Firebase Firestore
- **Mode**: Native mode
- **Access**: Server-side only for sensitive data (router credentials, payment records). Client-side allowed only for non-sensitive reads (own vouchers, own payments).

## Payments
- **Provider**: Paystack
- **Integration**: Paystack Inline JS on the frontend to initialize payment. Server-side verification via Paystack API in Next.js API route before any voucher is generated.

## Router Communication
- **Protocol**: MikroTik RouterOS REST API over HTTPS
- **Port**: 443 (www-ssl must be enabled on each router)
- **Auth**: HTTP Basic Auth (router username + password)
- **Called from**: Next.js API routes only. Never from the browser/frontend.

## Hosting
- **Platform**: Vercel (free hobby tier)
- **Environment Variables**: All secrets stored in Vercel environment variables (Firebase service account, Paystack secret key, router credentials encryption key)

## Key Libraries
- `firebase` — Firebase client SDK (Auth + Firestore client-side)
- `firebase-admin` — Firebase Admin SDK (server-side Firestore access in API routes)
- `axios` — HTTP requests to Paystack API from server
- `shadcn/ui` — UI component library
- `tailwindcss` — Utility-first CSS
- `zod` — Schema validation for API route inputs
- `lucide-react` — Icons

## Project Structure
```
/app
  /(auth)
    /login/page.tsx
    /register/page.tsx
  /(customer)
    /page.tsx — plan selection home
    /checkout/page.tsx — payment page
    /voucher/page.tsx — voucher display after payment
    /my-vouchers/page.tsx — customer voucher history
  /(admin)
    /admin/page.tsx — dashboard overview
    /admin/vouchers/page.tsx — all vouchers
    /admin/locations/page.tsx — manage routers
    /admin/plans/page.tsx — manage plans
    /admin/failed/page.tsx — failed generations + retry
  /api
    /payment/verify/route.ts
    /voucher/retry/route.ts
    /admin/locations/route.ts
    /admin/plans/route.ts
    /admin/stats/route.ts

/lib
  /firebase.ts — Firebase client SDK init
  /firebase-admin.ts — Firebase Admin SDK init
  /mikrotik.ts — MikroTik REST API utility
  /paystack.ts — Paystack verification utility

/types
  /index.ts — All shared TypeScript types

/components
  /ui/... — shadcn/ui components
  /customer/... — customer-facing components
  /admin/... — admin-facing components
  /shared/... — shared layout components
```

## Environment Variables Required

### Firebase Client
```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

### Firebase Admin (server-side)
```
FIREBASE_ADMIN_PROJECT_ID
FIREBASE_ADMIN_CLIENT_EMAIL
FIREBASE_ADMIN_PRIVATE_KEY
```

### Paystack
```
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY
PAYSTACK_SECRET_KEY
```

### App
```
NEXT_PUBLIC_APP_URL
ADMIN_EMAIL
```
