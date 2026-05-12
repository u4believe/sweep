import { pgTable, serial, text, timestamp, decimal, integer, boolean } from "drizzle-orm/pg-core";

// ─── Subscription Plans (created by the platform user / "creator") ─────────────

export const subscriptionPlansTable = pgTable("subscription_plans", {
  id:                serial("id").primaryKey(),
  creatorUserId:     integer("creator_user_id").notNull(),
  paymentEmail:      text("payment_email").notNull(),
  planTitle:         text("plan_title").notNull(),
  pakHash:           text("pak_hash").notNull(),
  merchantId:        text("merchant_id").notNull().unique(), // one per plan, globally unique
  hasFreeTrial:      boolean("has_free_trial").notNull().default(false),
  trialDurationDays: integer("trial_duration_days"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
});

export type SubscriptionPlan = typeof subscriptionPlansTable.$inferSelect;

// ─── Subscription Intervals (one row per billing cadence per plan) ─────────────
// A plan can have weekly, monthly, and/or yearly intervals simultaneously.
// All intervals share the plan's single Merchant ID.

export const subscriptionIntervalsTable = pgTable("subscription_intervals", {
  id:        serial("id").primaryKey(),
  planId:    integer("plan_id").notNull(),
  tierId:    integer("tier_id"),            // null for flat (no-tier) plans
  interval:  text("interval").notNull(),   // 'weekly' | 'monthly' | 'yearly'
  amount:    decimal("amount", { precision: 20, scale: 6 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type SubscriptionInterval = typeof subscriptionIntervalsTable.$inferSelect;

// ─── Subscription Plan Tiers (optional named pricing tiers per plan) ───────────
// When a plan has tiers, subscribers choose a tier (e.g. Basic/Pro/Team) and then
// pick an interval within that tier. Plans without tiers use the flat interval model.

export const subscriptionPlanTiersTable = pgTable("subscription_plan_tiers", {
  id:            serial("id").primaryKey(),
  planId:        integer("plan_id").notNull(),
  tierName:      text("tier_name").notNull(),
  description:   text("description"),
  features:      text("features").array().notNull().default([]),
  isHighlighted: boolean("is_highlighted").notNull().default(false),
  displayOrder:  integer("display_order").notNull().default(0),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
});

export type SubscriptionPlanTier = typeof subscriptionPlanTiersTable.$inferSelect;

// ─── Confirmation Codes ────────────────────────────────────────────────────────
// Generated in the "Pay Subscription" flow after transaction password + OTP.
// Emailed to subscriber; entered on the hosted subscription page to activate.

export const subscriptionConfirmationCodesTable = pgTable("subscription_confirmation_codes", {
  id:               serial("id").primaryKey(),
  subscriberUserId: integer("subscriber_user_id").notNull(),
  intervalId:       integer("interval_id").notNull(),
  merchantId:       text("merchant_id").notNull(),       // denormalized for fast lookup
  planInterval:     text("plan_interval").notNull(),     // locked at generation time
  codeHash:         text("code_hash").notNull(),         // SHA-256 hex of the plaintext code
  expiresAt:        timestamp("expires_at").notNull(),   // 7 days from generation
  usedAt:           timestamp("used_at"),
  invalidatedAt:    timestamp("invalidated_at"),         // supersession
  createdAt:        timestamp("created_at").notNull().defaultNow(),
});

export type SubscriptionConfirmationCode = typeof subscriptionConfirmationCodesTable.$inferSelect;

// ─── Subscriptions ─────────────────────────────────────────────────────────────
// One row per active or historical subscription per subscriber per merchant.

export const subscriptionsTable = pgTable("subscriptions", {
  id:               serial("id").primaryKey(),
  subscriberUserId: integer("subscriber_user_id").notNull(),
  planId:           integer("plan_id").notNull(),
  intervalId:       integer("interval_id").notNull(),
  merchantId:       text("merchant_id").notNull(),
  planInterval:     text("plan_interval").notNull(),
  amount:           decimal("amount", { precision: 20, scale: 6 }).notNull(),
  // Statuses: active | trialing | past_due | cancelled | failed
  status:           text("status").notNull().default("active"),
  startedAt:        timestamp("started_at").notNull().defaultNow(),
  trialEndsAt:      timestamp("trial_ends_at"),
  nextBillingAt:    timestamp("next_billing_at"),
  retryCount:        integer("retry_count").notNull().default(0),
  lastRetryAt:       timestamp("last_retry_at"),
  cancelledAt:       timestamp("cancelled_at"),
  // Developer API fields — null for Creator-class (UI) activations
  externalRef:       text("external_ref"),         // developer's own user ID (identity bridge)
  activationMethod:  text("activation_method"),    // "confirmation_code" | "passport" | null
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
});

export type Subscription = typeof subscriptionsTable.$inferSelect;

// ─── Subscription Passports ────────────────────────────────────────────────────
// Persistent signed identity token auto-issued after a user's first successful
// subscription activation. Enables single-step passport-based activation on
// all future subscriptions — no confirmation code required.

export const subscriptionPassportsTable = pgTable("subscription_passports", {
  id:              serial("id").primaryKey(),
  userId:          integer("user_id").notNull().unique(),
  status:          text("status").notNull().default("active"),  // "active" | "suspended" | "revoked"
  signature:       text("signature").notNull(),
  issuedAt:        timestamp("issued_at").notNull().defaultNow(),
  suspendedAt:     timestamp("suspended_at"),
  suspendedReason: text("suspended_reason"),
  revokedAt:       timestamp("revoked_at"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

export type SubscriptionPassport = typeof subscriptionPassportsTable.$inferSelect;
