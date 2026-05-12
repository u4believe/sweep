/**
 * GET  /v1/plans          — list all plans for authenticated developer
 * POST /v1/plans          — create a new plan
 * GET  /v1/plans/:id      — retrieve a specific plan
 * PATCH /v1/plans/:id     — update name, description, metadata (amount/interval immutable)
 * DELETE /v1/plans/:id    — archive plan (soft delete, existing subscriptions continue)
 */

import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db, subscriptionPlansTable, subscriptionIntervalsTable, subscriptionsTable, subscriptionPlanTiersTable } from "@workspace/db";
import { eq, and, ne, count } from "drizzle-orm";
import { requireApiKey } from "../../lib/apiKeyAuth.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();
const MERCHANT_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const VALID_INTERVALS  = ["weekly", "monthly", "yearly"] as const;

function generateMerchantId(): string {
  const bytes = crypto.randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += MERCHANT_CHARSET[bytes[i]! % MERCHANT_CHARSET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

type TierInput = {
  tier_name:       string;
  description?:    string;
  features?:       string[];
  is_highlighted?: boolean;
  display_order?:  number;
  intervals:       { interval: string; amount: string | number }[];
};

// ─── Shared plan formatter (handles flat + tiered) ────────────────────────────

async function formatPlan(p: typeof subscriptionPlansTable.$inferSelect) {
  const [countRow] = await db
    .select({ value: count() })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.planId, p.id),
        ne(subscriptionsTable.status, "cancelled"),
        ne(subscriptionsTable.status, "failed"),
      ),
    );

  const planTiers = await db
    .select()
    .from(subscriptionPlanTiersTable)
    .where(eq(subscriptionPlanTiersTable.planId, p.id))
    .orderBy(subscriptionPlanTiersTable.displayOrder);

  const base = {
    plan_id:            p.id,
    merchant_id:        p.merchantId,
    name:               p.planTitle,
    payment_email:      p.paymentEmail,
    has_free_trial:     p.hasFreeTrial,
    trial_days:         p.trialDurationDays ?? 0,
    status:             "active",
    active_subscribers: countRow?.value ?? 0,
    created_at:         p.createdAt,
    updated_at:         p.updatedAt,
  };

  if (planTiers.length > 0) {
    const tiers = await Promise.all(planTiers.map(async (tier) => {
      const ivs = await db
        .select()
        .from(subscriptionIntervalsTable)
        .where(and(
          eq(subscriptionIntervalsTable.planId, p.id),
          eq(subscriptionIntervalsTable.tierId, tier.id),
        ));
      return {
        tier_id:        tier.id,
        tier_name:      tier.tierName,
        description:    tier.description ?? null,
        features:       tier.features,
        is_highlighted: tier.isHighlighted,
        display_order:  tier.displayOrder,
        intervals:      ivs.map((iv) => ({ interval_id: iv.id, interval: iv.interval, amount: iv.amount, currency: "USD" })),
      };
    }));
    return { ...base, is_tiered: true, tiers, intervals: [] };
  }

  const intervals = await db
    .select()
    .from(subscriptionIntervalsTable)
    .where(eq(subscriptionIntervalsTable.planId, p.id));
  return {
    ...base,
    is_tiered: false,
    tiers:     [],
    intervals: intervals.map((iv) => ({ interval_id: iv.id, interval: iv.interval, amount: iv.amount, currency: "USD" })),
  };
}

// ─── GET /v1/plans ────────────────────────────────────────────────────────────

router.get("/", requireApiKey, async (req, res) => {
  try {
    const dev    = req.developer!;
    const plans  = await db
      .select()
      .from(subscriptionPlansTable)
      .where(
        and(
          eq(subscriptionPlansTable.creatorUserId, dev.developerId),
          eq(subscriptionPlansTable.pakHash, "dev-api-plan"),
        ),
      );

    const result = await Promise.all(plans.map((p) => formatPlan(p)));

    res.json({ plans: result, total: result.length });
  } catch (err: any) {
    logger.error({ err: err.message }, "[v1/plans] GET / error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /v1/plans ───────────────────────────────────────────────────────────

router.post("/", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const { name, payment_email, intervals, tiers, has_free_trial, trial_days } = req.body as {
      name?:           string;
      payment_email?:  string;
      intervals?:      { interval: string; amount: string | number }[];
      tiers?:          TierInput[];
      has_free_trial?: boolean;
      trial_days?:     number;
    };

    const isTiered = Array.isArray(tiers) && tiers.length > 0;

    if (!name?.trim()) {
      res.status(400).json({ error: "Validation", message: "name is required" });
      return;
    }
    if (!payment_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payment_email)) {
      res.status(400).json({ error: "Validation", message: "Valid payment_email is required" });
      return;
    }
    if (has_free_trial && (!trial_days || trial_days < 1)) {
      res.status(400).json({ error: "Validation", message: "trial_days must be ≥ 1 when has_free_trial is true" });
      return;
    }

    if (isTiered) {
      if (tiers!.length > 5) {
        res.status(400).json({ error: "Validation", message: "A plan can have at most 5 tiers" });
        return;
      }
      for (const tier of tiers!) {
        if (!tier.tier_name?.trim()) {
          res.status(400).json({ error: "Validation", message: "Each tier must have a name" });
          return;
        }
        if (!Array.isArray(tier.intervals) || tier.intervals.length === 0) {
          res.status(400).json({ error: "Validation", message: `Tier "${tier.tier_name}" needs at least one interval` });
          return;
        }
        for (const iv of tier.intervals) {
          if (!VALID_INTERVALS.includes(iv.interval as any)) {
            res.status(400).json({ error: "Validation", message: `Invalid interval "${iv.interval}" in tier "${tier.tier_name}"` });
            return;
          }
          if (isNaN(parseFloat(String(iv.amount))) || parseFloat(String(iv.amount)) <= 0) {
            res.status(400).json({ error: "Validation", message: `Each interval in tier "${tier.tier_name}" must have a positive amount` });
            return;
          }
        }
      }
    } else {
      if (!Array.isArray(intervals) || intervals.length === 0) {
        res.status(400).json({ error: "Validation", message: "At least one interval is required (or provide tiers for a tiered plan)" });
        return;
      }
      for (const iv of intervals) {
        if (!VALID_INTERVALS.includes(iv.interval as any)) {
          res.status(400).json({ error: "Validation", message: `Invalid interval: ${iv.interval}` });
          return;
        }
        if (isNaN(parseFloat(String(iv.amount))) || parseFloat(String(iv.amount)) <= 0) {
          res.status(400).json({ error: "Validation", message: "Each interval must have a positive amount" });
          return;
        }
      }
    }

    // Generate unique merchant ID
    let merchantId: string;
    let attempts = 0;
    while (true) {
      merchantId = generateMerchantId();
      const dup = await db.select({ id: subscriptionPlansTable.id })
        .from(subscriptionPlansTable)
        .where(eq(subscriptionPlansTable.merchantId, merchantId))
        .limit(1);
      if (dup.length === 0) break;
      if (++attempts > 10) throw new Error("Could not generate unique Merchant ID");
    }

    const [plan] = await db.insert(subscriptionPlansTable).values({
      creatorUserId:     dev.developerId,
      paymentEmail:      payment_email.toLowerCase().trim(),
      planTitle:         name.trim(),
      pakHash:           "dev-api-plan",
      merchantId:        merchantId!,
      hasFreeTrial:      has_free_trial ?? false,
      trialDurationDays: has_free_trial ? trial_days : null,
    }).returning();

    if (isTiered) {
      for (let i = 0; i < tiers!.length; i++) {
        const tierInput = tiers![i]!;
        const [tier] = await db.insert(subscriptionPlanTiersTable).values({
          planId:        plan!.id,
          tierName:      tierInput.tier_name.trim(),
          description:   tierInput.description?.trim() || null,
          features:      tierInput.features ?? [],
          isHighlighted: tierInput.is_highlighted ?? false,
          displayOrder:  tierInput.display_order ?? i,
        }).returning();

        for (const iv of tierInput.intervals) {
          await db.insert(subscriptionIntervalsTable).values({
            planId:   plan!.id,
            tierId:   tier!.id,
            interval: iv.interval,
            amount:   parseFloat(String(iv.amount)).toFixed(6),
          });
        }
      }
      logger.info({ planId: plan!.id, developerId: dev.developerId, tiers: tiers!.length }, "[v1/plans] Tiered plan created");
    } else {
      for (const iv of intervals!) {
        await db.insert(subscriptionIntervalsTable).values({
          planId:   plan!.id,
          interval: iv.interval,
          amount:   parseFloat(String(iv.amount)).toFixed(6),
        });
      }
      logger.info({ planId: plan!.id, developerId: dev.developerId }, "[v1/plans] Flat plan created");
    }

    res.status(201).json(await formatPlan(plan!));
  } catch (err: any) {
    logger.error({ err: err.message }, "[v1/plans] POST / error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /v1/plans/:id ────────────────────────────────────────────────────────

router.get("/:id", requireApiKey, async (req, res) => {
  try {
    const dev    = req.developer!;
    const planId = parseInt(String(req.params["id"]), 10);
    if (isNaN(planId)) {
      res.status(400).json({ error: "Validation", message: "Invalid plan ID" });
      return;
    }

    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(
        and(
          eq(subscriptionPlansTable.id, planId),
          eq(subscriptionPlansTable.creatorUserId, dev.developerId),
          eq(subscriptionPlansTable.pakHash, "dev-api-plan"),
        ),
      )
      .limit(1);

    if (!plan) {
      res.status(404).json({ error: "Not found", message: "Plan not found" });
      return;
    }

    res.json(await formatPlan(plan));
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── PATCH /v1/plans/:id ─────────────────────────────────────────────────────

router.patch("/:id", requireApiKey, async (req, res) => {
  try {
    const dev    = req.developer!;
    const planId = parseInt(String(req.params["id"]), 10);
    if (isNaN(planId)) {
      res.status(400).json({ error: "Validation", message: "Invalid plan ID" });
      return;
    }

    const { name, payment_email } = req.body as { name?: string; payment_email?: string };

    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(
        and(
          eq(subscriptionPlansTable.id, planId),
          eq(subscriptionPlansTable.creatorUserId, dev.developerId),
          eq(subscriptionPlansTable.pakHash, "dev-api-plan"),
        ),
      )
      .limit(1);

    if (!plan) {
      res.status(404).json({ error: "Not found", message: "Plan not found" });
      return;
    }

    const updates: Partial<typeof subscriptionPlansTable.$inferInsert> = { updatedAt: new Date() };
    if (name?.trim())         updates.planTitle    = name.trim();
    if (payment_email?.trim()) updates.paymentEmail = payment_email.toLowerCase().trim();

    await db.update(subscriptionPlansTable).set(updates).where(eq(subscriptionPlansTable.id, planId));

    res.json({ message: "Plan updated", plan_id: planId });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── DELETE /v1/plans/:id ────────────────────────────────────────────────────

router.delete("/:id", requireApiKey, async (req, res) => {
  try {
    const dev    = req.developer!;
    const planId = parseInt(String(req.params["id"]), 10);
    if (isNaN(planId)) {
      res.status(400).json({ error: "Validation", message: "Invalid plan ID" });
      return;
    }

    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(
        and(
          eq(subscriptionPlansTable.id, planId),
          eq(subscriptionPlansTable.creatorUserId, dev.developerId),
          eq(subscriptionPlansTable.pakHash, "dev-api-plan"),
        ),
      )
      .limit(1);

    if (!plan) {
      res.status(404).json({ error: "Not found", message: "Plan not found" });
      return;
    }

    // Soft delete — existing subscriptions continue
    await db.update(subscriptionPlansTable)
      .set({ updatedAt: new Date() })
      .where(eq(subscriptionPlansTable.id, planId));

    res.json({ message: "Plan archived. Existing subscriptions will continue until cancelled." });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;