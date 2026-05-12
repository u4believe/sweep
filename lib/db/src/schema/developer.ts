import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

// ─── Developer Accounts ────────────────────────────────────────────────────────
// Separate from regular user accounts. Developers register on the Developer
// Portal to access the /v1/ API and receive subscription webhooks.

export const developersTable = pgTable("developers", {
  id:            serial("id").primaryKey(),
  email:         text("email").notNull().unique(),
  passwordHash:  text("password_hash").notNull(),
  name:          text("name").notNull(),
  merchantId:    text("merchant_id").notNull().unique(), // XXXX-XXXX-XXXX, globally unique
  paymentEmail:  text("payment_email").notNull(),
  emailVerified:         boolean("email_verified").notNull().default(false),
  resetToken:            text("reset_token"),             // SHA-256 hex of the plaintext reset token
  resetTokenExpiresAt:   timestamp("reset_token_expires_at"),
  createdAt:             timestamp("created_at").notNull().defaultNow(),
  updatedAt:             timestamp("updated_at").notNull().defaultNow(),
});

export type Developer = typeof developersTable.$inferSelect;

// ─── Developer API Keys ────────────────────────────────────────────────────────
// Each developer can have multiple API keys (test + live).
// The actual key is shown to the developer once on creation; we store only
// a SHA-256 hex hash for fast lookup without storing the plaintext.

export const developerApiKeysTable = pgTable("developer_api_keys", {
  id:          serial("id").primaryKey(),
  developerId: integer("developer_id").notNull(),
  keyHash:     text("key_hash").notNull().unique(),  // SHA-256 hex of the raw key
  keyPrefix:   text("key_prefix").notNull(),          // first 20 chars for display (e.g. live_sk_abc123...)
  type:        text("type").notNull(),                // "live" | "test"
  label:       text("label").notNull().default("Default"),
  active:      boolean("active").notNull().default(true),
  lastUsedAt:  timestamp("last_used_at"),
  revokedAt:   timestamp("revoked_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export type DeveloperApiKey = typeof developerApiKeysTable.$inferSelect;

// ─── Subscription Payments ────────────────────────────────────────────────────
// One row per billing attempt for auditability and developer reporting.

export const subscriptionPaymentsTable = pgTable("subscription_payments", {
  id:             serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull(),
  merchantId:     text("merchant_id").notNull(),    // denormalized for fast lookup
  amount:         text("amount").notNull(),
  currency:       text("currency").notNull().default("USD"),
  status:         text("status").notNull(),          // "succeeded" | "failed" | "pending" | "refunded"
  failureReason:  text("failure_reason"),
  attemptedAt:    timestamp("attempted_at").notNull().defaultNow(),
});

export type SubscriptionPayment = typeof subscriptionPaymentsTable.$inferSelect;

// ─── Webhook Endpoints ────────────────────────────────────────────────────────
// Developer-registered URLs that receive subscription event payloads.
// secret is stored in plaintext (it is used for HMAC signing, not password auth).

export const webhookEndpointsTable = pgTable("webhook_endpoints", {
  id:          serial("id").primaryKey(),
  developerId: integer("developer_id").notNull(),
  url:         text("url").notNull(),
  secret:      text("secret").notNull(),       // HMAC-SHA256 signing secret
  label:       text("label").notNull().default("Default"),
  active:      boolean("active").notNull().default(true),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type WebhookEndpoint = typeof webhookEndpointsTable.$inferSelect;

// ─── Webhook Events (delivery log) ────────────────────────────────────────────
// One row per event per endpoint. Tracks delivery attempts and status.

export const webhookEventsTable = pgTable("webhook_events", {
  id:             serial("id").primaryKey(),
  developerId:    integer("developer_id").notNull(),
  endpointId:     integer("endpoint_id").notNull(),
  eventId:        text("event_id").notNull().unique(),  // UUID — idempotency key
  eventType:      text("event_type").notNull(),
  payload:        text("payload").notNull(),             // serialized JSON
  attemptCount:   integer("attempt_count").notNull().default(0),
  maxAttempts:    integer("max_attempts").notNull().default(5),
  nextRetryAt:    timestamp("next_retry_at"),
  deliveredAt:    timestamp("delivered_at"),             // null until successfully delivered
  lastStatusCode: integer("last_status_code"),
  lastError:      text("last_error"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export type WebhookEvent = typeof webhookEventsTable.$inferSelect;