/**
 * POST /v1/confirmation-codes/generate  — generate a code for a user (with external_ref)
 * POST /v1/confirmation-codes/validate  — validate a code and activate subscription
 */

import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import {
  db, usersTable, otpCodesTable,
  subscriptionPlansTable, subscriptionIntervalsTable,
  subscriptionConfirmationCodesTable, subscriptionsTable,
  subscriptionPassportsTable, subscriptionPaymentsTable,
  escrowsTable,
} from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { requireApiKey } from "../../lib/apiKeyAuth.js";
import { enqueueWebhook } from "../../lib/webhookDelivery.js";
import { hashEmail, parseUsdcAmount } from "../../lib/escrow.js";
import { sendPassportCreatedEmail, sendSubscriptionActivatedEmail } from "../../lib/email.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

const CONFIRMATION_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const CODE_EXPIRY_DAYS     = 7;
const VALID_INTERVALS      = ["weekly", "monthly", "yearly"] as const;
type Interval = typeof VALID_INTERVALS[number];

function generateConfirmationCode(): string {
  const bytes = crypto.randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CONFIRMATION_CHARSET[bytes[i]! % CONFIRMATION_CHARSET.length];
  return s;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function advanceBillingDate(from: Date, interval: Interval): Date {
  const next = new Date(from);
  if (interval === "weekly")  next.setDate(next.getDate() + 7);
  if (interval === "monthly") next.setMonth(next.getMonth() + 1);
  if (interval === "yearly")  next.setFullYear(next.getFullYear() + 1);
  return next;
}

// ─── POST /v1/confirmation-codes/generate ─────────────────────────────────────

router.post("/generate", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const { merchant_id, plan_id, interval, external_ref, user_email } = req.body as {
      merchant_id?:  string;
      plan_id?:      number;
      interval?:     string;
      external_ref?: string;
      user_email?:   string;
    };

    const merchantId = merchant_id ?? dev.merchantId;

    if (!plan_id) {
      res.status(400).json({ error: "Validation", message: "plan_id is required" });
      return;
    }
    if (!interval || !VALID_INTERVALS.includes(interval as Interval)) {
      res.status(400).json({ error: "Validation", message: "Valid interval (weekly/monthly/yearly) is required" });
      return;
    }
    if (!user_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user_email)) {
      res.status(400).json({ error: "Validation", message: "Valid user_email is required to identify the subscriber" });
      return;
    }

    // Look up user by email (they must have a platform account to subscribe)
    const [subscriber] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, user_email.toLowerCase().trim()))
      .limit(1);

    if (!subscriber) {
      res.status(404).json({ error: "Not found", message: "User with that email not found on the platform" });
      return;
    }

    // Resolve plan + interval
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

    // Supersession: invalidate prior codes for this user + merchant
    await db.update(subscriptionConfirmationCodesTable)
      .set({ invalidatedAt: new Date() })
      .where(
        and(
          eq(subscriptionConfirmationCodesTable.subscriberUserId, subscriber.id),
          eq(subscriptionConfirmationCodesTable.merchantId, merchantId),
          isNull(subscriptionConfirmationCodesTable.invalidatedAt),
          isNull(subscriptionConfirmationCodesTable.usedAt),
        ),
      );

    // Generate unique code
    let code: string;
    let attempts = 0;
    while (true) {
      code = generateConfirmationCode();
      const h = hashCode(code);
      const dup = await db.select({ id: subscriptionConfirmationCodesTable.id })
        .from(subscriptionConfirmationCodesTable)
        .where(eq(subscriptionConfirmationCodesTable.codeHash, h))
        .limit(1);
      if (dup.length === 0) break;
      if (++attempts > 20) throw new Error("Could not generate unique code");
    }

    const expiresAt = new Date(Date.now() + CODE_EXPIRY_DAYS * 86_400_000);
    await db.insert(subscriptionConfirmationCodesTable).values({
      subscriberUserId: subscriber.id,
      intervalId:       intervalRecord.id,
      merchantId,
      planInterval:     interval,
      codeHash:         hashCode(code!),
      expiresAt,
    });

    logger.info({ userId: subscriber.id, merchantId, externalRef: external_ref }, "[v1/confirmation-codes] Generated");

    res.json({
      confirmation_code: code!,
      expires_at:        expiresAt,
      merchant_id:       merchantId,
      plan_id,
      interval,
      external_ref:      external_ref ?? null,
      message:           "Deliver this code to the user. They enter it on the subscription page to activate.",
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[v1/confirmation-codes] Generate error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /v1/confirmation-codes/validate ─────────────────────────────────────

router.post("/validate", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const { code, merchant_id, external_ref } = req.body as {
      code?:         string;
      merchant_id?:  string;
      external_ref?: string;
    };

    const merchantId = merchant_id ?? dev.merchantId;

    if (!code?.trim()) {
      res.status(400).json({ error: "Validation", message: "code is required" });
      return;
    }

    const codeHash = hashCode(code.trim());

    const [codeRecord] = await db
      .select()
      .from(subscriptionConfirmationCodesTable)
      .where(
        and(
          eq(subscriptionConfirmationCodesTable.codeHash, codeHash),
          eq(subscriptionConfirmationCodesTable.merchantId, merchantId),
          isNull(subscriptionConfirmationCodesTable.usedAt),
          isNull(subscriptionConfirmationCodesTable.invalidatedAt),
          gt(subscriptionConfirmationCodesTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!codeRecord) {
      res.status(400).json({ error: "Invalid code", message: "Confirmation code is invalid, expired, or already used" });
      return;
    }

    const [intervalRecord] = await db
      .select()
      .from(subscriptionIntervalsTable)
      .where(eq(subscriptionIntervalsTable.id, codeRecord.intervalId))
      .limit(1);

    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, intervalRecord!.planId))
      .limit(1);

    const [subscriber] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, codeRecord.subscriberUserId))
      .limit(1);

    const amount  = parseFloat(intervalRecord!.amount);
    const now     = new Date();
    const planInterval = codeRecord.planInterval as Interval;

    let status: string;
    let trialEndsAt: Date | null = null;
    let nextBillingAt: Date;

    if (plan!.hasFreeTrial && plan!.trialDurationDays) {
      status        = "trialing";
      trialEndsAt   = new Date(now.getTime() + plan!.trialDurationDays * 86_400_000);
      nextBillingAt = trialEndsAt;
    } else {
      if (parseFloat(subscriber?.claimedBalance ?? "0") < amount) {
        res.status(402).json({ error: "Insufficient balance", message: "Subscriber has insufficient balance" });
        return;
      }

      const newBalance   = (parseFloat(subscriber!.claimedBalance ?? "0") - amount).toFixed(6);
      const creatorEmail = plan!.paymentEmail.toLowerCase().trim();
      const emailHash    = hashEmail(creatorEmail);

      const [creatorUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, creatorEmail))
        .limit(1);

      await db.transaction(async (tx) => {
        await tx.update(usersTable)
          .set({ claimedBalance: newBalance })
          .where(eq(usersTable.id, subscriber!.id));

        if (creatorUser) {
          const creatorNewBalance = (parseFloat(creatorUser.claimedBalance ?? "0") + amount).toFixed(6);
          await tx.update(usersTable)
            .set({ claimedBalance: creatorNewBalance })
            .where(eq(usersTable.id, creatorUser.id));
          await tx.insert(escrowsTable).values({
            senderAddress:   subscriber!.email,
            recipientEmail:  creatorEmail,
            emailHash,
            amount:          amount.toFixed(6),
            amountWei:       parseUsdcAmount(amount.toFixed(6)).toString(),
            status:          "claimed",
            recipientUserId: creatorUser.id,
            claimedAt:       now,
          });
        } else {
          await tx.insert(escrowsTable).values({
            senderAddress:  subscriber!.email,
            recipientEmail: creatorEmail,
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

    // Cancel any existing subscription for this merchant
    await db.update(subscriptionsTable)
      .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
      .where(
        and(
          eq(subscriptionsTable.subscriberUserId, subscriber!.id),
          eq(subscriptionsTable.merchantId, merchantId),
        ),
      );

    const [subscription] = await db.insert(subscriptionsTable).values({
      subscriberUserId: subscriber!.id,
      planId:           plan!.id,
      intervalId:       intervalRecord!.id,
      merchantId,
      planInterval,
      amount:           amount.toFixed(6),
      status,
      startedAt:        now,
      trialEndsAt,
      nextBillingAt,
      externalRef:      external_ref ?? null,
      activationMethod: "confirmation_code",
    }).returning();

    await db.update(subscriptionConfirmationCodesTable)
      .set({ usedAt: now })
      .where(eq(subscriptionConfirmationCodesTable.id, codeRecord.id));

    // Record payment event (if not trialing)
    if (status === "active") {
      await db.insert(subscriptionPaymentsTable).values({
        subscriptionId: subscription!.id,
        merchantId,
        amount:         amount.toFixed(6),
        currency:       "USD",
        status:         "succeeded",
      });
    }

    // Auto-issue passport
    try {
      const [passport] = await db
        .select()
        .from(subscriptionPassportsTable)
        .where(eq(subscriptionPassportsTable.userId, subscriber!.id))
        .limit(1);

      if (!passport) {
        const secret    = process.env.JWT_SECRET ?? "arc-passport-secret";
        const payload   = `passport:${subscriber!.id}:${Date.now()}`;
        const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
        await db.insert(subscriptionPassportsTable).values({
          userId: subscriber!.id, status: "active", signature, issuedAt: now,
        });
        sendPassportCreatedEmail(subscriber!.email).catch(() => {});
      }
    } catch {}

    // Email subscriber
    try {
      await sendSubscriptionActivatedEmail(
        subscriber!.email, plan!.planTitle, amount.toFixed(2), planInterval,
        status === "trialing", status === "trialing" ? undefined : nextBillingAt, trialEndsAt ?? undefined,
      );
    } catch {}

    // Fire webhook
    enqueueWebhook(dev.developerId, "subscription.created", {
      subscription_id:      subscription!.id,
      plan_id:              plan!.id,
      plan_name:            plan!.planTitle,
      merchant_id:          merchantId,
      external_ref:         external_ref ?? null,
      amount:               amount,
      currency:             "USD",
      interval:             planInterval,
      status,
      activation_method:    "confirmation_code",
      current_period_start: now.toISOString(),
      current_period_end:   nextBillingAt.toISOString(),
      trial_end:            trialEndsAt?.toISOString() ?? null,
      user_email:           subscriber!.email,
    }).catch(() => {});

    logger.info({ subId: subscription!.id, developerId: dev.developerId, externalRef: external_ref }, "[v1/confirmation-codes] Activated");

    res.json({
      success:         true,
      subscription_id: subscription!.id,
      status,
      external_ref:    external_ref ?? null,
      plan_name:       plan!.planTitle,
      amount:          amount.toFixed(2),
      interval:        planInterval,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[v1/confirmation-codes] Validate error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;