/**
 * Ledger helpers — the only safe way to move claimedBalance between users.
 *
 * Every balance change is a single atomic SQL increment/decrement evaluated
 * against the row's *current* value. Never compute a new balance in JS from a
 * previously-read row and write it back: two writes to the same row (e.g. a
 * user paying themselves, or two concurrent requests) will overwrite each
 * other and create or destroy money.
 */

import { db, usersTable, escrowsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { hashEmail, parseUsdcAmount } from "./escrow.js";

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = DbTx | typeof db;

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Insufficient balance");
    this.name = "InsufficientBalanceError";
  }
}

export class SelfPaymentError extends Error {
  constructor() {
    super("You cannot subscribe to or pay your own plan");
    this.name = "SelfPaymentError";
  }
}

function toAmountStr(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ledger amount: ${amount}`);
  return n.toFixed(6);
}

/** Atomically deduct `amount` only if the balance covers it. Throws InsufficientBalanceError otherwise. */
export async function debitBalance(ex: Executor, userId: number, amount: number | string): Promise<string> {
  const amt = toAmountStr(amount);
  const [row] = await ex
    .update(usersTable)
    .set({ claimedBalance: sql`${usersTable.claimedBalance} - ${amt}::numeric` })
    .where(and(eq(usersTable.id, userId), sql`${usersTable.claimedBalance} >= ${amt}::numeric`))
    .returning({ newBalance: usersTable.claimedBalance });
  if (!row) throw new InsufficientBalanceError();
  return row.newBalance;
}

/** Atomically add `amount` to the user's balance. */
export async function creditBalance(ex: Executor, userId: number, amount: number | string): Promise<string> {
  const amt = toAmountStr(amount);
  const [row] = await ex
    .update(usersTable)
    .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${amt}::numeric` })
    .where(eq(usersTable.id, userId))
    .returning({ newBalance: usersTable.claimedBalance });
  if (!row) throw new Error(`creditBalance: user ${userId} not found`);
  return row.newBalance;
}

/** True when the subscriber would be paying themselves (plan creator or payout account). */
export function isSelfSubscription(
  subscriber: { id: number; email: string },
  plan: { creatorUserId: number; paymentEmail: string },
): boolean {
  return (
    subscriber.id === plan.creatorUserId ||
    subscriber.email.toLowerCase().trim() === plan.paymentEmail.toLowerCase().trim()
  );
}

/**
 * Charge a subscriber for a plan and pay the plan's payout account, inside `tx`.
 * Throws SelfPaymentError / InsufficientBalanceError — the caller's transaction rolls back.
 */
export async function chargeSubscription(
  tx: DbTx,
  subscriber: { id: number; email: string },
  plan: { creatorUserId: number; paymentEmail: string },
  amount: number | string,
  now: Date = new Date(),
): Promise<void> {
  const amt            = toAmountStr(amount);
  const recipientEmail = plan.paymentEmail.toLowerCase().trim();
  const emailHash      = hashEmail(recipientEmail);

  const [recipient] = await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, recipientEmail))
    .limit(1);

  if (isSelfSubscription(subscriber, plan) || recipient?.id === subscriber.id) {
    throw new SelfPaymentError();
  }

  await debitBalance(tx, subscriber.id, amt);

  if (recipient) {
    await creditBalance(tx, recipient.id, amt);
    await tx.insert(escrowsTable).values({
      senderAddress:   subscriber.email,
      recipientEmail,
      emailHash,
      amount:          amt,
      amountWei:       parseUsdcAmount(amt).toString(),
      status:          "claimed",
      recipientUserId: recipient.id,
      claimedAt:       now,
    });
  } else {
    await tx.insert(escrowsTable).values({
      senderAddress:  subscriber.email,
      recipientEmail,
      emailHash,
      amount:         amt,
      amountWei:      parseUsdcAmount(amt).toString(),
      status:         "pending",
    });
  }
}

/**
 * Credits every pending escrow sent to `email` before the user signed up.
 * The status guard makes this safe to call concurrently — each escrow is claimed once.
 */
export async function claimPendingEscrows(userId: number, email: string): Promise<{ total: number; count: number }> {
  const emailHash = hashEmail(email);
  return db.transaction(async (tx) => {
    const claimed = await tx.update(escrowsTable)
      .set({ status: "claimed", recipientUserId: userId, claimedAt: new Date() })
      .where(and(eq(escrowsTable.emailHash, emailHash), eq(escrowsTable.status, "pending")))
      .returning({ amount: escrowsTable.amount });
    const total = claimed.reduce((sum, e) => sum + parseFloat(e.amount), 0);
    if (total > 0) await creditBalance(tx, userId, total);
    return { total, count: claimed.length };
  });
}
