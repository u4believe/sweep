/**
 * Sweep reconciliation worker.
 *
 * Runs every 60 seconds and checks every user wallet on ALL deposit-enabled
 * chains for unswept USDC.
 *
 * Arc Testnet is handled separately via on-chain eth_call (USDC.balanceOf)
 * because Circle's wallet balance API doesn't index Arc USDC tokens.
 *
 * Sweep-only: does NOT credit balances. Crediting is handled exclusively by
 * the Circle API poll (depositIndexer) using real on-chain txHashes as the
 * unique key. Crediting without a real txHash causes double-credits.
 */

import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getWalletUsdcBalance } from "./circle.js";
import { arcTestnetSweep, evmGatewaySweep, solanaSweep, getArcOnChainUsdcBalance } from "./gatewaySweep.js";
import { DEPOSIT_CHAINS, type ChainKey } from "./gatewayConfig.js";

const POLL_INTERVAL_MS  = 60_000;   // full scan every 60 s
const MIN_SWEEP_USDC    = 0.000001; // ignore dust

let _running = false;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _busy   = false;

// Cooldown: don't re-sweep the same (userId, chain, balanceSnapshot) within 10 minutes.
// Prevents infinite retry floods when on-chain execution fails or is slow to confirm.
const _recentSweeps    = new Map<string, number>();
const SWEEP_COOLDOWN_MS = 10 * 60_000;

function _isSweepOnCooldown(key: string): boolean {
  const t = _recentSweeps.get(key);
  return !!t && Date.now() - t < SWEEP_COOLDOWN_MS;
}
function _markSwept(key: string): void {
  _recentSweeps.set(key, Date.now());
  // Prune stale entries
  if (_recentSweeps.size > 500) {
    const cutoff = Date.now() - SWEEP_COOLDOWN_MS;
    for (const [k, v] of _recentSweeps) if (v < cutoff) _recentSweeps.delete(k);
  }
}

export function startSweepReconciliationWorker() {
  if (_running) return;
  _running = true;
  logger.info("[sweep-reconciliation] Worker started (all deposit chains via Circle DCW)");
  void poll();
}

export function stopSweepReconciliationWorker() {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  logger.info("[sweep-reconciliation] Worker stopped");
}

async function poll() {
  if (!_running || _busy) return;
  _busy = true;
  try {
    await reconcile();
  } catch (err: any) {
    logger.error({ err: err?.message }, "[sweep-reconciliation] Unexpected error");
  } finally {
    _busy = false;
  }
  if (_running) {
    _timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }
}

async function reconcile() {
  const users = await db
    .select({
      id:                  usersTable.id,
      circleWalletId:      usersTable.circleWalletId,
      primaryAddress:      usersTable.circleWalletAddress,
      walletIdsJson:       (usersTable as any).circleWalletIdsJson,
      walletAddressesJson: (usersTable as any).circleWalletAddressesJson,
    })
    .from(usersTable)
    .where(sql`${usersTable.circleWalletAddress} IS NOT NULL`);

  if (users.length === 0) return;

  let sweepsTriggered = 0;

  // ── Non-Arc chains: Circle wallet balance API ─────────────────────────────
  // Arc Testnet is skipped here because Circle's API never returns Arc USDC
  // token balances. Arc is handled separately below via on-chain eth_call.
  for (const chainCfg of DEPOSIT_CHAINS) {
    const chain = chainCfg.key as ChainKey;
    if (chain === "ARC-TESTNET") continue;

    for (const user of users) {
      let walletId: string | undefined;
      if (user.walletIdsJson) {
        try {
          const ids = JSON.parse(user.walletIdsJson) as Record<string, string>;
          walletId = ids[chain];
        } catch { /* fall through */ }
      }
      if (!walletId && chain === "BASE-SEPOLIA" && user.circleWalletId) {
        walletId = user.circleWalletId;
      }
      if (!walletId) continue;

      let balance: number;
      try {
        balance = parseFloat(await getWalletUsdcBalance(walletId));
      } catch (e: any) {
        logger.warn({ chain, walletId, err: e?.message }, "[sweep-reconciliation] Balance fetch failed");
        continue;
      }

      if (balance < MIN_SWEEP_USDC) continue;

      let address: string | null = null;
      if (user.walletAddressesJson) {
        try {
          const addrs = JSON.parse(user.walletAddressesJson) as Record<string, string>;
          address = addrs[chain]?.toLowerCase() ?? null;
        } catch { /* fall through */ }
      }
      if (!address && user.primaryAddress) address = user.primaryAddress.toLowerCase();
      if (!address) address = walletId;

      const rawBalanceStr = Math.round(balance * 1_000_000).toString();

      logger.warn(
        { userId: user.id, chain, address, balance },
        "[sweep-reconciliation] Found unswept USDC — sweep only, crediting handled by Circle poll",
      );

      const cooldownKey = `${user.id}:${chain}:${rawBalanceStr}`;
      if (_isSweepOnCooldown(cooldownKey)) {
        logger.debug({ userId: user.id, chain }, "[sweep-reconciliation] Sweep on cooldown — skipping retry");
        continue;
      }
      _markSwept(cooldownKey);

      if (chainCfg.type === "evm") {
        evmGatewaySweep({ userWalletId: walletId, chainKey: chain, amount: balance.toFixed(6) })
          .then(() => logger.info({ userId: user.id, chain }, "[sweep-reconciliation] EVM sweep completed"))
          .catch((err: any) => logger.error(
            { err: err?.message, userId: user.id, chain },
            "[sweep-reconciliation] EVM sweep failed",
          ));
      } else if (chain === "SOL-DEVNET") {
        solanaSweep({ userSolanaWalletId: walletId, amount: balance.toFixed(6) })
          .then(() => logger.info({ userId: user.id, chain }, "[sweep-reconciliation] Solana sweep completed"))
          .catch((err: any) => logger.error(
            { err: err?.message, userId: user.id, chain },
            "[sweep-reconciliation] Solana sweep failed",
          ));
      }

      sweepsTriggered++;
    }
  }

  // ── Arc Testnet: on-chain eth_call (USDC.balanceOf) ───────────────────────
  // Sweep-only fallback. Crediting is handled by arcDepositWorker which queries
  // Circle per-wallet. This section only sweeps any unswept on-chain USDC that
  // the arc deposit worker may have missed or whose sweep failed.
  for (const user of users) {
    const arcAddress = user.primaryAddress;
    if (!arcAddress) continue;

    let arcWalletId: string | undefined;
    if (user.walletIdsJson) {
      try {
        arcWalletId = (JSON.parse(user.walletIdsJson) as Record<string, string>)["ARC-TESTNET"];
      } catch { /* fall through */ }
    }
    if (!arcWalletId) continue;

    let balance: number;
    try {
      balance = await getArcOnChainUsdcBalance(arcAddress);
    } catch { continue; }

    if (balance < MIN_SWEEP_USDC) continue;

    const cooldownKey = `${user.id}:ARC-TESTNET:${Math.round(balance * 1_000_000)}`;
    if (_isSweepOnCooldown(cooldownKey)) continue;
    _markSwept(cooldownKey);

    logger.warn(
      { userId: user.id, address: arcAddress, balance },
      "[sweep-reconciliation] Found unswept Arc USDC — sweeping to treasury",
    );

    arcTestnetSweep({ userWalletId: arcWalletId, userAddress: arcAddress, amount: balance.toFixed(6) })
      .then(txId => logger.info({ userId: user.id, txId }, "[sweep-reconciliation] Arc sweep completed"))
      .catch((err: any) => logger.error(
        { err: err?.message, userId: user.id },
        "[sweep-reconciliation] Arc sweep failed",
      ));

    sweepsTriggered++;
  }

  if (sweepsTriggered > 0) {
    logger.info({ sweepsTriggered }, "[sweep-reconciliation] Reconciliation complete");
  } else {
    logger.debug("[sweep-reconciliation] All user wallets clean — no unswept USDC found");
  }
}
