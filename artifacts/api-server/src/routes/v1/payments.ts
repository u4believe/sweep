/**
 * GET /v1/payments       — list payments (filter: subscription_id, status)
 * GET /v1/payments/:id   — retrieve a single payment
 */

import { Router, type IRouter } from "express";
import { db, subscriptionPaymentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireApiKey } from "../../lib/apiKeyAuth.js";

const router: IRouter = Router();

router.get("/", requireApiKey, async (req, res) => {
  try {
    const dev    = req.developer!;
    const subId  = typeof req.query["subscription_id"] === "string" ? parseInt(req.query["subscription_id"]) : null;
    const status = typeof req.query["status"] === "string" ? req.query["status"] : null;

    const payments = await db
      .select()
      .from(subscriptionPaymentsTable)
      .where(eq(subscriptionPaymentsTable.merchantId, dev.merchantId));

    const filtered = payments.filter((p) => {
      if (subId  && p.subscriptionId !== subId) return false;
      if (status && p.status !== status)         return false;
      return true;
    });

    res.json({ payments: filtered, total: filtered.length });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

router.get("/:id", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const id  = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Validation", message: "Invalid payment ID" });
      return;
    }

    const [payment] = await db
      .select()
      .from(subscriptionPaymentsTable)
      .where(
        and(
          eq(subscriptionPaymentsTable.id, id),
          eq(subscriptionPaymentsTable.merchantId, dev.merchantId),
        ),
      )
      .limit(1);

    if (!payment) {
      res.status(404).json({ error: "Not found", message: "Payment not found" });
      return;
    }

    res.json(payment);
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;