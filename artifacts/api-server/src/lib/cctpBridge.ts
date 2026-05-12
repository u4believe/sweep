/**
 * CCTP V2 bridge: Base Sepolia → Arc Testnet via Circle Forwarding Service.
 *
 * Why not Circle App Kit?
 *   Base Sepolia's kitContracts has no `adapter` contract. The Circle Wallets
 *   adapter requires an adapter contract on the SOURCE chain. Arc Testnet has
 *   both `bridge` and `adapter`; Base Sepolia does not — so kit.bridge() always
 *   fails when Base Sepolia is the source chain.
 *
 * Why depositForBurnWithHook (not depositForBurn)?
 *   The Circle Forwarding Service is triggered by the `hookData` field of
 *   depositForBurnWithHook. Without it, the USDC is burned on Base Sepolia but
 *   receiveMessage is NEVER called on Arc — the USDC vanishes.
 *   depositForBurn (5- or 7-param) does NOT trigger the Forwarding Service.
 *   Reference: https://developers.circle.com/cctp/concepts/forwarding-service
 *
 * Flow:
 *   1. approve(tokenMessengerV2, amount)   — on Base Sepolia USDC
 *   2. depositForBurnWithHook(...)         — burns USDC + embeds Forwarding
 *      Service hook (cctp-forward magic bytes) so Circle auto-relays to Arc
 *   3. Circle Forwarding Service:          — attests + calls receiveMessage
 *   4. Arc TokenMinterV2:                  — mints USDC at Arc platform treasury
 *
 * Fee model (from docs.arc.network/app-kit/concepts/bridge-fees):
 *   - Forwarding Service fee: $0.20 USDC (deducted from minted amount on Arc)
 *   - CCTP protocol fee:      varies by source chain (deducted from burned amount)
 *   - maxFee covers both. If maxFee < combined fees → falls back to Standard
 *     Transfer but Forwarding Service still completes the mint on Arc.
 *
 * Base Sepolia CCTP V2 contracts:
 *   USDC:              0x036CbD53842c5426634e7929541eC2318f3dCF7e
 *   TokenMessengerV2:  0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa
 *   MessageTransmitterV2: 0xe737e5cebeeba77efe34d4aa090756590b1ce275
 *   Arc Testnet domain: 26
 */

import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { ethers } from "ethers";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { getPlatformWalletAddress } from "./circle.js";

// ── Base Sepolia CCTP V2 constants ────────────────────────────────────────────

const BASE_SEPOLIA_USDC              = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_SEPOLIA_CCTP_V2_MESSENGER = "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa";
const ARC_TESTNET_DOMAIN             = 26;
const ZERO_BYTES32                   = `0x${"00".repeat(32)}`; // destinationCaller = any relayer

// Forwarding Service hook data — static 32-byte payload for EVM→EVM transfers.
// Format: "cctp-forward" magic (12 bytes padded to 24) | version uint32(0) | length uint32(0)
// Reference: https://developers.circle.com/cctp/concepts/forwarding-service
const FORWARDING_HOOK_DATA =
  "0x636374702d666f72776172640000000000000000000000000000000000000000";

// maxFee must cover Forwarding Service fee ($0.20 USDC) + CCTP protocol fee.
// Set to 0.50 USDC for a comfortable buffer.
// If maxFee < combined fees, CCTP falls back to Standard Transfer but
// the Forwarding Service still completes the mint on Arc.
const MAX_FEE_ATOMIC         = "500000"; // 0.50 USDC in atomic units (6 decimals)
const MIN_FINALITY_THRESHOLD = 1000;     // fast-finality path (seconds, not 20+ min)

// ABI for depositForBurnWithHook — the CCTP V2 function that embeds the
// Forwarding Service hook so Circle auto-relays the attestation + mint on Arc.
const DEPOSIT_FOR_BURN_WITH_HOOK_ABI = [
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData) external returns (uint64 nonce)",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDcwClient() {
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!entitySecret) throw new Error("CIRCLE_ENTITY_SECRET not set");
  return initiateDeveloperControlledWalletsClient({
    apiKey:       process.env.CIRCLE_API_KEY!,
    entitySecret,
  });
}

function padAddressToBytes32(addr: string): string {
  return `0x${addr.replace(/^0x/i, "").padStart(64, "0").toLowerCase()}`;
}

// Poll Circle DCW until tx reaches CONFIRMED / COMPLETE.
// Returns the on-chain tx hash if Circle has indexed it.
async function pollTxConfirmed(
  client: ReturnType<typeof getDcwClient>,
  txId:   string,
  maxMs:  number = 120_000,
): Promise<string | undefined> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res  = await client.getTransaction({ id: txId });
      const body = (res as any)?.data ?? res;
      const tx   = body?.data ?? body?.transaction ?? body;
      const state: string = String(tx?.state ?? tx?.status ?? "").toUpperCase();

      if (state === "CONFIRMED" || state === "COMPLETE") {
        return tx?.txHash ?? tx?.transactionHash ?? undefined;
      }
      if (state === "FAILED" || state === "CANCELLED" || state === "DENIED") {
        throw new Error(`Circle DCW transaction ${txId} ended with state: ${state}`);
      }
    } catch (e: any) {
      if (/(FAILED|CANCELLED|DENIED)/.test(e?.message ?? "")) throw e;
    }
    await new Promise(r => setTimeout(r, 3_000));
  }
  throw new Error(`Circle DCW transaction ${txId} not confirmed within ${maxMs / 1000}s`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wallet reference — Circle DCW wallet ID (preferred) or EVM address+blockchain.
 */
export type WalletRef =
  | { walletId: string; walletAddress?: never }
  | { walletId?: never; walletAddress: string };

/**
 * Bridge USDC from a Base Sepolia wallet to the Arc Testnet platform treasury
 * using CCTP V2 depositForBurnWithHook + Circle Forwarding Service.
 *
 * Steps:
 *   1. approve(tokenMessenger, amount)   — Base Sepolia USDC (polled to confirm)
 *   2. depositForBurnWithHook(...)       — burns USDC with Forwarding Service
 *      hook so Circle auto-relays to Arc (polled to confirm on-chain)
 *
 * Fees deducted from the minted amount on Arc:
 *   - Forwarding Service: $0.20 USDC
 *   - CCTP protocol fee: small amount (covered by maxFee = 0.50 USDC)
 *
 * @param wallet  { walletId } for treasury or { walletAddress } for user wallets.
 * @param amount  Human-readable USDC amount, e.g. "10.500000".
 * @returns       The depositForBurnWithHook Circle DCW transaction ID.
 */
export async function cctpDepositForBurnFromBase(
  wallet: WalletRef,
  amount: string,
): Promise<{ txId: string; onChainTxHash: string | undefined }> {
  const client      = getDcwClient();
  const arcTreasury = getPlatformWalletAddress();
  if (!arcTreasury) throw new Error("CIRCLE_PLATFORM_WALLET_ADDRESS not set");

  const amountAtomic     = ethers.parseUnits(amount, 6).toString();
  const recipientBytes32 = padAddressToBytes32(arcTreasury);

  const walletField: Record<string, string> = "walletId" in wallet && wallet.walletId
    ? { walletId: wallet.walletId }
    : { walletAddress: (wallet as any).walletAddress, blockchain: "BASE-SEPOLIA" };

  // ── Step 1: approve ───────────────────────────────────────────────────────
  logger.info(
    { ...walletField, amount, amountAtomic, arcTreasury },
    "[cctp] Step 1/2 — approve CCTP V2 TokenMessenger to spend Base Sepolia USDC",
  );

  const approveRes = await (client as any).createContractExecutionTransaction({
    ...walletField,
    contractAddress:      BASE_SEPOLIA_USDC,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters:        [BASE_SEPOLIA_CCTP_V2_MESSENGER, amountAtomic],
    fee:                  { config: { feeLevel: "MEDIUM" } },
    idempotencyKey:       randomUUID(),
  });

  const approveTxId: string | undefined =
    (approveRes as any)?.data?.id ?? (approveRes as any)?.id;
  if (!approveTxId) throw new Error("approve: Circle DCW returned no transaction ID");

  logger.info({ approveTxId }, "[cctp] Step 1/2 — approve submitted, waiting for confirmation");
  await pollTxConfirmed(client, approveTxId);
  logger.info({ approveTxId }, "[cctp] Step 1/2 — approve confirmed on Base Sepolia");

  // ── Step 2: depositForBurnWithHook ────────────────────────────────────────
  // Uses ethers ABI encoding because hookData is a dynamic `bytes` type which
  // requires offset+length encoding that abiParameters alone cannot express.
  const iface        = new ethers.Interface(DEPOSIT_FOR_BURN_WITH_HOOK_ABI);
  const burnCallData = iface.encodeFunctionData("depositForBurnWithHook", [
    amountAtomic,
    ARC_TESTNET_DOMAIN,       // Arc Testnet CCTP domain = 26
    recipientBytes32,         // arc treasury padded to bytes32
    BASE_SEPOLIA_USDC,        // burnToken
    ZERO_BYTES32,             // destinationCaller = any relayer
    MAX_FEE_ATOMIC,           // max 0.50 USDC: covers Forwarding Service + CCTP fees
    MIN_FINALITY_THRESHOLD,   // 1000 = fast-finality path
    FORWARDING_HOOK_DATA,     // cctp-forward magic → Circle Forwarding Service
  ]);

  logger.info(
    {
      ...walletField,
      amount,
      amountAtomic,
      arcDomain: ARC_TESTNET_DOMAIN,
      arcTreasury,
      maxFee:              MAX_FEE_ATOMIC,
      minFinalityThreshold: MIN_FINALITY_THRESHOLD,
    },
    "[cctp] Step 2/2 — depositForBurnWithHook (Forwarding Service) on Base Sepolia → Arc Testnet",
  );

  const burnRes = await (client as any).createContractExecutionTransaction({
    ...walletField,
    contractAddress: BASE_SEPOLIA_CCTP_V2_MESSENGER,
    callData:        burnCallData,
    fee:             { config: { feeLevel: "HIGH" } },
    idempotencyKey:  randomUUID(),
  });

  const burnTxId: string | undefined =
    (burnRes as any)?.data?.id ?? (burnRes as any)?.id;
  if (!burnTxId) throw new Error("depositForBurnWithHook: Circle DCW returned no transaction ID");

  logger.info({ burnTxId }, "[cctp] Step 2/2 — burn submitted, waiting for on-chain confirmation");

  // Confirm the burn is on-chain before returning. Only after this does
  // the CCTP MessageSent event exist for the Forwarding Service to relay.
  const onChainTxHash = await pollTxConfirmed(client, burnTxId, 120_000);

  logger.info(
    {
      burnTxId,
      onChainTxHash,
      amount,
      arcDomain:   ARC_TESTNET_DOMAIN,
      arcTreasury,
      maxFee:      MAX_FEE_ATOMIC,
      hook:        "cctp-forward (Forwarding Service)",
    },
    "[cctp] Step 2/2 — depositForBurnWithHook confirmed on Base Sepolia — Circle Forwarding Service will attest and mint USDC on Arc Testnet",
  );

  return { txId: burnTxId, onChainTxHash };
}
