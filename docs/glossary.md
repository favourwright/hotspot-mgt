# Glossary

Every other doc in this folder assumes you've read this one. If you hit an unfamiliar term anywhere else in `docs/`, it's defined here first.

This is written for someone who knows how to code (variables, functions, APIs, databases in general) but has never touched this specific stack before.

## The web framework

**Next.js** — the framework this whole app is built with. It's built on top of React (a library for building UIs out of components) and adds things React alone doesn't have: routing (which URL shows which page), a server (code that runs on a machine you control, not in the visitor's browser), and a build system.

**App Router** — Next.js's current way of defining pages: the folder structure under `app/` *is* the URL structure. A file at `app/faq/page.tsx` serves the page at `yoursite.com/faq`. A folder named `[tenantSlug]` means "this segment of the URL is a variable, not a literal word" — `app/[tenantSlug]/page.tsx` matches `/starlinkkonnect`, `/anybusiness`, anything.

**Server component** — a React component that runs only on the server, never in the browser. It can talk directly to the database, read secret environment variables, etc. By default, every component in `app/` is a server component unless marked otherwise. You cannot use browser-only things in them (no `onClick`, no `useState`) — they just fetch data and render HTML.

**Client component** — a React component marked with `"use client"` at the top of the file. It ships its JavaScript to the browser and runs there, so it *can* use `onClick`, `useState`, and respond to things the user does. The tradeoff: it can't directly query the database or use server secrets — it has to ask an API route to do that for it.

**RSC payload** — short for "React Server Component payload." When a server component renders, Next.js doesn't just send plain HTML — it sends a special serialized format that also tells the browser how to "hydrate" (attach interactivity to) any client components embedded inside it. You don't need to understand this deeply, just that it's why raw curl output against a page sometimes looks like unreadable `$`-prefixed JSON rather than plain HTML — that's the RSC payload, still useful for debugging if you know what to grep for (see `docs/auth-and-security.md` for a real example of reading one).

**API route** / **route handler** — a file at `app/api/.../route.ts` that exports functions named after HTTP methods (`GET`, `POST`, `PATCH`, `DELETE`). These are small server-only functions a client component can call over HTTP, the same way you'd call any external API. This is how client components get data or make changes without directly touching the database.

**Middleware** (called `proxy.ts` in this specific Next.js version) — code that runs before *every* request reaches a page or API route, used for lightweight routing decisions. In this app it does almost nothing — see `docs/architecture.md`.

**Turbopack** — the build tool Next.js uses to compile the app (bundle all the TypeScript/React/CSS into what a browser can actually run). You don't interact with it directly; it just runs under `npm run dev` / `npm run build`.

## Language and tooling

**TypeScript** — JavaScript with types added (e.g. `function add(a: number, b: number)` instead of just `function add(a, b)`). Catches a whole category of bugs (wrong data shape, typos in a field name) before the code ever runs. This project uses it in "strict" mode — the strictest setting, which refuses to compile if types are ambiguous.

**Zod** — a library for describing the *shape* of data (what fields exist, what type each one is, which are optional) and validating real data against that shape at runtime. In this project, Zod schemas (in `types/schemas.ts`) are the **single source of truth**: both the TypeScript types *and* the runtime validation come from the same schema definition, so they can never drift apart. See `docs/data-model.md`.

**Zustand** — a small state-management library: a place to keep data that many different components need to read or change, without passing it down through every layer of the component tree by hand. This app uses it for exactly two things: who's logged in (`stores/auth-store.ts`) and the in-progress onboarding wizard's form data (`stores/onboarding-store.ts`).

**TanStack Query** (also called React Query) — a library for client components that manages *server* data: fetching it, caching it, and — critically for this app — automatically re-fetching it when something changes. If component A fetches a list and component B does something that changes that list, TanStack Query is what lets A's list update itself without a full page reload. See `docs/architecture.md` for how this project actually uses it (and one real bug that came from using it halfway).

**Tailwind CSS** — a CSS approach where you style elements by adding utility class names directly in your markup (`className="flex items-center gap-2"`) instead of writing separate `.css` files. **shadcn/ui** is a collection of pre-built, Tailwind-styled components (buttons, dialogs, tables) that this project's `components/ui/` folder is built from.

## Firebase (Google's backend-as-a-service platform)

**Firebase** — a suite of hosted services from Google. This app uses two of them: Authentication and Firestore.

**Firebase Authentication ("Firebase Auth")** — handles user accounts: sign-up, login, password, and issuing proof of identity. It runs partly in the browser (via the Firebase *client* SDK) and partly needs server-side verification (via the Firebase *Admin* SDK — see below). It does **not** store your app's own data like tenants or vouchers — just login credentials and a unique ID per user.

**Firestore** — Firebase's NoSQL document database. Data is organized into **collections** (like a table) containing **documents** (like a row), and documents can have **subcollections** nested inside them. No fixed schema is enforced by Firestore itself — that's what this project uses Zod for. See `docs/data-model.md` for every collection this app actually uses.

**Firebase Admin SDK** — a *server-only* library (never runs in the browser, needs a secret service-account key) that can read/write Firestore and verify Firebase Auth tokens with full privileges, bypassing Firestore's own security rules. Every API route in `app/api/` that touches the database uses this.

**ID token** — a short-lived (about 1 hour), cryptographically signed proof of "this is who the user is," issued by Firebase Auth after login. The browser attaches it to API requests (`Authorization: Bearer <token>`) and the Admin SDK verifies it server-side.

**Session cookie** — a *different*, longer-lived (this app uses 5 days) proof of identity, also issued by Firebase, but stored as an httpOnly browser cookie instead of being manually attached to each request. This app added this specifically so that *server components* (which can't read a manually-passed token, since they render before any client JS runs) can still know who's asking. See `docs/auth-and-security.md` — this was a real gap this project had to fix mid-way through.

**Firestore security rules** — a separate rules file (`firestore.rules`) that Firestore itself enforces for any *direct* client-side read/write (bypassing your API routes entirely). In this app, almost every collection has `write: if false` — meaning the only way to ever write data is through a server API route using the Admin SDK, never directly from the browser. Reads are selectively allowed per-collection based on role/ownership.

**Firestore index** — Firestore requires a pre-built index for certain query shapes (notably: filtering on one field *and* sorting by a different field). Without the matching index deployed, that exact query fails at runtime with an error telling you which index to create. `firestore.indexes.json` declares all of them; `firebase deploy --only firestore:indexes` pushes them live.

## Paystack (the payment processor)

**Paystack** — a Nigerian payment gateway (similar in concept to Stripe) this app uses for every real money movement: a customer buying a voucher, a tenant paying their platform subscription. See `docs/billing-and-payments.md` for the full mechanics — the terms below are just enough to follow along elsewhere.

**Paystack Inline** — the small JavaScript popup that collects card/bank details and actually charges the customer, embedded directly in the page (the customer never leaves the site).

**Subaccount** — a Paystack feature for *splitting* a single payment between two parties automatically — in this app, between the platform and the tenant business. Paystack performs the actual money split; this app never calculates or moves money itself, only records what Paystack reports back.

**Plan** (Paystack's own concept, not this app's `Plan`) and **Subscription** — Paystack's building blocks for *recurring* billing (used for a tenant's own monthly platform fee, not for customer voucher purchases, which are one-off charges).

**Webhook** — an HTTP request Paystack sends *to* this app when something happens on their end (e.g. a subscription payment succeeded), so the app doesn't have to constantly poll Paystack asking "did anything change?"

**Test mode vs. live mode** — Paystack keeps these two completely separate: separate API keys, and any Subaccount/Plan/Customer object created in test mode does not exist in live mode or vice versa. Switching a deployment from test to live keys means every previously-created Paystack object (subaccounts, cached plan codes) must be recreated.

## MikroTik and networking

**MikroTik** — a company that makes network routers. This app manages MikroTik routers remotely via their own built-in HTTP API.

**RouterOS** — the operating system MikroTik routers run. It has its own scripting language and terminal, accessible either over SSH-like access or through...

**Winbox** — MikroTik's own free desktop app for configuring a RouterOS router over the local network. Important distinction this app's UI has to actively clarify for non-technical users: **Winbox runs on your own computer, not on the router** — it's a remote-control tool, not something installed on the router itself.

**Hotspot** — a RouterOS feature that intercepts web traffic from devices on a Wi-Fi network and shows a login page until the device authenticates — this is literally the "voucher" product this whole app sells access to.

**www-ssl service** — the specific RouterOS setting that exposes the router's REST API over HTTPS, which this app calls directly (not through Winbox) once a router is registered, to create/manage hotspot voucher users.

**VPN (Virtual Private Network)** — a general technique for creating an encrypted, private network connection between two machines over the public internet, making them behave as if they were on the same local network even though they're not.

**WireGuard** — the specific, modern VPN protocol this app uses to reach a tenant's router. Necessary because most routers sit behind a home/office internet connection with no public IP address — nothing outside that network can normally reach them. WireGuard creates a persistent, encrypted tunnel between the tenant's router and this app's server, so the server can reach the router's REST API as if it were local. See `docs/router-and-wireguard.md` for the entire setup flow and every real-world failure mode this project hit building it.

**Tunnel IP** — once a WireGuard tunnel is up, each side gets a private IP address *on the tunnel itself* (distinct from either side's real network IP) — this app's server reaches a tenant's router at this address, not the router's real, usually-unreachable home IP.

**Handshake** — the one-time cryptographic exchange that establishes a WireGuard tunnel. A completed handshake proves the tunnel itself works, but — as this project discovered — does **not** by itself prove the router will respond to anything sent through it (that depends on separate configuration, like a firewall rule). This distinction mattered enough to build real diagnostics around it.

**Direct IP (advanced/fallback option)** — this app's alternative to WireGuard, for the rare case where a router already has a public IP reachable directly. Deliberately de-emphasized in the UI since it requires exposing the router's admin interface to the public internet.

## Multi-tenancy (this app's core architecture)

**Multi-tenant** — a single deployment of this app serves many separate businesses ("tenants"), each with their own customers, routers, locations, and vouchers, fully isolated from each other's data, without needing a separate deployment per business.

**Tenant** — one hotspot business using the platform (e.g. "Starlinkkonnect"). Has its own URL slug (`/starlinkkonnect/...`), its own owner, its own Firestore subcollections.

**Path-based tenancy** — this app's specific approach: a tenant is identified by the first segment of the URL path (`/{tenantSlug}/...`), as opposed to the alternative of giving each tenant its own subdomain (`tenant.yourapp.com`). This was the approach used from the very first version of this app — not something weighed against alternatives on paper, just what was built.

**Tenant slug** — the URL-safe identifier for a tenant (e.g. `starlinkkonnect` in `/starlinkkonnect/admin`). Validated and reserved-word-checked by `SlugSchema` in `types/schemas.ts`.

**Role** — every user account has exactly one of three roles, which this app's authorization is built entirely around:
- **customer** — buys vouchers from one or more tenants. Default role for anyone who signs up.
- **owner** — runs one tenant's hotspot business: manages its routers, locations, plans, and views its own vouchers/payments. Can never see another tenant's data.
- **superadmin** — manages the whole platform: creates/edits billing plans, views (but, by design, cannot edit) every tenant's admin data, manages platform-wide config. There's no signup flow for this — it's granted automatically to whichever email matches the `SUPERADMIN_EMAIL` environment variable at the moment that account first registers.
