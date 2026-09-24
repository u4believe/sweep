# Sweep — Web3‑Fiat Stablecoin Payments

> Sweep is a Web3-fiat payments app that lets people send USD to each other by **email address** — no wallet, no seed phrase, no gas for the sender. Every balance is backed 1:1 by USDC held in the Sweep treasury, and users can also withdraw USDC to any external wallet on a supported chain.
> Built on **Circle's Developer‑Controlled Wallets**, **Gateway**, and **Gas Station**.

This repository is a **pnpm monorepo** containing the full Sweep platform: an Express API server, a React single‑page app, and shared TypeScript libraries (database, validation, generated API client).

---

## Table of contents

- [Sweep — Web3‑Fiat Stablecoin Payments](#sweep--web3fiat-stablecoin-payments)
  - [Table of contents](#table-of-contents)
  - [Architecture](#architecture)
  - [Tech stack](#tech-stack)
  - [Prerequisites](#prerequisites)
  - [Quick start](#quick-start)
  - [Environment variables](#environment-variables)
    - [Required (server refuses to start without these)](#required-server-refuses-to-start-without-these)
    - [Circle — wallets, gateway \& gas](#circle--wallets-gateway--gas)
    - [Chains \& contracts](#chains--contracts)
    - [Auth, email \& app](#auth-email--app)
  - [Database setup](#database-setup)
  - [Running the app](#running-the-app)
    - [Development](#development)
    - [Production‑style (single container)](#productionstyle-single-container)
  - [Circle integration — detailed walkthrough](#circle-integration--detailed-walkthrough)
    - [Circle products used](#circle-products-used)
    - [One‑time setup](#onetime-setup)
    - [How the money flows](#how-the-money-flows)
  - [Background workers](#background-workers)
  - [Supported chains](#supported-chains)
  - [Deployment](#deployment)
    - [API server + frontend — Railway (Docker)](#api-server--frontend--railway-docker)
    - [Frontend — Vercel (optional split)](#frontend--vercel-optional-split)
    - [Database — Supabase](#database--supabase)
  - [Scripts reference](#scripts-reference)
  - [Security notes](#security-notes)

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
| Auth & security | JWT sessions, bcrypt, email OTP on login, optional authenticator‑app 2FA (TOTP), Google Sign‑In, Cloudflare Turnstile, Helmet, custom threat monitor |
| Web3 / payments | **Circle DCW SDK**, **Circle App Kit**, **Gateway**, **Gas Station**, viem, ethers, @solana/web3.js |
| Email | Resend, Brevo or SMTP, tried in that order (falls back to logging emails to the console when none is set) |
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
| `ADMIN_SECRET` | Random string, **min 20 chars**. Guards `/api/admin/*` routes (sent as `Authorization: Bearer …`) |
| `PORT` | Port the API listens on (e.g. `3001`). There is no default — the server exits if it's missing |

### Circle — wallets, gateway & gas

| Variable | Notes |
|----------|-------|
| `CIRCLE_API_BASE_URL` | `https://api-sandbox.circle.com` (sandbox) or production base |
| `CIRCLE_ENTITY_SECRET` | Your Circle entity secret — used to sign DCW operations |
| `CIRCLE_WALLET_SET_ID` | The DCW wallet set new user wallets are created under |
| `CIRCLE_PLATFORM_WALLET_ID` / `CIRCLE_PLATFORM_WALLET_ADDRESS` | Default treasury wallet id/address |
| `CIRCLE_PLATFORM_WALLET_ID_ARC_TESTNET` … `_BASE_SEPOLIA`, `_ARB_SEPOLIA`, `_OP_SEPOLIA`, `_MATIC_AMOY`, `_AVAX_FUJI`, `_SOL` | Per‑chain treasury wallet ids (or set them all at once as JSON in `CIRCLE_PLATFORM_WALLET_IDS_JSON`) |
| `CIRCLE_PLATFORM_WALLET_ID_ETH_SEPOLIA`, `_UNICHAIN_SEPOLIA`, `_MONAD_TESTNET` | Read by `scripts/provision-treasury-wallets.mjs`, which creates any missing treasury wallets and skips chains that already have an id set |
| `CIRCLE_PLATFORM_WALLET_ADDRESS_ARC_TESTNET` / `_SOL` | Per‑chain treasury addresses |
| `CIRCLE_ARC_TESTNET_USDC_TOKEN_ID`, `CIRCLE_BASE_SEPOLIA_USDC_TOKEN_ID` | Circle token ids for USDC on Arc / Base |
| `CIRCLE_MASTER_WALLET_ID` | Circle wallet used as the source for bank (wire) withdrawals |
| `CIRCLE_GATEWAY_SIGNER_WALLET_ID` / `CIRCLE_GATEWAY_SIGNER_ADDRESS` | EOA delegate that signs Gateway burn intents (see Circle section) |
| `CIRCLE_GAS_STATION_ENABLED` | `true` to let Gas Station sponsor sweep/withdrawal gas |

### Chains & contracts

| Variable | Notes |
|----------|-------|
| `ARC_RPC_URL`, `BASE_SEPOLIA_RPC_URL`, `SOLANA_RPC_URL` | RPC endpoints (sensible testnet defaults are built in) |
| `ARC_USDC_ADDRESS`, `BASE_USDC_ADDRESS`, `HYPEREVM_USDC_ADDRESS` | USDC contract addresses (defaults built in) |

### Auth, email & app

| Variable | Notes |
|----------|-------|
| `GOOGLE_CLIENT_ID` | Optional. OAuth "Web application" client ID — enables **Sign in with Google** (the button stays hidden until set) |
| `TOTP_ENCRYPTION_KEY` | Random string, **min 32 chars**. Encrypts users' authenticator‑app secrets — authenticator 2FA is unavailable until set. Never change it once users have enabled 2FA |
| `TURNSTILE_SECRET_KEY` | Optional. Cloudflare Turnstile secret — bot check on sign‑up and password reset (skipped when unset) |
| `RESEND_API_KEY`, `RESEND_FROM` | Resend transactional email |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | SMTP fallback (use port **587** on WSL2/most hosts) |
| `BREVO_API_KEY`, `BREVO_FROM` | Optional Brevo email |
| `APP_URL`, `FRONTEND_URL` | Public URLs (used in emails, links, CORS) |
| `ALLOWED_ORIGINS` | Comma‑separated CORS allow‑list in production |
| `LOG_LEVEL` | Optional Pino log level (default `info`) |

**Frontend** (`artifacts/usdc-send`, build‑time — these end up in the browser, so they must never be secrets):

| Variable | Notes |
|----------|-------|
| `VITE_API_URL` | API base URL when the frontend is hosted separately (leave empty when the API serves the frontend) |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (pairs with `TURNSTILE_SECRET_KEY`) |
| `VITE_UMAMI_SRC`, `VITE_UMAMI_WEBSITE_ID`, `VITE_UMAMI_HOST_URL` | Optional Umami analytics |

> Generate strong secrets with: `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## Database setup

The source of truth for the schema is the Drizzle definitions in [`lib/db/src/schema`](./lib/db/src/schema) (22 tables).

[`schema.sql`](./schema.sql) covers only the **core** tables — `users`, `otp_codes`, `escrows` (the email‑transfer ledger), `escrow_balances`, `deposits`, `withdrawals`, `virtual_accounts`, `chain_transactions`, `claim_nonces`, `indexer_state` and `recurring_transfers`. It does **not** include the subscription, developer‑API (`developers`, `developer_api_keys`, `webhook_endpoints`, `webhook_events`) or `subscription_payments` tables.

1. Create the full schema from the Drizzle definitions: `pnpm --filter @workspace/db push` (reads `DATABASE_URL` from the repo‑root `.env`). Alternatively run `schema.sql` in the Supabase SQL editor for the core tables and create the rest from the Drizzle schema.
2. On every server start, `runStartupMigrations()` (from `@workspace/db`) adds newer `users` columns (login lockout, Google sign‑in, authenticator 2FA) and re‑applies the idempotent unique indexes that guard against double deposits, before any worker runs.

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
| **Developer‑Controlled Wallets (DCW)** | One SCA wallet per user across the EVM chains (shared address) plus a separate Solana EOA wallet. Transactions are signed through Circle using the entity secret. |
| **Gateway** | Unified USDC balance across chains; cross‑chain withdrawals via signed burn intents. |
| **Gas Station** | Sponsors gas for sweep/withdrawal transactions so users (and senders) pay no gas. |
| **Circle Wire / Mint** | Bank **withdrawals** via Circle wire payouts (`/api/withdraw/fiat`). Wire **deposits** are implemented in the API (per‑user wire accounts and instructions) but not yet exposed in the app, which shows bank deposits as *coming soon*. |
| **Webhooks** | Notify the server of deposits/transfers so balances are credited. |

### One‑time setup

**1. Create an API key and entity secret.** In the [Circle console](https://console.circle.com) create a (sandbox) API key, then generate an entity secret and register it with Circle. Set:

```
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
CIRCLE_API_BASE_URL=https://api-sandbox.circle.com
```

`getDcwClient()` in `circle.ts` initializes the DCW client from these.

**2. Create a wallet set.** All user wallets are created under one wallet set. Set `CIRCLE_WALLET_SET_ID`. (`ensureWalletSet()` will create/resolve it.)

**3. Provision the platform treasury wallets.** Create an SCA treasury wallet per supported chain and record their ids/addresses in the `CIRCLE_PLATFORM_WALLET_ID_*` / `CIRCLE_PLATFORM_WALLET_ADDRESS_*` variables (or run `scripts/provision-treasury-wallets.mjs`). There is no single home chain: each chain's deposits are swept into that chain's treasury wallet, and on-chain funds are pooled in Circle Gateway's unified balance so withdrawals can go out on any supported chain.

**4. Set up the Gateway delegate (for cross‑chain withdrawals).** Circle's Gateway only accepts **EOA** signatures for burn intents, but the treasury is an **SCA**. So a dedicated EOA is registered as a per‑token delegate via `addDelegate`:

```bash
# One-time, after the server is running and admin secret is set:
curl -X POST https://<your-host>/api/admin/setup-gateway-delegate \
  -H "Authorization: Bearer $ADMIN_SECRET"
```

This creates the EOA signer and submits `addDelegate` on all Gateway‑supported chains. Save the returned wallet id/address into `CIRCLE_GATEWAY_SIGNER_WALLET_ID` / `CIRCLE_GATEWAY_SIGNER_ADDRESS` and restart. The server also calls `provisionGatewayDelegate()` at startup (idempotent, non‑fatal).

**5. Enable Gas Station.** Set `CIRCLE_GAS_STATION_ENABLED=true`. At startup `probeGasStationStatus()` checks that sponsorship is active.

**6. Register the webhook.** In the Circle console, point webhooks at `https://<your-host>/api/deposit/circle/webhook?token=<CIRCLE_WEBHOOK_SECRET>`. The server rejects notifications whose `token` doesn't match `CIRCLE_WEBHOOK_SECRET`. (`circle.ts` also exports `ensureCircleWebhookSubscription()`, but it isn't called automatically.)

### How the money flows

**User onboarding →** on registration (email or Google) the server calls `createUserCircleWallet()`, which creates an SCA wallet across the EVM chains (one shared address) and a separate Solana EOA wallet. Wallet ids/addresses are stored on the `users` row. `ensureAllChainWallets()` backfills any missing chains.

**Deposit (crypto) →** the user sends USDC to their wallet on any supported chain. The **deposit indexer** detects it, records a `deposits` row (with unique indexes preventing double‑credits), then **sweeps** it into Sweep's treasury wallet **on the same chain**. On EVM chains the treasury then deposits it into **Circle Gateway** (`evmGatewaySweep()`: approve + `depositFor`), adding it to the unified balance. The user's spendable balance is their Sweep ledger balance, credited when the deposit is detected — it isn't tied to any one chain.

**Deposit (fiat / wire) →** *implemented in the API, not yet enabled in the app.* `createCircleWireBankAccount()` + `getCircleWireDepositInstructions()` produce bank details; Circle mints USDC on receipt and a `payments` webhook credits the balance.

**Send by email →** a ledger transfer between Sweep balances (no on-chain transaction): the sender's balance is debited and a transfer record is written to `escrows`. If the recipient already has an account they're credited immediately; otherwise the transfer stays pending and is credited when they sign up with that email.

**Withdrawal (crypto) →** `directWalletTransfer()` / `circleTransferUsdc()` pays from the treasury when it holds balance on the destination chain; otherwise a **Gateway** cross‑chain withdrawal is performed via a signed burn intent (`gatewaySweep.ts`). A flat per‑chain platform fee (see `gatewayConfig.ts`) is deducted, and the balance is refunded if the transfer fails.

**Withdrawal (bank) →** a Circle wire payout to the user's bank account; the balance is refunded if the payout can't be initiated.

All chain identifiers, USDC addresses, Gateway contract addresses, fees, and min‑withdrawal rules are centralized in **`gatewayConfig.ts`** — add or toggle a chain there.

---

## Background workers

Started in `src/index.ts` after migrations, stopped on graceful shutdown:

| Worker | Responsibility |
|--------|----------------|
| `depositIndexer` | Scan chains for incoming USDC deposits and credit/sweep them |
| `arcDepositWorker` | Poll each user's Arc wallet for USDC deposits the global indexer can miss, credit them, and sweep them to the treasury |
| `sweepReconciliationWorker` | Reconcile in‑flight sweeps to the treasury |
| `withdrawalReconciliationWorker` | Reconcile pending withdrawals |
| `recurringWorker` | Execute scheduled recurring transfers |
| `subscriptionBillingWorker` | Charge active subscriptions on their billing cycle |
| `webhookDelivery` | Deliver HMAC‑signed webhooks to developer endpoints with retries |
| `otpCleanupWorker` | Delete expired and used OTP codes |

---

## Supported chains

Configured in `gatewayConfig.ts` (testnets). There is no hub chain — deposit on any enabled chain and withdraw on any enabled chain, with Circle Gateway's unified balance moving USDC between them.

| Chain | Deposits | Withdrawals | Min withdrawal | Flat fee |
|-------|:--------:|:-----------:|---------------:|---------:|
| Arc | ✅ | ✅ | $1 | $0.10 |
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

- **No private keys on the server** — on‑chain signing goes through Circle Developer‑Controlled Wallets using the entity secret. Sweep is custodial: user balances are held in the Sweep treasury and backed 1:1 by USDC.
- **Secrets stay server‑side.** Anything exposed to the browser must be a `VITE_*` variable and is therefore public — never put Circle keys, JWT secrets, `TOTP_ENCRYPTION_KEY` or `DATABASE_URL` there. `.env` is git‑ignored; commit only `.env.example`.
- **Account security** — bcrypt‑hashed passwords, an email code on every password login, optional authenticator‑app 2FA (secrets encrypted at rest), Google Sign‑In, lockout after repeated failed logins, a separate transaction password for every send, and a Personal Authorization Key for sensitive account changes.
- **Money movement** — balance changes are atomic database updates, and unique constraints plus reconciliation workers guard against double credits and double spends.
- **Transport & abuse protection** — HTTPS redirect and HSTS in production, Helmet headers, a CORS allow‑list, rate limiting on withdrawals, a progressive IP threat monitor, and an optional Cloudflare Turnstile check on sign‑up and password reset.
- **Webhooks** — incoming Circle webhooks must carry the shared secret token; outbound developer webhooks are HMAC‑SHA256 signed. Developer API keys are stored only as SHA‑256 hashes.

---

*This is currently a testnet / sandbox build. Before mainnet, complete Circle production onboarding, KYC/AML & compliance, and rotate all secrets.*
