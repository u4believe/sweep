/**
 * Withdrawal reconciliation worker.
 *
 * Runs every 5 minutes and looks for withdrawals stuck in "processing" status
 * for more than STALE_THRESHOLD_MS. These represent server crashes that
 * occurred between the balance deduction and the Circle API response.
 *
 * Recovery logic per stale record:
 *   1. Re-call Circle's createTransaction with the SAME idempotencyKey.
 *      Circle treats identical keys as the same transaction and returns the
 *      existing one — so this is safe to replay any number of times.
 *   2. If Circle returns a transaction ID → transfer went through.
 *      Mark the withdrawal "completed". Do NOT restore the balance.
 *   3. If Circle returns an error (not found / failed) → transfer never
 *      happened. Restore the balance atomically and mark "failed".
 */

import { db, usersTable, withdrawalsTable } from "@workspace/db";
import { eq, and, sql, lt } from "drizzle-orm";
import { logger } from "./logger.js";
import {
  circleTransferUsdc,
  getPlatformWalletAddress,
  PRIMARY_BLOCKCHAIN,
} from "./circle.js";

const POLL_INTERVAL_MS   = 5 * 60 * 1000;  // run every 5 minutes
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // treat as stale after 10 minutes
const WITHDRAWAL_FEE     = 0.10;

async function atomicRestore(userId: number, amount: number): Promise<void> {
  await db
    .update(usersTable)
    .set({
      claimedBalance: sql`${usersTable.claimedBalance} + ${amount}`,
    })
    .where(eq(usersTable.id, userId));
}

async function reconcile(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const stale = await db
    .select()
    .from(withdrawalsTable)
    .where(
      and(
        eq(withdrawalsTable.status, "processing"),
        eq(withdrawalsTable.type, "crypto"),
        lt(withdrawalsTable.createdAt, staleThreshold),
      ),
    );

  if (stale.length === 0) return;

  logger.info({ count: stale.length }, "[reconcile] Found stale processing withdrawals");

  const platformAddress = getPlatformWalletAddress();
  if (!platformAddress) {
    logger.warn("[reconcile] CIRCLE_PLATFORM_WALLET_ADDRESS not set — skipping");
    return;
  }

  for (const w of stale) {
    if (!w.idempotencyKey) {
      // No key to replay — safe to treat as failed and restore
      logger.warn({ id: w.id }, "[reconcile] No idempotencyKey — marking failed and restoring");
      await atomicRestore(w.userId, parseFloat(w.amount) + WITHDRAWAL_FEE);
      await db.update(withdrawalsTable)
        .set({ status: "failed" })
        .where(eq(withdrawalsTable.id, w.id));
      continue;
    }

    try {
      // Re-submit to Circle with the same idempotency key.
      // Circle returns the existing transaction if it was already submitted.
      const txHash = await circleTransferUsdc(
        platformAddress,
        w.destination,
        PRIMARY_BLOCKCHAIN,
        "",
        w.amount,
        w.idempotencyKey,
      );

      // Circle returned a txId — the transfer went through
      logger.info({ id: w.id, txHash }, "[reconcile] Transfer confirmed — marking completed");
      await db.update(withdrawalsTable)
        .set({ status: "completed", txHash, completedAt: new Date() })
        .where(eq(withdrawalsTable.id, w.id));
    } catch (e: any) {
      // Circle does not recognise this transaction — it never happened
      logger.warn({ id: w.id, err: e.message }, "[reconcile] Circle has no record — restoring balance");
      await atomicRestore(w.userId, parseFloat(w.amount) + WITHDRAWAL_FEE);
      await db.update(withdrawalsTable)
        .set({ status: "failed" })
        .where(eq(withdrawalsTable.id, w.id));
    }
  }
}

let _timer: ReturnType<typeof setTimeout> | null = null;

export function startWithdrawalReconciliationWorker(): void {
  const run = async () => {
    try {
      await reconcile();
    } catch (e: any) {
      logger.error({ err: e.message }, "[reconcile] Unexpected error");
    }
    _timer = setTimeout(run, POLL_INTERVAL_MS);
  };
  _timer = setTimeout(run, POLL_INTERVAL_MS); // first run after 5 min, not at startup
  logger.info("[reconcile] Withdrawal reconciliation worker started");
}

export function stopWithdrawalReconciliationWorker(): void {
  if (_timer) { clearTimeout(_timer); _timer = null; }
}
