// ─── Sweep & Withdrawal Logic ─────────────────────────────────────────────────
// All deposit sweeps: user wallet → platform treasury wallet (Circle DCW SDK).
// USDC stays in the treasury wallet so directTreasuryTransfer can send it to
// users on withdrawal using the same SDK path.
//
// Cross-chain withdrawals use the Gateway Forwarding Service via SignedBurnIntent
// (gatewayWithdrawal) when the treasury has no on-chain balance on the destination.

import { randomUUID, randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  GATEWAY_WALLET_ADDRESS_EVM,
  GATEWAY_MINTER_ADDRESS_EVM,
  SOLANA_GATEWAY_MINTER_PROGRAM,
  GATEWAY_API_BASE,
  ABI_APPROVE,
  ABI_DEPOSIT_FOR,
  ABI_ADD_DELEGATE,
  getChain,
  type ChainKey,
} from "./gatewayConfig.js";
import { getDcwClient, sweepUsdcToPlatformWallet, getWalletUsdcBalance, directWalletTransfer, waitForTransactionComplete } from "./circle.js";

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY!;

const TREASURY_ADDRESS       = process.env.CIRCLE_PLATFORM_WALLET_ADDRESS!;

// EOA wallet used to sign Gateway burn intents.
// Because the treasury is an SCA and Gateway only accepts EOA signatures,
// this dedicated EOA is added as a per-token delegate via addDelegate().
// Set by running POST /api/admin/setup-gateway-delegate, then storing the
// returned walletId and address in .env before restarting the server.
const GATEWAY_SIGNER_WALLET_ID = process.env.CIRCLE_GATEWAY_SIGNER_WALLET_ID ?? "";
const GATEWAY_SIGNER_ADDRESS   = process.env.CIRCLE_GATEWAY_SIGNER_ADDRESS   ?? "";

// ─── Solana constants ─────────────────────────────────────────────────────────

const TREASURY_SOL_WALLET_ID = process.env.CIRCLE_PLATFORM_WALLET_ID_SOL ?? "";
const TREASURY_SOL_ADDRESS   = process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_SOL ?? "";

// ─── Per-chain treasury wallet ID resolution ──────────────────────────────────
// Each EVM chain needs its own Circle wallet ID for the platform treasury SCA.
// Set CIRCLE_PLATFORM_WALLET_IDS_JSON as a JSON map, or individual per-chain vars.

function getTreasuryWalletIdForChain(chainKey: ChainKey): string | null {
  // Try the JSON map first (covers all chains in one env var)
  const jsonMap = process.env.CIRCLE_PLATFORM_WALLET_IDS_JSON;
  if (jsonMap) {
    try {
      const map = JSON.parse(jsonMap) as Record<string, string>;
      if (map[chainKey]) return map[chainKey];
    } catch { /* fall through */ }
  }

  // Per-chain env vars — only return if explicitly set for this chain.
  // No generic fallback: using the wrong wallet ID on a chain causes "Invalid credentials"
  // from Circle DCW because the wallet doesn't exist on that chain.
  const perChain: Partial<Record<ChainKey, string | undefined>> = {
    "ARC-TESTNET":    process.env.CIRCLE_PLATFORM_WALLET_ID_ARC_TESTNET,
    "BASE-SEPOLIA":   process.env.CIRCLE_PLATFORM_WALLET_ID_BASE_SEPOLIA,
    "ARB-SEPOLIA":    process.env.CIRCLE_PLATFORM_WALLET_ID_ARB_SEPOLIA,
    "OP-SEPOLIA":     process.env.CIRCLE_PLATFORM_WALLET_ID_OP_SEPOLIA,
    "MATIC-AMOY":     process.env.CIRCLE_PLATFORM_WALLET_ID_MATIC_AMOY,
    "AVAX-FUJI":      process.env.CIRCLE_PLATFORM_WALLET_ID_AVAX_FUJI,
  };
  return perChain[chainKey] ?? null;
}



// ─── Helpers ──────────────────────────────────────────────────────────────────

function circleHeaders() {
  return {
    Authorization:  `Bearer ${CIRCLE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// Convert a decimal USDC amount string to uint256 base units (6 decimals).
// "1.5" → "1500000"
function toBaseUnits(amount: string): string {
  return BigInt(Math.round(parseFloat(amount) * 1_000_000)).toString();
}


// ─── EVM Sweep ───────────────────────────────────────────────────────────────
// Three-step flow per Arc Team guidance:
//   1. user SCA → treasury DCW wallet (createTransaction / sweepUsdcToPlatformWallet)
//   2. treasury approves Gateway contract to spend USDC (createContractExecutionTransaction)
//   3. treasury calls depositFor() on Gateway contract (createContractExecutionTransaction)
//      → USDC enters the Gateway Unified Balance for cross-chain gatewayWithdrawal

export async function evmGatewaySweep(opts: {
  userWalletId: string;
  chainKey:     ChainKey;
  amount:       string;
}): Promise<{ sweepTxId: string; approveTxId: string; depositForTxId: string }> {
  const { userWalletId, chainKey, amount } = opts;
  const chainCfg = getChain(chainKey);

  console.info(
    `[GatewaySweep] EVM sweep: wallet=${userWalletId} chain=${chainKey} amount=${amount}`,
  );

  // ── Step 1: user SCA → treasury ──────────────────────────────────────────
  const sweepTxId = await sweepUsdcToPlatformWallet(userWalletId, amount, chainKey);
  console.info(`[GatewaySweep] Step 1/3 sweep submitted: ${sweepTxId} — waiting for confirmation`);

  // Wait for the sweep to confirm before calling depositFor.
  // depositFor calls transferFrom on the USDC contract; if the sweep hasn't
  // landed yet, the treasury has no balance and the depositFor will fail.
  const sweepConfirmed = await waitForTransactionComplete(sweepTxId);
  if (!sweepConfirmed) {
    console.warn(`[GatewaySweep] Sweep ${sweepTxId} did not confirm — skipping depositFor`);
    return { sweepTxId, approveTxId: "", depositForTxId: "" };
  }
  console.info(`[GatewaySweep] Step 1/3 sweep confirmed: ${sweepTxId}`);

  // ── Steps 2 & 3: treasury → Gateway Unified Balance (approve + depositFor) ─
  // Skip for chains whose USDC can't be deposited into the Gateway (e.g. ARC-TESTNET
  // uses a precompile at 0x3600... that doesn't support ERC-20 approve/transferFrom).
  // USDC on those chains stays in the treasury wallet for directTreasuryTransfer.
  if (!GATEWAY_SUPPORTED_CHAINS.has(chainKey)) {
    console.info(
      `[GatewaySweep] ${chainKey} is not Gateway-compatible — USDC stays in treasury wallet`,
    );
    return { sweepTxId, approveTxId: "", depositForTxId: "" };
  }

  const treasuryWalletId = getTreasuryWalletIdForChain(chainKey);
  if (!treasuryWalletId) {
    console.warn(
      `[GatewaySweep] No treasury wallet ID for ${chainKey} — skipping depositFor. ` +
      `Set CIRCLE_PLATFORM_WALLET_ID_${chainKey.replace("-", "_")} in .env.`,
    );
    return { sweepTxId, approveTxId: "", depositForTxId: "" };
  }

  const client = getDcwClient();
  if (!client) {
    console.warn("[GatewaySweep] DCW client unavailable — skipping depositFor");
    return { sweepTxId, approveTxId: "", depositForTxId: "" };
  }

  const amountBaseUnits = toBaseUnits(amount);

  // Step 2: approve(gatewayContract, amount) on the USDC contract
  const approveRes = await (client as any).createContractExecutionTransaction({
    walletId:             treasuryWalletId,
    contractAddress:      chainCfg.usdcAddress,
    abiFunctionSignature: ABI_APPROVE,
    abiParameters:        [GATEWAY_WALLET_ADDRESS_EVM, amountBaseUnits],
    fee:                  { config: { feeLevel: "MEDIUM" } },
    idempotencyKey:       randomUUID(),
  });
  const approveBody: any = approveRes.data ?? approveRes;
  const approveTxId: string =
    approveBody?.data?.id ?? approveBody?.transaction?.id ?? approveBody?.id ?? "";
  if (!approveTxId) throw new Error("[GatewaySweep] approve tx returned no ID");
  console.info(`[GatewaySweep] Step 2/3 approve submitted: ${approveTxId}`);

  // Step 3: depositFor(token, depositor, value) on the Gateway contract.
  // depositor = treasury address so the Unified Balance accrues under the treasury.
  const depositForRes = await (client as any).createContractExecutionTransaction({
    walletId:             treasuryWalletId,
    contractAddress:      GATEWAY_WALLET_ADDRESS_EVM,
    abiFunctionSignature: ABI_DEPOSIT_FOR,
    abiParameters:        [chainCfg.usdcAddress, TREASURY_ADDRESS, amountBaseUnits],
    fee:                  { config: { feeLevel: "MEDIUM" } },
    idempotencyKey:       randomUUID(),
  });
  const depositBody: any = depositForRes.data ?? depositForRes;
  const depositForTxId: string =
    depositBody?.data?.id ?? depositBody?.transaction?.id ?? depositBody?.id ?? "";
  if (!depositForTxId) throw new Error("[GatewaySweep] depositFor tx returned no ID");
  console.info(`[GatewaySweep] Step 3/3 depositFor submitted: ${depositForTxId} — USDC entering Gateway Unified Balance`);

  return { sweepTxId, approveTxId, depositForTxId };
}


// ─── Arc Testnet Sweep ───────────────────────────────────────────────────────
// Uses Circle's recommended approach for Arc Testnet transfers:
//   createTransaction({ blockchain, walletAddress, tokenAddress, destinationAddress, amount, fee })
//
// Using walletAddress + tokenAddress + blockchain (not walletId + tokenId) tells
// Circle to read the on-chain balance at 0x3600... directly, bypassing their
// internal registry which lags behind listTransactions after a fresh deposit.
// This avoids "insufficient asset" errors caused by Circle's sync delay.
//
// The depositFor step (treasury → Gateway Unified Balance) is NOT done here.
// Use POST /api/admin/arc-depositfor when needed.

export async function arcTestnetSweep(opts: {
  userWalletId:  string;
  userAddress?:  string;  // EVM address of the user's Arc wallet
  amount:        string;
}): Promise<string> {
  const { userWalletId, userAddress, amount } = opts;

  const client = getDcwClient();
  if (!client) throw new Error("[ArcSweep] Circle DCW client not configured");

  const treasury = process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_ARC_TESTNET
                ?? process.env.CIRCLE_PLATFORM_WALLET_ADDRESS!;
  if (!treasury) throw new Error("[ArcSweep] Treasury address not configured");

  const usdcAddress = process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";

  console.info(`[ArcSweep] transfer: wallet=${userWalletId} address=${userAddress ?? "n/a"} → ${treasury} amount=${amount}`);

  // Per Circle docs: use walletAddress + tokenAddress + blockchain for Arc.
  // This resolves the balance on-chain rather than from Circle's internal registry.
  const res = await (client as any).createTransaction({
    blockchain:         "ARC-TESTNET",
    ...(userAddress ? { walletAddress: userAddress } : { walletId: userWalletId }),
    tokenAddress:       usdcAddress,
    destinationAddress: treasury,
    amount:             [amount],
    fee:                { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey:     randomUUID(),
  });

  const body: any    = (res as any)?.data ?? res;
  const txId: string = body?.data?.id ?? body?.transaction?.id ?? body?.id ?? (res as any)?.transaction?.id ?? "";
  if (!txId) throw new Error("[ArcSweep] createTransaction returned no ID");

  console.info(`[ArcSweep] Sweep submitted: ${txId}`);
  void _pollTransferStatus(txId, "ArcSweep");
  return txId;
}

// ─── Solana Sweep ────────────────────────────────────────────────────────────
// Transfers USDC from a user's Solana EOA to the treasury Solana EOA via the
// Circle DCW SDK (handles entity secret automatically, no raw fetch needed).

export async function solanaSweep(opts: {
  userSolanaWalletId: string;
  amount:             string;
}): Promise<void> {
  const { userSolanaWalletId, amount } = opts;
  const destAddress = TREASURY_SOL_ADDRESS || TREASURY_ADDRESS;

  console.info(
    `[GatewaySweep] Solana sweep: wallet=${userSolanaWalletId} → ${destAddress} amount=${amount}`,
  );

  // The reconciliation worker calls getWalletUsdcBalance before this function,
  // which populates _tokenIdCache with the Circle USDC token UUID.
  // resolveUsdcTokenId finds it from cache — no extra API call needed.
  const txId = await directWalletTransfer(userSolanaWalletId, destAddress, amount);
  console.info(`[GatewaySweep] Solana sweep submitted: ${txId}`);
}

// ─── Withdrawal: SignedBurnIntent + Gateway Forwarding Service ────────────────
// The Circle Gateway API requires a SignedBurnIntentSet — an array of burn
// intents each EIP-712 signed by the treasury SCA via Circle DCW.
//
// The Unified Balance is chain-agnostic: USDC deposited via depositFor() on
// any chain pools together. The burn can originate from any chain where the
// treasury has a configured wallet ID and known chain ID. gatewayWithdrawal()
// tries each eligible source chain in priority order and uses the first that
// succeeds in signing and submitting.
//
// Flow (per attempt):
//   1. Pick source chain (first with treasury walletId + known chain ID)
//   2. Build BurnIntent: nonce, source, destination, amount, token
//   3. EIP-712 sign via Circle DCW /sign/typedData
//   4. POST [{ burnIntent, signature }] to the Gateway API
//   5. Circle Forwarding Service delivers USDC on the destination chain

// EIP-712 type definitions for the Gateway BurnIntent (Circle Gateway v1).
// The BurnIntent wraps a TransferSpec; both are required as nested types.
// Domain: { name: "GatewayWallet", version: "1" } — no chainId or verifyingContract.
const BURN_INTENT_TYPES = {
  EIP712Domain: [
    { name: "name",    type: "string" },
    { name: "version", type: "string" },
  ],
  TransferSpec: [
    { name: "version",              type: "uint32"  },
    { name: "sourceDomain",         type: "uint32"  },
    { name: "destinationDomain",    type: "uint32"  },
    { name: "sourceContract",       type: "bytes32" },
    { name: "destinationContract",  type: "bytes32" },
    { name: "sourceToken",          type: "bytes32" },
    { name: "destinationToken",     type: "bytes32" },
    { name: "sourceDepositor",      type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner",         type: "bytes32" },
    { name: "destinationCaller",    type: "bytes32" },
    { name: "value",                type: "uint256" },
    { name: "salt",                 type: "bytes32" },
    { name: "hookData",             type: "bytes"   },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256"      },
    { name: "maxFee",         type: "uint256"      },
    { name: "spec",           type: "TransferSpec" },
  ],
};

// Circle Gateway domain IDs — NOT EVM chain IDs.
// These are Circle-issued identifiers used in the TransferSpec.
const GATEWAY_DOMAIN_IDS: Partial<Record<ChainKey, number>> = {
  "ETH-SEPOLIA":       0,
  "AVAX-FUJI":         1,
  "OP-SEPOLIA":        2,
  "ARB-SEPOLIA":       3,
  "SOL-DEVNET":        5,
  "BASE-SEPOLIA":      6,
  "MATIC-AMOY":        7,
  "UNICHAIN-SEPOLIA":  10,
  "HYPEREVM-TESTNET":  19,
  "ARC-TESTNET":       26,
};

// Max uint256 string — used as maxBlockHeight to indicate no expiration.
const MAX_UINT256     = ((1n << 256n) - 1n).toString();
// 0.50 USDC in base units — covers Forwarding Service fee ($0.20) with buffer.
const GATEWAY_MAX_FEE = "500000";
const ZERO_BYTES32    = "0x" + "00".repeat(32);

// Pad a 20-byte EVM address to a 32-byte hex value (bytes32 field in TransferSpec).
function padAddress(addr: string): string {
  return "0x" + addr.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
}

// Encode a base58 Solana public key as a 0x-prefixed 32-byte hex string.
// Solana pubkeys are already 32 bytes — no padding needed, just base58 decode.
function solanaAddressToBytes32(base58Addr: string): string {
  return "0x" + Buffer.from(new PublicKey(base58Addr).toBytes()).toString("hex");
}

// Solana token-program constants for ATA derivation.
// Seeds: [owner_pubkey, TOKEN_PROGRAM_ID, usdc_mint]
const SOL_TOKEN_PROGRAM_ID            = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SOL_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bJ");
const SOL_RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

// Derive the canonical ATA address for a wallet + mint (synchronous, no RPC call).
function getSolanaUsdcAta(walletAddress: string, usdcMint: string): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(walletAddress).toBuffer(),
      SOL_TOKEN_PROGRAM_ID.toBuffer(),
      new PublicKey(usdcMint).toBuffer(),
    ],
    SOL_ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata.toBase58();
}

// Resolve the USDC token account the Gateway Minter should mint to.
//
// Circle's DCW sometimes creates raw (non-ATA) token accounts instead of the
// canonical ATA. The Gateway Minter mints to whichever token account is
// passed as destinationRecipient, so we must pass an account that already
// exists on-chain — otherwise Circle's Forwarding Service simulation fails
// and the burn bounces back to the Unified Balance hours later.
//
// Strategy:
//  1. Query Solana for all USDC token accounts owned by the wallet.
//  2. If any exist (ATA or raw), use the first one — it's already live on-chain.
//  3. If none exist, derive the canonical ATA and try to seed it via faucet
//     so it exists before the burn intent is submitted.
async function resolveSolanaUsdcTokenAccount(
  walletAddress: string,
  usdcMint:      string,
): Promise<string> {
  const { Connection } = await import("@solana/web3.js");
  const conn = new Connection(SOL_RPC_URL, "confirmed");

  try {
    const result = await conn.getParsedTokenAccountsByOwner(
      new PublicKey(walletAddress),
      { mint: new PublicKey(usdcMint) },
    );
    if (result.value.length > 0) {
      const tokenAccount = result.value[0].pubkey.toBase58();
      console.info(
        `[GatewayWithdrawal] Resolved Solana USDC token account for ${walletAddress}: ${tokenAccount}`,
      );
      return tokenAccount;
    }
  } catch (e: any) {
    console.warn(`[GatewayWithdrawal] Token account lookup failed (will fall back to ATA): ${e?.message}`);
  }

  // No token account on-chain yet — derive the canonical ATA and seed it.
  const ata = getSolanaUsdcAta(walletAddress, usdcMint);
  console.info(`[GatewayWithdrawal] No existing USDC account for ${walletAddress} — seeding ATA ${ata}`);
  await seedSolanaAta(walletAddress);
  return ata;
}

// Seed a USDC ATA via Circle's devnet faucet so it exists before the Gateway mint.
// Non-fatal: the faucet returns Forbidden when the wallet already has USDC (not an error).
async function seedSolanaAta(walletAddress: string): Promise<void> {
  const dcwClient = getDcwClient();
  if (!dcwClient) return;
  try {
    await (dcwClient as any).requestTestnetTokens({
      address:    walletAddress,
      blockchain: "SOL-DEVNET",
      usdc:       true,
    });
    console.info(`[GatewayWithdrawal] Solana USDC ATA seeded for ${walletAddress}`);
    await new Promise(r => setTimeout(r, 3_000));
  } catch (e: any) {
    console.info(`[GatewayWithdrawal] Solana ATA seed (non-fatal): ${e?.message}`);
  }
}

// Chains that Circle's Gateway Forwarding Service supports as both source and
// destination. Arc Testnet IS supported (domain 26) — its USDC is the native
// token and Circle's Unified Balance reflects transfers on Arc.
export const GATEWAY_SUPPORTED_CHAINS = new Set<ChainKey>([
  "ARC-TESTNET",
  "ETH-SEPOLIA",
  "BASE-SEPOLIA",
  "ARB-SEPOLIA",
  "OP-SEPOLIA",
  "MATIC-AMOY",
  "AVAX-FUJI",
  "UNICHAIN-SEPOLIA",
  "HYPEREVM-TESTNET",
  "SOL-DEVNET",
]);

const SOURCE_CHAIN_PRIORITY: ChainKey[] = [
  "ARC-TESTNET",      // primary treasury — all user deposits sweep here
  "BASE-SEPOLIA",
  "ARB-SEPOLIA",
  "OP-SEPOLIA",
  "MATIC-AMOY",
  "AVAX-FUJI",
  "ETH-SEPOLIA",
  "UNICHAIN-SEPOLIA",
  "HYPEREVM-TESTNET",
];

async function signBurnIntent(burnIntent: object): Promise<string> {
  if (!GATEWAY_SIGNER_WALLET_ID) {
    throw new Error(
      "[GatewayWithdrawal] CIRCLE_GATEWAY_SIGNER_WALLET_ID not set — " +
      "run POST /api/admin/setup-gateway-delegate, store the returned walletId " +
      "and address in .env, then restart the server.",
    );
  }

  const client = getDcwClient();
  if (!client) throw new Error("[GatewayWithdrawal] Circle DCW client not configured — CIRCLE_ENTITY_SECRET not set");

  // Gateway EIP-712 domain has no chainId or verifyingContract.
  const domain = { name: "GatewayWallet", version: "1" };

  // Circle DCW signTypedData expects `data` as a JSON string.
  const res = await (client as any).signTypedData({
    walletId:       GATEWAY_SIGNER_WALLET_ID,
    idempotencyKey: randomUUID(),
    data:           JSON.stringify({
      domain,
      types:       BURN_INTENT_TYPES,
      primaryType: "BurnIntent",
      message:     burnIntent,
    }),
  });

  const body: any  = (res as any)?.data ?? res;
  const signature: string | undefined =
    body?.data?.signature ?? body?.signature;
  if (!signature) throw new Error("[GatewayWithdrawal] No signature returned from Circle DCW");
  return signature;
}

export async function gatewayWithdrawal(opts: {
  destinationAddress: string;
  destinationChain:   ChainKey;
  amount:             string;
  idempotencyKey:     string;
}): Promise<{ transferId: string }> {
  const { destinationAddress, destinationChain, amount } = opts;

  if (!TREASURY_ADDRESS) throw new Error("[GatewayWithdrawal] CIRCLE_PLATFORM_WALLET_ADDRESS not set");

  if (!GATEWAY_SIGNER_WALLET_ID || !GATEWAY_SIGNER_ADDRESS) {
    throw new Error(
      "[GatewayWithdrawal] Gateway EOA signer not configured. " +
      "Run POST /api/admin/setup-gateway-delegate, add the returned " +
      "CIRCLE_GATEWAY_SIGNER_WALLET_ID and CIRCLE_GATEWAY_SIGNER_ADDRESS to .env, " +
      "then restart.",
    );
  }

  if (!GATEWAY_SUPPORTED_CHAINS.has(destinationChain)) {
    throw Object.assign(
      new Error(
        `Cross-chain withdrawal to ${destinationChain} is not supported by Circle's Gateway ` +
        `Forwarding Service. Supported chains: ${[...GATEWAY_SUPPORTED_CHAINS].join(", ")}. ` +
        `Wait for the treasury to accumulate on-chain liquidity on ${destinationChain} for a direct transfer.`,
      ),
      { code: "GATEWAY_UNSUPPORTED_CHAIN" },
    );
  }

  const destDomainId  = GATEWAY_DOMAIN_IDS[destinationChain]!;
  const destChainCfg  = getChain(destinationChain);
  const netAmount     = parseFloat(amount);

  console.info(`[GatewayWithdrawal] → ${destinationChain} to=${destinationAddress} amount=${amount}`);

  // Prefer destination chain first (same-chain burn is cheapest), then fall back
  // to other chains in priority order.
  const candidateChains: ChainKey[] = [
    destinationChain,
    ...SOURCE_CHAIN_PRIORITY.filter(c => c !== destinationChain),
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Solana destinations require base58 → bytes32 encoding; EVM uses padAddress.
  const isSolanaDestination = destinationChain === "SOL-DEVNET";
  const encodeDestAddr = isSolanaDestination ? solanaAddressToBytes32 : padAddress;

  // For Solana: the Gateway Minter mints to a USDC token account, not the wallet pubkey.
  // Circle's DCW sometimes creates raw (non-ATA) token accounts, so we look up
  // the wallet's actual on-chain USDC account first. If none exists we fall back
  // to the canonical ATA and seed it. Passing the wrong address causes SIMULATION_FAILED
  // and Circle refunds the burn to the Unified Balance hours later.
  let effectiveRecipient = destinationAddress;
  if (isSolanaDestination) {
    effectiveRecipient = await resolveSolanaUsdcTokenAccount(
      destinationAddress,
      destChainCfg.usdcAddress,
    );
  }

  // Build a burnIntent for the given source chain and value (base-unit string).
  // Source chain is always EVM (burn happens on EVM); only destination fields differ for Solana.
  const makeBurnIntent = (sourceChain: ChainKey, value: string): object => {
    const srcDomainId = GATEWAY_DOMAIN_IDS[sourceChain]!;
    const srcChainCfg = getChain(sourceChain);
    return {
      maxBlockHeight: MAX_UINT256,
      maxFee:         GATEWAY_MAX_FEE,
      spec: {
        version:              1,
        sourceDomain:         srcDomainId,
        destinationDomain:    destDomainId,
        sourceContract:       padAddress(GATEWAY_WALLET_ADDRESS_EVM),
        destinationContract:  isSolanaDestination ? solanaAddressToBytes32(SOLANA_GATEWAY_MINTER_PROGRAM) : padAddress(GATEWAY_MINTER_ADDRESS_EVM),
        sourceToken:          padAddress(srcChainCfg.usdcAddress),
        destinationToken:     encodeDestAddr(destChainCfg.usdcAddress),
        sourceDepositor:      padAddress(TREASURY_ADDRESS),
        destinationRecipient: encodeDestAddr(effectiveRecipient),
        sourceSigner:         padAddress(GATEWAY_SIGNER_ADDRESS),
        destinationCaller:    ZERO_BYTES32,
        value,
        salt:                 "0x" + randomBytes(32).toString("hex"),
        hookData:             "0x",
      },
    };
  };

  // Sign each intent and POST the batch. Returns transferId or throws.
  const postBatch = async (
    intents: Array<{ sourceChain: ChainKey; burnIntent: object }>,
  ): Promise<string> => {
    const requestBody = await Promise.all(
      intents.map(async ({ burnIntent }) => ({
        burnIntent,
        signature: await signBurnIntent(burnIntent),
      })),
    );

    const url = `${GATEWAY_API_BASE}/v1/transfer?enableForwarder=true`;
    const sources = intents.map(i => i.sourceChain).join(", ");
    console.info(
      `[GatewayWithdrawal] POST ${url} (sources: ${sources})\n` +
      `  body: ${JSON.stringify(requestBody, null, 2)}`,
    );

    const res = await fetch(url, {
      method:  "POST",
      headers: circleHeaders(),
      body:    JSON.stringify(requestBody),
    });

    const rawText = await res.text();
    let json: any;
    try { json = JSON.parse(rawText); } catch { json = { raw: rawText }; }
    console.info(`[GatewayWithdrawal] Response ${res.status}: ${rawText}`);

    if (!res.ok) {
      throw new Error(json?.message ?? json?.error ?? json?.raw ?? `HTTP ${res.status}`);
    }

    const transferId: string | undefined = json?.transferId ?? json?.data?.transferId;
    if (!transferId) throw new Error("Gateway API returned no transferId");
    return transferId;
  };

  // ── Phase 1: try each chain with the full amount ──────────────────────────
  // Chains that fail with "Insufficient balance: available X" are saved for
  // Phase 2 aggregation; all other errors are recorded and that chain is skipped.

  interface SourceAvail {
    chainKey:  ChainKey;
    domainId:  number;
    available: number; // USDC available in Unified Balance on this chain
  }

  const chainErrors:  string[]      = [];
  const sourceAvails: SourceAvail[] = [];
  const AVAIL_RE = /available ([\d.]+)/;

  for (const sourceChain of candidateChains) {
    if (!getTreasuryWalletIdForChain(sourceChain)) continue;

    const srcDomainId = GATEWAY_DOMAIN_IDS[sourceChain];
    if (srcDomainId === undefined) continue;

    const sameChain = srcDomainId === destDomainId;
    console.info(
      `[GatewayWithdrawal] ${sameChain ? "Same-chain" : "Cross-chain"} burn: ` +
      `${sourceChain} (domain ${srcDomainId}) → ${destinationChain} (domain ${destDomainId})`,
    );

    try {
      const transferId = await postBatch([{
        sourceChain,
        burnIntent: makeBurnIntent(sourceChain, toBaseUnits(amount)),
      }]);
      console.info(
        `[GatewayWithdrawal] Submitted via ${sourceChain} ` +
        `(${sameChain ? "same-chain" : "cross-chain"} Forwarding Service): ${transferId}`,
      );
      return { transferId };
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      chainErrors.push(`${sourceChain}: ${msg}`);
      console.warn(`[GatewayWithdrawal] ${sourceChain}: ${msg} — trying next chain`);

      // Capture available balance for Phase 2 multi-intent aggregation.
      const m = AVAIL_RE.exec(msg);
      if (m) sourceAvails.push({ chainKey: sourceChain, domainId: srcDomainId, available: parseFloat(m[1]) });
    }
  }

  // ── Phase 2: multi-intent aggregation ────────────────────────────────────
  // If every Phase 1 failure was balance-related and the combined available
  // balance across chains covers the requested amount, split the transfer
  // across multiple source chains in a single batch request.
  //
  // Circle's /v1/transfer accepts an array of burn intents and processes them
  // together, minting the sum on the destination chain.

  // Per-intent fee headroom: ~0.21 USDC forwarding fee + ~0.01 base fee.
  const FEE_HEADROOM = 0.25;

  const usableChains = sourceAvails
    .map(c => ({ ...c, usable: parseFloat(Math.max(0, c.available - FEE_HEADROOM).toFixed(6)) }))
    .filter(c => c.usable > 0.001)
    .sort((a, b) => b.usable - a.usable); // drain largest chains first

  const totalUsable = usableChains.reduce((s, c) => s + c.usable, 0);

  if (usableChains.length >= 2 && totalUsable >= netAmount) {
    console.info(
      `[GatewayWithdrawal] Phase 2 — aggregating across ` +
      usableChains.map(c => `${c.chainKey}(${c.usable.toFixed(4)} USDC)`).join(", "),
    );

    let remaining = netAmount;
    const intents: Array<{ sourceChain: ChainKey; burnIntent: object }> = [];

    for (const src of usableChains) {
      if (remaining < 0.001) break;
      const value   = parseFloat(Math.min(remaining, src.usable).toFixed(6));
      remaining     = parseFloat((remaining - value).toFixed(6));
      intents.push({ sourceChain: src.chainKey, burnIntent: makeBurnIntent(src.chainKey, toBaseUnits(value.toFixed(6))) });
    }

    try {
      const transferId = await postBatch(intents);
      const sources    = intents.map(i => i.sourceChain).join(" + ");
      console.info(`[GatewayWithdrawal] Multi-intent submitted (${sources}): ${transferId}`);
      return { transferId };
    } catch (err: any) {
      const sources = intents.map(i => i.sourceChain).join("+");
      chainErrors.push(`multi-intent(${sources}): ${err?.message}`);
    }
  }

  throw new Error(
    `Gateway withdrawal failed — no eligible source chain succeeded.\n` +
    `Per-chain errors:\n${chainErrors.map(e => `  • ${e}`).join("\n")}`,
  );
}

// ─── Treasury liquidity check ─────────────────────────────────────────────────

export async function getTreasuryChainBalance(chainKey: ChainKey): Promise<number> {
  try {
    if (chainKey === "ARC-TESTNET") {
      // Circle's wallet balance API returns empty tokenBalances for Arc wallets
      // because Arc USDC is a native precompile not indexed by Circle's token
      // registry. Read the balance directly from the Arc blockchain instead.
      return await _getArcTreasuryOnChainBalance();
    }
    const walletId = chainKey === "SOL-DEVNET"
      ? TREASURY_SOL_WALLET_ID
      : getTreasuryWalletIdForChain(chainKey);
    if (!walletId) return 0;
    return parseFloat(await getWalletUsdcBalance(walletId));
  } catch {
    return 0;
  }
}

// Reads any address's Arc USDC balance directly via eth_call (balanceOf).
// Circle's wallet balance API doesn't index Arc USDC tokens, so this is the
// only reliable way to check Arc balances — for both user wallets and treasury.
export async function getArcOnChainUsdcBalance(address: string): Promise<number> {
  const rpcUrl      = process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
  const usdcAddress = process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
  if (!address) return 0;

  // ERC-20 balanceOf(address) selector: 0x70a08231
  const paddedAddr = address.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  const data       = "0x70a08231" + paddedAddr;

  try {
    const res = await fetch(rpcUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        jsonrpc: "2.0",
        method:  "eth_call",
        params:  [{ to: usdcAddress, data }, "latest"],
        id:      1,
      }),
    });
    const json = await res.json() as { result?: string; error?: any };
    if (json.error) {
      console.warn("[ArcBalance] eth_call error:", json.error);
      return 0;
    }
    if (!json.result || json.result === "0x") return 0;
    return Number(BigInt(json.result)) / 1_000_000;
  } catch (e: any) {
    console.warn("[ArcBalance] RPC fetch error:", e?.message);
    return 0;
  }
}

function _getArcTreasuryOnChainBalance(): Promise<number> {
  return getArcOnChainUsdcBalance(TREASURY_ADDRESS);
}

// ─── Arc treasury → Unified Balance (approve + depositFor only) ──────────────
// Used when USDC is already in the Arc treasury wallet (e.g. from an old sweep
// that only did step 1) and needs to be pushed into the Gateway Unified Balance.
// Skips step 1 (user→treasury transfer) — treasury already holds the USDC.

export async function arcTreasuryDepositFor(amount: string): Promise<{
  approveTxId:    string;
  depositForTxId: string;
}> {
  const usdcAddress     = process.env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
  const amountBaseUnits = toBaseUnits(amount);
  const treasuryWalletId = getTreasuryWalletIdForChain("ARC-TESTNET");
  if (!treasuryWalletId) throw new Error("[ArcDepositFor] CIRCLE_PLATFORM_WALLET_ID_ARC_TESTNET not configured");

  const client = getDcwClient();
  if (!client) throw new Error("[ArcDepositFor] Circle DCW client not configured");

  console.info(`[ArcDepositFor] approve + depositFor ${amount} USDC from Arc treasury ${treasuryWalletId}`);

  const approveRes = await (client as any).createContractExecutionTransaction({
    walletId:             treasuryWalletId,
    contractAddress:      usdcAddress,
    abiFunctionSignature: ABI_APPROVE,
    abiParameters:        [GATEWAY_WALLET_ADDRESS_EVM, amountBaseUnits],
    fee:                  { config: { feeLevel: "MEDIUM" } },
    idempotencyKey:       randomUUID(),
  });
  const approveBody: any    = approveRes.data ?? approveRes;
  const approveTxId: string = approveBody?.data?.id ?? approveBody?.transaction?.id ?? approveBody?.id ?? "";
  if (!approveTxId) throw new Error("[ArcDepositFor] approve tx returned no ID");
  console.info(`[ArcDepositFor] approve submitted: ${approveTxId} — waiting for confirmation`);

  const approveConfirmed = await waitForTransactionComplete(approveTxId);
  if (!approveConfirmed) throw new Error(`[ArcDepositFor] approve ${approveTxId} did not confirm`);
  console.info(`[ArcDepositFor] approve confirmed: ${approveTxId}`);

  const depositForRes = await (client as any).createContractExecutionTransaction({
    walletId:             treasuryWalletId,
    contractAddress:      GATEWAY_WALLET_ADDRESS_EVM,
    abiFunctionSignature: ABI_DEPOSIT_FOR,
    abiParameters:        [usdcAddress, TREASURY_ADDRESS, amountBaseUnits],
    fee:                  { config: { feeLevel: "MEDIUM" } },
    idempotencyKey:       randomUUID(),
  });
  const depositBody: any       = depositForRes.data ?? depositForRes;
  const depositForTxId: string = depositBody?.data?.id ?? depositBody?.transaction?.id ?? depositBody?.id ?? "";
  if (!depositForTxId) throw new Error("[ArcDepositFor] depositFor tx returned no ID");
  console.info(`[ArcDepositFor] depositFor submitted: ${depositForTxId}`);
  void _pollTransferStatus(depositForTxId, "ArcDepositFor");

  return { approveTxId, depositForTxId };
}

// ─── Gateway Unified Balance check ───────────────────────────────────────────
// Calls POST /v1/balances on the Circle Gateway API to get the USDC Unified
// Balance available under the treasury depositor address on every chain.

export async function getGatewayUnifiedBalance(): Promise<{
  perChain: Record<string, number>;
  total:    number;
}> {
  // Each domain requires the depositor address in its native format:
  //   EVM chains  → 0x hex address (CIRCLE_PLATFORM_WALLET_ADDRESS)
  //   SOL-DEVNET  → base58 Solana address (CIRCLE_PLATFORM_WALLET_ADDRESS_SOL)
  const SOL_DOMAIN = 5;
  const sources = Object.entries(GATEWAY_DOMAIN_IDS)
    .map(([, domain]) => {
      const depositor = domain === SOL_DOMAIN ? TREASURY_SOL_ADDRESS : TREASURY_ADDRESS;
      return depositor ? { domain, depositor } : null;
    })
    .filter((s): s is { domain: number; depositor: string } => s !== null);

  const res = await fetch(`${GATEWAY_API_BASE}/v1/balances`, {
    method:  "POST",
    headers: circleHeaders(),
    body:    JSON.stringify({ token: "USDC", sources }),
  });

  const raw = await res.text();
  let json: any;
  try { json = JSON.parse(raw); } catch { json = { raw }; }

  if (!res.ok) {
    throw new Error(json?.message ?? json?.error ?? json?.raw ?? `HTTP ${res.status}`);
  }

  // Response shape: { balances: [{ domain, balance }, ...] } or { data: { balances: [...] } }
  const balances: Array<{ domain: number; balance: string }> =
    json?.balances ?? json?.data?.balances ?? [];

  // Build a chainKey → balance map using GATEWAY_DOMAIN_IDS as the reverse lookup.
  const domainToChain: Record<number, string> = {};
  for (const [chain, domain] of Object.entries(GATEWAY_DOMAIN_IDS)) {
    domainToChain[domain] = chain;
  }

  const perChain: Record<string, number> = {};
  let total = 0;
  for (const entry of balances) {
    const chainKey = domainToChain[entry.domain] ?? `domain-${entry.domain}`;
    const amount   = parseFloat(entry.balance ?? "0");
    perChain[chainKey] = amount;
    total += amount;
  }

  return { perChain, total };
}

// ─── Direct same-chain withdrawal (no Forwarding Service) ────────────────────

export async function directTreasuryTransfer(opts: {
  destinationAddress: string;
  chainKey:           ChainKey;
  amount:             string;
  idempotencyKey:     string;
  onFailure?:         () => Promise<void>;
}): Promise<string> {
  const { destinationAddress, chainKey, amount, idempotencyKey, onFailure } = opts;
  const isSolana = chainKey === "SOL-DEVNET";
  const walletId = isSolana ? TREASURY_SOL_WALLET_ID : getTreasuryWalletIdForChain(chainKey);

  if (!walletId) throw new Error(`No treasury wallet configured for ${chainKey}`);

  // SOL-DEVNET: Gas Station blocks ATA creation (PAYMASTER_SOL_ATA_CREATION_NOT_ALLOWED).
  // Pre-seed the destination ATA via Circle's devnet faucet before the real transfer.
  if (isSolana) {
    const dcwClient = getDcwClient();
    if (dcwClient) {
      try {
        await (dcwClient as any).requestTestnetTokens({
          address:    destinationAddress,
          blockchain: "SOL-DEVNET",
          usdc:       true,
        });
        console.info(`[DirectTransfer] Solana USDC ATA seeded for ${destinationAddress}`);
        await new Promise(r => setTimeout(r, 3_000));
      } catch (e: any) {
        // Non-fatal — ATA may already exist or faucet rate-limited
        console.info(`[DirectTransfer] Solana ATA seed (non-fatal): ${e?.message}`);
      }
    }
  }

  const txId = await directWalletTransfer(walletId, destinationAddress, amount, idempotencyKey);
  console.info(`[DirectTransfer] ${amount} USDC → ${destinationAddress} on ${chainKey}: ${txId}`);
  void _pollTransferStatus(txId, `DirectTransfer(${chainKey})`, onFailure);
  return txId;
}

async function _pollTransferStatus(
  txId:       string,
  label:      string,
  onFailure?: () => Promise<void>,
): Promise<void> {
  const client = getDcwClient();
  if (!client) return;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 8_000));
    try {
      const res  = await (client as any).getTransaction({ id: txId });
      const body = res.data as any;
      const tx   = body?.data ?? body?.transaction ?? body;
      const state: string = tx?.state ?? tx?.status ?? "";
      if (state === "COMPLETE") {
        const hash = tx?.txHash ?? tx?.transactionHash ?? null;
        console.info(`[${label}] ✅ ${txId} COMPLETE — onChainTxHash=${hash ?? "not yet indexed"}`);
        return;
      }
      if (state === "FAILED" || state === "CANCELLED") {
        console.error(
          `[${label}] ❌ ${txId} ${state} — ` +
          `errorCode=${tx?.errorCode ?? "?"} ` +
          `errorReason=${tx?.errorReason ?? "?"} ` +
          `networkError=${tx?.networkErrorCode ?? "?"}`,
        );
        if (onFailure) {
          try { await onFailure(); } catch (e: any) {
            console.error(`[${label}] onFailure error: ${e?.message}`);
          }
        }
        return;
      }
      console.info(`[${label}] ${txId} state=${state || "unknown"} — still pending`);
    } catch (e: any) {
      console.warn(`[${label}] Poll error for ${txId}: ${e?.message}`);
    }
  }
  console.warn(`[${label}] ⚠️ ${txId} still pending after 5 min — check Circle dashboard`);
}

// ─── Gateway delegate provisioning ───────────────────────────────────────────
// One-time setup for cross-chain Gateway withdrawals:
//   1. Creates a Circle DCW EOA wallet to use as the Gateway burn-intent signer.
//   2. Calls addDelegate(usdcAddress, eoaAddress) on the GatewayWallet contract
//      from each SCA treasury wallet on every Gateway-supported chain, authorising
//      the EOA to spend the treasury's Unified Balance for that token.
//
// After running, add the returned walletId + address to .env as:
//   CIRCLE_GATEWAY_SIGNER_WALLET_ID=<walletId>
//   CIRCLE_GATEWAY_SIGNER_ADDRESS=<address>
// then restart the server.

export async function provisionGatewayDelegate(opts?: {
  walletSetId?: string;
}): Promise<{
  signerWalletId: string;
  signerAddress:  string;
  delegated:      string[];
  skipped:        string[];
}> {
  const client = getDcwClient();
  if (!client) throw new Error("[GatewayDelegate] Circle DCW client not configured — CIRCLE_ENTITY_SECRET not set");

  // ── Step 1: create (or reuse) the EOA signer wallet ─────────────────────────
  let signerWalletId = GATEWAY_SIGNER_WALLET_ID;
  let signerAddress  = GATEWAY_SIGNER_ADDRESS;

  if (!signerWalletId) {
    const walletSetId = opts?.walletSetId ?? process.env.CIRCLE_WALLET_SET_ID;
    if (!walletSetId) {
      throw new Error(
        "[GatewayDelegate] No wallet set ID — pass walletSetId in opts or set CIRCLE_WALLET_SET_ID",
      );
    }

    const res = await client.createWallets({
      blockchains:    ["BASE-SEPOLIA"] as any[],
      count:          1,
      walletSetId,
      accountType:    "EOA" as any,
      idempotencyKey: randomUUID(),
    });

    const wallets: any[] = (res as any)?.data?.wallets ?? (res as any)?.wallets ?? [];
    const wallet = wallets[0];
    if (!wallet?.id || !wallet?.address) {
      throw new Error("[GatewayDelegate] Circle DCW did not return a wallet — check credentials");
    }

    signerWalletId = wallet.id   as string;
    signerAddress  = wallet.address as string;
    console.info(`[GatewayDelegate] Created EOA signer wallet ${signerWalletId} @ ${signerAddress}`);
  } else {
    console.info(`[GatewayDelegate] Reusing existing signer wallet ${signerWalletId} @ ${signerAddress}`);
  }

  // ── Step 2: addDelegate on each supported Gateway chain ─────────────────────
  const delegated: string[] = [];
  const skipped:   string[] = [];

  for (const chainKey of GATEWAY_SUPPORTED_CHAINS) {
    const treasuryWalletId = getTreasuryWalletIdForChain(chainKey as ChainKey);
    if (!treasuryWalletId) {
      // Normal for withdrawal-only chains (ETH-SEPOLIA, UNICHAIN-SEPOLIA) that
      // have no treasury wallet configured — addDelegate is not needed there.
      skipped.push(chainKey);
      continue;
    }

    const chainCfg = getChain(chainKey as ChainKey);

    try {
      // All chains (including Arc Testnet): Circle SCA wallets require feeLevel.
      // On Arc, USDC is the native gas token so the wallet pays from its own
      // balance — Gas Station sponsorship is not involved.
      const fee = { config: { feeLevel: "MEDIUM" } };

      const txRes = await (client as any).createContractExecutionTransaction({
        walletId:             treasuryWalletId,
        contractAddress:      GATEWAY_WALLET_ADDRESS_EVM,
        abiFunctionSignature: ABI_ADD_DELEGATE,
        abiParameters:        [chainCfg.usdcAddress, signerAddress],
        fee,
        idempotencyKey:       randomUUID(),
      });

      const txId: string =
        (txRes as any)?.data?.id ?? (txRes as any)?.id ?? "?";
      console.info(`[GatewayDelegate] addDelegate on ${chainKey}: tx=${txId}`);
      delegated.push(chainKey);
    } catch (err: any) {
      console.warn(`[GatewayDelegate] addDelegate on ${chainKey} failed: ${err?.message}`);
      skipped.push(chainKey);
    }
  }

  return { signerWalletId, signerAddress, delegated, skipped };
}
