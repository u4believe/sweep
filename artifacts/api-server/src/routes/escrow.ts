import { Router, type IRouter } from "express";
import { db, escrowsTable, usersTable, escrowBalancesTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import { requireAuth, requireEmailVerified } from "../lib/auth.js";
import { hashEmail, parseUsdcAmount } from "../lib/escrow.js";
import {
  sendTransferSentEmail,
  sendTransferReceivedEmail,
  sendEscrowClaimedEmail,
} from "../lib/email.js";

const router: IRouter = Router();

// ─── GET /api/escrow/pending ──────────────────────────────────────────────────
router.get("/pending", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const emailHash = hashEmail(user.email);

    const pendingEscrows = await db.select().from(escrowsTable).where(
      and(
        eq(escrowsTable.emailHash, emailHash),
        eq(escrowsTable.status, "pending"),
      )
    );

    const totalPendingAmount = pendingEscrows.reduce((sum, e) => sum + parseFloat(e.amount), 0);

    res.json({
      escrows: pendingEscrows.map((e) => ({
        id: e.id,
        senderAddress: e.senderAddress,
        recipientEmail: e.recipientEmail,
        amount: e.amount,
        status: e.status,
        txHash: e.txHash,
        createdAt: e.createdAt,
        claimedAt: e.claimedAt,
      })),
      totalPendingAmount: totalPendingAmount.toFixed(6),
    });
  } catch (error: any) {
    req.log.error({ err: error }, "[pending] Error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── POST /api/escrow/claim ───────────────────────────────────────────────────
// Credits all pending escrows for the authenticated user to their balance.
router.post("/claim", requireAuth, async (req, res) => {
  try {
    const user      = (req as any).user;
    const emailHash = hashEmail(user.email);
    const now       = new Date();

    const { claimedCount, totalClaimed } = await db.transaction(async (tx) => {
      // Re-read pending escrows inside the transaction to prevent double-claim races
      const pending = await tx
        .select()
        .from(escrowsTable)
        .where(and(eq(escrowsTable.emailHash, emailHash), eq(escrowsTable.status, "pending")))
        .for("update"); // row-level lock — concurrent claims block until this commits

      if (pending.length === 0) return { claimedCount: 0, totalClaimed: 0 };

      const ids   = pending.map((e) => e.id);
      const total = pending.reduce((s, e) => s + parseFloat(e.amount), 0);

      await tx
        .update(escrowsTable)
        .set({ status: "claimed", recipientUserId: user.userId, claimedAt: now })
        .where(inArray(escrowsTable.id, ids));

      await tx
        .update(usersTable)
        .set({ claimedBalance: sql`(CAST(claimed_balance AS NUMERIC) + ${total})::TEXT` })
        .where(eq(usersTable.id, user.userId));

      return { claimedCount: pending.length, totalClaimed: total };
    });

    if (claimedCount === 0) {
      res.status(400).json({ error: "No pending escrows", message: "No pending escrow funds found for your account" });
      return;
    }

    sendEscrowClaimedEmail(user.email, totalClaimed.toFixed(6), claimedCount).catch(() => {});

    res.json({
      claimedCount,
      totalClaimed: totalClaimed.toFixed(6),
      message: `Successfully claimed $${totalClaimed.toFixed(2)} USD`,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "[claim] Error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── POST /api/escrow/claim/auto ─────────────────────────────────────────────
// Alias of /claim — credits all pending escrows to the user's balance.
router.post("/claim/auto", requireAuth, async (req, res) => {
  try {
    const user      = (req as any).user;
    const emailHash = hashEmail(user.email);
    const now       = new Date();

    const { claimedCount, totalClaimed } = await db.transaction(async (tx) => {
      const pending = await tx
        .select()
        .from(escrowsTable)
        .where(and(eq(escrowsTable.emailHash, emailHash), eq(escrowsTable.status, "pending")))
        .for("update");

      if (pending.length === 0) return { claimedCount: 0, totalClaimed: 0 };

      const ids   = pending.map((e) => e.id);
      const total = pending.reduce((s, e) => s + parseFloat(e.amount), 0);

      await tx
        .update(escrowsTable)
        .set({ status: "claimed", recipientUserId: user.userId, claimedAt: now })
        .where(inArray(escrowsTable.id, ids));

      await tx
        .update(usersTable)
        .set({ claimedBalance: sql`(CAST(claimed_balance AS NUMERIC) + ${total})::TEXT` })
        .where(eq(usersTable.id, user.userId));

      return { claimedCount: pending.length, totalClaimed: total };
    });

    if (claimedCount === 0) {
      res.status(400).json({ error: "No pending escrows", message: "No pending escrow funds found for your account" });
      return;
    }

    req.log.info({ userId: user.userId, totalClaimed }, "[claim/auto] Claim complete");
    sendEscrowClaimedEmail(user.email, totalClaimed.toFixed(6), claimedCount).catch(() => {});

    res.json({
      success: true,
      claimedCount,
      totalClaimed: totalClaimed.toFixed(6),
      txHash: null,
      message: `Successfully claimed $${totalClaimed.toFixed(2)} USD`,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "[claim/auto] Error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── GET /api/escrow/history ──────────────────────────────────────────────────
router.get("/history", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const emailHash = hashEmail(user.email);

    const [sentEscrows, receivedEscrows] = await Promise.all([
      db.select().from(escrowsTable).where(eq(escrowsTable.senderAddress, user.email.toLowerCase())),
      db.select().from(escrowsTable).where(eq(escrowsTable.emailHash, emailHash)),
    ]);

    const mapEscrow = (e: typeof sentEscrows[0]) => ({
      id: e.id,
      senderAddress: e.senderAddress,
      recipientEmail: e.recipientEmail,
      amount: e.amount,
      status: e.status,
      txHash: e.txHash,
      createdAt: e.createdAt,
      claimedAt: e.claimedAt,
    });

    res.json({ sent: sentEscrows.map(mapEscrow), received: receivedEscrows.map(mapEscrow) });
  } catch (error: any) {
    req.log.error({ err: error }, "[history] Error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── POST /api/escrow/send/platform ──────────────────────────────────────────
// Deducts from the sender's balance and creates an escrow record for the recipient.
router.post("/send/platform", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const user = (req as any).user;

    const body = req.body as { recipientEmail?: unknown; amount?: unknown; transactionPassword?: unknown };
    const recipientEmail = typeof body.recipientEmail === "string" ? body.recipientEmail.toLowerCase().trim() : "";
    const amountRaw = typeof body.amount === "string" ? body.amount.trim() : "";

    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      res.status(400).json({ error: "Validation error", message: "A valid recipient email is required" });
      return;
    }

    if (recipientEmail === user.email.toLowerCase()) {
      res.status(400).json({ error: "Invalid recipient", message: "You cannot send money to yourself" });
      return;
    }

    const numAmount = parseFloat(amountRaw);
    if (isNaN(numAmount) || numAmount <= 0) {
      res.status(400).json({ error: "Invalid amount", message: "Amount must be a positive number" });
      return;
    }
    if (numAmount > 1_000_000) {
      res.status(400).json({ error: "Invalid amount", message: "Amount exceeds the maximum single-transfer limit" });
      return;
    }

    const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId)).limit(1);
    const currentBalance = parseFloat(sender?.claimedBalance ?? "0");

    if (sender?.transactionPasswordHash) {
      const txnPwd = typeof body.transactionPassword === "string" ? body.transactionPassword : "";
      if (!txnPwd) {
        res.status(403).json({ error: "Transaction password required", message: "Please enter your transaction password to authorize this transfer" });
        return;
      }
      const txnPwdValid = await bcrypt.compare(txnPwd, sender.transactionPasswordHash);
      if (!txnPwdValid) {
        res.status(403).json({ error: "Invalid transaction password", message: "The transaction password you entered is incorrect" });
        return;
      }
    }

    if (currentBalance < numAmount) {
      res.status(400).json({
        error: "Insufficient balance",
        message: `You only have $${currentBalance.toFixed(2)} available. Top up your balance first.`,
      });
      return;
    }

    const newBalance = (currentBalance - numAmount).toFixed(6);
    const emailHash = hashEmail(recipientEmail);
    const amountStr = numAmount.toFixed(6);

    // Deduct from sender
    await db.update(usersTable)
      .set({ claimedBalance: newBalance })
      .where(eq(usersTable.id, user.userId));

    // Look up recipient and credit immediately if they exist
    const [recipient] = await db.select().from(usersTable)
      .where(eq(usersTable.email, recipientEmail))
      .limit(1);

    let escrowStatus: "claimed" | "pending";
    let recipientUserId: number | null = null;

    if (recipient) {
      const recipientNewBalance = (parseFloat(recipient.claimedBalance ?? "0") + numAmount).toFixed(6);
      await db.update(usersTable)
        .set({ claimedBalance: recipientNewBalance })
        .where(eq(usersTable.id, recipient.id));
      escrowStatus = "claimed";
      recipientUserId = recipient.id;
    } else {
      // Recipient not yet registered — keep as pending so they receive it on sign-up
      escrowStatus = "pending";
    }

    const [escrow] = await db.insert(escrowsTable).values({
      senderAddress: user.email,
      recipientEmail,
      emailHash,
      amount: amountStr,
      amountWei: parseUsdcAmount(amountStr).toString(),
      status: escrowStatus,
      recipientUserId,
      claimedAt: escrowStatus === "claimed" ? new Date() : null,
      txHash: null,
    }).returning();

    sendTransferSentEmail(user.email, recipientEmail, amountStr, newBalance).catch(() => {});
    if (recipient) {
      const recipientNewBalance = (parseFloat(recipient.claimedBalance ?? "0") + numAmount).toFixed(6);
      sendTransferReceivedEmail(recipientEmail, user.email, amountStr, recipientNewBalance).catch(() => {});
    }

    res.json({
      success: true,
      escrowId: escrow.id,
      recipientEmail,
      amount: amountStr,
      remainingBalance: newBalance,
      credited: escrowStatus === "claimed",
      message: escrowStatus === "claimed"
        ? `$${numAmount.toFixed(2)} sent to ${recipientEmail}`
        : `$${numAmount.toFixed(2)} sent to ${recipientEmail} — they'll receive it when they join`,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "[send/platform] Error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── GET /api/escrow/lookup-recipient ────────────────────────────────────────
// Pre-flight check: returns the recipient's display name so the UI can show a
// confirmation screen before committing the transfer.
router.get("/lookup-recipient", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const email = typeof req.query.email === "string" ? req.query.email.toLowerCase().trim() : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Validation error", message: "A valid email is required" });
      return;
    }

    if (email === user.email.toLowerCase()) {
      res.status(400).json({ error: "Invalid recipient", message: "You cannot send money to yourself" });
      return;
    }

    const [recipient] = await db.select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (recipient) {
      res.json({ registered: true, name: recipient.name, email: recipient.email });
    } else {
      res.json({ registered: false, name: null, email });
    }
  } catch (error: any) {
    req.log.error({ err: error }, "[lookup-recipient] Error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── GET /api/escrow/balance ──────────────────────────────────────────────────
router.get("/balance", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const emailHash = hashEmail(user.email);

    const [dbUser, pendingEscrows, onChainRow] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.id, user.userId)).limit(1),
      db.select().from(escrowsTable).where(
        and(eq(escrowsTable.emailHash, emailHash), eq(escrowsTable.status, "pending"))
      ),
      db.select().from(escrowBalancesTable).where(eq(escrowBalancesTable.emailHash, emailHash)).limit(1),
    ]);

    const onChainUsdcBalance = parseFloat(onChainRow[0]?.amount ?? "0");
    const claimedBalance = parseFloat(dbUser[0]?.claimedBalance ?? "0");
    const pendingBalance = pendingEscrows.reduce((sum, e) => sum + parseFloat(e.amount), 0);
    const usdBalance = (onChainUsdcBalance + claimedBalance).toFixed(6);

    res.json({
      onChainUsdcBalance: onChainUsdcBalance.toFixed(6),
      onChainLastUpdated: onChainRow[0]?.lastUpdated ?? null,
      claimedBalance: claimedBalance.toFixed(6),
      pendingBalance: pendingBalance.toFixed(6),
      usdBalance,
      usdEquivalent: usdBalance,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "[balance] Error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

export default router;
