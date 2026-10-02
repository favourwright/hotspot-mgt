# Hotspot Manager

A multi-tenant SaaS platform for hotspot/Wi-Fi businesses to sell internet access vouchers online. A business ("tenant") signs up, connects their MikroTik router(s), sets pricing, and their customers buy vouchers instantly via Paystack — no cash, no manual handling. The platform itself charges tenants for using it, via a configurable set of billing plans.

**New to this project, or to any of the technologies it's built on?** Start with [`docs/glossary.md`](docs/glossary.md) — every doc below assumes you've read it.

## Tech stack

Next.js 16 (App Router, TypeScript strict) · Firebase (Authentication + Firestore) · Paystack · MikroTik RouterOS + WireGuard · Zod · Zustand · TanStack Query · Tailwind CSS + shadcn/ui

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/glossary.md`](docs/glossary.md) | Every term used elsewhere — read this first |
| [`docs/architecture.md`](docs/architecture.md) | The big picture: what the product does, the three user roles, how a request actually flows through the app, folder-by-folder tour |
| [`docs/data-model.md`](docs/data-model.md) | Every Firestore collection and field, and *why* each one exists |
| [`docs/local-setup.md`](docs/local-setup.md) | Zero to a running local instance — accounts to create, every env var explained, your first superadmin login |
| [`docs/auth-and-security.md`](docs/auth-and-security.md) | How login actually works end to end, the session-cookie layer, and the real security incidents that shaped it |
| [`docs/billing-and-payments.md`](docs/billing-and-payments.md) | Paystack end to end — customer purchases, tenant subscriptions, test vs. live mode |
| [`docs/router-and-wireguard.md`](docs/router-and-wireguard.md) | MikroTik/WireGuard from scratch, the full router-registration wizard, every real failure mode hit building it |
| [`docs/deployment.md`](docs/deployment.md) | The production VPS, why it's set up the way it is, and how to deploy each of this project's three independently-deployed pieces |
| [`docs/decisions-and-gotchas.md`](docs/decisions-and-gotchas.md) | A scannable index of every non-obvious decision and gotcha above, for quick lookup |

## Quickstart

```bash
git clone <this-repo-url>
cd hotspot-mgt
npm install
cp .env.example .env.local   # then fill it in — see docs/local-setup.md
npm run dev
```

Full walkthrough, including Firebase/Paystack account setup and creating your first superadmin login, is in [`docs/local-setup.md`](docs/local-setup.md) — the steps above will not work on their own without it.

## Common commands

```bash
npm run dev          # local dev server
npm run build        # production build + type check
npm run typecheck    # type check only
npm run start         # run an already-built production bundle
```
