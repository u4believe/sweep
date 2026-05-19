import app from "./app";
import { logger } from "./lib/logger";
import { runStartupMigrations } from "@workspace/db";
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

  // Apply idempotent DB migrations (unique indexes) before starting any workers.
  // This ensures the double-deposit guard is in place on every cold start.
  runStartupMigrations()
    .then(() => {
      startDepositIndexer();
      startBridgeWorker();
      startTreasuryConsolidationWorker();
      startRecurringWorker();
      startSubscriptionBillingWorker();
      startWebhookDeliveryWorker();
      startSweepReconciliationWorker();
      startWithdrawalReconciliationWorker();
      startOtpCleanupWorker();
      probeGasStationStatus().catch(() => {});
    })
    .catch((migrationErr) => {
      logger.error({ err: migrationErr }, "[startup] Fatal migration error — shutting down");
      process.exit(1);
    });
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
