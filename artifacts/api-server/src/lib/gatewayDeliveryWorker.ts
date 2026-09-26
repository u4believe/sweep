// ─── Gateway delivery worker ─────────────────────────────────────────────────
// Gateway withdrawals are "delivering" from the moment Circle accepts the burn
// intent until the Forwarding Service mints on the destination chain. This
// worker asks Gateway for each transfer's status:
//
//   confirmed / finalized → withdrawal "completed" with the destination tx hash
//   failed / expired      → user refunded the full gross amount, withdrawal "refunded"
//   pending               → keep waiting (logged if it runs unusually long)
//
// The refund and the status change happen in one DB transaction guarded on
// status = 'delivering', so a withdrawal is refunded at most once even if two
// passes (or two servers) look at it together. Gateway itself returns the
// burned USDC to the Unified Balance when forwarding fails, so the treasury
// is made whole on its side.

import { db, usersTable, withdrawalsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getGatewayTransfer } from "./gatewaySweep.js";
import { logger } from "./logger.js";

const POLL_INTERVAL_MS = parseInt(process.env.GATEWAY_DELIVERY_POLL_MS ?? String(2 * 60_000), 10);
const SLOW_AFTER_MS    = 6 * 60 * 60_000; // warn when a delivery has been pending 6h+

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function refund(w: typeof withdrawalsTable.$inferSelect, reason: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const claimed = await tx.update(withdrawalsTable)
      .set({ status: "refunded", completedAt: new Date() })
      .where(and(eq(withdrawalsTable.id, w.id), eq(withdrawalsTable.status, "delivering")))
      .returning({ id: withdrawalsTable.id });
    if (!claimed.length) return false;

    // amount is the gross amount deducted at withdrawal time (net + fee)
    await tx.update(usersTable)
      .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${w.amount}::numeric` })
      .where(eq(usersTable.id, w.userId));
    logger.warn({ withdrawalId: w.id, userId: w.userId, amount: w.amount, transferId: w.circleTransferId, reason },
      "[gatewayDelivery] Delivery failed — user refunded");
    return true;
  });
}

export async function checkGatewayDeliveries(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const delivering = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.status, "delivering"));
    for (const w of delivering) {
      if (!w.circleTransferId) continue;
      let transfer;
      try {
        transfer = await getGatewayTransfer(w.circleTransferId);
      } catch (err: any) {
        logger.warn({ withdrawalId: w.id, err: err?.message }, "[gatewayDelivery] Status check failed — will retry");
        continue;
      }
      if (!transfer) {
        logger.warn({ withdrawalId: w.id, transferId: w.circleTransferId }, "[gatewayDelivery] Gateway has no record of this transfer yet");
        continue;
      }

      if (transfer.status === "confirmed" || transfer.status === "finalized") {
        await db.update(withdrawalsTable)
          .set({ status: "completed", txHash: transfer.transactionHash ?? w.txHash, completedAt: new Date() })
          .where(and(eq(withdrawalsTable.id, w.id), eq(withdrawalsTable.status, "delivering")));
        logger.info({ withdrawalId: w.id, txHash: transfer.transactionHash }, "[gatewayDelivery] Delivered");
      } else if (transfer.status === "failed" || transfer.status === "expired") {
        await refund(w, transfer.failureReason ?? transfer.status);
      } else if (Date.now() - w.createdAt.getTime() > SLOW_AFTER_MS) {
        logger.warn({ withdrawalId: w.id, transferId: w.circleTransferId, status: transfer.status },
          "[gatewayDelivery] Delivery still pending after 6h");
      }
    }
  } finally {
    running = false;
  }
}

export function startGatewayDeliveryWorker(): void {
  if (timer) return;
  const tick = () => { checkGatewayDeliveries().catch((err) => logger.error({ err: err?.message }, "[gatewayDelivery] pass error")); };
  tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "[gatewayDelivery] Worker started");
}
