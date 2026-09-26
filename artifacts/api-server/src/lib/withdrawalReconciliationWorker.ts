/**
 * Withdrawal reconciliation worker.
 *
 * Runs every 5 minutes and recovers crypto withdrawals left mid-flight by a
 * server crash (older than STALE_THRESHOLD_MS):
 *
 *   "processing"          — the route never reached Gateway, so either a direct
 *                           treasury transfer was sent or nothing was. Replay the
 *                           same direct transfer (same chain, address, net amount
 *                           and idempotencyKey): Circle returns the existing
 *                           transaction if it was already sent, so the user is
 *                           never paid twice. A definite rejection refunds the
 *                           user; a network/timeout error is retried next pass.
 *
 *   "submitting_gateway"  — the crash happened while a Gateway burn intent was
 *                           being submitted. Gateway can't be asked whether it
 *                           accepted it, so replaying or refunding could pay the
 *                           user twice. Marked "needs_review" for an admin
 *                           (GET /api/admin/withdrawals/review).
 *
 * Refunds give back the stored amount, which is the gross amount deducted
 * (net + fee), and are guarded on status so they happen at most once.
 */

import { db, usersTable, withdrawalsTable } from "@workspace/db";
import { eq, and, sql, lt, inArray } from "drizzle-orm";
import { logger } from "./logger.js";
import { CHAINS, netWithdrawalAmount, type ChainKey } from "./gatewayConfig.js";
import { directTreasuryTransfer } from "./gatewaySweep.js";

const POLL_INTERVAL_MS   = 5 * 60 * 1000;  // run every 5 minutes
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // treat as stale after 10 minutes

type Withdrawal = typeof withdrawalsTable.$inferSelect;

/** Move a withdrawal out of `from` and refund its gross amount — at most once. */
export async function refundWithdrawal(w: Withdrawal, from: string[], status: "failed" | "refunded", reason: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = await tx.update(withdrawalsTable)
      .set({ status, completedAt: new Date() })
      .where(and(eq(withdrawalsTable.id, w.id), inArray(withdrawalsTable.status, from)))
      .returning({ id: withdrawalsTable.id });
    if (!claimed.length) return false;
    await tx.update(usersTable)
      .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${w.amount}::numeric` })
      .where(eq(usersTable.id, w.userId));
    logger.warn({ id: w.id, userId: w.userId, amount: w.amount, reason }, `[reconcile] Withdrawal ${status} — balance restored`);
    return true;
  });
}

/** "0xabc… (Base)" → address + chain, as written by the withdraw route. */
function parseDestination(destination: string): { address: string; chainKey: ChainKey } | null {
  const m = /^(.+?) \(([^)]+)\)$/.exec(destination.trim());
  if (!m) return null;
  const chain = Object.values(CHAINS).find((c) => c.label === m[2]);
  return chain ? { address: m[1]!.trim(), chainKey: chain.key } : null;
}

/** Circle SDK errors carry the HTTP status; none means the request never got an answer. */
function httpStatusOf(err: any): number | null {
  return err?.response?.status ?? err?.status ?? null;
}

async function markNeedsReview(w: Withdrawal, reason: string): Promise<void> {
  await db.update(withdrawalsTable)
    .set({ status: "needs_review" })
    .where(and(eq(withdrawalsTable.id, w.id), inArray(withdrawalsTable.status, ["processing", "submitting_gateway"])));
  logger.error({ id: w.id, userId: w.userId, amount: w.amount, destination: w.destination, reason },
    "[reconcile] Withdrawal needs manual review — not replayed or refunded");
}

async function recoverDirect(w: Withdrawal): Promise<void> {
  const dest = parseDestination(w.destination);
  if (!dest || !w.idempotencyKey) {
    await markNeedsReview(w, dest ? "no idempotency key to replay safely" : `unrecognised destination "${w.destination}"`);
    return;
  }
  const chain = CHAINS[dest.chainKey];
  const net   = netWithdrawalAmount(chain, parseFloat(w.amount));

  try {
    const txId = await directTreasuryTransfer({
      destinationAddress: dest.address,
      chainKey:           dest.chainKey,
      amount:             net.toFixed(6),
      idempotencyKey:     w.idempotencyKey,
      onFailure: async () => { await refundWithdrawal(w, ["completed"], "failed", "replayed transfer failed on-chain"); },
    });
    await db.update(withdrawalsTable)
      .set({ status: "completed", circleTransferId: txId, completedAt: new Date() })
      .where(and(eq(withdrawalsTable.id, w.id), eq(withdrawalsTable.status, "processing")));
    logger.info({ id: w.id, txId, chainKey: dest.chainKey }, "[reconcile] Direct transfer confirmed via idempotent replay");
  } catch (e: any) {
    const status = httpStatusOf(e);
    if (status === null || status >= 500 || status === 429) {
      logger.warn({ id: w.id, err: e?.message, status }, "[reconcile] Replay inconclusive — will retry next pass");
    } else if (status === 409) {
      await markNeedsReview(w, `Circle idempotency conflict: ${e?.message}`);
    } else {
      await refundWithdrawal(w, ["processing"], "failed", `Circle rejected the transfer (${status}): ${e?.message}`);
    }
  }
}

async function reconcile(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const stale = await db
    .select()
    .from(withdrawalsTable)
    .where(
      and(
        inArray(withdrawalsTable.status, ["processing", "submitting_gateway"]),
        eq(withdrawalsTable.type, "crypto"),
        lt(withdrawalsTable.createdAt, staleThreshold),
      ),
    );

  if (stale.length === 0) return;
  logger.info({ count: stale.length }, "[reconcile] Found stale in-flight withdrawals");

  for (const w of stale) {
    try {
      if (w.status === "submitting_gateway") await markNeedsReview(w, "server stopped while submitting a Gateway burn intent");
      else await recoverDirect(w);
    } catch (e: any) {
      logger.error({ id: w.id, err: e?.message }, "[reconcile] Recovery error");
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
