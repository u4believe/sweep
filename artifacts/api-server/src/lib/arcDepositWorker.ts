/**
 * Arc Testnet Deposit Worker
 *
 * Polls Circle's DCW API per-user (walletId filter) for INBOUND USDC transactions
 * on ARC-TESTNET. Circle's global listTransactions doesn't reliably return Arc
 * deposits; querying by walletId is more targeted and catches what the global
 * indexer misses.
 *
 * On each detected deposit:
 *   1. Inserts a deposit record (idempotent via circle-{txId} key).
 *   2. Credits the user's claimedBalance.
 *   3. Triggers arcTestnetSweep to move USDC to the platform treasury on Arc.
 */

import { db, usersTable, depositsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getDcwClient } from "./circle.js";
import { arcTestnetSweep } from "./gatewaySweep.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000; // scan all Arc wallets every 30 s

// Treasury address — transactions destined here are sweeps, not user deposits.
const TREASURY_ADDRESS = (
  process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_ARC_TESTNET
  ?? process.env.CIRCLE_PLATFORM_WALLET_ADDRESS
  ?? ""
).toLowerCase();

// ─── State ────────────────────────────────────────────────────────────────────

// Rolling 30-minute safety buffer — same pattern as the global deposit indexer.
let _lastPollTime: string = new Date(Date.now() - 24 * 3_600_000).toISOString();
let _running = false;
let _timer:   ReturnType<typeof setTimeout> | null = null;
let _busy     = false;

// ─── Public API ───────────────────────────────────────────────────────────────

export function startArcDepositWorker(): void {
  if (_running) return;
  _running = true;
  logger.info("[arc-deposit] Worker started (per-wallet Circle API poll)");
  void _poll();
}

export function stopArcDepositWorker(): void {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  logger.info("[arc-deposit] Worker stopped");
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function _poll(): Promise<void> {
  if (!_running || _busy) return;
  _busy = true;
  try {
    await _scan();
  } catch (err: any) {
    logger.error({ err: err?.message }, "[arc-deposit] Unexpected poll error");
  } finally {
    _busy = false;
  }
  if (_running) {
    _timer = setTimeout(() => void _poll(), POLL_INTERVAL_MS);
  }
}

// ─── Main scan ────────────────────────────────────────────────────────────────

async function _scan(): Promise<void> {
  const client = getDcwClient();
  if (!client) return;

  const from = _lastPollTime;
  const next = new Date(Date.now() - 1_800_000).toISOString(); // now − 30 min

  // Fetch all users that have an ARC-TESTNET wallet provisioned.
  const users = await db
    .select({
      id:            usersTable.id,
      walletIdsJson: (usersTable as any).circleWalletIdsJson,
    })
    .from(usersTable)
    .where(sql`${(usersTable as any).circleWalletIdsJson} IS NOT NULL`);

  for (const user of users) {
    let arcWalletId: string | undefined;
    try {
      arcWalletId = (JSON.parse(user.walletIdsJson) as Record<string, string>)["ARC-TESTNET"];
    } catch { continue; }
    if (!arcWalletId) continue;

    await _pollWallet(client, user.id, arcWalletId, from);
  }

  _lastPollTime = next;
}

// ─── Per-wallet query ─────────────────────────────────────────────────────────

async function _pollWallet(
  client:      any,
  userId:      number,
  arcWalletId: string,
  from:        string,
): Promise<void> {
  let res: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await client.listTransactions({
        walletId: arcWalletId,
        txType:   "INBOUND" as any,
        state:    "COMPLETE" as any,
        from,
        pageSize: 50,
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
      // Non-transient error — skip this wallet silently.
      return;
    }
  }
  if (!res) return;

  const txns: any[] = (res?.data as any)?.data?.transactions
                    ?? (res?.data as any)?.transactions
                    ?? [];

  for (const tx of txns) {
    await _processTx(userId, arcWalletId, tx).catch((err: any) =>
      logger.error({ err: err?.message, userId, txId: tx?.id }, "[arc-deposit] Failed to process tx"),
    );
  }
}

// ─── Per-transaction processing ───────────────────────────────────────────────

async function _processTx(userId: number, arcWalletId: string, tx: any): Promise<void> {
  const circleId:    string        = tx.id;
  const txHash:      string | null = tx.txHash ?? null;
  const amount:      string        = tx.amounts?.[0] ?? "0";
  const destAddress: string        = (tx.destinationAddress ?? "").toLowerCase();

  if (!circleId || parseFloat(amount) <= 0) return;

  // Only on-chain transactions have a txHash.
  if (!txHash) return;

  // Skip sweep confirmations (USDC arriving at the treasury is not a user deposit).
  if (TREASURY_ADDRESS && destAddress === TREASURY_ADDRESS) return;

  const depositRef = `circle-${circleId}`;

  // Idempotent credit — onConflictDoNothing prevents double-credit.
  const credited = await db.transaction(async (txn) => {
    const [inserted] = await txn.insert(depositsTable).values({
      userId,
      amount:           parseFloat(amount).toFixed(6),
      type:             "crypto",
      source:           "Arc Testnet USDC",
      status:           "completed",
      depositReference: depositRef,
      txHash,
      creditedAt:       new Date(),
    }).onConflictDoNothing().returning({ id: depositsTable.id });

    if (!inserted) return false;

    await txn.update(usersTable)
      .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${parseFloat(amount)}` })
      .where(eq(usersTable.id, userId));

    return true;
  });

  if (credited) {
    logger.info(
      { userId, amount, txHash, depositRef },
      "[arc-deposit] Credited Arc deposit — initiating sweep",
    );

    // Pass destAddress as userAddress so arcTestnetSweep uses walletAddress +
    // tokenAddress + blockchain (Circle docs approach) which reads the on-chain
    // balance directly, bypassing Circle's internal registry sync lag.
    arcTestnetSweep({
      userWalletId: arcWalletId,
      userAddress:  destAddress || undefined,
      amount:       parseFloat(amount).toFixed(6),
    })
      .then(sweepTxId => logger.info({ userId, sweepTxId }, "[arc-deposit] Arc sweep submitted"))
      .catch((err: any) => logger.warn(
        { err: err?.message, userId },
        "[arc-deposit] Arc sweep failed — reconciliation worker will retry",
      ));
  }
}
