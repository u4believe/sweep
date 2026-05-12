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
const CIRCLE_API_BASE_URL  = process.env.CIRCLE_API_BASE_URL || "https://api-sandbox.circle.com";
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;
let   CIRCLE_WALLET_SET_ID = process.env.CIRCLE_WALLET_SET_ID;

// ─── Supported chains ─────────────────────────────────────────────────────────

export const SUPPORTED_SOURCE_CHAINS = ["BASE-SEPOLIA", "ARC-TESTNET"] as const;
export type  SourceChain = (typeof SUPPORTED_SOURCE_CHAINS)[number];

// Aliases kept for route/worker compatibility
export const SUPPORTED_BLOCKCHAINS = SUPPORTED_SOURCE_CHAINS;
export type  SupportedBlockchain   = SourceChain;

export const PRIMARY_BLOCKCHAIN = "ARC-TESTNET" as SourceChain;

// ─── App Kit chain identifiers ────────────────────────────────────────────────

export const APP_KIT_CHAIN_IDS: Record<SourceChain, string> = {
  "BASE-SEPOLIA": "Base_Sepolia",
  "ARC-TESTNET":  "Arc_Testnet",
};

// ─── USDC contract addresses ──────────────────────────────────────────────────

export const CHAIN_USDC_ADDRESSES: Record<SourceChain, string> = {
  "BASE-SEPOLIA": (process.env.BASE_USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e").toLowerCase(),
  // Arc testnet USDC is a standard ERC-20 precompile (6 decimals)
  "ARC-TESTNET":  (process.env.ARC_USDC_ADDRESS ?? process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000").toLowerCase(),
};

// USDC decimals differ between chains
export const CHAIN_USDC_DECIMALS: Record<SourceChain, number> = {
  "BASE-SEPOLIA": 6,
  "ARC-TESTNET":  6,  // Arc USDC at 0x3600... is standard ERC-20 with 6 decimals
};

// ─── RPC URLs ─────────────────────────────────────────────────────────────────

export const CHAIN_RPC_URLS: Record<SourceChain, string> = {
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
// Creates SCA wallets on BASE-SEPOLIA and ARC-TESTNET in a single Circle DCW
// call. Circle EIP-4337 SCA wallets derive the same address on all EVM chains
// from the same factory + salt, so both wallets share one on-chain address.
// The Arc Testnet wallet ID is required for the Circle Wallets adapter to sign
// CCTP depositForBurn transactions on Arc (bridge → BASE-SEPOLIA treasury).

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

  const res = await client.createWallets({
    blockchains:    ["BASE-SEPOLIA", "ARC-TESTNET"] as any[],
    count:          1,
    walletSetId,
    accountType:    "SCA" as any,
    idempotencyKey: randomUUID(),
  });

  const wallets: any[] = (res.data as any)?.wallets ?? (res as any)?.wallets ?? [];
  if (wallets.length === 0) {
    throw new Error("Circle DCW createWallets returned no wallets — check API credentials and wallet set.");
  }

  // Index returned wallets by their blockchain field
  const byChain: Record<string, { id: string; address: string }> = {};
  for (const w of wallets) {
    const chain = (w.blockchain ?? w.chain) as string | undefined;
    if (chain) byChain[chain] = { id: w.id as string, address: w.address as string };
  }

  const baseSepolia = byChain["BASE-SEPOLIA"];
  if (!baseSepolia) {
    throw new Error("Circle DCW did not return a BASE-SEPOLIA wallet — check API credentials and wallet set.");
  }
  const arcTestnet = byChain["ARC-TESTNET"];

  const idsMap: Record<string, string>  = { "BASE-SEPOLIA": baseSepolia.id };
  const addrMap: Record<string, string> = { "BASE-SEPOLIA": baseSepolia.address };

  if (arcTestnet) {
    idsMap["ARC-TESTNET"]  = arcTestnet.id;
    addrMap["ARC-TESTNET"] = arcTestnet.address;
  } else {
    // ARC-TESTNET wallet not returned — reuse BASE-SEPOLIA address as fallback
    console.warn("[Circle DCW] ARC-TESTNET wallet not created — CCTP bridging from Arc will be unavailable");
    addrMap["ARC-TESTNET"] = baseSepolia.address;
  }

  return {
    walletId:            baseSepolia.id,
    address:             baseSepolia.address,
    walletIdsJson:       JSON.stringify(idsMap),
    walletAddressesJson: JSON.stringify(addrMap),
  };
}

// ─── Backfill Arc Testnet wallet for existing users ───────────────────────────
// Called on login when a user already has a BASE-SEPOLIA wallet but has no
// ARC-TESTNET entry in circleWalletIdsJson. Creates the Arc wallet in the same
// wallet set so the Circle Wallets adapter can sign Arc CCTP transactions.

export async function ensureArcTestnetWallet(
  existingIdsJson:  string | null,
  existingAddrsJson: string | null,
): Promise<{ idsJson: string; addrsJson: string } | null> {
  const idsMap   = existingIdsJson   ? (JSON.parse(existingIdsJson)   as Record<string, string>) : {};
  const addrsMap = existingAddrsJson ? (JSON.parse(existingAddrsJson) as Record<string, string>) : {};

  if (idsMap["ARC-TESTNET"]) return null; // already provisioned

  const client      = getDcwClient();
  const walletSetId = await ensureWalletSet();
  if (!client || !walletSetId) return null;

  try {
    const res = await client.createWallets({
      blockchains:    ["ARC-TESTNET"] as any[],
      count:          1,
      walletSetId,
      accountType:    "SCA" as any,
      idempotencyKey: randomUUID(),
    });

    const wallets: any[] = (res.data as any)?.wallets ?? (res as any)?.wallets ?? [];
    const arcWallet = wallets[0];
    if (!arcWallet?.id) return null;

    idsMap["ARC-TESTNET"]   = arcWallet.id as string;
    addrsMap["ARC-TESTNET"] = arcWallet.address as string;

    console.info(`[Circle DCW] Backfilled ARC-TESTNET wallet ${arcWallet.id} @ ${arcWallet.address}`);
    return { idsJson: JSON.stringify(idsMap), addrsJson: JSON.stringify(addrsMap) };
  } catch (e: any) {
    console.warn("[Circle DCW] ensureArcTestnetWallet failed:", e?.message);
    return null;
  }
}

// ─── USDC balance helpers ─────────────────────────────────────────────────────

function isUsdcToken(b: any): boolean {
  return (
    b.token?.symbol?.toUpperCase() === "USDC" ||
    (b.token?.name ?? "").toLowerCase().includes("usd coin")
  );
}

export async function getWalletUsdcBalance(walletId: string): Promise<string> {
  const client = getDcwClient();
  if (!client) return "0";
  try {
    const res = await client.getWalletTokenBalance({ id: walletId });
    const tokenBalances: any[] = (res.data as any)?.tokenBalances ?? [];
    const usdcEntry = tokenBalances.find(isUsdcToken);
    if (usdcEntry?.token?.id) _tokenIdCache.set(walletId, usdcEntry.token.id);
    return usdcEntry?.amount ?? "0";
  } catch (e: any) {
    console.warn("[Circle DCW] getWalletUsdcBalance error:", e?.message);
    return "0";
  }
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

  const usdcEntry = tokenBalances.find(isUsdcToken);

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

// ─── Sweep: user BASE-SEPOLIA wallet → platform treasury ─────────────────────
// Transfers USDC from a user's Circle SCA wallet to the platform treasury.
// Gas-free via EIP-4337 + Circle Gas Station.

export async function sweepUsdcToPlatformWallet(
  userWalletId: string,
  amount: string,
): Promise<string> {
  const client = getDcwClient();
  if (!client) throw new Error("Circle DCW client not available — CIRCLE_ENTITY_SECRET not set");

  const destAddress = getPlatformWalletAddress();
  if (!destAddress) throw new Error("CIRCLE_PLATFORM_WALLET_ADDRESS not configured");

  const tokenId = await resolveUsdcTokenId(userWalletId);

  console.info(`[Circle] sweep: walletId=${userWalletId} → treasury=${destAddress} amount=${amount}`);

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
