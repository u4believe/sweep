import { Router, type IRouter } from "express";
import { billingWorkerLastRunAt, BILLING_WORKER_INTERVAL_MS } from "../lib/subscriptionBillingWorker.js";
import { webhookWorkerLastRunAt, WEBHOOK_WORKER_INTERVAL_MS } from "../lib/webhookDelivery.js";

const router: IRouter = Router();

function workerStatus(lastRunAt: Date | null, intervalMs: number): { status: string; lastRunAt: string | null; lagMs: number | null } {
  if (!lastRunAt) return { status: "not_started", lastRunAt: null, lagMs: null };
  const lagMs = Date.now() - lastRunAt.getTime();
  const status = lagMs > intervalMs * 2 ? "stale" : "ok";
  return { status, lastRunAt: lastRunAt.toISOString(), lagMs };
}

router.get("/healthz", (_req, res) => {
  const workers = {
    subscriptionBilling: workerStatus(billingWorkerLastRunAt, BILLING_WORKER_INTERVAL_MS),
    webhookDelivery:     workerStatus(webhookWorkerLastRunAt, WEBHOOK_WORKER_INTERVAL_MS),
  };

  const allOk = Object.values(workers).every((w) => w.status === "ok" || w.status === "not_started");

  res.status(allOk ? 200 : 503).json({
    status:    allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    workers,
  });
});

export default router;