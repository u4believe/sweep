import app from "./app";
import { logger } from "./lib/logger";
import { startDepositIndexer, stopDepositIndexer } from "./lib/depositIndexer.js";
import { startBridgeWorker, stopBridgeWorker } from "./lib/bridgeWorker.js";
import { startTreasuryConsolidationWorker, stopTreasuryConsolidationWorker } from "./lib/treasuryConsolidationWorker.js";
import { startRecurringWorker, stopRecurringWorker } from "./lib/recurringWorker.js";
import { startSubscriptionBillingWorker, stopSubscriptionBillingWorker } from "./lib/subscriptionBillingWorker.js";
import { startWebhookDeliveryWorker, stopWebhookDeliveryWorker } from "./lib/webhookDelivery.js";
import { startSweepReconciliationWorker, stopSweepReconciliationWorker } from "./lib/sweepReconciliationWorker.js";
import { startWithdrawalReconciliationWorker, stopWithdrawalReconciliationWorker } from "./lib/withdrawalReconciliationWorker.js";
import { startOtpCleanupWorker, stopOtpCleanupWorker } from "./lib/otpCleanupWorker.js";
import { probeGasStationStatus } from "./lib/circle.js";
import { verifySmtp } from "./lib/email.js";

// ─── Required environment variable validation ─────────────────────────────────
// Fail immediately at startup rather than crashing on first use of a missing var.

const REQUIRED_ENV: { key: string; minLength?: number }[] = [
  { key: "DATABASE_URL" },
  { key: "JWT_SECRET",        minLength: 32 },
  { key: "DEV_JWT_SECRET",    minLength: 32 },
  { key: "PASSPORT_SECRET",   minLength: 32 },
  { key: "CIRCLE_API_KEY" },
  { key: "CIRCLE_WEBHOOK_SECRET" },
  { key: "ADMIN_SECRET",      minLength: 20 },
];

const envErrors: string[] = [];
for (const { key, minLength } of REQUIRED_ENV) {
  const val = process.env[key];
  if (!val) {
    envErrors.push(`  ✗ ${key} is not set`);
  } else if (minLength && val.length < minLength) {
    envErrors.push(`  ✗ ${key} is too short (min ${minLength} chars)`);
  }
}
if (envErrors.length > 0) {
  console.error("\n[startup] Missing or invalid environment variables:\n" + envErrors.join("\n"));
  console.error("\nFix the above variables before starting the server.\n");
  process.exit(1);
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Verify SMTP credentials immediately so misconfigured email is caught on startup
  verifySmtp().catch(() => {});

  // Start deposit indexer (BASE-SEPOLIA and ARC-TESTNET)
  startDepositIndexer();

  // Start sweep worker — moves user deposits to BASE-SEPOLIA platform treasury
  startBridgeWorker();

  // Start treasury consolidation worker — bridges Arc treasury USDC → BASE-SEPOLIA
  startTreasuryConsolidationWorker();

  // Start recurring transfers worker
  startRecurringWorker();

  // Start subscription billing worker (trial transitions, renewals, retries)
  startSubscriptionBillingWorker();

  // Start webhook delivery worker (dispatches queued events with exponential backoff)
  startWebhookDeliveryWorker();

  // Start sweep reconciliation worker — catches unswept USDC on both chains
  startSweepReconciliationWorker();

  // Start withdrawal reconciliation worker — recovers stale "processing" withdrawals
  startWithdrawalReconciliationWorker();

  // Start nightly OTP cleanup — deletes expired and used OTP codes
  startOtpCleanupWorker();

  // Probe Circle Gas Station status (informational, non-blocking)
  probeGasStationStatus().catch(() => {});
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown() {
  logger.info("Shutdown signal received");
  stopDepositIndexer();
  stopBridgeWorker();
  stopTreasuryConsolidationWorker();
  stopRecurringWorker();
  stopSubscriptionBillingWorker();
  stopWebhookDeliveryWorker();
  stopSweepReconciliationWorker();
  stopWithdrawalReconciliationWorker();
  stopOtpCleanupWorker();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);
