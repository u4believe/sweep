/**
 * Circle integration — DCW client, wallet provisioning, USDC transfers.
 *
 * Supported networks:
 *   ARC-TESTNET  — Primary treasury chain. Arc deposits swept directly here;
 *                  Base Sepolia deposits bridged here via CCTP V2 fast transfer.
 *                  All withdrawals are sent from the Arc treasury wallet.
 *   BASE-SEPOLIA — User deposit chain only. No direct withdrawals from here.
 *
 * No private keys on the server. All signing uses Circle DCW (entity secret).
 */

import axios from "axios";
import { randomUUID } from "node:crypto";
import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

// ─── Environment ──────────────────────────────────────────────────────────────

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY!;
const CIRCLE_API_BASE_URL  = (process.env.CIRCLE_API_BASE_URL || "https://api-sandbox.circle.com")
  .replace(/\/v1\/w3s\/?$/, "")
  .replace(/\/$/, "");
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;
let   CIRCLE_WALLET_SET_ID = process.env.CIRCLE_WALLET_SET_ID;

// ─── Supported chains ─────────────────────────────────────────────────────────

// All deposit-enabled chains. ETH-SEPOLIA, UNICHAIN-SEPOLIA, HYPEREVM-TESTNET are withdrawals-only.
export const SUPPORTED_SOURCE_CHAINS = [
  "BASE-SEPOLIA", "ARC-TESTNET", "ARB-SEPOLIA", "OP-SEPOLIA",
  "MATIC-AMOY", "AVAX-FUJI", "SOL-DEVNET",
] as const;
export type  SourceChain = (typeof SUPPORTED_SOURCE_CHAINS)[number];

// Aliases kept for route/worker compatibility
export const SUPPORTED_BLOCKCHAINS = SUPPORTED_SOURCE_CHAINS;
export type  SupportedBlockchain   = SourceChain;

export const PRIMARY_BLOCKCHAIN = "ARC-TESTNET" as SourceChain;

// ─── App Kit chain identifiers ────────────────────────────────────────────────

// App Kit chain IDs — only chains with Circle wallet connection support.
export const APP_KIT_CHAIN_IDS: Partial<Record<SourceChain, string>> = {
  "BASE-SEPOLIA": "Base_Sepolia",
  "ARC-TESTNET":  "Arc_Testnet",
};

// ─── USDC contract addresses ──────────────────────────────────────────────────
// Only chains directly monitored by the deposit indexer via RPC.

export const CHAIN_USDC_ADDRESSES: Partial<Record<SourceChain, string>> = {
  "BASE-SEPOLIA": (process.env.BASE_USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e").toLowerCase(),
  "ARC-TESTNET":  (process.env.ARC_USDC_ADDRESS ?? process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000").toLowerCase(),
};

// USDC decimals — only for RPC-monitored chains.
export const CHAIN_USDC_DECIMALS: Partial<Record<SourceChain, number>> = {
  "BASE-SEPOLIA": 6,
  "ARC-TESTNET":  6,
};

// ─── RPC URLs ─────────────────────────────────────────────────────────────────
// Only chains with direct RPC access for the deposit indexer.

export const CHAIN_RPC_URLS: Partial<Record<SourceChain, string>> = {
  "BASE-SEPOLIA": process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
  "ARC-TESTNET":  process.env.ARC_RPC_URL ?? process.env.RPC_URL ?? "https://rpc.testnet.arc.network",
};

// ─── Entity-specific USDC token IDs ──────────────────────────────────────────
// These are confirmed live via getWalletTokenBalance and cached.
// Override with env vars if Circle changes them.
// ARC-TESTNET token ID must be set manually since Arc USDC (0x3600 precompile)
// may not be auto-indexed by Circle DCW — run the diagnostic script to find it.

const BASE_SEPOLIA_USDC_TOKEN_ID  = process.env.CIRCLE_BASE_SEPOLIA_USDC_TOKEN_ID  ?? "bdf128b4-827b-5267-8f9e-243694989b5f";
const ARC_TESTNET_USDC_TOKEN_ID   = process.env.CIRCLE_ARC_TESTNET_USDC_TOKEN_ID   ?? null;

const _tokenIdCache = new Map<string, string>(); // walletId → USDC token ID

export function clearTokenIdCache(walletId: string): void {
  _tokenIdCache.delete(walletId);
}

// ─── HTTP client ──────────────────────────────────────────────────────────────

const circleHttpClient = axios.create({
  baseURL: CIRCLE_API_BASE_URL,
  headers: {
    Authorization: `Bearer ${CIRCLE_API_KEY}`,
    "Content-Type": "application/json",
  },
});

// ─── DCW client singleton ─────────────────────────────────────────────────────

let _dcwClient: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;

export function getDcwClient() {
  if (!CIRCLE_ENTITY_SECRET) return null;
  if (!_dcwClient) {
    _dcwClient = initiateDeveloperControlledWalletsClient({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
    });
  }
  return _dcwClient;
}

async function ensureWalletSet(): Promise<string | null> {
  if (CIRCLE_WALLET_SET_ID) return CIRCLE_WALLET_SET_ID;
  const client = getDcwClient();
  if (!client) return null;
  try {
    const res = await client.createWalletSet({ name: "USDC App User Wallets" });
    const id = (res.data as any)?.walletSet?.id || (res as any)?.walletSet?.id;
    if (id) { CIRCLE_WALLET_SET_ID = id; return id; }
  } catch (e: any) {
    console.warn("[Circle DCW] Could not create wallet set:", e?.message || e);
  }
  return null;
}

// ─── User wallet provisioning ─────────────────────────────────────────────────
// Creates SCA wallets on all supported EVM chains in a single Circle DCW call.
// EIP-4337 SCA wallets derive the same address on all EVM chains from the same
// factory + salt, so all EVM wallets share one on-chain address.
// UNICHAIN-SEPOLIA is excluded — not supported by Circle DCW wallet creation.
// SOL-DEVNET is created separately as an EOA (different account type).

// ETH-SEPOLIA, UNICHAIN-SEPOLIA, HYPEREVM-TESTNET are withdrawals-only — no user deposit wallets.
const EVM_CHAINS_FOR_WALLET = [
  "BASE-SEPOLIA", "ARC-TESTNET", "ARB-SEPOLIA", "OP-SEPOLIA",
  "MATIC-AMOY", "AVAX-FUJI",
] as const;

export async function createUserCircleWallet(_userId: number): Promise<{
  walletId: string;
  address: string;
  walletIdsJson: string;
  walletAddressesJson: string;
}> {
  const client      = getDcwClient();
  const walletSetId = await ensureWalletSet();

  if (!client || !walletSetId) {
    throw new Error(
      "Circle DCW is not configured. Set CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, and CIRCLE_WALLET_SET_ID.",
    );
  }

  // Step 1: EVM SCA wallets — all chains share one on-chain address.
  const evmRes = await client.createWallets({
    blockchains:    EVM_CHAINS_FOR_WALLET as unknown as any[],
    count:          1,
    walletSetId,
    accountType:    "SCA" as any,
    idempotencyKey: randomUUID(),
  });

  const wallets: any[] = (evmRes.data as any)?.wallets ?? (evmRes as any)?.wallets ?? [];
  if (wallets.length === 0) {
    throw new Error("Circle DCW createWallets returned no wallets — check API credentials and wallet set.");
  }

  const idsMap:  Record<string, string> = {};
  const addrMap: Record<string, string> = {};

  for (const w of wallets) {
    const chain = (w.blockchain ?? w.chain) as string | undefined;
    if (chain) {
      idsMap[chain]  = w.id as string;
      addrMap[chain] = w.address as string;
    }
  }

  const baseSepolia = wallets.find((w: any) => (w.blockchain ?? w.chain) === "BASE-SEPOLIA");
  if (!baseSepolia) {
    throw new Error("Circle DCW did not return a BASE-SEPOLIA wallet — check API credentials and wallet set.");
  }

  // Step 2: SOL-DEVNET EOA wallet (separate call — different account type).
  try {
    const solRes = await client.createWallets({
      blockchains:    ["SOL-DEVNET"] as any[],
      count:          1,
      walletSetId,
      accountType:    "EOA" as any,
      idempotencyKey: randomUUID(),
    });
    const solWallets: any[] = (solRes.data as any)?.wallets ?? (solRes as any)?.wallets ?? [];
    const sol = solWallets[0];
    if (sol?.id) {
      idsMap["SOL-DEVNET"]  = sol.id as string;
      addrMap["SOL-DEVNET"] = sol.address as string;
      console.info(`[Circle DCW] Created SOL-DEVNET wallet ${sol.id} @ ${sol.address}`);

      // Provision native SOL so the wallet can pay Solana tx fees and ATA creation rent.
      // Without SOL, Circle DCW createTransaction for SPL transfers fails silently.
      try {
        await client.requestTestnetTokens({
          address:    sol.address as string,
          blockchain: "SOL-DEVNET" as any,
          native:     true,
        });
        console.info(`[Circle DCW] Requested devnet SOL for ${sol.address}`);
      } catch (faucetErr: any) {
        console.warn(`[Circle DCW] SOL faucet request failed (non-fatal): ${faucetErr?.message}`);
      }
    }
  } catch (e: any) {
    console.warn("[Circle DCW] SOL-DEVNET wallet creation failed — Solana deposits unavailable:", e?.message);
  }

  return {
    walletId:            baseSepolia.id,
    address:             baseSepolia.address,
    walletIdsJson:       JSON.stringify(idsMap),
    walletAddressesJson: JSON.stringify(addrMap),
  };
}

// ─── Backfill missing chain wallets for existing users ────────────────────────
// Called at login. Provisions any chains absent from circleWalletIdsJson.
// Missing EVM chains are created in one batch (same SCA slot = new shared address,
// different from the user's original BASE-SEPOLIA address but stored per-chain in
// circleWalletAddressesJson so the deposit indexer can find them).

export async function ensureAllChainWallets(
  existingIdsJson:   string | null,
  existingAddrsJson: string | null,
): Promise<{ idsJson: string; addrsJson: string } | null> {
  const idsMap   = existingIdsJson   ? (JSON.parse(existingIdsJson)   as Record<string, string>) : {};
  const addrsMap = existingAddrsJson ? (JSON.parse(existingAddrsJson) as Record<string, string>) : {};

  const missingEvm = (EVM_CHAINS_FOR_WALLET as readonly string[]).filter((c) => !idsMap[c]);
  const missingSol = !idsMap["SOL-DEVNET"];

  if (missingEvm.length === 0 && !missingSol) return null;

  const client      = getDcwClient();
  const walletSetId = await ensureWalletSet();
  if (!client || !walletSetId) return null;

  let changed = false;

  if (missingEvm.length > 0) {
    try {
      const res = await client.createWallets({
        blockchains:    missingEvm as any[],
        count:          1,
        walletSetId,
        accountType:    "SCA" as any,
        idempotencyKey: randomUUID(),
      });
      const evmWallets: any[] = (res.data as any)?.wallets ?? (res as any)?.wallets ?? [];
      for (const w of evmWallets) {
        const chain = (w.blockchain ?? w.chain) as string | undefined;
        if (chain && w.id) {
          idsMap[chain]   = w.id as string;
          addrsMap[chain] = w.address as string;
          changed = true;
        }
      }
      console.info(
        `[Circle DCW] Backfilled ${evmWallets.length} EVM chain(s): ${evmWallets.map((w: any) => w.blockchain ?? w.chain).join(", ")}`,
      );
    } catch (e: any) {
      console.warn("[Circle DCW] ensureAllChainWallets EVM backfill failed:", e?.message);
    }
  }

  if (missingSol) {
    try {
      const res = await client.createWallets({
        blockchains:    ["SOL-DEVNET"] as any[],
        count:          1,
        walletSetId,
        accountType:    "EOA" as any,
        idempotencyKey: randomUUID(),
      });
      const solWallets: any[] = (res.data as any)?.wallets ?? (res as any)?.wallets ?? [];
      const sol = solWallets[0];
      if (sol?.id) {
        idsMap["SOL-DEVNET"]   = sol.id as string;
        addrsMap["SOL-DEVNET"] = sol.address as string;
        changed = true;
        console.info(`[Circle DCW] Backfilled SOL-DEVNET wallet ${sol.id} @ ${sol.address}`);
      }
    } catch (e: any) {
      console.warn("[Circle DCW] ensureAllChainWallets SOL backfill failed:", e?.message);
    }
  }

  if (!changed) return null;
  return { idsJson: JSON.stringify(idsMap), addrsJson: JSON.stringify(addrsMap) };
}

// Keep old name as an alias so any remaining import sites don't break.
export const ensureArcTestnetWallet = ensureAllChainWallets;

// ─── USDC balance helpers ─────────────────────────────────────────────────────

function isUsdcToken(b: any): boolean {
  return (
    b.token?.symbol?.toUpperCase() === "USDC" ||
    (b.token?.name ?? "").toLowerCase().includes("usd coin") ||
    // Arc USDC is a native precompile whose name/symbol in Circle's API differs
    // from standard USDC. Match by the known token ID from env as a fallback.
    (ARC_TESTNET_USDC_TOKEN_ID !== null && b.token?.id === ARC_TESTNET_USDC_TOKEN_ID)
  );
}

// Returns true for transient SSL/network errors that are safe to retry.
// WSL2 produces "ssl/tls alert bad record mac" (TCP checksum offloading bug).
function isTransientError(e: any): boolean {
  const msg: string = e?.message ?? "";
  return (
    msg.includes("bad record mac") ||
    msg.includes("SSL") ||
    msg.includes("ssl") ||
    e?.code === "ECONNRESET" ||
    e?.code === "ETIMEDOUT" ||
    e?.code === "ECONNREFUSED"
  );
}

export async function getWalletUsdcBalance(walletId: string): Promise<string> {
  const client = getDcwClient();
  if (!client) return "0";

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await client.getWalletTokenBalance({ id: walletId });
      const tokenBalances: any[] = (res.data as any)?.tokenBalances ?? [];
      const usdcEntry = tokenBalances.find(isUsdcToken);
      if (usdcEntry?.token?.id) _tokenIdCache.set(walletId, usdcEntry.token.id);

      // If no USDC found but the wallet has tokens, log them so we can see what
      // name/symbol Circle uses for Arc USDC (which may not match isUsdcToken).
      if (!usdcEntry && tokenBalances.length > 0) {
        console.warn(
          `[Circle] getWalletUsdcBalance: no USDC match in wallet ${walletId}. ` +
          `Tokens: ` + tokenBalances.map((b: any) =>
            `${b.token?.symbol}/${b.token?.name}/${b.token?.id}=${b.amount}`
          ).join(", "),
        );
      }

      return usdcEntry?.amount ?? "0";
    } catch (e: any) {
      if (isTransientError(e) && attempt < 2) {
        await new Promise(r => setTimeout(r, 1_000 * (attempt + 1)));
        continue;
      }
      console.warn("[Circle DCW] getWalletUsdcBalance error:", e?.message);
      return "0";
    }
  }
  return "0";
}

// Resolves the Circle USDC token ID for a wallet by inspecting its live balance.
// Throws if no USDC is found so the bridge worker retries rather than using a
// wrong token ID (which causes "Cannot find target token" from Circle's API).
async function resolveUsdcTokenId(walletId: string): Promise<string> {
  if (_tokenIdCache.has(walletId)) return _tokenIdCache.get(walletId)!;

  const client = getDcwClient();
  if (!client) throw new Error("Circle DCW client not available");

  const res = await client.getWalletTokenBalance({ id: walletId });
  const tokenBalances: any[] = (res.data as any)?.tokenBalances ?? [];

  // Log all tokens for debugging — especially useful for Arc where the token
  // name/symbol may differ from what isUsdcToken expects.
  if (tokenBalances.length > 0) {
    console.info(
      `[Circle] Tokens in wallet ${walletId}: ` +
      tokenBalances.map((b: any) => `${b.token?.symbol}/${b.token?.name}/${b.token?.id} (${b.amount})`).join(", "),
    );
  } else {
    console.warn(`[Circle] No tokens found in wallet ${walletId} — deposit may not have been indexed yet`);
  }

  // Pick the USDC token with the highest balance. When a wallet holds multiple
  // USDC token IDs (e.g. Arc native + Circle internal, or after a partial sweep
  // leaves one token at 0), always prefer the one that actually has funds.
  const usdcEntry = tokenBalances
    .filter(isUsdcToken)
    .sort((a: any, b: any) => parseFloat(b.amount ?? "0") - parseFloat(a.amount ?? "0"))[0];

  if (!usdcEntry?.token?.id) {
    // Chain-specific env var overrides — set CIRCLE_ARC_TESTNET_USDC_TOKEN_ID
    // or CIRCLE_BASE_SEPOLIA_USDC_TOKEN_ID once you've found the correct values.
    const walletInfo = await client.getWallet({ id: walletId }).catch(() => null);
    // Circle SDK wraps responses in a nested data.data structure.
    const raw        = walletInfo?.data as any;
    const wallet     = raw?.data?.wallet ?? raw?.wallet ?? null;
    const blockchain: string = wallet?.blockchain ?? "";

    console.warn(`[Circle] resolveUsdcTokenId: wallet ${walletId} blockchain="${blockchain}" — no USDC indexed`);

    const envFallback =
      blockchain.includes("ARC")  ? ARC_TESTNET_USDC_TOKEN_ID
      : blockchain.includes("BASE") || blockchain.includes("SEPOLIA") ? BASE_SEPOLIA_USDC_TOKEN_ID
      : null; // Unknown chain — never guess; require explicit env var

    if (envFallback) {
      console.warn(`[Circle] No USDC found in wallet ${walletId} (${blockchain}) — using env fallback ${envFallback}`);
      return envFallback;
    }
    throw new Error(`Wallet ${walletId} (${blockchain || "unknown chain"}) has no USDC and no env fallback configured. Set CIRCLE_ARC_TESTNET_USDC_TOKEN_ID for Arc wallets.`);
  }

  _tokenIdCache.set(walletId, usdcEntry.token.id);
  return usdcEntry.token.id;
}

// ─── Sweep: user wallet → per-chain platform treasury ────────────────────────
// Transfers USDC from a user's Circle SCA wallet to the platform treasury.
// Gas-free via EIP-4337 + Circle Gas Station.
//
// The destination address is resolved per-chain because Arc Testnet's SCA
// factory may produce a different address than the other EVM chains.
// Set CIRCLE_PLATFORM_WALLET_ADDRESS_ARC_TESTNET in .env if it differs from
// CIRCLE_PLATFORM_WALLET_ADDRESS.

export async function sweepUsdcToPlatformWallet(
  userWalletId: string,
  amount: string,
  chainKey?: string,
): Promise<string> {
  const client = getDcwClient();
  if (!client) throw new Error("Circle DCW client not available — CIRCLE_ENTITY_SECRET not set");

  // Use a chain-specific treasury address if configured (Arc Testnet may deploy
  // its SCA at a different address than the other EVM chains).
  const isArc = chainKey === "ARC-TESTNET";
  const destAddress = (isArc && process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_ARC_TESTNET)
    ? process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_ARC_TESTNET
    : (process.env.CIRCLE_PLATFORM_WALLET_ADDRESS ?? "");
  if (!destAddress) throw new Error("CIRCLE_PLATFORM_WALLET_ADDRESS not configured");

  const tokenId = await resolveUsdcTokenId(userWalletId);

  console.info(`[Circle] sweep: walletId=${userWalletId} chain=${chainKey ?? "?"} → treasury=${destAddress} amount=${amount}`);

  const input: any = {
    walletId:           userWalletId,
    tokenId,
    destinationAddress: destAddress,
    amount:             [amount],
    fee:                { config: { feeLevel: "MEDIUM" } },
    idempotencyKey:     randomUUID(),
  };

  try {
    const res  = await client.createTransaction(input);
    const body = res.data as any;
    const txId: string | undefined =
      body?.data?.id ?? body?.transaction?.id ?? body?.id ?? (res as any)?.transaction?.id;
    if (!txId) throw new Error("Circle createTransaction returned no transaction ID");
    return txId;
  } catch (e: any) {
    const msg = e?.response?.data?.message ?? e?.errors?.[0]?.message ?? e?.message ?? "Sweep failed";
    throw new Error(`Circle sweep error: ${msg}`);
  }
}

// ─── Direct wallet transfer (treasury → user withdrawal) ─────────────────────
// Sends USDC from any Circle DCW wallet to an external address via the SDK.
// Uses SDK (not raw fetch) so entity secret ciphertext is handled automatically.
// Works for SCA wallets on any EVM chain where the wallet holds USDC directly.

export async function directWalletTransfer(
  fromWalletId:       string,
  destinationAddress: string,
  amount:             string,
  idempotencyKey:     string = randomUUID(),
): Promise<string> {
  const client = getDcwClient();
  if (!client) throw new Error("Circle DCW client not available — CIRCLE_ENTITY_SECRET not set");

  const tokenId = await resolveUsdcTokenId(fromWalletId);

  console.info(
    `[Circle] directWalletTransfer: walletId=${fromWalletId} → ${destinationAddress} amount=${amount}`,
  );

  const input: any = {
    walletId:           fromWalletId,
    tokenId,
    destinationAddress,
    amount:             [amount],
    fee:                { config: { feeLevel: "MEDIUM" } },
    idempotencyKey,
  };

  try {
    const res  = await client.createTransaction(input);
    const body = res.data as any;
    const txId: string | undefined =
      body?.data?.id ?? body?.transaction?.id ?? body?.id ?? (res as any)?.transaction?.id;
    if (!txId) throw new Error("Circle createTransaction returned no transaction ID");
    return txId;
  } catch (e: any) {
    const msg = e?.response?.data?.message ?? e?.errors?.[0]?.message ?? e?.message ?? "Transfer failed";
    throw new Error(`Circle directWalletTransfer error: ${msg}`);
  }
}

// ─── Transfer from platform treasury → external address (user withdrawals) ────
// Platform treasury is on ARC-TESTNET (Circle DCW wallet).

export async function circleTransferUsdc(
  fromWalletAddress: string,
  toAddress: string,
  _blockchain: string,    // kept for call-site compatibility; always ARC-TESTNET
  _tokenAddress: string,  // kept for call-site compatibility; resolved internally
  amount: string,
  idempotencyKey: string = randomUUID(),  // caller supplies key for replay safety
): Promise<string> {
  const client = getDcwClient();
  if (!client) throw new Error("Circle DCW client not available — CIRCLE_ENTITY_SECRET not set");

  const walletId = await resolveWalletId(fromWalletAddress);
  if (!walletId) throw new Error(`Cannot resolve Circle walletId for ${fromWalletAddress}`);

  const tokenId = await resolveUsdcTokenId(walletId);

  console.info(`[Circle] transfer: walletId=${walletId} → ${toAddress} amount=${amount} idempotencyKey=${idempotencyKey}`);

  const input: any = {
    walletId,
    tokenId,
    destinationAddress: toAddress,
    amount:             [amount],
    fee:                { config: { feeLevel: "MEDIUM" } },
    idempotencyKey,
  };

  try {
    const res  = await client.createTransaction(input);
    const body = res.data as any;
    const txId: string | undefined =
      body?.data?.id ?? body?.transaction?.id ?? body?.id ?? (res as any)?.transaction?.id;
    if (!txId) throw new Error("Circle createTransaction returned no transaction ID");
    return txId;
  } catch (e: any) {
    const msg = e?.response?.data?.message ?? e?.errors?.[0]?.message ?? e?.message ?? "Transfer failed";
    throw new Error(`Circle transfer error: ${msg}`);
  }
}

// ─── Wallet ID resolution ─────────────────────────────────────────────────────

const _walletIdCache = new Map<string, string>(); // address (lower) → walletId

async function recoverWalletIdFromCircle(walletAddress: string): Promise<string | null> {
  const key = walletAddress.toLowerCase();
  if (_walletIdCache.has(key)) return _walletIdCache.get(key)!;

  const client = getDcwClient();
  if (!client || !CIRCLE_WALLET_SET_ID) return null;

  try {
    const res = await client.listWallets({
      walletSetId: CIRCLE_WALLET_SET_ID,
      blockchain:  "BASE-SEPOLIA" as any,
      pageSize:    50,
    });
    const wallets: any[] = (res.data as any)?.wallets ?? [];
    const match = wallets.find((w: any) => w.address?.toLowerCase() === key);
    if (!match?.id) return null;

    _walletIdCache.set(key, match.id);
    console.info(`[Circle] Recovered walletId ${match.id} for ${walletAddress}`);

    // Backfill the DB so future lookups hit the fast path
    try {
      const { db, usersTable } = await import("@workspace/db");
      const { sql, eq } = await import("drizzle-orm");
      const [user] = await db
        .select({ id: usersTable.id, circleWalletIdsJson: (usersTable as any).circleWalletIdsJson })
        .from(usersTable)
        .where(sql`lower(${usersTable.circleWalletAddress}) = lower(${walletAddress})`)
        .limit(1);
      if (user) {
        const existing = user.circleWalletIdsJson ? JSON.parse(user.circleWalletIdsJson) : {};
        existing["BASE-SEPOLIA"] = match.id;
        await db.update(usersTable)
          .set({ circleWalletIdsJson: JSON.stringify(existing) } as any)
          .where(eq(usersTable.id, user.id));
      }
    } catch { /* non-fatal */ }

    return match.id;
  } catch (e: any) {
    console.warn(`[Circle] recoverWalletId failed for ${walletAddress}:`, e?.message);
    return null;
  }
}

async function resolveWalletId(walletAddress: string): Promise<string | null> {
  // Platform treasury
  const platformAddress = getPlatformWalletAddress();
  if (platformAddress?.toLowerCase() === walletAddress.toLowerCase()) {
    return getPlatformWalletId();
  }

  // User wallet — DB lookup first, then Circle API fallback
  try {
    const { db, usersTable } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const [user] = await db
      .select({
        circleWalletId:      usersTable.circleWalletId,
        circleWalletIdsJson: (usersTable as any).circleWalletIdsJson,
      })
      .from(usersTable)
      .where(sql`lower(${usersTable.circleWalletAddress}) = lower(${walletAddress})`)
      .limit(1);

    if (!user) return null;

    if (user.circleWalletIdsJson) {
      const idsMap = JSON.parse(user.circleWalletIdsJson) as Record<string, string>;
      if (idsMap["BASE-SEPOLIA"]) return idsMap["BASE-SEPOLIA"];
    }
    return user.circleWalletId ?? await recoverWalletIdFromCircle(walletAddress);
  } catch {
    return null;
  }
}

// ─── Platform treasury helpers ────────────────────────────────────────────────

// Arc Testnet is the primary treasury chain — all deposits land here and
// all withdrawals are sent from the Arc treasury wallet.
export function getPlatformWalletId(): string | null {
  return process.env.CIRCLE_PLATFORM_WALLET_ID_ARC_TESTNET
    ?? process.env.CIRCLE_PLATFORM_WALLET_ID_BASE_SEPOLIA
    ?? process.env.CIRCLE_PLATFORM_WALLET_ID
    ?? null;
}

export function getArcPlatformWalletId(): string | null {
  return process.env.CIRCLE_PLATFORM_WALLET_ID_ARC_TESTNET ?? null;
}

export function getPlatformWalletAddress(): string | null {
  return process.env.CIRCLE_PLATFORM_WALLET_ADDRESS ?? null;
}

// Kept for backward compat with admin route
export function getPlatformWalletIdForChain(_blockchain: string): string | null {
  return getPlatformWalletId();
}

// ─── Treasury Solana ATA seeding ──────────────────────────────────────────────
// The first SPL transfer to the treasury address requires the treasury's USDC
// Associated Token Account (ATA) to exist. ATA creation costs ~0.002 SOL rent
// which Circle Gas Station does NOT cover. Seeding the treasury's ATA once at
// startup (by requesting devnet USDC via Circle's faucet) ensures every future
// user sweep only needs a transaction fee — which Gas Station DOES sponsor.

export async function ensureTreasurySolanaAtaSeeded(): Promise<void> {
  const treasuryAddress = process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_SOL;
  if (!treasuryAddress) return;

  const client = getDcwClient();
  if (!client) return;

  try {
    const walletId = process.env.CIRCLE_PLATFORM_WALLET_ID_SOL;
    if (!walletId) return;

    const balance = await getWalletUsdcBalance(walletId);
    if (parseFloat(balance) > 0) {
      console.info(`[Circle] Treasury Solana ATA already seeded (balance: ${balance} USDC)`);
      return;
    }

    // Request devnet USDC — this creates the ATA and gives the treasury a small balance.
    await client.requestTestnetTokens({
      address:    treasuryAddress,
      blockchain: "SOL-DEVNET" as any,
      usdc:       true,
    });
    console.info(`[Circle] Requested devnet USDC to seed treasury Solana ATA @ ${treasuryAddress}`);
  } catch (err: any) {
    console.warn(`[Circle] Treasury Solana ATA seed failed (non-fatal): ${err?.message}`);
  }
}

// ─── Gas Station ──────────────────────────────────────────────────────────────
// On testnet, Circle auto-provisions a default Gas Station policy at signup.
// Set CIRCLE_GAS_STATION_ENABLED=true to skip the probe (recommended for testnet).

let _gasStationStatus: "enabled" | "disabled" | "unknown" = "unknown";

export function isGasStationEnabled(): boolean {
  if (process.env.CIRCLE_GAS_STATION_ENABLED === "true") return true;
  return _gasStationStatus === "enabled";
}

export async function probeGasStationStatus(): Promise<void> {
  if (process.env.CIRCLE_GAS_STATION_ENABLED === "true") {
    _gasStationStatus = "enabled";
    console.info("[Circle] Gas Station: enabled (env override)");
    return;
  }
  try {
    const res = await circleHttpClient.get("/v1/w3s/config/entity/gasStation", {
      validateStatus: () => true,
    });
    if (res.status === 200) {
      _gasStationStatus = (res.data?.data?.enabled ?? res.data?.enabled) ? "enabled" : "disabled";
    } else if (res.status === 404) {
      // Testnet auto-policy: 404 means enabled (no explicit configuration needed)
      _gasStationStatus = "enabled";
    } else {
      _gasStationStatus = "disabled";
    }
  } catch {
    _gasStationStatus = "unknown";
  }
  console.info(`[Circle] Gas Station: ${_gasStationStatus}`);
}

// ─── Fiat transfer helpers ────────────────────────────────────────────────────

export interface BankDetails {
  bankAccountNumber: string;
  routingNumber:     string;
  accountHolderName: string;
  country:           string;
}

export async function initiateWireTransfer(
  amount: string,
  bankDetails: BankDetails,
): Promise<{ transferId: string; status: string }> {
  const idempotencyKey = randomUUID();
  try {
    const bankRes = await circleHttpClient.post("/v1/banks/wires", {
      idempotencyKey: `bank-${idempotencyKey}`,
      accountNumber:  bankDetails.bankAccountNumber,
      routingNumber:  bankDetails.routingNumber,
      billingDetails: {
        name:       bankDetails.accountHolderName,
        country:    bankDetails.country,
        city:       "N/A", line1: "N/A", district: "N/A", postalCode: "00000",
      },
      bankAddress: { country: bankDetails.country },
    });
    const bankId = bankRes.data.data.id;
    const payoutRes = await circleHttpClient.post("/v1/payouts", {
      idempotencyKey,
      source:      { type: "wallet", id: process.env.CIRCLE_MASTER_WALLET_ID || "1000216185" },
      destination: { type: "wire", id: bankId },
      amount:      { amount, currency: "USD" },
    });
    return { transferId: payoutRes.data.data.id, status: payoutRes.data.data.status };
  } catch (error: any) {
    if (CIRCLE_API_BASE_URL.includes("sandbox")) return { transferId: randomUUID(), status: "pending" };
    throw new Error(`Circle API error: ${error.response?.data?.message || error.message}`);
  }
}

// ─── Wire bank account helpers ────────────────────────────────────────────────

export async function createCircleWireBankAccount(userId: number): Promise<{
  id: string; trackingRef: string; status: string;
}> {
  const res = await circleHttpClient.post("/v1/businessAccount/banks/wires", {
    idempotencyKey: randomUUID(),
    accountNumber:  `1000${userId.toString().padStart(8, "0")}`,
    routingNumber:  "121000248",
    billingDetails: {
      name: `ARC Finance User ${userId}`,
      city: "San Francisco", country: "US",
      line1: "1 Market St", district: "CA", postalCode: "94105",
    },
    bankAddress: { bankName: "Wells Fargo Bank", city: "San Francisco", country: "US" },
  });
  const data = res.data?.data ?? res.data;
  return { id: data.id, trackingRef: data.trackingRef, status: data.status };
}

export async function getCircleWireDepositInstructions(wireAccountId: string): Promise<any> {
  const res = await circleHttpClient.get(`/v1/businessAccount/banks/wires/${wireAccountId}/instructions`);
  return res.data?.data ?? res.data;
}

export async function createMockWireDeposit(
  trackingRef: string,
  circleAccountNumber: string,
  amountUsd: string,
): Promise<void> {
  await circleHttpClient.post("/v1/mocks/payments/wire", {
    trackingRef,
    amount:          { amount: amountUsd, currency: "USD" },
    beneficiaryBank: { accountNumber: circleAccountNumber },
  });
}

// ─── Circle webhook subscription ─────────────────────────────────────────────

export async function ensureCircleWebhookSubscription(webhookUrl: string): Promise<void> {
  try {
    const listRes  = await circleHttpClient.get("/v1/notifications/subscriptions");
    const existing: any[] = listRes.data?.data ?? [];
    if (existing.some((s: any) => s.endpoint === webhookUrl)) {
      console.info(`[Circle] Webhook already registered: ${webhookUrl}`);
      return;
    }
    await circleHttpClient.post("/v1/notifications/subscriptions", { endpoint: webhookUrl });
    console.info(`[Circle] Webhook subscription registered: ${webhookUrl}`);
  } catch (err: any) {
    console.warn(`[Circle] Could not register webhook: ${err?.response?.data?.message ?? err?.message}`);
  }
}

// ─── Resolve on-chain tx hash for a Circle transaction ID ────────────────────
// Circle transactions use UUIDs as their primary ID. The actual on-chain tx hash
// (0x…) is only available once the transaction is confirmed. Call this after a
// short delay to retrieve the real hash for block explorer links.

export async function resolveCircleOnChainTxHash(circleId: string): Promise<string | null> {
  const client = getDcwClient();
  if (!client) return null;
  try {
    const res  = await client.getTransaction({ id: circleId });
    const body = res.data as any;
    const tx   = body?.data ?? body?.transaction ?? body;
    const hash: string | undefined = tx?.txHash ?? tx?.transactionHash;
    if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) return hash;
    return null;
  } catch {
    return null;
  }
}

// ─── Transaction confirmation poller ─────────────────────────────────────────
// Polls until a Circle DCW transaction reaches COMPLETE or FAILED.
// Used before calling depositFor so the treasury actually has the USDC.
// Returns true if COMPLETE, false if FAILED or timed out.

// Circle DCW terminal states that mean "the funds have landed":
//   COMPLETE    — fully finalised on-chain
//   CONFIRMED   — included in a block (used for internal DCW transfers and many
//                 testnet chains that never emit a separate COMPLETE event)
//   TRANSFERRED — Circle off-chain internal transfer between DCW wallets
// Waiting only for COMPLETE caused 5-minute timeouts when Circle returned
// CONFIRMED/TRANSFERRED as the terminal state, causing depositFor to be skipped.
const CIRCLE_TX_SUCCESS_STATES = new Set(["COMPLETE", "CONFIRMED", "TRANSFERRED"]);
const CIRCLE_TX_FAILURE_STATES = new Set(["FAILED", "CANCELLED", "DENIED"]);

export async function waitForTransactionComplete(
  txId:       string,
  timeoutMs:  number = 10 * 60_000, // 10 min — extended for slower testnets
  intervalMs: number = 5_000,
): Promise<boolean> {
  const client = getDcwClient();
  if (!client) return false;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const res  = await client.getTransaction({ id: txId });
      const body = res.data as any;
      const tx   = body?.data ?? body?.transaction ?? body;
      const state: string = (tx?.state ?? tx?.status ?? "").toUpperCase();
      if (CIRCLE_TX_SUCCESS_STATES.has(state)) {
        console.info(`[Circle] Transaction ${txId} reached success state: ${state}`);
        return true;
      }
      if (CIRCLE_TX_FAILURE_STATES.has(state)) {
        console.warn(`[Circle] Transaction ${txId} reached failure state: ${state}`);
        return false;
      }
    } catch { /* transient error — keep polling */ }
  }

  console.warn(`[Circle] waitForTransactionComplete: timed out after ${timeoutMs / 1000}s for tx ${txId}`);
  return false;
}
