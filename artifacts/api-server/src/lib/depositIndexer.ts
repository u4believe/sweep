/**
 * Universal USDC deposit indexer — Circle API poll.
 *
 * Polls Circle's transaction API for all INBOUND COMPLETE transactions across
 * all supported chains. On detection:
 *   1. Credits user's claimedBalance (idempotent via depositReference).
 *   2. Fires the agreed sweep flow: user wallet → platform treasury (transfer),
 *      then treasury → Gateway Vault (depositFor).
 *
 * Circle webhook (deposit.ts) is the primary notification path. This poller
 * acts as a reliable fallback for any events the webhook misses.
 *
 * All chains are covered via a single poll — no chain-specific getLogs needed.
 * Arc Testnet and Base Sepolia both require this API-poll approach because:
 *   - Arc USDC precompile does not emit ERC-20 Transfer events.
 *   - Base Sepolia public RPC returns -32602 on any getLogs call against USDC.
 * Other chains (ARB, OP, MATIC, AVAX, SOL) are also detected here,
 * providing a unified fallback for all deposit-enabled chains.
 */

import {
  db, usersTable, depositsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getDcwClient } from "./circle.js";
import { arcTestnetSweep, evmGatewaySweep, solanaSweep } from "./gatewaySweep.js";
import { isDepositChain, getChain, type ChainKey } from "./gatewayConfig.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;  // 3 s between polls
const PAGE_SIZE        = 50;
const MAX_PAGES        = 20;     // guard against runaway pagination

// Human-readable labels for deposit records and UI display.
const CHAIN_LABELS: Record<string, string> = {
  "BASE-SEPOLIA":      "Base Sepolia USDC",
  "ARC-TESTNET":       "Arc Testnet USDC",
  "ARB-SEPOLIA":       "Arbitrum Sepolia USDC",
  "OP-SEPOLIA":        "Optimism Sepolia USDC",
  "MATIC-AMOY":        "Polygon Amoy USDC",
  "AVAX-FUJI":         "Avalanche Fuji USDC",
  "UNICHAIN-SEPOLIA":  "Unichain Sepolia USDC",
  "HYPEREVM-TESTNET":  "HyperEVM Testnet USDC",
  "SOL-DEVNET":        "Solana Devnet USDC",
};

// ─── State ────────────────────────────────────────────────────────────────────

// Time cursor: initialise 24 h back so the first poll catches any deposits made
// while the server was offline. Advanced to (now − 30 min) after each poll to
// give slow-confirming chains (e.g. Base Sepolia, 5–15 min) a safety buffer.
let _lastPollTime: string = new Date(Date.now() - 24 * 3_600_000).toISOString();
let _running = false;
let _timer:   ReturnType<typeof setTimeout> | null = null;
let _busy     = false;

// ─── Public API ───────────────────────────────────────────────────────────────

export function startDepositIndexer() {
  if (_running) return;
  _running = true;
  logger.info("[usdc-indexer] Starting (Circle API poll — all chains)");
  void _poll();
}

export function stopDepositIndexer() {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  logger.info("[usdc-indexer] Stopped");
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function _poll() {
  if (!_running || _busy) return;
  _busy = true;
  try {
    await _runCircleTransactionPoll();
  } catch (err: any) {
    logger.error({ err: err?.message }, "[usdc-indexer] Poll error");
  } finally {
    _busy = false;
  }
  if (_running) {
    _timer = setTimeout(() => void _poll(), POLL_INTERVAL_MS);
  }
}

// ─── Circle API poll ──────────────────────────────────────────────────────────
// Fetches all INBOUND COMPLETE transactions within the rolling time window.
// Idempotency key: "circle-{circleId}" — matches the webhook path, preventing
// double-credits when both fire for the same transaction.

async function _runCircleTransactionPoll() {
  const client = getDcwClient();
  if (!client) {
    logger.warn("[usdc-indexer] Circle DCW client unavailable — skipping poll");
    return;
  }

  const from = _lastPollTime;
  // 30-minute safety buffer: don't advance the cursor past (now − 30 min).
  const next = new Date(Date.now() - 1_800_000).toISOString();

  // Pass 1: CONFIRMED — insert pending records immediately for fast UI feedback.
  // No balance credit; just lets the user see the deposit in history straight away.
  await _fetchAndProcess(client, from, "CONFIRMED" as any, true);

  // Pass 2: COMPLETE — credit balance and mark as completed. Idempotent with Pass 1.
  await _fetchAndProcess(client, from, "COMPLETE" as any, false);

  // Arc-specific passes: global listTransactions may not reliably return Arc
  // testnet transactions. Query again with blockchain=ARC-TESTNET to catch any
  // that the global query missed. Processing is idempotent — duplicates are no-ops.
  await _fetchAndProcess(client, from, "CONFIRMED" as any, true,  "ARC-TESTNET");
  await _fetchAndProcess(client, from, "COMPLETE"  as any, false, "ARC-TESTNET");

  _lastPollTime = next;
}

async function _fetchAndProcess(
  client:     any,
  from:       string,
  state:      any,
  pendingOnly: boolean,
  blockchain?: string,
) {
  let pageAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let res: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await client.listTransactions({
          txType: "INBOUND" as any,
          state,
          from,
          pageSize: PAGE_SIZE,
          ...(blockchain ? { blockchain: blockchain as any } : {}),
          ...(pageAfter ? { pageAfter } : {}),
        } as any);
        break;
      } catch (e: any) {
        const msg: string = e?.message ?? "";
        const transient = msg.includes("bad record mac") || msg.includes("SSL") ||
                          msg.includes("ssl") || e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT";
        if (transient && attempt < 2) {
          await new Promise(r => setTimeout(r, 1_000 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }

    const txns: any[] = (res?.data as any)?.data?.transactions
                      ?? (res?.data as any)?.transactions
                      ?? [];

    for (const tx of txns) {
      await _processTx(tx, pendingOnly).catch((err: any) => {
        logger.error(
          { err: err?.message, txId: tx?.id },
          "[usdc-indexer] Failed to process transaction — continuing",
        );
      });
    }

    if (txns.length < PAGE_SIZE) break;
    pageAfter = txns[txns.length - 1]?.id;
    if (!pageAfter) break;
  }
}

// ─── Per-transaction processing ───────────────────────────────────────────────

// Platform treasury addresses — transactions destined here are sweeps, not user deposits.
const _TREASURY_ADDRESSES = new Set(
  [
    process.env.CIRCLE_PLATFORM_WALLET_ADDRESS,
    process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_ARC_TESTNET,
    process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_SOL,
  ].filter(Boolean).map(a => a!.toLowerCase()),
);

async function _processTx(tx: any, pendingOnly = false) {
  const circleId:    string        = tx.id;
  const txHash:      string | null = tx.txHash ?? null;
  const walletId:    string | null = tx.walletId ?? null;
  const destAddress: string        = (tx.destinationAddress ?? "").toLowerCase();
  const amount:      string        = tx.amounts?.[0] ?? "0";
  const txChain:     string | null = tx.blockchain ?? null;

  if (!circleId || parseFloat(amount) <= 0) return;

  // Only include on-chain confirmed deposits (must have an actual tx hash).
  if (!txHash) {
    logger.debug({ circleId, txChain }, "[usdc-indexer] No txHash — skipping Circle-internal tx");
    return;
  }

  // Skip sweep confirmations — USDC arriving at the treasury is not a user deposit.
  if (destAddress && _TREASURY_ADDRESSES.has(destAddress)) {
    logger.debug({ circleId, destAddress }, "[usdc-indexer] Destination is treasury — skipping sweep");
    return;
  }

  // Resolve user by walletId (primary column, then JSON map) then address.
  let userId: number | undefined;

  if (walletId) {
    const [byPrimary] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.circleWalletId, walletId)).limit(1);
    userId = byPrimary?.id;

    if (!userId) {
      const [byJson] = await db.select({ id: usersTable.id }).from(usersTable)
        .where(sql`${(usersTable as any).circleWalletIdsJson} LIKE ${"%" + walletId + "%"}`).limit(1);
      userId = byJson?.id;
    }
  }

  if (!userId && destAddress) {
    const [byAddr] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(sql`lower(${usersTable.circleWalletAddress}) = ${destAddress}`).limit(1);
    userId = byAddr?.id;
  }

  if (!userId) {
    logger.debug(
      { circleId, walletId, destAddress, txChain },
      "[usdc-indexer] No user for tx — skipping",
    );
    return;
  }

  logger.debug(
    { userId, circleId, txChain },
    `[usdc-indexer] Processing inbound tx (chain=${txChain})`,
  );

  await _handleDeposit(
    userId,
    parseFloat(amount).toFixed(6),
    txHash,
    destAddress || walletId || "",
    circleId,
    txChain ?? undefined,
    pendingOnly,
  );
}

// ─── Deposit crediting + sweep trigger ────────────────────────────────────────
// circleId is always present for Circle-poll deposits; txBlockchain is the chain
// label reported by Circle (e.g. "BASE-SEPOLIA", "ARC-TESTNET").

async function _handleDeposit(
  userId:        number,
  amount:        string,
  txHash:        string | null,
  _toAddress:    string,
  circleId?:     string,
  txBlockchain?: string,
  pendingOnly:   boolean = false,
) {
  const depositRef = circleId ? `circle-${circleId}` : (txHash ?? "");

  // 1. Check by txHash.
  // promotedViaHash: true means we credited the balance here and must still
  // reach step 4 to trigger the sweep — do NOT return early.
  let promotedViaHash = false;
  if (txHash) {
    const [existingByHash] = await db
      .select({ id: depositsTable.id, status: depositsTable.status })
      .from(depositsTable)
      .where(eq(depositsTable.txHash, txHash))
      .limit(1);
    if (existingByHash) {
      if (existingByHash.status === "completed") {
        logger.debug({ txHash, userId }, "[usdc-indexer] Already credited by txHash — skipping");
        return;
      }
      if (pendingOnly) {
        logger.debug({ txHash, userId }, "[usdc-indexer] Pending record exists (CONFIRMED pass) — skipping");
        return;
      }
      // COMPLETE pass: promote the pending record directly by txHash.
      await db.transaction(async (tx: any) => {
        await tx.update(depositsTable)
          .set({ status: "completed", txHash, creditedAt: new Date() })
          .where(eq(depositsTable.id, existingByHash.id));
        await tx.update(usersTable)
          .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${parseFloat(amount)}` })
          .where(eq(usersTable.id, userId));
      });
      logger.info({ txHash, userId, amount }, "[usdc-indexer] Promoted pending→completed directly by txHash");
      promotedViaHash = true; // fall through to step 4 to trigger sweep
    }
  }

  // Steps 2 & 3 are skipped when step 1 already promoted the record.
  if (!promotedViaHash) {
    // 2. Check by depositReference.
    let skipInsert = false;
    if (depositRef) {
      const [existingByRef] = await db
        .select({ id: depositsTable.id, currentTxHash: depositsTable.txHash, status: depositsTable.status })
        .from(depositsTable)
        .where(eq(depositsTable.depositReference, depositRef))
        .limit(1);

      if (existingByRef) {
        if (!pendingOnly && existingByRef.status === "pending") {
          // COMPLETE pass: promote pending → completed and credit balance.
          await db.transaction(async (tx: any) => {
            await tx.update(depositsTable)
              .set({
                status:     "completed",
                txHash:     txHash ?? existingByRef.currentTxHash ?? null,
                creditedAt: new Date(),
              })
              .where(eq(depositsTable.id, existingByRef.id));
            await tx.update(usersTable)
              .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${parseFloat(amount)}` })
              .where(eq(usersTable.id, userId));
          });
          logger.info(
            { txHash, depositRef, userId, amount },
            "[usdc-indexer] Promoted pending→completed, credited balance",
          );
          skipInsert = true;
        } else {
          // Already completed, or pending pass seeing an existing record — patch txHash if missing.
          if (!existingByRef.currentTxHash && txHash) {
            await db.update(depositsTable)
              .set({ txHash })
              .where(eq(depositsTable.id, existingByRef.id));
            logger.info({ txHash, depositRef, userId }, "[usdc-indexer] Patched missing txHash");
          }
          return;
        }
      }
    }

    // 3. New record.
    if (!skipInsert) {
      if (pendingOnly) {
        // CONFIRMED pass: insert pending record for fast UI display — no balance credit yet.
        await db.insert(depositsTable).values({
          userId,
          amount,
          type:             "crypto",
          source:           CHAIN_LABELS[txBlockchain ?? ""] ?? `${txBlockchain ?? "Unknown"} USDC`,
          status:           "pending",
          depositReference: depositRef || null,
          txHash:           txHash ?? null,
        }).onConflictDoNothing();
        logger.info({ userId, amount, chain: txBlockchain }, "[usdc-indexer] Pending deposit recorded");
        return;
      }

      const credited = await db.transaction(async (tx: any) => {
        const [inserted] = await tx.insert(depositsTable).values({
          userId,
          amount,
          type:             "crypto",
          source:           CHAIN_LABELS[txBlockchain ?? ""] ?? `${txBlockchain ?? "Unknown"} USDC`,
          status:           "completed",
          depositReference: depositRef || null,
          txHash:           txHash ?? null,
          creditedAt:       new Date(),
        }).onConflictDoNothing().returning({ id: depositsTable.id });

        if (!inserted) return false;

        await tx.update(usersTable)
          .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${parseFloat(amount)}` })
          .where(eq(usersTable.id, userId));

        return true;
      });

      if (!credited) return;

      logger.info(
        { userId, amount, chain: txBlockchain },
        "[usdc-indexer] Credited deposit",
      );
    }
  } // end !promotedViaHash

  // 4. Trigger agreed sweep: user wallet → treasury → Gateway Vault.
  const sweepChain = txBlockchain as string | undefined;
  if (!sweepChain || !isDepositChain(sweepChain)) return;

  try {
    const [userWallet] = await db
      .select({
        circleWalletId: usersTable.circleWalletId,
        walletIdsJson:  (usersTable as any).circleWalletIdsJson,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    let walletId: string | undefined;
    if (userWallet?.walletIdsJson) {
      const map = JSON.parse(userWallet.walletIdsJson) as Record<string, string>;
      walletId = map[sweepChain];
    }
    if (!walletId && sweepChain === "BASE-SEPOLIA" && userWallet?.circleWalletId) {
      walletId = userWallet.circleWalletId;
    }

    if (!walletId) {
      logger.warn({ userId, chain: sweepChain }, "[usdc-indexer] No wallet ID for sweep — skipped");
      return;
    }

    const chain = getChain(sweepChain);
    if (sweepChain === "ARC-TESTNET") {
      arcTestnetSweep({ userWalletId: walletId, amount })
        .then(txId => logger.info({ userId, txId }, "[usdc-indexer] Arc sweep completed"))
        .catch((err: any) => logger.error(
          { err: err?.message, userId },
          "[usdc-indexer] Arc sweep failed",
        ));
    } else if (chain.type === "evm") {
      evmGatewaySweep({ userWalletId: walletId, chainKey: sweepChain as ChainKey, amount })
        .then(() => logger.info({ userId, chain: sweepChain }, "[usdc-indexer] EVM sweep completed"))
        .catch((err: any) => logger.error(
          { err: err?.message, userId, chain: sweepChain },
          "[usdc-indexer] EVM sweep failed",
        ));
    } else if (sweepChain === "SOL-DEVNET") {
      solanaSweep({ userSolanaWalletId: walletId, amount })
        .then(() => logger.info({ userId }, "[usdc-indexer] Solana sweep completed"))
        .catch((err: any) => logger.error(
          { err: err?.message, userId },
          "[usdc-indexer] Solana sweep failed",
        ));
    }
  } catch (e: any) {
    logger.warn({ err: e?.message, userId, chain: sweepChain }, "[usdc-indexer] Sweep trigger error");
  }
}
