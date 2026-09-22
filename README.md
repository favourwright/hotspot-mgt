# Hotspot Management System

A complete web-based solution for managing MikroTik hotspot voucher sales with integrated payment processing via Paystack.

## 🌟 Features

### For Customers
- 🔐 Secure registration and login
- 🎫 Browse and purchase internet vouchers online
- 💳 Secure payment via Paystack (card, bank transfer, USSD)
- ⚡ Instant voucher generation after payment
- 📱 Mobile-responsive design
- 📋 Personal voucher history
- 📋 Copy credentials with one click

### For Admins
- 📊 Real-time sales dashboard and statistics
- 🗺️ Manage multiple MikroTik router locations
- 💰 Create and manage pricing plans
- 🔄 Automatic MikroTik hotspot user creation
- ⚠️ Failed voucher queue with retry mechanism
- 🔍 Search and filter all vouchers
- 📈 Revenue and performance tracking
- 🧪 Router connection testing

## 🛠️ Tech Stack

- **Framework:** Next.js 16 with App Router (Turbopack)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS + shadcn/ui
- **Authentication:** Firebase Authentication
- **Database:** Cloud Firestore
- **Payments:** Paystack
- **Router Integration:** MikroTik RouterOS REST API
- **Deployment:** Vercel

## 📋 Prerequisites

- Node.js 18+ and npm
- Firebase project with Authentication and Firestore
- Paystack account (test or live mode)
- MikroTik router with REST API enabled (www-ssl service)

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd hotspot-mgt
npm install
```

### 2. Environment Setup

Create `.env.local` in the project root:

```env
# Firebase Client (Public)
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123:web:abc123

# Firebase Admin (Server-side - Secret)
FIREBASE_ADMIN_PROJECT_ID=your-project-id
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYourKey\n-----END PRIVATE KEY-----\n"

# Paystack
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
PAYSTACK_SECRET_KEY=sk_test_xxxxx

# App Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
ADMIN_EMAIL=admin@yourdomain.com
```

### 3. Firebase Setup

1. Create a Firebase project at https://console.firebase.google.com
2. Enable Email/Password authentication
3. Create a Firestore database
4. Deploy security rules from `.kiro/firestore.rules`

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Create Admin Account

1. Register using the email you set in `ADMIN_EMAIL`
2. You'll automatically receive admin privileges
3. Access the admin panel at `/admin`

## 📚 Documentation

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Complete deployment guide for production
- **[PROGRESS.md](./PROGRESS.md)** - Development progress and feature tracking
- **[AGENTS.md](./AGENTS.md)** - AI agent guidelines (if applicable)

## 🏗️ Project Structure

```
hotspot-mgt/
├── app/
│   ├── (auth)/          # Authentication pages
│   ├── (customer)/      # Customer-facing pages
│   ├── (admin)/         # Admin dashboard
│   └── api/             # API routes
├── components/
│   ├── ui/              # shadcn/ui components
│   ├── admin/           # Admin components
│   ├── customer/        # Customer components
│   └── shared/          # Shared components
├── lib/
│   ├── firebase.ts      # Firebase client SDK
│   ├── firebase-admin.ts # Firebase Admin SDK
│   ├── mikrotik.ts      # MikroTik API integration
│   ├── paystack.ts      # Paystack verification
│   └── utils.ts         # Utility functions
├── types/
│   └── index.ts         # TypeScript type definitions
└── proxy.ts             # Route protection middleware
```

## 🔐 Security Features

- ✅ Server-side authentication verification on all API routes
- ✅ Role-based access control (admin/customer)
- ✅ Router credentials stored securely (never exposed to client)
- ✅ Paystack payment verification on server-side only
- ✅ Firestore security rules enforce data access policies
- ✅ All secrets stored as environment variables
- ✅ HTTPS required for MikroTik communication

## 🔌 MikroTik Setup

Enable REST API on your MikroTik router:

```
/ip service set www-ssl port=443 disabled=no
/certificate add name=local-cert common-name=router.local
/ip service set www-ssl certificate=local-cert
```

Create an API user (recommended):

```
/user add name=hotspot-api group=full password=StrongPassword123
```

## 💳 Payment Flow

1. Customer selects a plan and proceeds to checkout
2. Paystack Inline popup opens for payment
3. Customer completes payment
4. Server verifies payment with Paystack API
5. Server generates voucher credentials
6. Server creates hotspot user on MikroTik router
7. Voucher displayed to customer with copy buttons
8. If MikroTik fails, voucher marked as "failed" for admin retry

## 🔧 Common Tasks

### Build for Production

```bash
npm run build
```

### Type Check

```bash
npm run build  # Includes TypeScript checking
```

### Add New UI Component

```bash
npx shadcn@latest add <component-name>
```

### Update Dependencies

```bash
npm update
npm run build  # Verify no breaking changes
```

## 🐛 Troubleshooting

### Build Fails
- Verify all environment variables are set
- Check for TypeScript errors: `npm run build`
- Ensure Node.js version is 18+

### Firebase Connection Issues
- Verify Firebase credentials in `.env.local`
- Check Firebase project is active
- Ensure Firestore rules are deployed

### MikroTik Connection Fails
- Verify www-ssl service is enabled on router
- Check router IP is accessible
- Use connection test in admin panel
- Verify MikroTik profile names match exactly

### Paystack Payment Fails
- Verify Paystack keys are correct
- Check account is verified (for live mode)
- Review Paystack dashboard for errors

## 📊 Admin Features Guide

### Dashboard
- View total revenue, voucher counts, and today's sales
- Quick access to all management sections
- System health indicators

### Locations Management
- Add/edit/delete router locations
- Test router connection before saving
- Toggle location active/inactive
- IP addresses masked for security

### Plans Management
- Create pricing plans per location
- Set price (in Naira), duration, and data limits
- Specify MikroTik profile name
- Toggle plans active/inactive

### Vouchers Management
- View all generated vouchers
- Search by username, email, or location
- Filter by status (active/failed/expired)
- Copy credentials directly from table

### Failed Vouchers Queue
- View all failed voucher generations
- Retry individual vouchers
- Bulk retry all failed vouchers
- Track retry counts and reasons

## 🚀 Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions to Vercel.

Quick deploy:

```bash
# Push to GitHub
git add .
git commit -m "Ready for deployment"
git push

# Deploy to Vercel
# Import your repo at https://vercel.com/new
# Configure environment variables
# Deploy!
```

## 📝 License

[Your License Here]

## 🤝 Contributing

[Your Contributing Guidelines Here]

## 📧 Support

For issues and questions:
- Check the [DEPLOYMENT.md](./DEPLOYMENT.md) troubleshooting section
- Review Vercel logs
- Check Firebase console logs
- Review Paystack dashboard

## 🎉 Acknowledgments

Built with:
- [Next.js](https://nextjs.org/)
- [Firebase](https://firebase.google.com/)
- [Paystack](https://paystack.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)

---

**Made with ❤️ for hotspot operators**
