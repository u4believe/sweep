import { pgTable, serial, integer, text, bigint, timestamp } from "drizzle-orm/pg-core";

// Passkeys (Face ID / fingerprint) registered by a user, one row per device.
// Created at startup by runStartupMigrations (CREATE TABLE IF NOT EXISTS).
export const webauthnCredentialsTable = pgTable("webauthn_credentials", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull(),
  credentialId: text("credential_id").notNull().unique(), // base64url
  publicKey:    text("public_key").notNull(),            // base64url COSE key
  counter:      bigint("counter", { mode: "number" }).notNull().default(0),
  transports:   text("transports"),                      // comma-separated
  deviceName:   text("device_name"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  lastUsedAt:   timestamp("last_used_at"),
});

export type WebauthnCredential = typeof webauthnCredentialsTable.$inferSelect;
