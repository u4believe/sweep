/**
 * GET  /v1/subscriptions               — list subscriptions (filter: status, plan_id, external_ref)
 * GET  /v1/subscriptions/status        — check status by merchant_id + external_ref
 * GET  /v1/subscriptions/lookup        — all subs for an external_ref
 * GET  /v1/subscriptions/:id           — retrieve a subscription
 * POST /v1/subscriptions/:id/cancel    — cancel at period end
 */

import { Router, type IRouter } from "express";
import { db, subscriptionsTable, subscriptionPlansTable, subscriptionIntervalsTable, usersTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { requireApiKey } from "../../lib/apiKeyAuth.js";
import { enqueueWebhook } from "../../lib/webhookDelivery.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

function formatSub(
  sub: typeof subscriptionsTable.$inferSelect,
  plan?: { planTitle: string } | null,
  subscriber?: { email: string } | null,
) {
  return {
    subscription_id:      sub.id,
    plan_id:              sub.planId,
    merchant_id:          sub.merchantId,
    external_ref:         sub.externalRef ?? null,
    activation_method:    sub.activationMethod ?? null,
    status:               sub.status,
    interval:             sub.planInterval,
    amount:               sub.amount,
    currency:             "USD",
    current_period_start: sub.startedAt,
    current_period_end:   sub.nextBillingAt ?? null,
    next_billing_date:    sub.nextBillingAt ?? null,
    trial_start:          sub.trialEndsAt ? sub.startedAt : null,
    trial_end:            sub.trialEndsAt ?? null,
    retry_count:          sub.retryCount,
    cancelled_at:         sub.cancelledAt ?? null,
    created_at:           sub.createdAt,
    plan_name:            plan?.planTitle ?? null,
    subscriber_email:     subscriber?.email ?? null,
  };
}

// ─── GET /v1/subscriptions/status (must come before /:id) ────────────────────

router.get("/status", requireApiKey, async (req, res) => {
  try {
    const dev         = req.developer!;
    const externalRef = typeof req.query["external_ref"] === "string" ? req.query["external_ref"] : null;
    const merchantId  = typeof req.query["merchant_id"]  === "string" ? req.query["merchant_id"]  : dev.merchantId;

    if (!externalRef) {
      res.status(400).json({ error: "Validation", message: "external_ref query param is required" });
      return;
    }

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.merchantId, merchantId),
          eq(subscriptionsTable.externalRef, externalRef),
          ne(subscriptionsTable.status, "cancelled"),
          ne(subscriptionsTable.status, "failed"),
        ),
      )
      .limit(1);

    if (!sub) {
      res.json({ has_active_subscription: false, subscription_id: null, plan_name: null, status: null, current_period_end: null });
      return;
    }

    const [plan] = await db
      .select({ planTitle: subscriptionPlansTable.planTitle })
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, sub.planId))
      .limit(1);

    res.json({
      has_active_subscription: true,
      subscription_id:         sub.id,
      plan_name:                plan?.planTitle ?? null,
      status:                  sub.status,
      current_period_end:      sub.nextBillingAt ?? null,
      activation_method:       sub.activationMethod ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /v1/subscriptions/lookup ─────────────────────────────────────────────

router.get("/lookup", requireApiKey, async (req, res) => {
  try {
    const dev         = req.developer!;
    const externalRef = typeof req.query["external_ref"] === "string" ? req.query["external_ref"] : null;

    if (!externalRef) {
      res.status(400).json({ error: "Validation", message: "external_ref query param is required" });
      return;
    }

    const subs = await db
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.merchantId, dev.merchantId),
          eq(subscriptionsTable.externalRef, externalRef),
        ),
      );

    res.json({ subscriptions: subs.map((s) => formatSub(s)), total: subs.length });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /v1/subscriptions ────────────────────────────────────────────────────

router.get("/", requireApiKey, async (req, res) => {
  try {
    const dev     = req.developer!;
    const status  = typeof req.query["status"]  === "string" ? req.query["status"]  : null;
    const planId  = typeof req.query["plan_id"] === "string" ? parseInt(req.query["plan_id"]) : null;
    const extRef  = typeof req.query["external_ref"] === "string" ? req.query["external_ref"] : null;

    let query = db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.merchantId, dev.merchantId));

    const subs = await query;

    const filtered = subs.filter((s) => {
      if (status && s.status !== status) return false;
      if (planId && s.planId !== planId) return false;
      if (extRef  && s.externalRef !== extRef) return false;
      return true;
    });

    res.json({ subscriptions: filtered.map((s) => formatSub(s)), total: filtered.length });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /v1/subscriptions/:id ───────────────────────────────────────────────

router.get("/:id", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const id  = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Validation", message: "Invalid subscription ID" });
      return;
    }

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.id, id),
          eq(subscriptionsTable.merchantId, dev.merchantId),
        ),
      )
      .limit(1);

    if (!sub) {
      res.status(404).json({ error: "Not found", message: "Subscription not found" });
      return;
    }

    const [plan] = await db
      .select({ planTitle: subscriptionPlansTable.planTitle })
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, sub.planId))
      .limit(1);

    const [subscriber] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, sub.subscriberUserId))
      .limit(1);

    res.json(formatSub(sub, plan, subscriber));
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /v1/subscriptions/:id/cancel ───────────────────────────────────────

router.post("/:id/cancel", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const id  = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Validation", message: "Invalid subscription ID" });
      return;
    }

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(
        and(
          eq(subscriptionsTable.id, id),
          eq(subscriptionsTable.merchantId, dev.merchantId),
        ),
      )
      .limit(1);

    if (!sub) {
      res.status(404).json({ error: "Not found", message: "Subscription not found" });
      return;
    }
    if (sub.status === "cancelled" || sub.status === "failed") {
      res.status(400).json({ error: "Already inactive", message: `Subscription is already ${sub.status}` });
      return;
    }

    await db.update(subscriptionsTable)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(subscriptionsTable.id, id));

    // Fire webhook
    enqueueWebhook(dev.developerId, "subscription.cancelled", {
      subscription_id:  sub.id,
      merchant_id:      dev.merchantId,
      external_ref:     sub.externalRef ?? null,
      status:           "cancelled",
      cancelled_at:     new Date().toISOString(),
    }).catch(() => {});

    logger.info({ subId: id, developerId: dev.developerId }, "[v1/subscriptions] Cancelled");
    res.json({ message: "Subscription cancelled", subscription_id: id });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;