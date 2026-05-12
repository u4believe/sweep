import { Router, type IRouter } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, usersTable, withdrawalsTable, escrowsTable } from "@workspace/db";
import { eq, and, sql, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { requireAuth, requireEmailVerified } from "../lib/auth.js";
import { hashEmail, parseUsdcAmount } from "../lib/escrow.js";
import {
  circleTransferUsdc,
  getPlatformWalletAddress,
  initiateWireTransfer,
  resolveCircleOnChainTxHash,
} from "../lib/circle.js";
import { WithdrawCryptoBody, WithdrawFiatBodySecure } from "@workspace/api-zod";
import {
  sendWithdrawalCryptoEmail,
  sendWithdrawalFiatEmail,
  sendTransferSentEmail,
  sendTransferReceivedEmail,
} from "../lib/email.js";

const router: IRouter = Router();

const WITHDRAWAL_FEE = 0.10; // $0.10 USDC flat fee per external crypto withdrawal

const withdrawalLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             3,
  keyGenerator:    (req) => String((req as any).user?.userId ?? ipKeyGenerator(req)),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: "Too many requests", message: "Too many withdrawal attempts. Please wait a minute." },
});

// Atomically deduct `amount` from a user's claimedBalance only if the balance
// is sufficient. Returns the new balance string, or null if the update matched
// zero rows (balance too low, or a concurrent request already deducted it).
async function atomicDeduct(userId: number, amount: number): Promise<string | null> {
  const result = await db
    .update(usersTable)
    .set({
      claimedBalance: sql`${usersTable.claimedBalance} - ${amount}`,
    })
    .where(
      and(
        eq(usersTable.id, userId),
        sql`${usersTable.claimedBalance} >= ${amount}`,
      ),
    )
    .returning({ newBalance: usersTable.claimedBalance });
  return result[0]?.newBalance ?? null;
}

// Atomically restore `amount` to a user's claimedBalance.
async function atomicRestore(userId: number, amount: number): Promise<void> {
  await db
    .update(usersTable)
    .set({
      claimedBalance: sql`${usersTable.claimedBalance} + ${amount}`,
    })
    .where(eq(usersTable.id, userId));
}

// ─── POST /api/withdraw/crypto ────────────────────────────────────────────────
// Sends USDC from the Arc Testnet platform treasury to the user's wallet.
// Arc Testnet is the primary treasury — all deposits land here and all
// withdrawals are sent from here via Circle DCW.
//
// Idempotency / crash-safety design:
//   1. Validate inputs and transaction password.
//   2. Atomic DB deduction — single UPDATE WHERE balance >= total; fails if
//      balance is insufficient OR a concurrent request already deducted.
//   3. Insert withdrawal record as "processing" with a stored idempotencyKey
//      BEFORE calling Circle. If the server crashes after this point, the
//      reconciliation worker (withdrawalReconciliationWorker.ts) will replay
//      the Circle call with the same key and settle the record.
//   4. Call Circle. On success → mark "completed". On error → mark "failed"
//      and atomically restore the balance.
router.post("/crypto", requireAuth, requireEmailVerified, withdrawalLimiter, async (req, res) => {
  try {
    const user = (req as any).user;
    const parsed = WithdrawCryptoBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }

    const { walletAddress, amount } = parsed.data;
    const withdrawAmount = parseFloat(amount);
    const totalDeducted  = withdrawAmount + WITHDRAWAL_FEE;

    if (withdrawAmount <= 0) {
      res.status(400).json({ error: "Invalid amount", message: "Amount must be positive" });
      return;
    }

    // Transaction password check (reads user row — before the atomic deduct)
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId)).limit(1);
    if (dbUser?.transactionPasswordHash) {
      const txnPwd = typeof req.body.transactionPassword === "string" ? req.body.transactionPassword : "";
      if (!txnPwd) {
        res.status(403).json({ error: "Transaction password required", message: "Please enter your transaction password to authorize this withdrawal" });
        return;
      }
      const valid = await bcrypt.compare(txnPwd, dbUser.transactionPasswordHash);
      if (!valid) {
        res.status(403).json({ error: "Invalid transaction password", message: "The transaction password you entered is incorrect" });
        return;
      }
    }

    const platformAddress = getPlatformWalletAddress();
    if (!platformAddress) {
      res.status(503).json({ error: "Not configured", message: "CIRCLE_PLATFORM_WALLET_ADDRESS is not set" });
      return;
    }

    // ── Internal transfer: destination is another platform user's wallet ───────
    // Skip the on-chain Circle transfer entirely and credit the recipient directly.
    // This is instant, fee-free, and doesn't depend on chain RPC availability.
    const [internalRecipient] = await db
      .select({ id: usersTable.id, email: usersTable.email, claimedBalance: usersTable.claimedBalance })
      .from(usersTable)
      .where(
        and(
          sql`lower(${usersTable.circleWalletAddress}) = lower(${walletAddress})`,
          ne(usersTable.id, user.userId),
        ),
      )
      .limit(1);

    if (internalRecipient) {
      // No withdrawal fee for internal platform transfers
      const internalNewBalance = await atomicDeduct(user.userId, withdrawAmount);
      if (internalNewBalance === null) {
        res.status(400).json({
          error: "Insufficient balance",
          message: `You need at least $${withdrawAmount.toFixed(2)} for this transfer.`,
        });
        return;
      }

      // Use SQL increment — safe against concurrent transfers to the same recipient
      const [updatedRecipient] = await db.update(usersTable)
        .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${withdrawAmount}` })
        .where(eq(usersTable.id, internalRecipient.id))
        .returning({ newBalance: usersTable.claimedBalance });

      const senderEmail  = dbUser?.email ?? user.email;
      const recipientBal = updatedRecipient?.newBalance ?? "0";

      // Record in escrowsTable so both sender and recipient see it in history
      await db.insert(escrowsTable).values({
        senderAddress:   senderEmail,
        recipientEmail:  internalRecipient.email,
        emailHash:       hashEmail(internalRecipient.email),
        amount:          withdrawAmount.toFixed(6),
        amountWei:       parseUsdcAmount(withdrawAmount.toFixed(6)).toString(),
        status:          "claimed",
        recipientUserId: internalRecipient.id,
        claimedAt:       new Date(),
        txHash:          null,
      });

      sendTransferSentEmail(senderEmail, internalRecipient.email, amount, internalNewBalance).catch(() => {});
      sendTransferReceivedEmail(internalRecipient.email, senderEmail, amount, recipientBal).catch(() => {});

      req.log.info(
        { from: user.userId, to: internalRecipient.id, amount },
        "[withdraw] Internal platform transfer completed",
      );

      res.json({
        success:        true,
        internal:       true,
        recipientEmail: internalRecipient.email,
        amount,
        newBalance:     internalNewBalance,
        message:        `$${withdrawAmount.toFixed(2)} transferred to ${internalRecipient.email}`,
      });
      return;
    }

    // ── 1. Atomic deduction ───────────────────────────────────────────────────
    // Single UPDATE WHERE balance >= total. If two requests arrive simultaneously
    // only one can match — PostgreSQL row-level locking serialises them.
    const newBalance = await atomicDeduct(user.userId, totalDeducted);
    if (newBalance === null) {
      res.status(400).json({
        error: "Insufficient balance",
        message: `You need at least $${totalDeducted.toFixed(2)} (amount + $${WITHDRAWAL_FEE.toFixed(2)} fee).`,
      });
      return;
    }

    // ── 2. Pre-insert withdrawal record as "processing" ───────────────────────
    // Written before the Circle call so the reconciliation worker can recover
    // if the server crashes between the deduction and the Circle response.
    const idempotencyKey = randomUUID();
    const [withdrawal] = await db.insert(withdrawalsTable).values({
      userId:         user.userId,
      amount,
      type:           "crypto",
      destination:    walletAddress,
      status:         "processing",
      idempotencyKey,
    }).returning({ id: withdrawalsTable.id });

    // ── 3. Circle transfer ────────────────────────────────────────────────────
    let txHash: string;
    try {
      txHash = await circleTransferUsdc(
        platformAddress,
        walletAddress,
        "ARC-TESTNET",
        "",
        amount,
        idempotencyKey,
      );
      req.log.info({ txHash, amount, walletAddress }, "[withdraw] Circle USDC transfer initiated");
    } catch (chainError: any) {
      // Circle failed — restore balance and mark the record failed
      await atomicRestore(user.userId, totalDeducted);
      await db.update(withdrawalsTable)
        .set({ status: "failed" })
        .where(eq(withdrawalsTable.id, withdrawal.id));
      req.log.error({ err: chainError.message, amount, walletAddress }, "[withdraw] Transfer failed — balance restored");
      res.status(502).json({ error: "Transfer failed", message: chainError.message });
      return;
    }

    // ── 4. Resolve real on-chain hash ─────────────────────────────────────────
    // `txHash` from Circle is their internal UUID. The actual 0x… blockchain hash
    // is set once the tx is confirmed (usually a few seconds). Try to fetch it now;
    // the reconciliation worker will retry for any that are still pending.
    const onChainHash = await resolveCircleOnChainTxHash(txHash).catch(() => null);

    await db.update(withdrawalsTable)
      .set({
        status:           "completed",
        circleTransferId: txHash,
        txHash:           onChainHash ?? null,
        completedAt:      new Date(),
      })
      .where(eq(withdrawalsTable.id, withdrawal.id));

    sendWithdrawalCryptoEmail(dbUser.email, amount, WITHDRAWAL_FEE.toFixed(2), walletAddress).catch(() => {});

    res.json({
      txHash:      onChainHash ?? txHash,
      circleTxId:  txHash,
      amount,
      fee:         WITHDRAWAL_FEE.toFixed(2),
      newBalance,
      blockchain:  "ARC-TESTNET",
      message:     `Withdrew ${withdrawAmount.toFixed(2)} USDC to ${walletAddress} on ARC-TESTNET`,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "[withdraw] Crypto withdrawal error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── POST /api/withdraw/fiat ──────────────────────────────────────────────────
router.post("/fiat", requireAuth, requireEmailVerified, withdrawalLimiter, async (req, res) => {
  try {
    const user = (req as any).user;
    const parsed = WithdrawFiatBodySecure.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }

    const { amount, bankAccountNumber, routingNumber, accountHolderName, country } = parsed.data as any;
    const withdrawAmount = parseFloat(amount);

    if (withdrawAmount <= 0) {
      res.status(400).json({ error: "Invalid amount", message: "Amount must be positive" });
      return;
    }

    const [fiatUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId)).limit(1);
    const claimedBalance = parseFloat(fiatUser?.claimedBalance ?? "0");

    if (withdrawAmount > claimedBalance) {
      res.status(400).json({
        error: "Insufficient balance",
        message: `You only have $${claimedBalance.toFixed(2)} available. Requested $${withdrawAmount.toFixed(2)}.`,
      });
      return;
    }

    const newBalance = (claimedBalance - withdrawAmount).toFixed(6);
    await db.update(usersTable).set({ claimedBalance: newBalance }).where(eq(usersTable.id, user.userId));

    const { transferId, status } = await initiateWireTransfer(withdrawAmount.toFixed(2), {
      bankAccountNumber,
      routingNumber,
      accountHolderName,
      country: country ?? "US",
    });

    req.log.info({ transferId, status, amount }, "[withdraw] Circle payout initiated");

    const fiatDestination = `Bank ****${bankAccountNumber.slice(-4)} (routing: ${routingNumber})`;

    await db.insert(withdrawalsTable).values({
      userId:           user.userId,
      amount,
      type:             "fiat",
      destination:      fiatDestination,
      status:           "pending",
      circleTransferId: transferId,
    });

    sendWithdrawalFiatEmail(fiatUser.email, amount, fiatDestination).catch(() => {});

    res.json({
      transferId,
      amount,
      status,
      newBalance,
      estimatedArrival: "1–3 business days",
      message:          `Initiated $${withdrawAmount.toFixed(2)} USD wire transfer via Circle`,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "[withdraw] Fiat withdrawal error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

export default router;
