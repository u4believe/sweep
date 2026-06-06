/**
 * Bridge job worker.
 *
 * Arc Testnet is the primary treasury chain — all USDC flows to the Arc
 * platform treasury and all withdrawals are paid from there.
 *
 * Processes bridge_jobs by source chain:
 *
 *   ARC-TESTNET jobs  → sweepUsdcToPlatformWallet (Circle DCW createTransaction)
 *                        Same-chain ERC-20 transfer: Arc user wallet → Arc treasury.
 *                        Gas-free via EIP-4337 + Circle Gas Station. Seconds.
 *
 *   BASE-SEPOLIA jobs → cctpDepositForBurnFromBase (Circle DCW contract execution)
 *                        Direct CCTP V2: approve + depositForBurn on Base Sepolia.
 *                        Circle Forwarding Service handles attestation + Arc mint.
 *                        Completes in seconds via fast transfer path.
 *                        (Circle App Kit is NOT used — Base Sepolia has no `adapter`
 *                         kitContract, so the Circle Wallets adapter cannot sign.)
 *
 * Retry strategy — exponential back-off:
 *   attempt 1–3 → retry every 15 s (wait for token indexing / CCTP relay)
 *   attempt 4   → wait 1 min
 *   attempt 5   → wait 2 min
 *   attempt 6   → wait 4 min
 *   attempt 7   → wait 8 min
 *   attempt ≥ 8 → marked "failed"; admin must investigate.
 *
 * Concurrency: one job at a time to avoid nonce conflicts on Circle's bundler.
 */

import { db, bridgeJobsTable, usersTable } from "@workspace/db";
import { eq, and, lte, or, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { sweepUsdcToPlatformWallet, ensureArcTestnetWallet } from "./circle.js";
import { cctpDepositForBurnFromBase } from "./cctpBridge.js";

const POLL_INTERVAL_MS  = 5_000;
const MAX_ATTEMPTS      = 8;
const QUICK_RETRY_MS    = 15_000;
const QUICK_RETRY_LIMIT = 3;

function backoffMs(attempt: number): number {
  if (attempt <= QUICK_RETRY_LIMIT) return QUICK_RETRY_MS;
  return Math.pow(2, attempt - QUICK_RETRY_LIMIT) * 60_000;
}

let _running = false;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _processing = false;

export function startBridgeWorker() {
  if (_running) return;
  _running = true;
  logger.info("[bridge-worker] Starting");
  void poll();
}

export function stopBridgeWorker() {
  _running = false;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  logger.info("[bridge-worker] Stopped");
}

export function triggerBridgeWorker() {
  if (!_running || _processing) return;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  void poll();
}

async function poll() {
  if (!_running || _processing) return;
  _processing = true;
  try {
    await processNextJob();
  } catch (err: any) {
    logger.error({ err: err?.message }, "[bridge-worker] Unexpected poll error");
  } finally {
    _processing = false;
  }
  if (_running) {
    _timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }
}

async function processNextJob() {
  const [job] = await db
    .select()
    .from(bridgeJobsTable)
    .where(
      and(
        or(
          eq(bridgeJobsTable.status, "pending"),
          and(
            eq(bridgeJobsTable.status, "retry"),
            lte(
              sql`${bridgeJobsTable.updatedAt} + (
                CASE WHEN ${bridgeJobsTable.attempts} <= ${QUICK_RETRY_LIMIT}
                  THEN INTERVAL '15 seconds'
                  ELSE INTERVAL '1 minute' * POWER(2, ${bridgeJobsTable.attempts} - ${QUICK_RETRY_LIMIT})
                END
              )`,
              sql`now()`,
            ),
          ),
        ),
        lte(bridgeJobsTable.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(bridgeJobsTable.createdAt)
    .limit(1);

  if (!job) return;

  logger.info(
    { jobId: job.id, chain: job.sourceChain, amount: job.amount, attempt: job.attempts + 1 },
    "[bridge-worker] Processing bridge job",
  );

  await db.update(bridgeJobsTable)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(bridgeJobsTable.id, job.id));

  try {
    const chain = job.sourceChain as "BASE-SEPOLIA" | "ARC-TESTNET";
    let txId: string;
    let bridgeResultJson: string;

    if (chain === "BASE-SEPOLIA") {
      // ── CCTP V2 direct: Base Sepolia user wallet → Arc treasury ──────────────
      // Resolve the user's Base Sepolia Circle wallet ID for contract execution.
      const [user] = await db
        .select({
          id:                  usersTable.id,
          circleWalletId:      usersTable.circleWalletId,
          circleWalletIdsJson: (usersTable as any).circleWalletIdsJson,
        })
        .from(usersTable)
        .where(eq(usersTable.id, job.userId))
        .limit(1);

      const idsMap: Record<string, string> =
        user?.circleWalletIdsJson ? JSON.parse(user.circleWalletIdsJson) : {};
      const baseWalletId = idsMap["BASE-SEPOLIA"] ?? user?.circleWalletId ?? null;

      if (!baseWalletId) {
        throw new Error(
          `No BASE-SEPOLIA wallet ID for user ${job.userId} — wallet may not be provisioned.`,
        );
      }

      const cctpResult = await cctpDepositForBurnFromBase({ walletId: baseWalletId }, String(job.amount));
      txId = cctpResult.txId;
      bridgeResultJson = JSON.stringify({ txId, chain, method: "cctp-v2-depositForBurnWithHook", burnTxHash: cctpResult.onChainTxHash });

    } else {
      // ── ARC-TESTNET: same-chain Circle DCW sweep → Arc treasury (seconds) ────
      const [user] = await db
        .select({
          id:                       usersTable.id,
          circleWalletId:           usersTable.circleWalletId,
          circleWalletIdsJson:      (usersTable as any).circleWalletIdsJson,
          circleWalletAddressesJson: (usersTable as any).circleWalletAddressesJson,
        })
        .from(usersTable)
        .where(eq(usersTable.id, job.userId))
        .limit(1);

      let idsMap: Record<string, string> =
        user?.circleWalletIdsJson ? JSON.parse(user.circleWalletIdsJson) : {};

      // Backfill Arc wallet for users registered before Arc support was added
      if (!idsMap["ARC-TESTNET"]) {
        const backfilled = await ensureArcTestnetWallet(
          user?.circleWalletIdsJson ?? null,
          user?.circleWalletAddressesJson ?? null,
        );
        if (backfilled && user) {
          await db.update(usersTable)
            .set({
              circleWalletIdsJson:       backfilled.idsJson,
              circleWalletAddressesJson: backfilled.addrsJson,
            } as any)
            .where(eq(usersTable.id, user.id));
          idsMap = JSON.parse(backfilled.idsJson);
          logger.info({ userId: job.userId }, "[bridge-worker] ARC-TESTNET wallet backfilled");
        }
      }

      const arcWalletId = idsMap["ARC-TESTNET"] ?? null;
      if (!arcWalletId) {
        throw new Error(
          `No Arc Testnet wallet ID for user ${job.userId}. Wallet may not be provisioned — will retry.`,
        );
      }

      txId = await sweepUsdcToPlatformWallet(arcWalletId, String(job.amount), "ARC-TESTNET");
      bridgeResultJson = JSON.stringify({ txId, chain });
    }

    await db.update(bridgeJobsTable)
      .set({
        status:           "completed",
        attempts:         job.attempts + 1,
        bridgeResultJson,
        lastError:        null,
        updatedAt:        new Date(),
      })
      .where(eq(bridgeJobsTable.id, job.id));

    logger.info(
      { jobId: job.id, chain: job.sourceChain, amount: job.amount, txId },
      "[bridge-worker] Bridge job completed",
    );

  } catch (err: any) {
    const attempts  = job.attempts + 1;
    const exhausted = attempts >= MAX_ATTEMPTS;

    await db.update(bridgeJobsTable)
      .set({
        status:    exhausted ? "failed" : "retry",
        attempts,
        lastError: String(err?.message ?? err),
        updatedAt: new Date(),
      })
      .where(eq(bridgeJobsTable.id, job.id));

    if (exhausted) {
      logger.error(
        { jobId: job.id, chain: job.sourceChain, amount: job.amount, err: err?.message },
        "[bridge-worker] Bridge job FAILED after max attempts — manual intervention required",
      );
    } else {
      logger.warn(
        { jobId: job.id, chain: job.sourceChain, attempt: attempts, nextRetryMs: backoffMs(attempts), err: err?.message },
        "[bridge-worker] Bridge job failed — will retry",
      );
    }
  }
}
