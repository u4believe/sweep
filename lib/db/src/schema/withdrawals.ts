import { pgTable, serial, text, timestamp, decimal, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const withdrawalsTable = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: decimal("amount", { precision: 20, scale: 6 }).notNull(),
  type: text("type").notNull(), // crypto, fiat
  destination: text("destination").notNull(), // wallet address or bank account
  // status lifecycle: processing → completed | failed
  // "processing" is written before the Circle call; the reconciliation worker
  // uses it to detect and recover from server crashes mid-withdrawal.
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  txHash: text("tx_hash"),
  circleTransferId: text("circle_transfer_id"),
  // Stored before calling Circle so the reconciliation worker can replay the
  // same request idempotently and determine whether Circle processed it.
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertWithdrawalSchema = createInsertSchema(withdrawalsTable).omit({ id: true, createdAt: true });
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawalsTable.$inferSelect;
