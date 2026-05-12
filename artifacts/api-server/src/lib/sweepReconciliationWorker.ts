/**
 * Sweep reconciliation worker.
 *
 * Runs every 60 seconds and scans every user wallet on BASE-SEPOLIA and
 * ARC-TESTNET for unswept USDC — balances > 0 with no active bridge job.
 *
 * This catches USDC that slipped through due to:
 *   - Circle DCW transactions that were accepted but failed on-chain
 *   - Bridge job insert failures (DB error after balance was credited)
 *   - Server restarts that reset in-memory balance tracking
 *   - Transfer event indexer RPC failures (Base Sepolia getLogs errors)
 *   - Any other scenario where the deposit indexer missed the on-chain event
 *
 * When unswept USDC is found with no deposit record, this worker credits
 * the user's balance AND creates the bridge job, so users are never left
 * with USDC swept away but no platform balance credited.
 *
 * Idempotency: the synthetic tx_hash `recon-{chain}-{address8}-{rawBalance}`
 * ensures the same (wallet, balance snapshot) never creates duplicate jobs
 * or credits — even if this worker races with the deposit indexer.
 */

import { ethers } from "ethers";
import { db, usersTable, depositsTable, bridgeJobsTable } from "@workspace/db";
import { eq, sql, or } from "drizzle-orm";
import { logger } from "./logger.js";
import { triggerBridgeWorker } from "./bridgeWorker.js";
import {
  SUPPORTED_SOURCE_CHAINS,
  CHAIN_RPC_URLS,
  CHAIN_USDC_ADDRESSES,
  type SourceChain,
} from "./circle.js";

const POLL_INTERVAL_MS  = 60_000;   // full scan every 60 s
const MIN_SWEEP_USDC    = 0.000001; // ignore dust

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

let _running = false;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _busy   = false;

export function startSweepReconciliationWorker() {
  if (_running) return;
  _running = true;
  logger.info("[sweep-reconciliation] Worker started");
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
  // Load all users that have Circle wallets
  const users = await db
    .select({
      id:                  usersTable.id,
      primaryAddress:      usersTable.circleWalletAddress,
      walletIdsJson:       (usersTable as any).circleWalletIdsJson,
      walletAddressesJson: (usersTable as any).circleWalletAddressesJson,
    })
    .from(usersTable)
    .where(sql`${usersTable.circleWalletAddress} IS NOT NULL`);

  if (users.length === 0) return;

  const platformAddress = (process.env.CIRCLE_PLATFORM_WALLET_ADDRESS ?? "").toLowerCase();

  let jobsCreated = 0;

  for (const chain of SUPPORTED_SOURCE_CHAINS as SourceChain[]) {
    const rpcUrl   = CHAIN_RPC_URLS[chain];
    const usdcAddr = CHAIN_USDC_ADDRESSES[chain];

    let provider: ethers.JsonRpcProvider;
    let usdc: ethers.Contract;
    let decimals: number;

    try {
      provider = new ethers.JsonRpcProvider(rpcUrl);
      usdc     = new ethers.Contract(usdcAddr, ERC20_ABI, provider);
      decimals = Number(await usdc.decimals());
    } catch (e: any) {
      logger.warn({ chain, err: e?.message }, "[sweep-reconciliation] Could not connect to RPC — skipping chain");
      continue;
    }

    for (const user of users) {
      // Resolve this user's wallet address for the current chain
      let address: string | null = null;
      if (user.walletAddressesJson) {
        try {
          const map = JSON.parse(user.walletAddressesJson) as Record<string, string>;
          address = map[chain]?.toLowerCase() ?? null;
        } catch { /* fall through */ }
      }
      if (!address && user.primaryAddress) address = user.primaryAddress.toLowerCase();
      if (!address) continue;

      // Never watch the platform treasury — it's not a user wallet
      if (address === platformAddress) continue;

      // Check on-chain balance
      let rawBalance: bigint;
      try {
        rawBalance = await usdc.balanceOf(address);
      } catch (e: any) {
        logger.debug({ chain, address, err: e?.message }, "[sweep-reconciliation] balanceOf failed");
        continue;
      }

      if (rawBalance === 0n) continue;

      const balance = parseFloat(ethers.formatUnits(rawBalance, decimals));
      if (balance < MIN_SWEEP_USDC) continue;

      // Check whether an active bridge job already exists for this wallet+chain
      const [activeJob] = await db
        .select({ id: bridgeJobsTable.id })
        .from(bridgeJobsTable)
        .where(
          sql`${bridgeJobsTable.sourceChain} = ${chain}
          AND lower(${bridgeJobsTable.userWalletAddress}) = lower(${address})
          AND ${bridgeJobsTable.status} IN ('pending', 'processing', 'retry')`
        )
        .limit(1);

      if (activeJob) continue; // already being swept

      // No active job — check idempotency via synthetic hash
      const reconHash = `recon-${chain}-${address.slice(2, 10)}-${rawBalance.toString()}`;
      const [existing] = await db
        .select({ id: bridgeJobsTable.id })
        .from(bridgeJobsTable)
        .where(eq(bridgeJobsTable.txHash, reconHash))
        .limit(1);

      if (existing) continue; // already handled this exact balance snapshot

      // Check if the deposit was already credited (e.g. by Transfer event indexer or webhook).
      // If a deposit record with this reconHash exists, balance was credited in a prior run.
      const [existingDeposit] = await db
        .select({ id: depositsTable.id })
        .from(depositsTable)
        .where(eq(depositsTable.txHash, reconHash))
        .limit(1);

      logger.warn(
        { userId: user.id, chain, address, balance, reconHash, alreadyCredited: !!existingDeposit },
        "[sweep-reconciliation] Found unswept USDC — creating reconciliation bridge job",
      );

      // Credit user balance only if not already credited for this exact snapshot.
      // This fires when the deposit indexer missed the Transfer event (RPC failure, downtime, etc.)
      if (!existingDeposit) {
        await db.update(usersTable)
          .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${balance}` })
          .where(eq(usersTable.id, user.id));

        await db.insert(depositsTable).values({
          userId:           user.id,
          amount:           balance.toFixed(6),
          type:             "crypto",
          source:           chain === "ARC-TESTNET" ? "Arc Testnet USDC" : "Base Sepolia USDC",
          status:           "completed",
          depositReference: reconHash,
          txHash:           reconHash,
          creditedAt:       new Date(),
        });

        logger.info(
          { userId: user.id, chain, address, balance },
          "[sweep-reconciliation] Credited missed deposit",
        );
      }

      await db.insert(bridgeJobsTable).values({
        userId:            user.id,
        sourceChain:       chain,
        userWalletAddress: address,
        amount:            balance.toFixed(6),
        txHash:            reconHash,
        status:            "pending",
      });

      jobsCreated++;
    }
  }

  if (jobsCreated > 0) {
    logger.info(
      { jobsCreated },
      "[sweep-reconciliation] Reconciliation complete — bridge jobs created",
    );
    triggerBridgeWorker();
  } else {
    logger.debug("[sweep-reconciliation] All user wallets clean — no unswept USDC found");
  }
}
