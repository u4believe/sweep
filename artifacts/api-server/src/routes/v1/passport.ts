/**
 * POST /v1/passport/activate — activate a subscription via passport (no code needed)
 * GET  /v1/passport/status   — check if a user has a valid passport
 */

import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import {
  db, usersTable, escrowsTable,
  subscriptionPlansTable, subscriptionIntervalsTable,
  subscriptionsTable, subscriptionPassportsTable,
  subscriptionPaymentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireApiKey } from "../../lib/apiKeyAuth.js";
import { enqueueWebhook } from "../../lib/webhookDelivery.js";
import { hashEmail, parseUsdcAmount } from "../../lib/escrow.js";
import { sendSubscriptionActivatedEmail } from "../../lib/email.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

const VALID_INTERVALS = ["weekly", "monthly", "yearly"] as const;
type Interval = typeof VALID_INTERVALS[number];

function advanceBillingDate(from: Date, interval: Interval): Date {
  const next = new Date(from);
  if (interval === "weekly")  next.setDate(next.getDate() + 7);
  if (interval === "monthly") next.setMonth(next.getMonth() + 1);
  if (interval === "yearly")  next.setFullYear(next.getFullYear() + 1);
  return next;
}

// ─── GET /v1/passport/status ─────────────────────────────────────────────────

router.get("/status", requireApiKey, async (req, res) => {
  try {
    const userEmail = typeof req.query["user_email"] === "string" ? req.query["user_email"] : null;
    const userId    = typeof req.query["user_id"]    === "string" ? parseInt(req.query["user_id"]) : null;

    if (!userEmail && !userId) {
      res.status(400).json({ error: "Validation", message: "user_email or user_id is required" });
      return;
    }

    let user: typeof usersTable.$inferSelect | undefined;
    if (userId && !isNaN(userId)) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      user = u;
    } else if (userEmail) {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.email, userEmail.toLowerCase().trim())).limit(1);
      user = u;
    }

    if (!user) {
      res.json({ has_passport: false, status: null });
      return;
    }

    const [passport] = await db
      .select()
      .from(subscriptionPassportsTable)
      .where(eq(subscriptionPassportsTable.userId, user.id))
      .limit(1);

    if (!passport) {
      res.json({ has_passport: false, status: null, user_id: user.id });
      return;
    }

    res.json({
      has_passport: true,
      status:       passport.status,
      issued_at:    passport.issuedAt,
      user_id:      user.id,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /v1/passport/activate ──────────────────────────────────────────────

router.post("/activate", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const { plan_id, interval, external_ref, user_email, merchant_id } = req.body as {
      plan_id?:      number;
      interval?:     string;
      external_ref?: string;
      user_email?:   string;
      merchant_id?:  string;
    };

    const merchantId = merchant_id ?? dev.merchantId;

    if (!plan_id) {
      res.status(400).json({ error: "Validation", message: "plan_id is required" });
      return;
    }
    if (!interval || !VALID_INTERVALS.includes(interval as Interval)) {
      res.status(400).json({ error: "Validation", message: "Valid interval is required" });
      return;
    }
    if (!user_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user_email)) {
      res.status(400).json({ error: "Validation", message: "Valid user_email is required" });
      return;
    }

    const [subscriber] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, user_email.toLowerCase().trim()))
      .limit(1);

    if (!subscriber) {
      res.status(404).json({ error: "Not found", message: "User not found on the platform" });
      return;
    }

    // Verify active passport
    const [passport] = await db
      .select()
      .from(subscriptionPassportsTable)
      .where(eq(subscriptionPassportsTable.userId, subscriber.id))
      .limit(1);

    if (!passport || passport.status !== "active") {
      res.status(403).json({ error: "Forbidden", message: "User does not have an active Subscription Passport" });
      return;
    }

    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(and(eq(subscriptionPlansTable.id, plan_id), eq(subscriptionPlansTable.merchantId, merchantId)))
      .limit(1);

    if (!plan) {
      res.status(404).json({ error: "Not found", message: "Plan not found" });
      return;
    }

    const [intervalRecord] = await db
      .select()
      .from(subscriptionIntervalsTable)
      .where(
        and(
          eq(subscriptionIntervalsTable.planId, plan.id),
          eq(subscriptionIntervalsTable.interval, interval),
        ),
      )
      .limit(1);

    if (!intervalRecord) {
      res.status(404).json({ error: "Not found", message: "Interval not found for this plan" });
      return;
    }

    const planInterval = intervalRecord.interval as Interval;
    const amount       = parseFloat(intervalRecord.amount);
    const now          = new Date();

    let status: string;
    let trialEndsAt: Date | null = null;
    let nextBillingAt: Date;

    if (plan.hasFreeTrial && plan.trialDurationDays) {
      status        = "trialing";
      trialEndsAt   = new Date(now.getTime() + plan.trialDurationDays * 86_400_000);
      nextBillingAt = trialEndsAt;
    } else {
      if (parseFloat(subscriber.claimedBalance ?? "0") < amount) {
        res.status(402).json({ error: "Insufficient balance", message: "User has insufficient balance" });
        return;
      }

      const newBalance   = (parseFloat(subscriber.claimedBalance ?? "0") - amount).toFixed(6);
      const creatorEmail = plan.paymentEmail.toLowerCase().trim();
      const emailHash    = hashEmail(creatorEmail);

      const [creatorUser] = await db.select().from(usersTable).where(eq(usersTable.email, creatorEmail)).limit(1);

      await db.transaction(async (tx) => {
        await tx.update(usersTable).set({ claimedBalance: newBalance }).where(eq(usersTable.id, subscriber.id));

        if (creatorUser) {
          const creatorNewBalance = (parseFloat(creatorUser.claimedBalance ?? "0") + amount).toFixed(6);
          await tx.update(usersTable).set({ claimedBalance: creatorNewBalance }).where(eq(usersTable.id, creatorUser.id));
          await tx.insert(escrowsTable).values({
            senderAddress: subscriber.email, recipientEmail: creatorEmail, emailHash,
            amount: amount.toFixed(6), amountWei: parseUsdcAmount(amount.toFixed(6)).toString(),
            status: "claimed", recipientUserId: creatorUser.id, claimedAt: now,
          });
        } else {
          await tx.insert(escrowsTable).values({
            senderAddress: subscriber.email, recipientEmail: creatorEmail, emailHash,
            amount: amount.toFixed(6), amountWei: parseUsdcAmount(amount.toFixed(6)).toString(),
            status: "pending",
          });
        }
      });

      status        = "active";
      nextBillingAt = advanceBillingDate(now, planInterval);
    }

    await db.update(subscriptionsTable)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(
        and(
          eq(subscriptionsTable.subscriberUserId, subscriber.id),
          eq(subscriptionsTable.merchantId, merchantId),
        ),
      );

    const [subscription] = await db.insert(subscriptionsTable).values({
      subscriberUserId: subscriber.id,
      planId:           plan.id,
      intervalId:       intervalRecord.id,
      merchantId,
      planInterval,
      amount:           amount.toFixed(6),
      status,
      startedAt:        now,
      trialEndsAt,
      nextBillingAt,
      externalRef:      external_ref ?? null,
      activationMethod: "passport",
    }).returning();

    if (status === "active") {
      await db.insert(subscriptionPaymentsTable).values({
        subscriptionId: subscription!.id,
        merchantId,
        amount:         amount.toFixed(6),
        currency:       "USD",
        status:         "succeeded",
      });
    }

    try {
      await sendSubscriptionActivatedEmail(
        subscriber.email, plan.planTitle, amount.toFixed(2), planInterval,
        status === "trialing", status === "trialing" ? undefined : nextBillingAt, trialEndsAt ?? undefined,
      );
    } catch {}

    enqueueWebhook(dev.developerId, "passport.activated", {
      subscription_id:      subscription!.id,
      plan_id:              plan.id,
      plan_name:            plan.planTitle,
      merchant_id:          merchantId,
      external_ref:         external_ref ?? null,
      amount,
      currency:             "USD",
      interval:             planInterval,
      status,
      activation_method:    "passport",
      current_period_start: now.toISOString(),
      current_period_end:   nextBillingAt.toISOString(),
      trial_end:            trialEndsAt?.toISOString() ?? null,
      user_email:           subscriber.email,
    }).catch(() => {});

    logger.info({ subId: subscription!.id, developerId: dev.developerId, externalRef: external_ref }, "[v1/passport] Activated");

    res.json({
      success:         true,
      subscription_id: subscription!.id,
      status,
      external_ref:    external_ref ?? null,
      plan_name:       plan.planTitle,
      amount:          amount.toFixed(2),
      interval:        planInterval,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[v1/passport] Activate error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;