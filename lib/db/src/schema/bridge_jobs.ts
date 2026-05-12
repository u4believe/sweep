import { pgTable, serial, integer, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Tracks every CCTP bridge job that moves USDC from a user's source-chain wallet
 * to the platform's Arc Testnet treasury via App Kit + Circle Forwarding Service.
 *
 * Lifecycle: pending → processing → completed | failed
 * Retry: up to MAX_ATTEMPTS with exponential back-off (see bridgeWorker.ts)
 */
export const bridgeJobsTable = pgTable("bridge_jobs", {
  id: serial("id").primaryKey(),

  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  // Source chain the user deposited on (e.g. "BASE-SEPOLIA", "ETH-SEPOLIA")
  sourceChain: text("source_chain").notNull(),

  // User's Circle DCW wallet address on the source chain
  userWalletAddress: text("user_wallet_address").notNull(),

  // Amount of USDC to bridge (human-readable, 6 dp — e.g. "10.000000")
  amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),

  // Source-chain deposit tx hash that triggered this job (idempotency key)
  txHash: text("tx_hash").unique(),

  // Job state machine
  status: text("status").notNull().default("pending"),
  // pending    — waiting to be picked up by bridge worker
  // processing — worker has started; lock acquired
  // completed  — kit.bridge() succeeded; USDC arrived at Arc treasury
  // failed     — exhausted all retry attempts

  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),

  // Serialised summary of kit.bridge() result steps (for audit/debugging)
  bridgeResultJson: text("bridge_result_json"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BridgeJob = typeof bridgeJobsTable.$inferSelect;
export type InsertBridgeJob = typeof bridgeJobsTable.$inferInsert;
