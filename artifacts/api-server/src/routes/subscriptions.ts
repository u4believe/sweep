/**
 * Subscription routes — Creator Class (Document 1 of 2).
 *
 * Plan management (creator):
 *   POST /api/subscriptions/plans              — create subscription plan
 *   GET  /api/subscriptions/plans              — list creator's own plans
 *
 * Public lookup (subscriber — no auth):
 *   GET  /api/subscriptions/merchant/:id       — reveal plan info from Merchant ID
 *
 * Confirmation code flow (subscriber — requires auth):
 *   POST /api/subscriptions/confirmation-code/request-otp  — verify tx pwd, send OTP
 *   POST /api/subscriptions/confirmation-code/generate     — verify OTP, emit code
 *
 * Subscription activation (public — code carries identity):
 *   POST /api/subscriptions/activate           — enter code on hosted page
 *
 * Subscriber dashboard:
 *   GET  /api/subscriptions/my                 — list my subscriptions
 *   DELETE /api/subscriptions/:id              — cancel a subscription
 */

import { Router, type IRouter } from "express";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { db, usersTable, otpCodesTable, escrowsTable } from "@workspace/db";
import {
  subscriptionPlansTable,
  subscriptionIntervalsTable,
  subscriptionPlanTiersTable,
  subscriptionConfirmationCodesTable,
  subscriptionsTable,
  subscriptionPassportsTable,
} from "@workspace/db";
import { eq, and, gt, isNull, ne } from "drizzle-orm";
import { requireAuth, requireEmailVerified } from "../lib/auth.js";
import { hashEmail, parseUsdcAmount } from "../lib/escrow.js";
import {
  sendSubscriptionOtpEmail,
  sendSubscriptionConfirmationCodeEmail,
  sendCreatorNewSubscriberEmail,
  sendCreatorCancelledEmail,
  sendPassportCreatedEmail,
  sendSubscriptionActivatedEmail,
  sendSubscriptionCancelledEmail,
} from "../lib/email.js";
import { enqueueWebhook } from "../lib/webhookDelivery.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Constants ────────────────────────────────────────────────────────────────

const MERCHANT_ID_CHARSET    = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CONFIRMATION_CHARSET   = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const CODE_EXPIRY_DAYS       = 7;
const OTP_EXPIRY_MS          = 10 * 60 * 1000;
const VALID_INTERVALS        = ["weekly", "monthly", "yearly"] as const;
type  Interval               = typeof VALID_INTERVALS[number];

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateMerchantId(): string {
  const bytes = crypto.randomBytes(12);
  let   s     = "";
  for (let i = 0; i < 12; i++) s += MERCHANT_ID_CHARSET[bytes[i]! % MERCHANT_ID_CHARSET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

function generateConfirmationCode(): string {
  const bytes = crypto.randomBytes(8);
  let   s     = "";
  for (let i = 0; i < 8; i++) s += CONFIRMATION_CHARSET[bytes[i]! % CONFIRMATION_CHARSET.length];
  return s;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

async function issueOtp(userId: number, type: string): Promise<string> {
  const code      = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
  await db.insert(otpCodesTable).values({ userId, code, type, expiresAt });
  return code;
}

async function verifyOtp(userId: number, code: string, type: string): Promise<boolean> {
  const [otp] = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.userId, userId),
        eq(otpCodesTable.code, code.trim()),
        eq(otpCodesTable.type, type),
        eq(otpCodesTable.used, false),
        gt(otpCodesTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!otp) return false;
  await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, otp.id));
  return true;
}

/** Advance a date by one billing interval. */
function advanceBillingDate(from: Date, interval: Interval): Date {
  const next = new Date(from);
  if (interval === "weekly")  next.setDate(next.getDate() + 7);
  if (interval === "monthly") next.setMonth(next.getMonth() + 1);
  if (interval === "yearly")  next.setFullYear(next.getFullYear() + 1);
  return next;
}

// ── POST /api/subscriptions/plans ─────────────────────────────────────────────

router.post("/plans", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const user = (req as any).user as { userId: number };
    type TierInput = {
      tierName:      string;
      description?:  string;
      features?:     string[];
      isHighlighted: boolean;
      displayOrder:  number;
      intervals:     { interval: string; amount: string }[];
    };

    const { paymentEmail, planTitle, intervals, tiers, hasFreeTrial, trialDurationDays, pak } = req.body as {
      paymentEmail?:      string;
      planTitle?:         string;
      intervals?:         { interval: string; amount: string }[];
      tiers?:             TierInput[];
      hasFreeTrial?:      boolean;
      trialDurationDays?: number;
      pak?:               string;
    };

    const isTiered = Array.isArray(tiers) && tiers.length > 0;

    if (!paymentEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paymentEmail)) {
      res.status(400).json({ error: "Validation", message: "Valid paymentEmail is required" });
      return;
    }
    if (!planTitle?.trim()) {
      res.status(400).json({ error: "Validation", message: "planTitle is required" });
      return;
    }

    if (isTiered) {
      if (tiers!.length > 5) {
        res.status(400).json({ error: "Validation", message: "A plan can have at most 5 tiers" });
        return;
      }
      for (const tier of tiers!) {
        if (!tier.tierName?.trim()) {
          res.status(400).json({ error: "Validation", message: "Each tier must have a name" });
          return;
        }
        if (!tier.intervals || tier.intervals.length === 0) {
          res.status(400).json({ error: "Validation", message: `Tier "${tier.tierName}" must have at least one interval` });
          return;
        }
        for (const iv of tier.intervals) {
          if (!VALID_INTERVALS.includes(iv.interval as Interval)) {
            res.status(400).json({ error: "Validation", message: `Invalid interval "${iv.interval}" in tier "${tier.tierName}"` });
            return;
          }
          if (isNaN(parseFloat(iv.amount)) || parseFloat(iv.amount) <= 0) {
            res.status(400).json({ error: "Validation", message: `Each interval in tier "${tier.tierName}" must have a positive amount` });
            return;
          }
        }
      }
    } else {
      if (!intervals || intervals.length === 0) {
        res.status(400).json({ error: "Validation", message: "At least one interval is required" });
        return;
      }
      for (const iv of intervals) {
        if (!VALID_INTERVALS.includes(iv.interval as Interval)) {
          res.status(400).json({ error: "Validation", message: `Invalid interval: ${iv.interval}` });
          return;
        }
        if (isNaN(parseFloat(iv.amount)) || parseFloat(iv.amount) <= 0) {
          res.status(400).json({ error: "Validation", message: "Each interval must have a positive amount" });
          return;
        }
      }
    }

    if (!pak?.trim()) {
      res.status(400).json({ error: "Validation", message: "PAK is required" });
      return;
    }
    if (hasFreeTrial && (!trialDurationDays || trialDurationDays < 1)) {
      res.status(400).json({ error: "Validation", message: "trialDurationDays must be ≥ 1 when free trial is enabled" });
      return;
    }

    // Verify PAK
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId)).limit(1);
    if (!dbUser?.pakHash) {
      res.status(403).json({ error: "Forbidden", message: "You must generate a PAK before creating subscription plans" });
      return;
    }
    const pakValid = await bcrypt.compare(pak, dbUser.pakHash);
    if (!pakValid) {
      res.status(403).json({ error: "Forbidden", message: "Invalid PAK" });
      return;
    }

    const pakHash = dbUser.pakHash;

    // Generate ONE unique Merchant ID for the entire plan
    let merchantId: string;
    let attempts = 0;
    while (true) {
      merchantId = generateMerchantId();
      const existing = await db
        .select({ id: subscriptionPlansTable.id })
        .from(subscriptionPlansTable)
        .where(eq(subscriptionPlansTable.merchantId, merchantId))
        .limit(1);
      if (existing.length === 0) break;
      if (++attempts > 10) throw new Error("Could not generate unique Merchant ID");
    }

    const [plan] = await db.insert(subscriptionPlansTable).values({
      creatorUserId:     user.userId,
      paymentEmail:      paymentEmail.toLowerCase().trim(),
      planTitle:         planTitle.trim(),
      pakHash,
      merchantId:        merchantId!,
      hasFreeTrial:      hasFreeTrial ?? false,
      trialDurationDays: hasFreeTrial ? trialDurationDays : null,
    }).returning();

    if (isTiered) {
      // Insert tiers + their intervals
      const createdTiers = [];
      for (const tierInput of tiers!) {
        const [tier] = await db.insert(subscriptionPlanTiersTable).values({
          planId:        plan!.id,
          tierName:      tierInput.tierName.trim(),
          description:   tierInput.description?.trim() || null,
          features:      tierInput.features ?? [],
          isHighlighted: tierInput.isHighlighted ?? false,
          displayOrder:  tierInput.displayOrder,
        }).returning();

        const createdIntervals = [];
        for (const iv of tierInput.intervals) {
          const [interval] = await db.insert(subscriptionIntervalsTable).values({
            planId:   plan!.id,
            tierId:   tier!.id,
            interval: iv.interval,
            amount:   parseFloat(iv.amount).toFixed(6),
          }).returning();
          createdIntervals.push(interval);
        }
        createdTiers.push({ tier, intervals: createdIntervals });
      }

      logger.info({ planId: plan!.id, merchantId: merchantId!, userId: user.userId, tierCount: tiers!.length }, "[subscriptions] Tiered plan created");
      res.status(201).json({ plan, tiers: createdTiers });
    } else {
      // Flat plan — intervals belong directly to plan (no tier)
      const createdIntervals = [];
      for (const iv of intervals!) {
        const [interval] = await db.insert(subscriptionIntervalsTable).values({
          planId:   plan!.id,
          interval: iv.interval,
          amount:   parseFloat(iv.amount).toFixed(6),
        }).returning();
        createdIntervals.push(interval);
      }

      logger.info({ planId: plan!.id, merchantId: merchantId!, userId: user.userId }, "[subscriptions] Plan created");
      res.status(201).json({ plan, intervals: createdIntervals });
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "[subscriptions] Create plan error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── GET /api/subscriptions/plans ──────────────────────────────────────────────

router.get("/plans", requireAuth, async (req, res) => {
  try {
    const user  = (req as any).user as { userId: number };
    const plans = await db
      .select()
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.creatorUserId, user.userId));

    const result = await Promise.all(
      plans.map(async (plan) => {
        const intervals = await db
          .select()
          .from(subscriptionIntervalsTable)
          .where(eq(subscriptionIntervalsTable.planId, plan.id));

        const tiers = await db
          .select()
          .from(subscriptionPlanTiersTable)
          .where(eq(subscriptionPlanTiersTable.planId, plan.id))
          .orderBy(subscriptionPlanTiersTable.displayOrder);

        // Subscriber stats — exclude cancelled/failed
        const subs = await db
          .select({ amount: subscriptionsTable.amount, status: subscriptionsTable.status })
          .from(subscriptionsTable)
          .where(
            and(
              eq(subscriptionsTable.planId, plan.id),
              ne(subscriptionsTable.status, "cancelled"),
              ne(subscriptionsTable.status, "failed"),
            ),
          );

        const activeSubscriberCount = subs.length;
        const totalRevenue = subs
          .filter((s) => s.status === "active")
          .reduce((sum, s) => sum + parseFloat(s.amount), 0);

        return { ...plan, pakHash: undefined, intervals, tiers, activeSubscriberCount, totalRevenue: totalRevenue.toFixed(2) };
      }),
    );

    res.json({ plans: result });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── GET /api/subscriptions/merchant/:merchantId ───────────────────────────────
// Public — no auth. Returns plan info for the Pay Subscription lookup flow.

router.get("/merchant/:merchantId", async (req, res) => {
  try {
    const { merchantId } = req.params;

    // Look up plan directly by its merchant ID
    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.merchantId, merchantId as string))
      .limit(1);

    if (!plan) {
      res.status(404).json({ error: "Not found", message: "Merchant ID not found" });
      return;
    }

    const allIntervals = await db
      .select()
      .from(subscriptionIntervalsTable)
      .where(eq(subscriptionIntervalsTable.planId, plan.id));

    const allTiers = await db
      .select()
      .from(subscriptionPlanTiersTable)
      .where(eq(subscriptionPlanTiersTable.planId, plan.id))
      .orderBy(subscriptionPlanTiersTable.displayOrder);

    const [creator] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, plan.creatorUserId))
      .limit(1);

    // Build tiered response when plan has tiers
    const tieredResponse = allTiers.length > 0
      ? allTiers.map((tier) => ({
          tierId:        tier.id,
          tierName:      tier.tierName,
          description:   tier.description,
          features:      tier.features,
          isHighlighted: tier.isHighlighted,
          displayOrder:  tier.displayOrder,
          intervals:     allIntervals
            .filter((iv) => iv.tierId === tier.id)
            .map((iv) => ({ intervalId: iv.id, interval: iv.interval, amount: iv.amount })),
        }))
      : undefined;

    res.json({
      planTitle:         plan.planTitle,
      paymentEmail:      plan.paymentEmail,
      creatorName:       creator?.name ?? "Unknown",
      hasFreeTrial:      plan.hasFreeTrial,
      trialDurationDays: plan.trialDurationDays,
      // Flat plans: intervals at top level; tiered plans: tiers array with nested intervals
      intervals: tieredResponse
        ? allIntervals.map((iv) => ({ intervalId: iv.id, interval: iv.interval, amount: iv.amount }))
        : allIntervals.map((iv) => ({ intervalId: iv.id, interval: iv.interval, amount: iv.amount })),
      tiers: tieredResponse ?? [],
    });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/subscriptions/confirmation-code/request-otp ─────────────────────

router.post("/confirmation-code/request-otp", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const user = (req as any).user as { userId: number };
    const { merchantId, planInterval, intervalId: rawIntervalId, transactionPassword } = req.body as {
      merchantId?:          string;
      planInterval?:        string;
      intervalId?:          number;
      transactionPassword?: string;
    };

    if (!merchantId?.trim()) {
      res.status(400).json({ error: "Validation", message: "merchantId is required" });
      return;
    }

    // Look up plan by its merchant ID
    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.merchantId, merchantId))
      .limit(1);

    if (!plan) {
      res.status(404).json({ error: "Not found", message: "Merchant ID not found" });
      return;
    }

    // Resolve interval — prefer intervalId (precise, required for tiered plans);
    // fall back to planInterval string for flat / legacy plans.
    let interval: typeof subscriptionIntervalsTable.$inferSelect | undefined;
    if (rawIntervalId) {
      const [row] = await db
        .select()
        .from(subscriptionIntervalsTable)
        .where(
          and(
            eq(subscriptionIntervalsTable.id, rawIntervalId),
            eq(subscriptionIntervalsTable.planId, plan.id),
          ),
        )
        .limit(1);
      interval = row;
    } else {
      if (!planInterval || !VALID_INTERVALS.includes(planInterval as Interval)) {
        res.status(400).json({ error: "Validation", message: "intervalId or a valid planInterval (weekly/monthly/yearly) is required" });
        return;
      }
      const [row] = await db
        .select()
        .from(subscriptionIntervalsTable)
        .where(
          and(
            eq(subscriptionIntervalsTable.planId, plan.id),
            eq(subscriptionIntervalsTable.interval, planInterval),
          ),
        )
        .limit(1);
      interval = row;
    }

    if (!interval) {
      res.status(404).json({ error: "Not found", message: "Interval not found for this plan" });
      return;
    }

    // Verify transaction password if user has one
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId)).limit(1);
    if (dbUser?.transactionPasswordHash) {
      if (!transactionPassword) {
        res.status(403).json({ error: "Forbidden", message: "Transaction password required" });
        return;
      }
      const valid = await bcrypt.compare(transactionPassword, dbUser.transactionPasswordHash);
      if (!valid) {
        res.status(403).json({ error: "Forbidden", message: "Invalid transaction password" });
        return;
      }
    }

    // Issue OTP
    const otp = await issueOtp(user.userId, "sub-code-gen");
    await sendSubscriptionOtpEmail(dbUser!.email, otp);

    res.json({ message: "OTP sent to your registered email" });
  } catch (err: any) {
    logger.error({ err: err.message }, "[subscriptions] Request OTP error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/subscriptions/confirmation-code/generate ────────────────────────

router.post("/confirmation-code/generate", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const user = (req as any).user as { userId: number };
    const { otp, merchantId, planInterval: reqPlanInterval, intervalId: rawIntervalId } = req.body as {
      otp?:          string;
      merchantId?:   string;
      planInterval?: string;
      intervalId?:   number;
    };

    if (!otp?.trim() || !merchantId?.trim()) {
      res.status(400).json({ error: "Validation", message: "otp and merchantId are required" });
      return;
    }
    if (!rawIntervalId && !reqPlanInterval?.trim()) {
      res.status(400).json({ error: "Validation", message: "intervalId or planInterval is required" });
      return;
    }

    const otpValid = await verifyOtp(user.userId, otp, "sub-code-gen");
    if (!otpValid) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid or expired OTP" });
      return;
    }

    // Resolve plan by merchant ID
    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.merchantId, merchantId))
      .limit(1);

    if (!plan) {
      res.status(404).json({ error: "Not found", message: "Merchant ID not found" });
      return;
    }

    // Resolve interval — prefer intervalId for tiered plans
    let intervalRecord: typeof subscriptionIntervalsTable.$inferSelect | undefined;
    if (rawIntervalId) {
      const [row] = await db
        .select()
        .from(subscriptionIntervalsTable)
        .where(
          and(
            eq(subscriptionIntervalsTable.id, rawIntervalId),
            eq(subscriptionIntervalsTable.planId, plan.id),
          ),
        )
        .limit(1);
      intervalRecord = row;
    } else {
      const [row] = await db
        .select()
        .from(subscriptionIntervalsTable)
        .where(
          and(
            eq(subscriptionIntervalsTable.planId, plan.id),
            eq(subscriptionIntervalsTable.interval, reqPlanInterval!),
          ),
        )
        .limit(1);
      intervalRecord = row;
    }

    if (!intervalRecord) {
      res.status(404).json({ error: "Not found", message: "Interval not found for this plan" });
      return;
    }

    const planInterval = intervalRecord.interval;

    // Supersession: invalidate all prior codes this user has for this merchant
    await db
      .update(subscriptionConfirmationCodesTable)
      .set({ invalidatedAt: new Date() })
      .where(
        and(
          eq(subscriptionConfirmationCodesTable.subscriberUserId, user.userId),
          eq(subscriptionConfirmationCodesTable.merchantId, merchantId),
          isNull(subscriptionConfirmationCodesTable.invalidatedAt),
          isNull(subscriptionConfirmationCodesTable.usedAt),
        ),
      );

    // Generate unique confirmation code
    let code: string;
    let attempts = 0;
    while (true) {
      code = generateConfirmationCode();
      const h = hashCode(code);
      const dup = await db
        .select({ id: subscriptionConfirmationCodesTable.id })
        .from(subscriptionConfirmationCodesTable)
        .where(eq(subscriptionConfirmationCodesTable.codeHash, h))
        .limit(1);
      if (dup.length === 0) break;
      if (++attempts > 20) throw new Error("Could not generate unique confirmation code");
    }

    const expiresAt = new Date(Date.now() + CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    await db.insert(subscriptionConfirmationCodesTable).values({
      subscriberUserId: user.userId,
      intervalId:       intervalRecord.id,
      merchantId,
      planInterval,
      codeHash:         hashCode(code!),
      expiresAt,
    });

    // Fetch user email for delivery
    const [dbUser] = await db.select({ email: usersTable.email }).from(usersTable)
      .where(eq(usersTable.id, user.userId)).limit(1);

    await sendSubscriptionConfirmationCodeEmail(
      dbUser!.email,
      code!,
      plan!.planTitle,
      planInterval,
      intervalRecord.amount,
    );

    logger.info({ userId: user.userId, merchantId, planInterval }, "[subscriptions] Confirmation code generated");
    res.json({ message: "Confirmation code sent to your email. Enter it on the subscription page to activate." });
  } catch (err: any) {
    logger.error({ err: err.message }, "[subscriptions] Generate code error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/subscriptions/activate ─────────────────────────────────────────
// Public — used from the hosted subscription page (/subscribe/:merchantId).

router.post("/activate", async (req, res) => {
  try {
    const { merchantId, planInterval, confirmationCode } = req.body as {
      merchantId?:       string;
      planInterval?:     string;
      confirmationCode?: string;
    };

    if (!merchantId?.trim() || !planInterval?.trim() || !confirmationCode?.trim()) {
      res.status(400).json({ error: "Validation", message: "merchantId, planInterval, and confirmationCode are required" });
      return;
    }

    const codeHash = hashCode(confirmationCode.trim());

    // Find the confirmation code record
    const [codeRecord] = await db
      .select()
      .from(subscriptionConfirmationCodesTable)
      .where(
        and(
          eq(subscriptionConfirmationCodesTable.codeHash, codeHash),
          eq(subscriptionConfirmationCodesTable.merchantId, merchantId),
          eq(subscriptionConfirmationCodesTable.planInterval, planInterval),
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

    // Resolve interval + plan
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

    const subscriberUserId = codeRecord.subscriberUserId;
    const [subscriber] = await db.select().from(usersTable).where(eq(usersTable.id, subscriberUserId)).limit(1);

    const amount = parseFloat(intervalRecord!.amount);

    const now = new Date();
    let status: string;
    let trialEndsAt: Date | null = null;
    let nextBillingAt: Date;
    let subscription: typeof subscriptionsTable.$inferSelect;

    if (plan!.hasFreeTrial && plan!.trialDurationDays) {
      // Trial: no immediate charge; billing starts after trial
      status        = "trialing";
      trialEndsAt   = new Date(now.getTime() + plan!.trialDurationDays * 24 * 60 * 60 * 1000);
      nextBillingAt = trialEndsAt;

      [subscription] = await db.transaction(async (tx) => {
        // Cancel any existing subscription + create new one atomically
        await tx.update(subscriptionsTable)
          .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
          .where(and(eq(subscriptionsTable.subscriberUserId, subscriberUserId), eq(subscriptionsTable.merchantId, merchantId)));

        await tx.update(subscriptionConfirmationCodesTable)
          .set({ usedAt: now })
          .where(eq(subscriptionConfirmationCodesTable.id, codeRecord.id));

        return tx.insert(subscriptionsTable).values({
          subscriberUserId, planId: plan!.id, intervalId: intervalRecord!.id,
          merchantId, planInterval, amount: amount.toFixed(6),
          status, startedAt: now, trialEndsAt, nextBillingAt,
        }).returning();
      });
    } else {
      // Immediate billing
      if (parseFloat(subscriber?.claimedBalance ?? "0") < amount) {
        res.status(402).json({ error: "Insufficient balance", message: "Your account balance is too low to start this subscription" });
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

      status        = "active";
      nextBillingAt = advanceBillingDate(now, planInterval as Interval);

      [subscription] = await db.transaction(async (tx) => {
        // Cancel old subscription, debit subscriber, credit creator, create new subscription — all atomic
        await tx.update(subscriptionsTable)
          .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
          .where(and(eq(subscriptionsTable.subscriberUserId, subscriberUserId), eq(subscriptionsTable.merchantId, merchantId)));

        await tx.update(usersTable)
          .set({ claimedBalance: newBalance })
          .where(eq(usersTable.id, subscriberUserId));

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

        await tx.update(subscriptionConfirmationCodesTable)
          .set({ usedAt: now })
          .where(eq(subscriptionConfirmationCodesTable.id, codeRecord.id));

        return tx.insert(subscriptionsTable).values({
          subscriberUserId, planId: plan!.id, intervalId: intervalRecord!.id,
          merchantId, planInterval, amount: amount.toFixed(6),
          status, startedAt: now, trialEndsAt, nextBillingAt,
        }).returning();
      });
    }

    // Auto-issue or reactivate Subscription Passport on successful confirmation-code activation
    try {
      const [existingPassport] = await db
        .select()
        .from(subscriptionPassportsTable)
        .where(eq(subscriptionPassportsTable.userId, subscriberUserId))
        .limit(1);

      if (!existingPassport) {
        const secret    = process.env.PASSPORT_SECRET!;
        const payload   = `passport:${subscriberUserId}:${Date.now()}`;
        const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");

        await db.insert(subscriptionPassportsTable).values({
          userId:    subscriberUserId,
          status:    "active",
          signature,
          issuedAt:  new Date(),
        });

        try { await sendPassportCreatedEmail(subscriber!.email); } catch {}
        logger.info({ userId: subscriberUserId }, "[subscriptions] Subscription passport issued");
      } else if (existingPassport.status === "suspended") {
        // Reactivate suspended passport — user proved their identity via confirmation code
        await db.update(subscriptionPassportsTable)
          .set({ status: "active", suspendedAt: null, suspendedReason: null, updatedAt: new Date() })
          .where(eq(subscriptionPassportsTable.id, existingPassport.id));
        logger.info({ userId: subscriberUserId }, "[subscriptions] Subscription passport reactivated");
      }
      // revoked passports are not reinstated
    } catch (passportErr: any) {
      logger.warn({ err: passportErr.message }, "[subscriptions] Failed to auto-issue/reactivate passport");
    }

    // Notify subscriber of activation
    try {
      await sendSubscriptionActivatedEmail(
        subscriber!.email,
        plan!.planTitle,
        amount.toFixed(2),
        planInterval,
        status === "trialing",
        status === "trialing" ? undefined : nextBillingAt,
        trialEndsAt ?? undefined,
      );
    } catch {}

    // Notify creator of new subscriber
    try {
      const activeSubs = await db
        .select({ id: subscriptionsTable.id })
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.planId, plan!.id),
            ne(subscriptionsTable.status, "cancelled"),
            ne(subscriptionsTable.status, "failed"),
          ),
        );
      await sendCreatorNewSubscriberEmail(
        plan!.paymentEmail,
        subscriber!.email,
        plan!.planTitle,
        planInterval,
        activeSubs.length,
      );
    } catch (emailErr) {
      logger.warn({ err: emailErr }, "[subscriptions] Failed to send creator new-subscriber email");
    }

    logger.info(
      { subscriptionId: subscription!.id, subscriberUserId, merchantId, status },
      "[subscriptions] Subscription activated",
    );

    res.json({
      message:      status === "trialing" ? "Subscription activated — free trial started" : "Subscription activated",
      subscription: { id: subscription!.id, status, planTitle: plan!.planTitle, planInterval, amount: amount.toFixed(2) },
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[subscriptions] Activate error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── GET /api/subscriptions/my ─────────────────────────────────────────────────

router.get("/my", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as { userId: number };

    const subs = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.subscriberUserId, user.userId));

    // Attach plan titles
    const result = await Promise.all(
      subs.map(async (sub) => {
        const [plan] = await db
          .select({ planTitle: subscriptionPlansTable.planTitle, paymentEmail: subscriptionPlansTable.paymentEmail })
          .from(subscriptionPlansTable)
          .where(eq(subscriptionPlansTable.id, sub.planId))
          .limit(1);
        return { ...sub, planTitle: plan?.planTitle ?? "Unknown", paymentEmail: plan?.paymentEmail ?? "" };
      }),
    );

    res.json({ subscriptions: result });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── GET /api/subscriptions/plans/:planId/subscribers ─────────────────────────
// Creator only — returns all subscribers for one of their plans.

router.get("/plans/:planId/subscribers", requireAuth, async (req, res) => {
  try {
    const creator = (req as any).user as { userId: number };
    const planId  = parseInt(String(req.params["planId"]), 10);
    if (isNaN(planId)) {
      res.status(400).json({ error: "Validation", message: "Invalid plan ID" });
      return;
    }

    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(and(eq(subscriptionPlansTable.id, planId), eq(subscriptionPlansTable.creatorUserId, creator.userId)))
      .limit(1);

    if (!plan) {
      res.status(404).json({ error: "Not found", message: "Plan not found" });
      return;
    }

    const subs = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.planId, planId));

    const result = await Promise.all(
      subs.map(async (sub) => {
        const [subscriber] = await db
          .select({ name: usersTable.name, email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.id, sub.subscriberUserId))
          .limit(1);
        return {
          subscriptionId:  sub.id,
          subscriberName:  subscriber?.name  ?? "Unknown",
          subscriberEmail: subscriber?.email ?? "",
          planInterval:    sub.planInterval,
          amount:          sub.amount,
          status:          sub.status,
          startedAt:       sub.startedAt,
          nextBillingAt:   sub.nextBillingAt,
          cancelledAt:     sub.cancelledAt,
        };
      }),
    );

    res.json({ subscribers: result });
  } catch (err: any) {
    logger.error({ err: err.message }, "[subscriptions] List subscribers error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── GET /api/subscriptions/passport ──────────────────────────────────────────
// Returns the caller's passport status: { hasPassport, status }

router.get("/passport", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as { userId: number };

    const [passport] = await db
      .select()
      .from(subscriptionPassportsTable)
      .where(eq(subscriptionPassportsTable.userId, user.userId))
      .limit(1);

    if (!passport) {
      res.json({ hasPassport: false, status: null });
      return;
    }

    const sig = passport.signature.toUpperCase();
    const passportId = `PSP-${sig.slice(0, 4)}-${sig.slice(4, 8)}-${sig.slice(8, 12)}`;

    res.json({
      hasPassport: true,
      status:      passport.status,
      issuedAt:    passport.issuedAt,
      passportId,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[subscriptions] Get passport error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/subscriptions/passport/activate ─────────────────────────────────
// Passport-based subscription activation — no confirmation code required.
// Requires: auth, active passport, transaction password (if set).

router.post("/passport/activate", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const user = (req as any).user as { userId: number };
    const { merchantId, planInterval: reqPlanInterval, intervalId: rawIntervalId, transactionPassword, externalRef } = req.body as {
      merchantId?:          string;
      planInterval?:        string;
      intervalId?:          number;
      transactionPassword?: string;
      externalRef?:         string;
    };

    if (!merchantId?.trim()) {
      res.status(400).json({ error: "Validation", message: "merchantId is required" });
      return;
    }
    if (!rawIntervalId && !reqPlanInterval?.trim()) {
      res.status(400).json({ error: "Validation", message: "intervalId or planInterval is required" });
      return;
    }
    if (!rawIntervalId && reqPlanInterval && !VALID_INTERVALS.includes(reqPlanInterval as Interval)) {
      res.status(400).json({ error: "Validation", message: "Valid planInterval is required (weekly/monthly/yearly)" });
      return;
    }

    // Verify active passport
    const [passport] = await db
      .select()
      .from(subscriptionPassportsTable)
      .where(eq(subscriptionPassportsTable.userId, user.userId))
      .limit(1);

    if (!passport || passport.status !== "active") {
      res.status(403).json({ error: "Forbidden", message: "No active Subscription Passport found" });
      return;
    }

    // Verify transaction password if set
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId)).limit(1);
    if (!dbUser) {
      res.status(404).json({ error: "Not found", message: "User not found" });
      return;
    }
    if (dbUser.transactionPasswordHash) {
      if (!transactionPassword) {
        res.status(403).json({ error: "Forbidden", message: "Transaction password required" });
        return;
      }
      const valid = await bcrypt.compare(transactionPassword, dbUser.transactionPasswordHash);
      if (!valid) {
        res.status(403).json({ error: "Forbidden", message: "Invalid transaction password" });
        return;
      }
    }

    // Look up plan by merchant ID
    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.merchantId, merchantId))
      .limit(1);

    if (!plan) {
      res.status(404).json({ error: "Not found", message: "Merchant ID not found" });
      return;
    }

    // Resolve interval — prefer intervalId for tiered plans
    let intervalRecord: typeof subscriptionIntervalsTable.$inferSelect | undefined;
    if (rawIntervalId) {
      const [row] = await db
        .select()
        .from(subscriptionIntervalsTable)
        .where(
          and(
            eq(subscriptionIntervalsTable.id, rawIntervalId),
            eq(subscriptionIntervalsTable.planId, plan.id),
          ),
        )
        .limit(1);
      intervalRecord = row;
    } else {
      const [row] = await db
        .select()
        .from(subscriptionIntervalsTable)
        .where(
          and(
            eq(subscriptionIntervalsTable.planId, plan.id),
            eq(subscriptionIntervalsTable.interval, reqPlanInterval!),
          ),
        )
        .limit(1);
      intervalRecord = row;
    }

    if (!intervalRecord) {
      res.status(404).json({ error: "Not found", message: "Interval not found for this plan" });
      return;
    }

    const planInterval = intervalRecord.interval;

    const subscriberUserId = user.userId;
    const amount           = parseFloat(intervalRecord.amount);

    const now = new Date();
    let status: string;
    let trialEndsAt: Date | null = null;
    let nextBillingAt: Date;
    let passportSubscription: typeof subscriptionsTable.$inferSelect;

    const isDevPlan = plan.pakHash === "dev-api-plan";

    if (plan.hasFreeTrial && plan.trialDurationDays) {
      status        = "trialing";
      trialEndsAt   = new Date(now.getTime() + plan.trialDurationDays * 24 * 60 * 60 * 1000);
      nextBillingAt = trialEndsAt;

      [passportSubscription] = await db.transaction(async (tx) => {
        await tx.update(subscriptionsTable)
          .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
          .where(and(eq(subscriptionsTable.subscriberUserId, subscriberUserId), eq(subscriptionsTable.merchantId, merchantId)));

        return tx.insert(subscriptionsTable).values({
          subscriberUserId,
          planId:           plan.id,
          intervalId:       intervalRecord.id,
          merchantId,
          planInterval,
          amount:           amount.toFixed(6),
          status,
          startedAt:        now,
          trialEndsAt,
          nextBillingAt,
          externalRef:      isDevPlan ? (externalRef?.trim() || null) : null,
          activationMethod: isDevPlan ? "checkout" : "passport",
        }).returning();
      });
    } else {
      // Immediate billing
      if (parseFloat(dbUser.claimedBalance ?? "0") < amount) {
        res.status(402).json({ error: "Insufficient balance", message: "Your account balance is too low to start this subscription" });
        return;
      }

      const newBalance   = (parseFloat(dbUser.claimedBalance ?? "0") - amount).toFixed(6);
      const creatorEmail = plan.paymentEmail.toLowerCase().trim();
      const emailHash    = hashEmail(creatorEmail);

      const [creatorUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, creatorEmail))
        .limit(1);

      status        = "active";
      nextBillingAt = advanceBillingDate(now, planInterval as Interval);

      [passportSubscription] = await db.transaction(async (tx) => {
        await tx.update(subscriptionsTable)
          .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
          .where(and(eq(subscriptionsTable.subscriberUserId, subscriberUserId), eq(subscriptionsTable.merchantId, merchantId)));

        await tx.update(usersTable)
          .set({ claimedBalance: newBalance })
          .where(eq(usersTable.id, subscriberUserId));

        if (creatorUser) {
          const creatorNewBalance = (parseFloat(creatorUser.claimedBalance ?? "0") + amount).toFixed(6);
          await tx.update(usersTable)
            .set({ claimedBalance: creatorNewBalance })
            .where(eq(usersTable.id, creatorUser.id));

          await tx.insert(escrowsTable).values({
            senderAddress:   dbUser.email,
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
            senderAddress:  dbUser.email,
            recipientEmail: creatorEmail,
            emailHash,
            amount:         amount.toFixed(6),
            amountWei:      parseUsdcAmount(amount.toFixed(6)).toString(),
            status:         "pending",
          });
        }

        return tx.insert(subscriptionsTable).values({
          subscriberUserId,
          planId:           plan.id,
          intervalId:       intervalRecord.id,
          merchantId,
          planInterval,
          amount:           amount.toFixed(6),
          status,
          startedAt:        now,
          trialEndsAt:      null,
          nextBillingAt,
          externalRef:      isDevPlan ? (externalRef?.trim() || null) : null,
          activationMethod: isDevPlan ? "checkout" : "passport",
        }).returning();
      });
    }

    // Fire webhook for developer-class plans
    if (isDevPlan) {
      enqueueWebhook(plan.creatorUserId, "subscription.created", {
        subscription_id:    passportSubscription.id,
        merchant_id:        merchantId,
        plan_id:            plan.id,
        plan_name:          plan.planTitle,
        external_ref:       externalRef?.trim() || null,
        interval:           planInterval,
        amount:             amount.toFixed(6),
        currency:           "USD",
        status,
        trial_end:          trialEndsAt?.toISOString() ?? null,
        current_period_end: nextBillingAt.toISOString(),
        created_at:         now.toISOString(),
      }).catch(() => {});
    }

    // Notify subscriber of activation
    try {
      await sendSubscriptionActivatedEmail(
        dbUser.email,
        plan.planTitle,
        amount.toFixed(2),
        planInterval,
        status === "trialing",
        status === "trialing" ? undefined : nextBillingAt,
        trialEndsAt ?? undefined,
      );
    } catch {}

    // Notify creator of new subscriber
    try {
      const activeSubs = await db
        .select({ id: subscriptionsTable.id })
        .from(subscriptionsTable)
        .where(
          and(
            eq(subscriptionsTable.planId, plan.id),
            ne(subscriptionsTable.status, "cancelled"),
            ne(subscriptionsTable.status, "failed"),
          ),
        );
      await sendCreatorNewSubscriberEmail(
        plan.paymentEmail,
        dbUser.email,
        plan.planTitle,
        planInterval,
        activeSubs.length,
      );
    } catch {}

    logger.info(
      { subscriptionId: passportSubscription.id, subscriberUserId, merchantId, status, method: "passport" },
      "[subscriptions] Passport-based subscription activated",
    );

    res.json({
      message:      status === "trialing" ? "Subscription activated — free trial started" : "Subscription activated",
      subscription: { id: passportSubscription.id, status, planTitle: plan.planTitle, planInterval, amount: amount.toFixed(2) },
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[subscriptions] Passport activate error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── DELETE /api/subscriptions/passport ────────────────────────────────────────
// Revokes the caller's Subscription Passport.

router.delete("/passport", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as { userId: number };

    const [passport] = await db
      .select()
      .from(subscriptionPassportsTable)
      .where(eq(subscriptionPassportsTable.userId, user.userId))
      .limit(1);

    if (!passport) {
      res.status(404).json({ error: "Not found", message: "No passport found" });
      return;
    }
    if (passport.status === "revoked") {
      res.status(400).json({ error: "Already revoked", message: "Passport is already revoked" });
      return;
    }

    await db
      .update(subscriptionPassportsTable)
      .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(subscriptionPassportsTable.id, passport.id));

    logger.info({ userId: user.userId }, "[subscriptions] Passport revoked");
    res.json({ message: "Subscription Passport revoked" });
  } catch (err: any) {
    logger.error({ err: err.message }, "[subscriptions] Revoke passport error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── DELETE /api/subscriptions/:id ─────────────────────────────────────────────

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user as { userId: number };
    const id   = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Validation", message: "Invalid subscription ID" });
      return;
    }

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.id, id), eq(subscriptionsTable.subscriberUserId, user.userId)))
      .limit(1);

    if (!sub) {
      res.status(404).json({ error: "Not found", message: "Subscription not found" });
      return;
    }
    if (sub.status === "cancelled" || sub.status === "failed") {
      res.status(400).json({ error: "Already inactive", message: `Subscription is already ${sub.status}` });
      return;
    }

    await db
      .update(subscriptionsTable)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(subscriptionsTable.id, id));

    // Fetch plan + subscriber once for both email notifications
    try {
      const [plan] = await db
        .select()
        .from(subscriptionPlansTable)
        .where(eq(subscriptionPlansTable.id, sub.planId))
        .limit(1);

      const [cancellingUser] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, sub.subscriberUserId))
        .limit(1);

      // Notify subscriber of cancellation
      if (cancellingUser) {
        try { await sendSubscriptionCancelledEmail(cancellingUser.email, plan?.planTitle ?? "your plan"); } catch {}
      }

      // Notify creator of cancellation
      if (plan) {
        const activeSubs = await db
          .select({ id: subscriptionsTable.id })
          .from(subscriptionsTable)
          .where(
            and(
              eq(subscriptionsTable.planId, plan.id),
              ne(subscriptionsTable.status, "cancelled"),
              ne(subscriptionsTable.status, "failed"),
            ),
          );

        try {
          await sendCreatorCancelledEmail(
            plan.paymentEmail,
            cancellingUser?.email ?? "Unknown subscriber",
            plan.planTitle,
            "user-initiated",
            activeSubs.length,
          );
        } catch {}
      }
    } catch (emailErr) {
      logger.warn({ err: emailErr }, "[subscriptions] Failed to send cancellation emails");
    }

    res.json({ message: "Subscription cancelled" });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;
