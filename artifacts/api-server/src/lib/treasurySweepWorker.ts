// ─── Treasury → Gateway Unified Balance worker ───────────────────────────────
// Every few minutes, moves each treasury wallet's USDC above a small float into
// the Gateway Unified Balance: Arc and Solana (whose deposit sweeps stop at the
// treasury) and any EVM leftovers. Logs the Unified Balance at startup and after
// every deposit, like the treasury Solana balance line.
//
// Env (optional):
//   TREASURY_FLOAT_USDC            USDC kept in each treasury wallet     (default 0.5)
//   TREASURY_MIN_SWEEP_USDC        smallest amount worth depositing      (default 1)
//   TREASURY_SWEEP_INTERVAL_MS     how often to check                    (default 5 min)
//   TREASURY_SWEEP_ENABLED=false   turn the worker off

import { CHAINS, type ChainKey } from "./gatewayConfig.js";
import {
  GATEWAY_SUPPORTED_CHAINS,
  getGatewayUnifiedBalance,
  getTreasuryChainBalance,
  getTreasuryWalletIdForChain,
  isTreasuryBusy,
  markTreasuryBusy,
  clearTreasuryBusy,
  solanaTreasuryDeposit,
  treasuryDepositFor,
} from "./gatewaySweep.js";
import { logger } from "./logger.js";

const FLOAT       = parseFloat(process.env.TREASURY_FLOAT_USDC ?? "0.5");
const MIN_SWEEP   = parseFloat(process.env.TREASURY_MIN_SWEEP_USDC ?? "1");
const INTERVAL_MS = parseInt(process.env.TREASURY_SWEEP_INTERVAL_MS ?? String(5 * 60_000), 10);

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Treasury wallets this worker manages: Gateway-supported chains with a configured wallet. */
function sweepableChains(): ChainKey[] {
  return (Object.keys(CHAINS) as ChainKey[]).filter((key) => {
    const cfg = CHAINS[key];
    if (!GATEWAY_SUPPORTED_CHAINS.has(key) || !(cfg.depositsEnabled || cfg.withdrawalsEnabled)) return false;
    return key === "SOL-DEVNET"
      ? !!process.env.CIRCLE_PLATFORM_WALLET_ID_SOL && !!process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_SOL
      : !!getTreasuryWalletIdForChain(key);
  });
}

export async function logUnifiedBalance(context: string): Promise<void> {
  try {
    const { perChain, total } = await getGatewayUnifiedBalance();
    const parts = Object.entries(perChain)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(" · ");
    console.info(`[UnifiedBalance] ${total.toFixed(6)} USDC total (${context})${parts ? ` — ${parts}` : ""}`);
  } catch (err: any) {
    console.warn(`[UnifiedBalance] check failed (${context}): ${err?.message}`);
  }
}

export async function sweepTreasuriesOnce(): Promise<number> {
  if (running) return 0;
  running = true;
  let swept = 0;
  try {
    for (const chainKey of sweepableChains()) {
      if (isTreasuryBusy(chainKey)) continue;

      const balance = await getTreasuryChainBalance(chainKey);
      const excess  = Math.floor((balance - FLOAT) * 1e6) / 1e6;
      if (excess < MIN_SWEEP) continue;

      const amount = excess.toFixed(6);
      console.info(`[TreasurySweep] ${chainKey}: ${balance.toFixed(6)} USDC in treasury — depositing ${amount}, keeping ${FLOAT}`);
      markTreasuryBusy(chainKey, 15 * 60_000);
      try {
        if (chainKey === "SOL-DEVNET") {
          await solanaTreasuryDeposit(amount);
        } else {
          const { confirmed, depositForTxId } = await treasuryDepositFor(chainKey, amount, { waitForDeposit: true });
          if (!confirmed) throw new Error(`depositFor ${depositForTxId} did not confirm`);
        }
        swept += 1;
      } catch (err: any) {
        logger.warn({ chainKey, amount, err: err?.message }, "[TreasurySweep] deposit failed — will retry next pass");
      } finally {
        clearTreasuryBusy(chainKey);
        markTreasuryBusy(chainKey, 60_000); // let balance reads settle
      }
    }
  } finally {
    running = false;
  }
  if (swept) await logUnifiedBalance(`after ${swept} treasury deposit${swept > 1 ? "s" : ""}`);
  return swept;
}

export function startTreasurySweepWorker(): void {
  if (timer || process.env.TREASURY_SWEEP_ENABLED === "false") return;
  logger.info({ float: FLOAT, minSweep: MIN_SWEEP, intervalMs: INTERVAL_MS, chains: sweepableChains() },
    "[TreasurySweep] Worker started");
  void logUnifiedBalance("startup");
  const tick = () => { sweepTreasuriesOnce().catch((err) => logger.error({ err: err?.message }, "[TreasurySweep] pass error")); };
  setTimeout(tick, 30_000); // after startup delegate provisioning settles
  timer = setInterval(tick, INTERVAL_MS);
}
