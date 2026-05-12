import { db, otpCodesTable } from "@workspace/db";
import { lt, or, eq, and } from "drizzle-orm";
import { logger } from "./logger.js";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let workerInterval: ReturnType<typeof setInterval> | null = null;

async function runCleanup(): Promise<void> {
  try {
    const result = await db
      .delete(otpCodesTable)
      .where(
        or(
          lt(otpCodesTable.expiresAt, new Date()),
          eq(otpCodesTable.used, true),
        ),
      )
      .returning({ id: otpCodesTable.id });

    if (result.length > 0) {
      logger.info({ deleted: result.length }, "[otpCleanup] Deleted expired/used OTP codes");
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "[otpCleanup] Cleanup error");
  }
}

export function startOtpCleanupWorker(): void {
  if (workerInterval) return;
  workerInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  void runCleanup(); // immediate pass on startup to clear any backlog
  logger.info("[otpCleanup] worker started");
}

export function stopOtpCleanupWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}