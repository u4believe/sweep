/**
 * POST /api/pay/checkout  — Direct checkout for developer-class subscription plans.
 *
 * Developers redirect their users to /pay/:merchantId?external_ref=…&interval_id=…
 * The checkout page calls this endpoint after the user confirms payment.
 *
 * Flow:
 *   1. Validate plan (must be a dev-api-plan) + interval
 *   2. Debit subscriber's claimedBalance
 *   3. Credit developer's payment email (or leave pending escrow if unregistered)
 *   4. Create subscription record with externalRef + activationMethod = "checkout"
 *   5. Enqueue subscription.created webhook to the developer
 *   6. Auto-issue Subscription Passport
 */

import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db, usersTable, escrowsTable } from "@workspace/db";
import {
  subscriptionPlansTable,
  subscriptionIntervalsTable,
  subscriptionsTable,
  subscriptionPassportsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireEmailVerified } from "../lib/auth.js";
import { hashEmail, parseUsdcAmount } from "../lib/escrow.js";
import { enqueueWebhook } from "../lib/webhookDelivery.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

type Interval = "weekly" | "monthly" | "yearly";

function advanceBillingDate(from: Date, interval: Interval): Date {
  const next = new Date(from);
  if (interval === "weekly")  next.setDate(next.getDate() + 7);
  if (interval === "monthly") next.setMonth(next.getMonth() + 1);
  if (interval === "yearly")  next.setFullYear(next.getFullYear() + 1);
  return next;
}

// ─── POST /api/pay/checkout ───────────────────────────────────────────────────

router.post("/checkout", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const user = (req as any).user as { userId: number };
    const { merchantId, intervalId, externalRef, redirectUrl } = req.body as {
      merchantId?:  string;
      intervalId?:  number;
      externalRef?: string;
      redirectUrl?: string;
    };

    if (!merchantId?.trim()) {
      res.status(400).json({ error: "Validation", message: "merchantId is required" });
      return;
    }
    if (!intervalId) {
      res.status(400).json({ error: "Validation", message: "intervalId is required" });
      return;
    }

    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(
        and(
          eq(subscriptionPlansTable.merchantId, merchantId),
          eq(subscriptionPlansTable.pakHash, "dev-api-plan"),
        ),
      )
      .limit(1);

    if (!plan) {
      res.status(404).json({ error: "Not found", message: "Payment page not found" });
      return;
    }

    const [intervalRecord] = await db
      .select()
      .from(subscriptionIntervalsTable)
      .where(
        and(
          eq(subscriptionIntervalsTable.id, intervalId),
          eq(subscriptionIntervalsTable.planId, plan.id),
        ),
      )
      .limit(1);

    if (!intervalRecord) {
      res.status(400).json({ error: "Validation", message: "Invalid interval" });
      return;
    }

    const [subscriber] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, user.userId))
      .limit(1);

    if (!subscriber) {
      res.status(401).json({ error: "Unauthorized", message: "User not found" });
      return;
    }

    const amount       = parseFloat(intervalRecord.amount);
    const planInterval = intervalRecord.interval as Interval;

    // Cancel any existing subscription for this user + merchant before creating a new one
    await db
      .update(subscriptionsTable)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(subscriptionsTable.subscriberUserId, user.userId),
          eq(subscriptionsTable.merchantId, merchantId),
        ),
      );

    const now = new Date();
    let status: string;
    let trialEndsAt: Date | null = null;
    let nextBillingAt: Date;

    if (plan.hasFreeTrial && plan.trialDurationDays) {
      status        = "trialing";
      trialEndsAt   = new Date(now.getTime() + plan.trialDurationDays * 24 * 60 * 60 * 1000);
      nextBillingAt = trialEndsAt;
    } else {
      if (parseFloat(subscriber.claimedBalance ?? "0") < amount) {
        res.status(402).json({
          error:   "Insufficient balance",
          message: "Your Sweep balance is too low. Add funds to your account to subscribe.",
        });
        return;
      }

      const newBalance     = (parseFloat(subscriber.claimedBalance ?? "0") - amount).toFixed(6);
      const recipientEmail = plan.paymentEmail.toLowerCase().trim();
      const emailHash      = hashEmail(recipientEmail);

      const [recipientUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, recipientEmail))
        .limit(1);

      await db.transaction(async (tx) => {
        await tx.update(usersTable)
          .set({ claimedBalance: newBalance })
          .where(eq(usersTable.id, user.userId));

        if (recipientUser) {
          const newRecipientBalance = (parseFloat(recipientUser.claimedBalance ?? "0") + amount).toFixed(6);
          await tx.update(usersTable)
            .set({ claimedBalance: newRecipientBalance })
            .where(eq(usersTable.id, recipientUser.id));
          await tx.insert(escrowsTable).values({
            senderAddress:   subscriber.email,
            recipientEmail,
            emailHash,
            amount:          amount.toFixed(6),
            amountWei:       parseUsdcAmount(amount.toFixed(6)).toString(),
            status:          "claimed",
            recipientUserId: recipientUser.id,
            claimedAt:       new Date(),
          });
        } else {
          await tx.insert(escrowsTable).values({
            senderAddress:  subscriber.email,
            recipientEmail,
            emailHash,
            amount:         amount.toFixed(6),
            amountWei:      parseUsdcAmount(amount.toFixed(6)).toString(),
            status:         "pending",
          });
        }
      });

      status        = "active";
      nextBillingAt = advanceBillingDate(now, planInterval);
    }

    const [subscription] = await db.insert(subscriptionsTable).values({
      subscriberUserId: user.userId,
      planId:           plan.id,
      intervalId:       intervalRecord.id,
      merchantId,
      planInterval:     intervalRecord.interval,
      amount:           amount.toFixed(6),
      status,
      startedAt:        now,
      trialEndsAt,
      nextBillingAt,
      externalRef:      externalRef?.trim() || null,
      activationMethod: "checkout",
    }).returning();

    enqueueWebhook(plan.creatorUserId, "subscription.created", {
      subscription_id:    subscription!.id,
      merchant_id:        merchantId,
      plan_id:            plan.id,
      plan_name:          plan.planTitle,
      external_ref:       externalRef?.trim() || null,
      interval:           intervalRecord.interval,
      amount:             amount.toFixed(6),
      currency:           "USD",
      status,
      trial_end:          trialEndsAt?.toISOString() ?? null,
      current_period_end: nextBillingAt.toISOString(),
      created_at:         now.toISOString(),
    }).catch(() => {});

    try {
      const [existingPassport] = await db
        .select()
        .from(subscriptionPassportsTable)
        .where(eq(subscriptionPassportsTable.userId, user.userId))
        .limit(1);

      if (!existingPassport) {
        const secret    = process.env.PASSPORT_SECRET!;
        const payload   = `passport:${user.userId}:${Date.now()}`;
        const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
        await db.insert(subscriptionPassportsTable).values({
          userId:   user.userId,
          status:   "active",
          signature,
          issuedAt: new Date(),
        });
      } else if (existingPassport.status === "suspended") {
        await db.update(subscriptionPassportsTable)
          .set({ status: "active", suspendedAt: null, suspendedReason: null, updatedAt: new Date() })
          .where(eq(subscriptionPassportsTable.id, existingPassport.id));
      }
    } catch (passportErr: any) {
      logger.warn({ err: passportErr.message }, "[pay] Failed to auto-issue passport");
    }

    logger.info(
      { subscriptionId: subscription!.id, userId: user.userId, merchantId, externalRef, status },
      "[pay] Checkout subscription activated",
    );

    res.status(201).json({
      message: status === "trialing"
        ? "Subscription activated — free trial started"
        : "Subscription activated",
      subscription: {
        id:           subscription!.id,
        status,
        plan_name:    plan.planTitle,
        interval:     intervalRecord.interval,
        amount:       amount.toFixed(2),
        external_ref: externalRef?.trim() || null,
        next_billing: nextBillingAt.toISOString(),
      },
      redirect_url: redirectUrl ?? null,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[pay] Checkout error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;