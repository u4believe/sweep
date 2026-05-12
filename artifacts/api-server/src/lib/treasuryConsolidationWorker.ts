/**
 * Treasury consolidation worker — Arc treasury balance monitor + Base Sepolia sweep.
 *
 * Arc Testnet is the primary treasury chain. All new deposits flow directly to
 * the Arc platform treasury (Arc deposits via same-chain sweep; Base Sepolia
 * deposits via CCTP V2 depositForBurn). Withdrawals are also paid from the Arc
 * treasury.
 *
 * This worker does two things:
 *   1. Monitors the Arc treasury USDC balance (observability / alerting).
 *   2. Detects any USDC remaining on the Base Sepolia platform treasury and
 *      forwards it to the Arc treasury via CCTP V2 depositForBurn.
 *      This handles legacy balances left over before the architecture migration.
 *      A `_forwarding` flag and per-forward cooldown prevent duplicate runs.
 */

import { ethers } from "ethers";
import { logger } from "./logger.js";
import { getPlatformWalletAddress, getWalletUsdcBalance } from "./circle.js";
import { cctpDepositForBurnFromBase } from "./cctpBridge.js";

const POLL_INTERVAL_MS        = 60_000; // check every 60 s
const MIN_LOG_THRESHOLD       = 0.5;    // only log Arc balance when worth noting
const BASE_FORWARD_THRESHOLD  = 1.0;    // forward Base treasury if balance ≥ $1
const FORWARD_COOLDOWN_MS     = 10 * 60_000; // 10-min cooldown between forward attempts

// Base Sepolia USDC contract
const BASE_SEPOLIA_USDC       = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

let _running    = false;
let _timer:      ReturnType<typeof setTimeout> | null = null;
let _busy        = false;
let _forwarding  = false;
let _lastForwardAt = 0;

export function startTreasuryConsolidationWorker() {
  if (_running) return;
  _running = true;
  logger.info("[treasury-consolidation] Worker started (Arc balance monitor + Base Sepolia sweep)");
  void poll();
}

export function stopTreasuryConsolidationWorker() {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  logger.info("[treasury-consolidation] Worker stopped");
}

// Kept for call-site compatibility — triggers an immediate balance check.
export function triggerTreasuryConsolidation() {
  if (!_running || _busy) return;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  void poll();
}

async function poll() {
  if (!_running || _busy) return;
  _busy = true;
  try {
    await checkBalances();
  } catch (err: any) {
    logger.error({ err: err?.message }, "[treasury-consolidation] Unexpected error");
  } finally {
    _busy = false;
  }
  if (_running) {
    _timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }
}

async function getArcTreasuryBalance(): Promise<number> {
  const treasuryAddress = getPlatformWalletAddress();
  if (!treasuryAddress) return 0;

  const arcWalletId = process.env.CIRCLE_PLATFORM_WALLET_ID_ARC_TESTNET;

  // Primary: Circle DCW API — tracks all USDC in the wallet regardless of
  // how it arrived (direct sweep, CCTP mint, external deposit).
  if (arcWalletId) {
    try {
      const dcwBalance = parseFloat(await getWalletUsdcBalance(arcWalletId));

      // Secondary: on-chain RPC read of Arc USDC precompile (catches any USDC
      // that Circle DCW may not have indexed yet, e.g. fresh CCTP mints).
      const arcRpc      = process.env.ARC_RPC_URL ?? process.env.RPC_URL ?? "https://rpc.testnet.arc.network";
      const arcUsdcAddr = process.env.ARC_USDC_ADDRESS ?? process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
      let   rpcBalance  = 0;
      try {
        const provider = new ethers.JsonRpcProvider(arcRpc);
        const usdc     = new ethers.Contract(arcUsdcAddr, [
          "function balanceOf(address) view returns (uint256)",
          "function decimals() view returns (uint8)",
        ], provider);
        const [raw, dec] = await Promise.all([usdc.balanceOf(treasuryAddress), usdc.decimals()]);
        rpcBalance = parseFloat(ethers.formatUnits(raw, dec));
      } catch { /* non-fatal; DCW value is primary */ }

      // Log both so discrepancies are immediately visible.
      // A gap means CCTP USDC arrived on-chain but Circle DCW hasn't indexed it yet.
      if (Math.abs(dcwBalance - rpcBalance) > 0.01) {
        logger.warn(
          { dcwBalance, rpcBalance },
          "[treasury-consolidation] Arc treasury balance mismatch — Circle DCW vs on-chain RPC",
        );
      }

      // Take the higher of the two: RPC is always accurate; DCW may lag after
      // a fresh CCTP mint before Circle's indexer catches up.
      return Math.max(dcwBalance, rpcBalance);
    } catch (e: any) {
      logger.warn({ err: e?.message }, "[treasury-consolidation] Circle DCW balance check failed");
    }
  }

  // Fallback: RPC only (when CIRCLE_PLATFORM_WALLET_ID_ARC_TESTNET is not set)
  const arcRpc      = process.env.ARC_RPC_URL ?? process.env.RPC_URL ?? "https://rpc.testnet.arc.network";
  const arcUsdcAddr = process.env.ARC_USDC_ADDRESS ?? process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
  try {
    const provider = new ethers.JsonRpcProvider(arcRpc);
    const usdc     = new ethers.Contract(arcUsdcAddr, [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
    ], provider);
    const [raw, dec] = await Promise.all([usdc.balanceOf(treasuryAddress), usdc.decimals()]);
    return parseFloat(ethers.formatUnits(raw, dec));
  } catch (e: any) {
    logger.warn({ err: e?.message }, "[treasury-consolidation] Failed to read Arc treasury balance via RPC");
    return 0;
  }
}

async function getBaseTreasuryBalance(): Promise<number> {
  const treasuryAddress = getPlatformWalletAddress();
  if (!treasuryAddress) return 0;

  const baseRpc = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

  try {
    const provider = new ethers.JsonRpcProvider(baseRpc);
    const usdc     = new ethers.Contract(BASE_SEPOLIA_USDC, [
      "function balanceOf(address) view returns (uint256)",
    ], provider);
    const raw = await usdc.balanceOf(treasuryAddress);
    return parseFloat(ethers.formatUnits(raw, 6));
  } catch (e: any) {
    logger.warn({ err: e?.message }, "[treasury-consolidation] Failed to read Base Sepolia treasury balance");
    return 0;
  }
}

async function forwardBaseToArc(balance: number): Promise<void> {
  const baseWalletId = process.env.CIRCLE_PLATFORM_WALLET_ID_BASE_SEPOLIA;
  if (!baseWalletId) {
    logger.warn("[treasury-consolidation] CIRCLE_PLATFORM_WALLET_ID_BASE_SEPOLIA not set — cannot forward Base treasury");
    return;
  }

  // Format to 6 decimal places (USDC precision) — leave a small buffer for fee
  // The Forwarding Service deducts gas + protocol fees from the transfer amount automatically.
  const amountStr = balance.toFixed(6);

  logger.info(
    { balance, amountStr, baseWalletId },
    "[treasury-consolidation] Forwarding Base Sepolia platform treasury USDC → Arc treasury via CCTP V2",
  );

  try {
    const { txId: burnTxId, onChainTxHash: burnTxHash } = await cctpDepositForBurnFromBase({ walletId: baseWalletId }, amountStr);
    logger.info(
      { burnTxId, burnTxHash, amount: amountStr },
      "[treasury-consolidation] Base→Arc CCTP depositForBurn submitted — Circle Forwarding Service will mint on Arc Testnet",
    );
  } catch (err: any) {
    logger.error(
      { err: err?.message, amount: amountStr },
      "[treasury-consolidation] Base→Arc forward failed — will retry next poll",
    );
    throw err;
  }
}

async function checkBalances(): Promise<void> {
  const [arcBalance, baseBalance] = await Promise.all([
    getArcTreasuryBalance(),
    getBaseTreasuryBalance(),
  ]);

  // ── Arc treasury logging ────────────────────────────────────────────────────
  if (arcBalance >= MIN_LOG_THRESHOLD) {
    logger.info(
      { arcBalance },
      "[treasury-consolidation] Arc treasury balance (primary treasury — deposits in, withdrawals out)",
    );
  } else {
    logger.debug({ arcBalance }, "[treasury-consolidation] Arc treasury balance below threshold");
  }

  // ── Base Sepolia treasury sweep ─────────────────────────────────────────────
  if (baseBalance < BASE_FORWARD_THRESHOLD) {
    if (baseBalance > 0) {
      logger.debug(
        { baseBalance },
        "[treasury-consolidation] Base Sepolia treasury balance below forward threshold — skipping",
      );
    }
    return;
  }

  if (_forwarding) {
    logger.debug(
      { baseBalance },
      "[treasury-consolidation] Base→Arc forward already in progress — skipping",
    );
    return;
  }

  const cooldownRemaining = FORWARD_COOLDOWN_MS - (Date.now() - _lastForwardAt);
  if (cooldownRemaining > 0) {
    logger.debug(
      { baseBalance, cooldownRemainingMs: cooldownRemaining },
      "[treasury-consolidation] Base→Arc forward in cooldown — skipping",
    );
    return;
  }

  _forwarding = true;
  _lastForwardAt = Date.now();

  try {
    await forwardBaseToArc(baseBalance);
  } finally {
    _forwarding = false;
  }
}
