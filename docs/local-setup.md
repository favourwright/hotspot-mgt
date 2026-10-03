# Local Setup - Zero to Running

Assumes you've read `docs/glossary.md`. Follow this top to bottom on a fresh machine and you'll have the app running locally with your own test data.

## 1. Prerequisites

- **Node.js 20 or newer** (CI runs on 20; this project has also been developed on 22). Check with `node -v`.
- **npm** (comes with Node).
- A **Google account**, to create a free Firebase project.
- A **Paystack account** in test mode (free to create, no business verification needed just to get test keys).
- **Git**.

## 2. Clone and install

```bash
git clone <this-repo-url>
cd hotspot-mgt
npm install
```

## 3. Create a Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com) and create a new project (any name).
2. **Add a Web App** to that project (the `</>` icon on the project overview page). This gives you the `NEXT_PUBLIC_FIREBASE_*` values you'll need below.
3. **Enable Authentication** → Sign-in method → enable **Email/Password**. This app doesn't use any other sign-in method.
4. **Create a Firestore database** (production mode is fine - this project supplies its own `firestore.rules`, so Firestore's default "test mode" rules are never actually relied on).
5. **Generate a service account key** for the Admin SDK: Project Settings → Service Accounts → "Generate new private key." This downloads a JSON file containing `project_id`, `client_email`, and `private_key` - you'll need all three, and the file itself should never be committed anywhere.

## 4. Create a Paystack test account

1. Sign up at [paystack.com](https://paystack.com) - you don't need to complete business verification to use test mode.
2. Settings → API Keys & Webhooks → copy the **Test** public key (`pk_test_...`) and secret key (`sk_test_...`). Never use live keys for local development.

## 5. Set up `.env.local`

```bash
cp .env.example .env.local
```

Then fill in every value. What each one is, and where it comes from:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` through `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase Console → Project Settings → your Web App's config object |
| `FIREBASE_ADMIN_PROJECT_ID` | Same as `project_id` in the service account JSON from step 3.5 |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Same as `client_email` in that JSON |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Same as `private_key` in that JSON - paste it with the literal `\n` escapes intact (don't convert them to real newlines) |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Your Paystack **test** public key |
| `PAYSTACK_SECRET_KEY` | Your Paystack **test** secret key |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` for local dev. **This is baked into the client bundle at build time** - if you ever change it, you must rebuild, not just restart |
| `SUPERADMIN_EMAIL` | Any email you plan to register with - that account automatically becomes superadmin the moment it registers (see "Create your first account" below) |
| `ADMIN_EMAIL` | Can be left the same as `SUPERADMIN_EMAIL` - it's a legacy fallback, checked only if `SUPERADMIN_EMAIL` is unset |
| `WG_MANAGER_URL` / `WG_MANAGER_SECRET` | Leave blank for local dev - these only matter on the production VPS (see `docs/deployment.md`). Router registration's WireGuard step simply won't work locally without a real WireGuard manager to talk to, which is expected |

## 6. Deploy Firestore rules and indexes

You need the Firebase CLI once:
```bash
npm install -g firebase-tools
firebase login
```
This repo already has `.firebaserc` pointing at a specific project - if you're using your *own* fresh Firebase project (not the one this repo was originally built against), update `.firebaserc`'s `"default"` value to your own project ID first. Then:
```bash
firebase deploy --only firestore:rules,firestore:indexes
```
Do this now, before first use - several queries in this app (e.g. listing active billing plans) will fail at runtime with an explicit "this query needs an index" error until the matching index in `firestore.indexes.json` has actually been deployed. Re-run this command any time you change `firestore.rules` or `firestore.indexes.json`.

## 7. Run it

```bash
npm run dev
```
Open `http://localhost:3000`.

## 8. Create your first account (and make it superadmin)

Register normally through the app's own sign-up form, using the exact email you set as `SUPERADMIN_EMAIL` in step 5. That account is automatically granted the `superadmin` role the moment it registers - there's no separate admin-creation step or script. Log in and you should land on `/superadmin`.

From there:
- **Superadmin → Billing Plans**: create at least one billing plan - onboarding has nothing to offer a new tenant until one exists.
- **Superadmin → Platform Config**: the WireGuard fields here only matter if you're going to test the router-registration flow, which also needs a real WireGuard manager running somewhere reachable (see `docs/router-and-wireguard.md`, `docs/deployment.md`) - not something a fresh local setup has by default. Everything else (onboarding, billing plans, the customer purchase flow) works fully without it.

To test the rest of the app as a tenant owner, register a *second* account with a different email (not matching `SUPERADMIN_EMAIL`) and go through `/onboarding`.

## Common tasks

```bash
npm run dev         # local dev server (Turbopack, hot reload)
npm run build        # production build + type check
npm run typecheck    # type check only, no build
npm run start         # run a build you already produced (npm run build first)
npm run lint          # currently broken - a pre-existing eslint-plugin-react/ESLint
                      # version mismatch unrelated to this app's own code; CI
                      # deliberately excludes lint for this reason
```

## If something's not working

- **"This query needs an index" error** → you skipped or need to re-run step 6.
- **Registering doesn't make you superadmin** → double check `SUPERADMIN_EMAIL` in `.env.local` *exactly* matches the email you registered with (case doesn't matter, but typos do), and that you restarted `npm run dev` after editing `.env.local` - Next.js only reads env files at process start, a running dev server won't pick up a mid-session edit.
- **Paystack popup doesn't appear / payment fails instantly** → confirm you're using **test** keys (`pk_test_`/`sk_test_`), and use the test card `4084 0840 8408 4081` (any future expiry, any CVV) - see `docs/billing-and-payments.md`.
