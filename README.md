# Hotspot Manager

A web-based hotspot management and payment system for MikroTik routers with Paystack payment integration.

## Features

- **Customer Portal**: Purchase internet vouchers online with instant delivery
- **Admin Dashboard**: Manage locations, plans, vouchers, and track sales
- **MikroTik Integration**: Automatic hotspot user creation via RouterOS REST API
- **Payment Processing**: Secure payments via Paystack
- **Multi-Location Support**: Manage multiple router locations
- **Failed Generation Retry**: Automatic retry for failed voucher generations

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript (strict mode)
- **Authentication**: Firebase Auth (email/password)
- **Database**: Firebase Firestore
- **Payments**: Paystack
- **Router API**: MikroTik RouterOS REST API
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A Firebase project
- A Paystack account
- MikroTik router(s) with REST API enabled (www-ssl service)

### 1. Clone and Install

```bash
git clone <your-repo>
cd hotspot-mgt
npm install
```

### 2. Set Up Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project
3. Enable **Email/Password** authentication:
   - Go to Authentication > Sign-in method
   - Enable Email/Password
4. Create a **Firestore database**:
   - Go to Firestore Database
   - Create database in production mode
   - Choose your region
5. Deploy Firestore Security Rules:
   - Copy rules from `.kiro/firestore.rules`
   - Paste in Firestore > Rules tab
   - Publish
6. Get your Firebase config:
   - Go to Project Settings > General
   - Scroll to "Your apps" and create a web app
   - Copy the config values
7. Create a service account for Admin SDK:
   - Go to Project Settings > Service Accounts
   - Click "Generate new private key"
   - Save the JSON file

### 3. Set Up Paystack

1. Sign up at [Paystack](https://paystack.com)
2. Get your API keys from Settings > API Keys & Webhooks
3. Use test keys for development, live keys for production

### 4. Configure Environment Variables

Copy `.env.local` template and fill in your values:

```bash
# Firebase Client (from Firebase Console > Project Settings)
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Firebase Admin (from Service Account JSON file)
FIREBASE_ADMIN_PROJECT_ID=your_project_id
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your_project_id.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour private key here\n-----END PRIVATE KEY-----\n"

# Paystack
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
PAYSTACK_SECRET_KEY=sk_test_xxxxx

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
ADMIN_EMAIL=admin@yourdomain.com
```

**Important Notes:**
- Keep the quotes around `FIREBASE_ADMIN_PRIVATE_KEY`
- The private key should include `\n` for line breaks
- Set `ADMIN_EMAIL` to the email you'll use for admin access

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 6. Create Admin Account

1. Go to http://localhost:3000/register
2. Register using the email you set in `ADMIN_EMAIL`
3. You'll automatically get admin role
4. Access admin dashboard at http://localhost:3000/admin

## Project Structure

```
/app
  /(auth)          - Login & registration pages
  /(customer)      - Customer-facing pages
  /(admin)         - Admin dashboard (coming soon)
  /api            - API routes
/components
  /ui             - shadcn/ui components
  /shared         - Shared components
/lib
  /firebase.ts           - Firebase client SDK
  /firebase-admin.ts     - Firebase Admin SDK
  /mikrotik.ts          - MikroTik API utility
  /paystack.ts          - Paystack verification
  /auth-context.tsx     - Auth state management
/types
  /index.ts       - TypeScript type definitions
```

## MikroTik Router Setup

For the system to create hotspot users on your router:

1. Enable REST API:
   ```
   /ip service set www-ssl disabled=no
   ```

2. Set a strong password for the admin user

3. Ensure HTTPS certificate is valid (or use development mode)

4. Test connectivity from the app server to router on port 443

## Deployment

### Deploy to Vercel

1. Push code to GitHub
2. Import project in Vercel
3. Add all environment variables in Vercel project settings
4. Deploy

**Important**: Set `NODE_TLS_REJECT_UNAUTHORIZED=0` only in development. In production, use proper SSL certificates.

## Development Progress

See [PROGRESS.md](PROGRESS.md) for implementation status.

## MVP Implementation Steps

1. ✅ Project Setup
2. ✅ MikroTik Utility Layer
3. ✅ Paystack Utility
4. ✅ Authentication
5. ⏳ Location Management (next)
6. ⏳ Plan Management
7. ⏳ Customer Flow
8. ⏳ Admin Dashboard
9. ⏳ Shared Components
10. ⏳ Testing & Deployment

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run typecheck` - Run TypeScript checks
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Security Notes

- Router credentials are stored in Firestore and only accessed server-side
- Paystack verification happens server-side only
- Firebase security rules restrict customer data access
- All API routes verify Firebase Auth tokens
- Admin routes additionally verify admin role

## License

MIT
