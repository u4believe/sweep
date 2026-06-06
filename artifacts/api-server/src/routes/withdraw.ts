import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db, usersTable, withdrawalsTable, escrowsTable } from "@workspace/db";
import { eq, and, sql, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { requireAuth, requireEmailVerified } from "../lib/auth.js";
import { hashEmail, parseUsdcAmount } from "../lib/escrow.js";
import {
  initiateWireTransfer,
} from "../lib/circle.js";
import { WithdrawFiatBodySecure } from "@workspace/api-zod";
import {
  sendWithdrawalCryptoEmail,
  sendWithdrawalFiatEmail,
  sendTransferSentEmail,
  sendTransferReceivedEmail,
} from "../lib/email.js";
import {
  gatewayWithdrawal,
  directTreasuryTransfer,
  getTreasuryChainBalance,
  GATEWAY_SUPPORTED_CHAINS,
} from "../lib/gatewaySweep.js";
import {
  getChain,
  validateWithdrawal,
  netWithdrawalAmount,
  type ChainKey,
} from "../lib/gatewayConfig.js";

const router: IRouter = Router();

const withdrawalLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             3,
  keyGenerator:    (req) => String((req as any).user?.userId ?? "unknown"),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: "Too many requests", message: "Too many withdrawal attempts. Please wait a minute." },
});

// Atomically deduct `amount` from claimedBalance only if balance is sufficient.
// Returns the new balance string, or null if balance is too low.
async function atomicDeduct(userId: number, amount: number): Promise<string | null> {
  const result = await db
    .update(usersTable)
    .set({ claimedBalance: sql`${usersTable.claimedBalance} - ${amount}` })
    .where(
      and(
        eq(usersTable.id, userId),
        sql`${usersTable.claimedBalance} >= ${amount}`,
      ),
    )
    .returning({ newBalance: usersTable.claimedBalance });
  return result[0]?.newBalance ?? null;
}

// Atomically restore `amount` to claimedBalance.
async function atomicRestore(userId: number, amount: number): Promise<void> {
  await db
    .update(usersTable)
    .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${amount}` })
    .where(eq(usersTable.id, userId));
}

// ─── POST /api/withdraw/crypto ────────────────────────────────────────────────
// Sends USDC from the treasury Unified Balance to any supported chain address
// via the Circle Gateway Forwarding Service.
//
// Fee model: platform deducts the gross amount from the user's balance.
// The user receives (gross - platformFee) on-chain; the fee stays in treasury.
//
// Idempotency / crash-safety:
//   1. Validate inputs and transaction password.
//   2. Atomic DB deduction — fails fast on insufficient balance.
//   3. Pre-insert withdrawal record as "processing" with idempotencyKey.
//   4. Submit burn intent via Gateway API. On success → mark "completed".
//      On error → restore balance, mark "failed".
//   The gateway.mint.finalized webhook backfills the on-chain txHash.
router.post("/crypto", requireAuth, requireEmailVerified, withdrawalLimiter, async (req, res) => {
  try {
    const user = (req as any).user;
    const { walletAddress, amount, chainKey, transactionPassword } = req.body ?? {};

    // ── Input validation ──────────────────────────────────────────────────────
    if (!walletAddress || typeof walletAddress !== "string" || walletAddress.trim().length < 2) {
      res.status(400).json({ error: "Validation error", message: "walletAddress is required" });
      return;
    }
    if (!chainKey || typeof chainKey !== "string") {
      res.status(400).json({ error: "Validation error", message: "chainKey is required (e.g. BASE-SEPOLIA)" });
      return;
    }
    const grossAmount = parseFloat(amount);
    if (!amount || isNaN(grossAmount) || grossAmount <= 0) {
      res.status(400).json({ error: "Validation error", message: "Amount must be a positive number" });
      return;
    }
    if (grossAmount < 1) {
      res.status(400).json({ error: "Validation error", message: "Minimum transfer amount is $1.00 USDC" });
      return;
    }

    // ── Chain + amount validation ─────────────────────────────────────────────
    const { valid, error: chainError } = validateWithdrawal(chainKey, grossAmount);
    if (!valid) {
      res.status(400).json({ error: "Validation error", message: chainError });
      return;
    }

    const chain      = getChain(chainKey);
    const netAmount  = netWithdrawalAmount(chain, grossAmount); // what user receives on-chain
    const fee        = chain.platformFee;

    // ── Transaction password check ────────────────────────────────────────────
    const [dbUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, user.userId))
      .limit(1);

    if (dbUser?.transactionPasswordHash) {
      const txnPwd = typeof transactionPassword === "string" ? transactionPassword : "";
      if (!txnPwd) {
        res.status(403).json({
          error:   "Transaction password required",
          message: "Please enter your transaction password to authorize this withdrawal",
        });
        return;
      }
      const match = await bcrypt.compare(txnPwd, dbUser.transactionPasswordHash);
      if (!match) {
        res.status(403).json({
          error:   "Invalid transaction password",
          message: "The transaction password you entered is incorrect",
        });
        return;
      }
    }

    // ── Internal transfer: destination is another platform user's SCA ─────────
    // Only possible on EVM chains (SCA addresses are 0x…). Fee-free — no
    // blockchain transaction needed; we credit the recipient's off-chain balance.
    if (chain.type === "evm") {
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
        const internalNewBalance = await atomicDeduct(user.userId, grossAmount);
        if (internalNewBalance === null) {
          res.status(400).json({
            error:   "Insufficient balance",
            message: `You need at least $${grossAmount.toFixed(2)} for this transfer.`,
          });
          return;
        }

        const [updatedRecipient] = await db
          .update(usersTable)
          .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${grossAmount}` })
          .where(eq(usersTable.id, internalRecipient.id))
          .returning({ newBalance: usersTable.claimedBalance });

        const senderEmail  = dbUser?.email ?? "";
        const recipientBal = updatedRecipient?.newBalance ?? "0";

        await db.insert(escrowsTable).values({
          senderAddress:   senderEmail,
          recipientEmail:  internalRecipient.email,
          emailHash:       hashEmail(internalRecipient.email),
          amount:          grossAmount.toFixed(6),
          amountWei:       parseUsdcAmount(grossAmount.toFixed(6)).toString(),
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
          message:        `$${grossAmount.toFixed(2)} transferred to ${internalRecipient.email}`,
        });
        return;
      }
    }

    // ── 1. Atomic deduction ───────────────────────────────────────────────────
    // Deduct the full gross amount. Net amount goes to user; platform fee stays
    // in the treasury Unified Balance as revenue.
    const newBalance = await atomicDeduct(user.userId, grossAmount);
    if (newBalance === null) {
      res.status(400).json({
        error:   "Insufficient balance",
        message: `You need at least $${grossAmount.toFixed(2)} (includes $${fee.toFixed(2)} platform fee).`,
      });
      return;
    }

    // ── 2. Pre-insert withdrawal record as "processing" ───────────────────────
    const idempotencyKey = randomUUID();
    const [withdrawal] = await db
      .insert(withdrawalsTable)
      .values({
        userId:         user.userId,
        amount:         grossAmount.toFixed(6),
        type:           "crypto",
        destination:    `${walletAddress} (${chain.label})`,
        status:         "processing",
        idempotencyKey,
      })
      .returning({ id: withdrawalsTable.id });

    // ── 3. Route: direct transfer if treasury has on-chain liquidity, else Gateway ─
    // Check on-chain balance first (fast, no side effects). If the treasury
    // already holds enough USDC on the destination chain we skip the Forwarding
    // Service entirely — saving the $0.20 flat fee per withdrawal.
    let transferId: string;
    let direct = false;
    try {
      const chainBalance = await getTreasuryChainBalance(chainKey as ChainKey);
      direct = chainBalance >= netAmount;

      if (direct) {
        transferId = await directTreasuryTransfer({
          destinationAddress: walletAddress,
          chainKey:           chainKey as ChainKey,
          amount:             netAmount.toFixed(6),
          idempotencyKey,
          onFailure: async () => {
            await atomicRestore(user.userId, grossAmount);
            await db.update(withdrawalsTable)
              .set({ status: "failed" })
              .where(eq(withdrawalsTable.id, withdrawal.id));
            req.log.error(
              { userId: user.userId, grossAmount, walletAddress, chainKey },
              "[withdraw] Circle tx failed on-chain — balance restored",
            );
          },
        });
        req.log.info(
          { transferId, grossAmount, netAmount, walletAddress, chainKey, chainBalance },
          "[withdraw] Direct treasury transfer submitted (on-chain liquidity sufficient)",
        );
      } else {
        // Cross-chain via Gateway — only possible for Gateway-supported destination chains.
        if (!GATEWAY_SUPPORTED_CHAINS.has(chainKey as ChainKey)) {
          await atomicRestore(user.userId, grossAmount);
          await db
            .update(withdrawalsTable)
            .set({ status: "failed" })
            .where(eq(withdrawalsTable.id, withdrawal.id));
          req.log.error(
            { chainKey, chainLabel: chain.label },
            "[withdraw] No treasury liquidity and chain not Gateway-supported — withdrawal failed",
          );
          res.status(503).json({
            error:   "Withdrawal unavailable",
            message: "We're unable to process this withdrawal at the moment due to an internal error. We apologize for the inconvenience. Please try again later.",
          });
          return;
        }

        const result = await gatewayWithdrawal({
          destinationAddress: walletAddress,
          destinationChain:   chainKey as ChainKey,
          amount:             netAmount.toFixed(6),
          idempotencyKey,
        });
        transferId = result.transferId;
        req.log.info(
          { transferId, grossAmount, netAmount, walletAddress, chainKey, chainBalance },
          "[withdraw] Gateway withdrawal submitted via Forwarding Service",
        );
      }
    } catch (err: any) {
      await atomicRestore(user.userId, grossAmount);
      await db
        .update(withdrawalsTable)
        .set({ status: "failed" })
        .where(eq(withdrawalsTable.id, withdrawal.id));
      req.log.error(
        { err: err.message, grossAmount, walletAddress, chainKey, direct },
        "[withdraw] Withdrawal failed — balance restored",
      );

      // All transfer failures — whether Circle API errors, upstream failures, or
      // liquidity issues — are platform errors. Never expose internal details.
      res.status(502).json({
        error:   "Withdrawal failed",
        message: "We're unable to process this withdrawal at the moment due to an internal error. We apologize for the inconvenience. Please try again later.",
      });
      return;
    }

    // ── 4. Mark completed ─────────────────────────────────────────────────────
    // Burn intent accepted = withdrawal submitted. The on-chain txHash is
    // backfilled by gateway.mint.finalized webhook when the mint lands.
    await db
      .update(withdrawalsTable)
      .set({
        status:           "completed",
        circleTransferId: transferId,
        completedAt:      new Date(),
      })
      .where(eq(withdrawalsTable.id, withdrawal.id));

    sendWithdrawalCryptoEmail(dbUser.email, netAmount.toFixed(2), fee.toFixed(2), walletAddress).catch(() => {});

    res.json({
      transferId,
      amount:     grossAmount.toFixed(2),
      netAmount:  netAmount.toFixed(2),
      fee:        fee.toFixed(2),
      newBalance,
      blockchain: chainKey,
      chain:      chain.label,
      message:    `Withdrawal of ${netAmount.toFixed(2)} USDC to ${walletAddress} on ${chain.label} is being processed`,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "[withdraw] Crypto withdrawal error");
    res.status(500).json({
      error:   "Internal server error",
      message: "An internal error occurred that led to the withdrawal failure. Please try again later.",
    });
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
    if (withdrawAmount < 1) {
      res.status(400).json({ error: "Validation error", message: "Minimum transfer amount is $1.00 USD" });
      return;
    }

    const [fiatUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, user.userId))
      .limit(1);

    const claimedBalance = parseFloat(fiatUser?.claimedBalance ?? "0");

    if (withdrawAmount > claimedBalance) {
      res.status(400).json({
        error:   "Insufficient balance",
        message: `You only have $${claimedBalance.toFixed(2)} available. Requested $${withdrawAmount.toFixed(2)}.`,
      });
      return;
    }

    const newBalance = (claimedBalance - withdrawAmount).toFixed(6);
    await db
      .update(usersTable)
      .set({ claimedBalance: newBalance })
      .where(eq(usersTable.id, user.userId));

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
    res.status(500).json({
      error:   "Internal server error",
      message: "An internal error occurred that led to the withdrawal failure. Please try again later.",
    });
  }
});

export default router;
