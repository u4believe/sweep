# Sweep — Web3‑Fiat Stablecoin Payments

> Send USDC to anyone by **email address** — no wallet, no seed phrase, no gas for the sender.
> Built on **Circle's Developer‑Controlled Wallets**, **Gateway**, and **Gas Station**, with **Arc** as the settlement chain.

This repository is a **pnpm monorepo** containing the full Sweep platform: an Express API server, a React single‑page app, and shared TypeScript libraries (database, validation, generated API client).

---

## Table of contents

1. [Architecture](#architecture)
2. [Tech stack](#tech-stack)
3. [Prerequisites](#prerequisites)
4. [Quick start](#quick-start)
5. [Environment variables](#environment-variables)
6. [Database setup](#database-setup)
7. [Running the app](#running-the-app)
8. [Circle integration — detailed walkthrough](#circle-integration--detailed-walkthrough)
9. [Background workers](#background-workers)
10. [Supported chains](#supported-chains)
11. [Deployment](#deployment)
12. [Scripts reference](#scripts-reference)
13. [Security notes](#security-notes)

---

## Architecture

```
Web3-Fiat-Arc/
├── artifacts/
│   ├── api-server/        # Express 5 + TypeScript backend (built with esbuild → dist/index.mjs)
│   │   └── src/
│   │       ├── app.ts             # Express app: helmet, CORS, logging, threat monitor, routes
│   │       ├── index.ts           # Entry: env validation, server listen, worker startup
│   │       ├── routes/            # REST routes (auth, escrow, deposit, withdraw, pay, admin, v1/*)
│   │       └── lib/               # Circle, gateway, email, indexer, workers, logger
│   └── usdc-send/         # React 19 + Vite 7 frontend (built → dist/public, served by the API)
│       └── src/
│           ├── pages/             # landing, dashboard, login, register, pay, subscribe, docs …
│           ├── components/        # UI (Radix), layout, analytics
│           └── lib/               # api client wiring, utils
├── lib/
│   ├── db/                # Drizzle ORM schema + node-postgres pool (@workspace/db)
│   ├── api-zod/           # Shared Zod request/response schemas (@workspace/api-zod)
│   ├── api-client-react/  # Generated typed React hooks for the API
│   └── api-spec/          # API specification
├── schema.sql            # Full Postgres schema (paste into Supabase SQL editor)
├── Dockerfile            # Railway build: frontend → backend, single container
├── railway.json          # Railway deploy config (Dockerfile builder)
├── nixpacks.toml         # Alternative Nixpacks build
├── vercel.json           # Frontend host config (SPA rewrite + /stats Umami proxy)
└── pnpm-workspace.yaml   # Workspace + dependency catalog
```

**Runtime model:** the frontend is built to static files and **served by the API server** in production (`app.ts` serves `usdc-send/dist/public` and falls through to `index.html` for client‑side routing). In development, Vite runs separately and proxies `/api` and `/v1` to the API server.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Package manager | **pnpm 10.33** (workspaces + catalog) |
| Runtime | **Node.js 22** |
| Backend | **Express 5**, TypeScript, esbuild bundle, Pino logging |
| Frontend | **React 19**, **Vite 7**, Tailwind CSS 4, Radix UI, TanStack Query, Wouter, Framer Motion |
| Database | **PostgreSQL** (Supabase) via **Drizzle ORM** (`node-postgres`) |
| Auth & security | JWT, bcrypt, Helmet, express‑rate‑limit, custom threat monitor, email OTP 2FA |
| Web3 / payments | **Circle DCW SDK**, **Circle App Kit**, **Gateway**, **Gas Station**, viem, ethers, @solana/web3.js |
| Email | Resend and/or SMTP (Brevo/Gmail) |
| Hosting | Railway (API + static frontend), Vercel (frontend), Supabase (DB) |

---

## Prerequisites

- **Node.js 22+**
- **pnpm 10.33** — `npm install -g pnpm@10.33.0`
- A **PostgreSQL** database (a free [Supabase](https://supabase.com) project works well)
- A **Circle Developer** account (sandbox): <https://console.circle.com> — for the Developer‑Controlled Wallets API
- An email provider — a [Resend](https://resend.com) API key, or SMTP credentials (Brevo, Gmail app password, etc.)

---

## Quick start

```bash
# 1. Clone and enter the project
git clone <your-repo-url>
cd Web3-Fiat-Arc

# 2. Install all workspace dependencies
pnpm install

# 3. Configure the API server environment
#    Create artifacts/api-server/.env  (see "Environment variables" below)

# 4. Create the database schema
#    Paste schema.sql into your Supabase SQL editor and run it

# 5. Build shared libs + the backend, then start it
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/api-server start          # serves on http://localhost:3001

# 6. In a second terminal, run the frontend dev server
pnpm --filter @workspace/usdc-send dev             # Vite, proxies /api + /v1 → :3001
```

> **Port already in use (`EADDRINUSE :3001`)?** Another process is on port 3001. Find it with
> `lsof -i :3001` and stop it, or run the API on another port by setting `PORT=3002` in
> `artifacts/api-server/.env` **and** `API_PORT=3002` for the Vite dev proxy so the frontend still reaches it.

---

## Environment variables

Create **`artifacts/api-server/.env`**. **Never commit this file** — `.env` and `.env.*` are already git‑ignored (only `.env.example` is allowed). The values below are descriptions/placeholders, **not** real secrets.

### Required (server refuses to start without these)

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Postgres connection string (Supabase → Project → Database → Connection string) |
| `JWT_SECRET` | Random string, **min 32 chars**. Signs user session tokens |
| `PASSPORT_SECRET` | Random string, **min 32 chars**. Signs Sweep Passport tokens |
| `CIRCLE_API_KEY` | Circle Developer API key (sandbox or production) |
| `CIRCLE_WEBHOOK_SECRET` | Secret used to verify Circle webhook signatures |
| `ADMIN_SECRET` | Random string, **min 20 chars**. Guards `/api/admin/*` routes |

### Circle — wallets, gateway & gas

| Variable | Notes |
|----------|-------|
| `CIRCLE_API_BASE_URL` | `https://api-sandbox.circle.com` (sandbox) or production base |
| `CIRCLE_ENTITY_SECRET` | Your Circle entity secret (raw) — used to sign DCW operations |
| `CIRCLE_ENTITY_SECRET_CIPHERTEXT` | Encrypted entity secret registered with Circle |
| `CIRCLE_WALLET_SET_ID` | The DCW wallet set new user wallets are created under |
| `CIRCLE_PLATFORM_WALLET_ID` / `CIRCLE_PLATFORM_WALLET_ADDRESS` | Default treasury wallet id/address |
| `CIRCLE_PLATFORM_WALLET_ID_ARC_TESTNET` … `_BASE_SEPOLIA`, `_ARB_SEPOLIA`, `_OP_SEPOLIA`, `_MATIC_AMOY`, `_AVAX_FUJI`, `_ETH_SEPOLIA`, `_SOL` | Per‑chain treasury wallet ids |
| `CIRCLE_PLATFORM_WALLET_ADDRESS_ARC_TESTNET` / `_SOL` | Per‑chain treasury addresses |
| `CIRCLE_ARC_TESTNET_USDC_TOKEN_ID` | Circle token id for USDC on Arc |
| `CIRCLE_GATEWAY_SIGNER_WALLET_ID` / `CIRCLE_GATEWAY_SIGNER_ADDRESS` | EOA delegate that signs Gateway burn intents (see Circle section) |
| `CIRCLE_GAS_STATION_ENABLED` | `true` to let Gas Station sponsor sweep/withdrawal gas |

### Chains & contracts

| Variable | Notes |
|----------|-------|
| `ARC_RPC_URL`, `BASE_SEPOLIA_RPC_URL` | RPC endpoints |
| `ARC_USDC_ADDRESS`, `BASE_USDC_ADDRESS`, `HYPEREVM_USDC_ADDRESS` | USDC contract addresses |
| `ARC_TESTNET_CHAIN_ID` | Arc testnet chain id |
| `ESCROW_CONTRACT_ADDRESS` | Email‑hash escrow contract address |

### Auth, email & app

| Variable | Notes |
|----------|-------|
| `SESSION_SECRET` | Session signing secret |
| `DEVELOPER_JWT_SECRET`, `DEV_JWT_SECRET` | Sign developer/API‑key tokens for the `/v1` platform |
| `RESEND_API_KEY`, `RESEND_FROM` | Resend transactional email |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | SMTP fallback (use port **587** on WSL2/most hosts) |
| `BREVO_API_KEY`, `BREVO_FROM` | Optional Brevo email |
| `APP_URL`, `FRONTEND_URL` | Public URLs (used in emails, links, CORS) |
| `PORT` | API port (default `3001`) |
| `ALLOWED_ORIGINS` | Comma‑separated CORS allow‑list in production |

> Generate strong secrets with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## Database setup

The schema lives in [`schema.sql`](./schema.sql). It defines: `users`, `otp_codes`, `escrows`, `escrow_balances`, `deposits`, `withdrawals`, `virtual_accounts`, `chain_transactions`, `claim_nonces`, `indexer_state`, `recurring_transfers`, and subscription tables.

1. Open your Supabase project → **SQL Editor**.
2. Paste the contents of `schema.sql` and **Run**. It is idempotent (`CREATE TABLE IF NOT EXISTS`, partial unique indexes, safe `ALTER`s), so it is safe to re‑run.
3. On every server start, `runStartupMigrations()` (from `@workspace/db`) re‑applies idempotent indexes (e.g. the double‑deposit guard) before any worker runs.

The DB is accessed through Drizzle ORM over a `node-postgres` pool (`lib/db/src/index.ts`, `max: 8` connections).

---

## Running the app

### Development

```bash
# Terminal 1 — API server (rebuilds, then runs on :3001)
pnpm --filter @workspace/api-server dev

# Terminal 2 — Vite frontend (hot reload; proxies /api and /v1 to the API)
pnpm --filter @workspace/usdc-send dev
```

### Production‑style (single container)

```bash
pnpm --filter @workspace/usdc-send build      # → artifacts/usdc-send/dist/public
pnpm --filter @workspace/api-server build      # → artifacts/api-server/dist/index.mjs
pnpm --filter @workspace/api-server start      # API serves the built frontend too
```

The backend `start` script runs with `--env-file=.env`, so environment variables are read from `artifacts/api-server/.env`.

---

## Circle integration — detailed walkthrough

Sweep uses Circle's stack so that **no private keys ever live on the server** — all signing happens through Circle's Developer‑Controlled Wallets using your entity secret. The integration code lives in:

- `src/lib/circle.ts` — DCW client, wallet provisioning, balances, transfers, wire deposits, webhooks
- `src/lib/gatewayConfig.ts` — single source of truth for chains, USDC addresses, Gateway contracts, fees
- `src/lib/gatewaySweep.ts` — sweeps, cross‑chain withdrawals (Gateway burn intents), delegate provisioning
- `src/lib/depositIndexer.ts` / `src/lib/arcDepositWorker.ts` — detect on‑chain deposits and trigger sweeps

### Circle products used

| Product | Purpose in Sweep |
|---------|------------------|
| **Developer‑Controlled Wallets (DCW)** | One SCA wallet per user (shared address across EVM chains) + a Solana wallet. Server signs via entity secret. |
| **Gateway** | Unified USDC balance across chains; cross‑chain withdrawals via signed burn intents. |
| **Gas Station** | Sponsors gas for sweep/withdrawal transactions so users (and senders) pay no gas. |
| **Circle Wire / Mint** | Fiat on‑ramp: per‑user wire bank accounts and deposit instructions. |
| **Webhooks** | Notify the server of deposits/transfers so balances are credited. |

### One‑time setup

**1. Create an API key and entity secret.** In the [Circle console](https://console.circle.com) create a (sandbox) API key. Generate an entity secret and register its ciphertext with Circle. Set:

```
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
CIRCLE_ENTITY_SECRET_CIPHERTEXT=...
CIRCLE_API_BASE_URL=https://api-sandbox.circle.com
```

`getDcwClient()` in `circle.ts` initializes the DCW client from these.

**2. Create a wallet set.** All user wallets are created under one wallet set. Set `CIRCLE_WALLET_SET_ID`. (`ensureWalletSet()` will create/resolve it.)

**3. Provision the platform treasury wallets.** Create an SCA treasury wallet per supported chain and record their ids/addresses in the `CIRCLE_PLATFORM_WALLET_ID_*` / `CIRCLE_PLATFORM_WALLET_ADDRESS_*` variables. Arc is the primary settlement chain; deposits are swept here and withdrawals are paid from here.

**4. Set up the Gateway delegate (for cross‑chain withdrawals).** Circle's Gateway only accepts **EOA** signatures for burn intents, but the treasury is an **SCA**. So a dedicated EOA is registered as a per‑token delegate via `addDelegate`:

```bash
# One-time, after the server is running and admin secret is set:
curl -X POST https://<your-host>/api/admin/setup-gateway-delegate \
  -H "x-admin-secret: $ADMIN_SECRET"
```

This creates the EOA signer and submits `addDelegate` on all Gateway‑supported chains. Save the returned wallet id/address into `CIRCLE_GATEWAY_SIGNER_WALLET_ID` / `CIRCLE_GATEWAY_SIGNER_ADDRESS` and restart. The server also calls `provisionGatewayDelegate()` at startup (idempotent, non‑fatal).

**5. Enable Gas Station.** Set `CIRCLE_GAS_STATION_ENABLED=true`. At startup `probeGasStationStatus()` checks that sponsorship is active.

**6. Register the webhook.** Point Circle webhooks at `POST /api/deposit/circle/webhook` and set `CIRCLE_WEBHOOK_SECRET`. The raw request body is captured in `app.ts` so the HMAC signature can be verified before the JSON is trusted. `ensureCircleWebhookSubscription()` can register the subscription for you.

### How the money flows

**User onboarding →** on registration the server calls `createUserCircleWallet()` → `client.createWallets({ accountType: "SCA", … })`. EVM chains share a single on‑chain address; a separate Solana wallet is provisioned. Wallet ids/addresses are stored on the `users` row. `ensureAllChainWallets()` backfills any missing chains.

**Deposit (crypto) →** the user sends USDC to their wallet on any supported chain. The **deposit indexer** detects it, records a `deposits` row (with unique indexes preventing double‑credits), then **sweeps** it to the treasury with `sweepUsdcToPlatformWallet()`. Deposits consolidate into the Arc treasury, where the user's spendable balance lives.

**Deposit (fiat / wire) →** `createCircleWireBankAccount()` + `getCircleWireDepositInstructions()` give the user bank details; Circle mints USDC on receipt and fires a webhook that credits the balance.

**Send by email →** the sender's balance is debited and funds are locked in the email‑hash escrow (`escrows`); only the verified owner of that email can claim them.

**Withdrawal →** `directWalletTransfer()` / `circleTransferUsdc()` pays from the Arc treasury when it holds balance on the destination; otherwise a **Gateway** cross‑chain withdrawal is performed via a signed burn intent (`gatewaySweep.ts`). A flat per‑chain platform fee (see `gatewayConfig.ts`) is deducted.

All chain identifiers, USDC addresses, Gateway contract addresses, fees, and min‑withdrawal rules are centralized in **`gatewayConfig.ts`** — add or toggle a chain there.

---

## Background workers

Started in `src/index.ts` after migrations, stopped on graceful shutdown:

| Worker | Responsibility |
|--------|----------------|
| `depositIndexer` | Scan chains for incoming USDC deposits and credit/sweep them |
| `arcDepositWorker` | Handle Arc‑specific deposit/bridge settlement |
| `sweepReconciliationWorker` | Reconcile in‑flight sweeps to the treasury |
| `withdrawalReconciliationWorker` | Reconcile pending withdrawals |
| `recurringWorker` | Execute scheduled recurring transfers |
| `subscriptionBillingWorker` | Charge active subscriptions on their billing cycle |
| `webhookDelivery` | Deliver HMAC‑signed webhooks to developer endpoints with retries |
| `otpCleanupWorker` | Expire/clean up used OTP codes |

---

## Supported chains

Configured in `gatewayConfig.ts` (testnets). Arc is the treasury/settlement hub.

| Chain | Deposits | Withdrawals | Min withdrawal | Flat fee |
|-------|:--------:|:-----------:|---------------:|---------:|
| **Arc** (treasury) | ✅ | ✅ | $1 | $0.10 |
| Base | ✅ | ✅ | $1 | $0.21 |
| Arbitrum | ✅ | ✅ | $1 | $0.21 |
| Optimism | ✅ | ✅ | $1 | $0.21 |
| Polygon | ✅ | ✅ | $1 | $0.21 |
| Avalanche | ✅ | ✅ | $5 | $0.35 |
| Solana | ✅ | ✅ | $5 | $0.40 |
| Unichain | ❌ | ✅ | $1 | $0.21 |
| Ethereum | ❌ | ❌ | $20 | $2.75 |
| HyperEVM | ❌ | ❌ | $1 | $0.21 |

---

## Deployment

### API server + frontend — Railway (Docker)

The [`Dockerfile`](./Dockerfile) builds the frontend, then the backend, into a single Node 22 container that serves both. `railway.json` selects the Dockerfile builder with an on‑failure restart policy.

1. Create a Railway project from this repo.
2. Add all environment variables from the [Environment variables](#environment-variables) section.
3. Railway builds and runs `node ./dist/index.mjs` on port `3001`.

(`nixpacks.toml` is provided as an alternative Nixpacks build that installs pnpm, builds `@workspace/api-server`, and starts it.)

### Frontend — Vercel (optional split)

[`vercel.json`](./vercel.json) configures the SPA rewrite and a first‑party **`/stats` → Umami** analytics proxy. If hosting the frontend separately on Vercel, set `VITE_API_URL` to your API server's URL and point the build at `artifacts/usdc-send`.

### Database — Supabase

Provision Postgres, run `schema.sql`, and use the connection string as `DATABASE_URL`.

---

## Scripts reference

| Command | What it does |
|---------|--------------|
| `pnpm install` | Install all workspace deps (pnpm enforced) |
| `pnpm --filter @workspace/api-server build` | Bundle the backend with esbuild → `dist/index.mjs` |
| `pnpm --filter @workspace/api-server start` | Run the backend (reads `.env`) on `:3001` |
| `pnpm --filter @workspace/api-server dev` | Build then start (development) |
| `pnpm --filter @workspace/usdc-send dev` | Vite dev server with API proxy |
| `pnpm --filter @workspace/usdc-send build` | Build the frontend → `dist/public` |
| `pnpm run typecheck` | Type‑check libs + all workspace packages |

---

## Security notes

- **No private keys on the server** — all on‑chain signing goes through Circle DCW (entity secret).
- **Secrets stay server‑side.** Anything exposed to the browser must be a `VITE_*` variable and is therefore public — never put Circle keys, JWT secrets, or `DATABASE_URL` there.
- **`.env` is git‑ignored.** Commit only `.env.example` with placeholder keys.
- Layered account security: email‑OTP 2FA, a separate transaction password, bcrypt password hashing, email‑hash privacy (recipient emails stored on‑chain only as hashes).
- Transport & abuse protection: forced HTTPS + HSTS, Helmet headers, strict CORS, rate limiting, and a progressive IP threat monitor.
- Webhook integrity: Circle and outbound developer webhooks are HMAC‑verified against the raw request body.

---

*This is currently a testnet / sandbox build. Before mainnet, complete Circle production onboarding, KYC/AML & compliance, and rotate all secrets.*
