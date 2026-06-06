// ─── Circle Gateway Webhook Handler ──────────────────────────────────────────
// Handles two Circle Gateway notification types:
//   gateway.deposit.finalized — USDC swept into treasury Unified Balance
//   gateway.mint.finalized    — Cross-chain withdrawal mint complete (Forwarding Service)
//
// Security: same token-in-query-param pattern as /api/deposit/circle/webhook.
// Register the webhook at:
//   https://<domain>/api/gateway/webhook?token=<CIRCLE_WEBHOOK_SECRET>

import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, usersTable, depositsTable, withdrawalsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { sendDepositConfirmedEmail } from "../lib/email.js";

const router: IRouter = Router();

// Convert USDC uint256 base units → decimal (6 decimal places).
function fromBaseUnits(raw: string | number | undefined): number {
  if (!raw) return 0;
  return parseFloat(String(raw)) / 1_000_000;
}

function verifyToken(req: any): boolean {
  const secret = process.env["CIRCLE_WEBHOOK_SECRET"];
  if (!secret) return true;
  const token = typeof req.query["token"] === "string" ? req.query["token"] : "";
  const a = createHmac("sha256", "webhook-verify").update(secret).digest();
  const b = createHmac("sha256", "webhook-verify").update(token).digest();
  return timingSafeEqual(a, b);
}

// GET /api/gateway/webhook — Circle validation probe
router.get("/webhook", (_req, res) => {
  res.status(200).json({ ok: true });
});

// POST /api/gateway/webhook
router.post("/webhook", async (req, res) => {
  if (!verifyToken(req)) {
    console.warn("[gateway/webhook] Rejected: invalid or missing token");
    res.status(200).json({ received: false });
    return;
  }

  // Respond 200 immediately — Gateway API retries if no 200 within 5 s
  res.status(200).json({ received: true });

  try {
    const { notificationType, notification } = req.body ?? {};
    console.info(
      `[gateway/webhook] type=${notificationType} notifId=${notification?.id}`,
    );

    if (notificationType === "gateway.deposit.finalized") {
      await handleDepositFinalized(notification ?? {});
    } else if (notificationType === "gateway.mint.finalized") {
      await handleMintFinalized(notification ?? {});
    }
  } catch (err: any) {
    console.error("[gateway/webhook] Unhandled error:", err?.message);
  }
});

// ─── gateway.deposit.finalized ────────────────────────────────────────────────
// Fired when USDC lands in the treasury Unified Balance via depositFor().
//
// Primary path: user was already credited by transactions.inbound when USDC
// arrived on their SCA — this is confirmation the sweep completed. We log it
// and record an audit entry.
//
// Safety-net path: if no completed deposit exists for this user+amount in the
// last 60 minutes (inbound webhook was missed), we credit the user now.
async function handleDepositFinalized(n: any): Promise<void> {
  const notifId = n?.id ?? n?.depositId;
  if (!notifId) {
    console.warn("[gateway/webhook] deposit.finalized: missing notification ID");
    return;
  }

  const depositRef = `gw-deposit-${notifId}`;

  // Idempotency — skip if we already processed this notification
  const [already] = await db
    .select({ id: depositsTable.id })
    .from(depositsTable)
    .where(eq(depositsTable.depositReference, depositRef))
    .limit(1);

  if (already) {
    console.info(`[gateway/webhook] deposit.finalized: already processed ${depositRef}`);
    return;
  }

  // Extract payload fields — defensively try multiple key names
  const senderAddress: string | undefined =
    n?.sender ?? n?.from ?? n?.senderAddress ?? n?.userAddress ?? n?.callerAddress;
  const rawAmount  = n?.amount ?? n?.value;
  const txHash     = n?.txHash ?? n?.transactionHash;
  const chain: string = n?.blockchain ?? n?.chain ?? n?.sourceChain ?? "unknown";

  const amountDecimal = fromBaseUnits(rawAmount);

  console.info(
    `[gateway/webhook] deposit.finalized: sender=${senderAddress} amount=${amountDecimal} chain=${chain} txHash=${txHash}`,
  );

  // Find user by sender address (user SCA is msg.sender of depositFor call)
  let dbUser: { id: number; email: string } | undefined;

  if (senderAddress) {
    const [byPrimary] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(sql`lower(${usersTable.circleWalletAddress}) = lower(${senderAddress})`)
      .limit(1);
    dbUser = byPrimary;

    if (!dbUser) {
      const [byJson] = await db
        .select({ id: usersTable.id, email: usersTable.email })
        .from(usersTable)
        .where(
          sql`lower(${(usersTable as any).circleWalletAddressesJson}::text) LIKE ${"%" + senderAddress.toLowerCase() + "%"}`,
        )
        .limit(1);
      dbUser = byJson;
    }
  }

  if (!dbUser) {
    console.warn(
      `[gateway/webhook] deposit.finalized: user not found for sender=${senderAddress} — will retry on next notification`,
    );
    return;
  }

  // Check if the user was already credited for a recent deposit of this amount
  // (by the transactions.inbound handler). Use a 60-minute window to cover the
  // typical inbound → sweep delay.
  const [recentCredit] = await db
    .select({ id: depositsTable.id })
    .from(depositsTable)
    .where(
      and(
        eq(depositsTable.userId, dbUser.id),
        eq(depositsTable.type, "crypto"),
        eq(depositsTable.status, "completed"),
        sql`${depositsTable.creditedAt} > NOW() - INTERVAL '60 minutes'`,
        sql`ABS(${depositsTable.amount}::numeric - ${amountDecimal}::numeric) < 0.01`,
      ),
    )
    .limit(1);

  if (recentCredit) {
    // Normal path: user already credited — record gateway sweep confirmation
    console.info(
      `[gateway/webhook] deposit.finalized: sweep confirmed for user ${dbUser.id} (${amountDecimal} USDC, ${chain})`,
    );
    await db.insert(depositsTable).values({
      userId:           dbUser.id,
      amount:           amountDecimal.toFixed(6),
      type:             "crypto",
      source:           `Gateway Confirmed (${chain})`,
      status:           "completed",
      depositReference: depositRef,
      txHash:           null,     // inbound deposit already owns the on-chain txHash
      creditedAt:       new Date(),
    }).onConflictDoNothing();
    return;
  }

  // Safety-net path: no recent credit found — credit the user now.
  if (amountDecimal <= 0) {
    console.warn(`[gateway/webhook] deposit.finalized: zero amount for user ${dbUser.id} — skipping`);
    return;
  }

  const credited = await db.transaction(async (tx: any) => {
    const [inserted] = await tx.insert(depositsTable).values({
      userId:           dbUser.id,
      amount:           amountDecimal.toFixed(6),
      type:             "crypto",
      source:           `Gateway Sweep (${chain})`,
      status:           "completed",
      depositReference: depositRef,
      txHash:           txHash ?? null,
      creditedAt:       new Date(),
    }).onConflictDoNothing().returning({ id: depositsTable.id });

    if (!inserted) return false;

    await tx.update(usersTable)
      .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${amountDecimal}` })
      .where(eq(usersTable.id, dbUser.id));

    return true;
  });

  if (credited) {
    console.info(
      `[gateway/webhook] deposit.finalized: safety-net credited ${amountDecimal} USDC to user ${dbUser.id}`,
    );
    sendDepositConfirmedEmail(
      dbUser.email,
      amountDecimal.toFixed(2),
      "crypto",
      `Gateway (${chain})`,
    ).catch(() => {});
  } else {
    console.info(`[gateway/webhook] deposit.finalized: idempotency conflict on insert — skipping`);
  }
}

// ─── gateway.mint.finalized ───────────────────────────────────────────────────
// Fired when the Forwarding Service completes a cross-chain USDC mint to the
// user's destination address. Marks the withdrawal record as completed.
async function handleMintFinalized(n: any): Promise<void> {
  const transferId: string | undefined = n?.transferId ?? n?.id;
  const txHash    : string | undefined = n?.txHash ?? n?.transactionHash;
  const chain     : string | undefined = n?.destinationChain ?? n?.blockchain;
  const rawAmount  = n?.amount ?? n?.value;

  console.info(
    `[gateway/webhook] mint.finalized: transferId=${transferId} txHash=${txHash} chain=${chain} amount=${fromBaseUnits(rawAmount)}`,
  );

  if (!transferId) {
    console.warn("[gateway/webhook] mint.finalized: no transferId — cannot update withdrawal");
    return;
  }

  const [withdrawal] = await db
    .select({
      id:     withdrawalsTable.id,
      status: withdrawalsTable.status,
      userId: withdrawalsTable.userId,
      txHash: withdrawalsTable.txHash,
    })
    .from(withdrawalsTable)
    .where(eq(withdrawalsTable.circleTransferId, transferId))
    .limit(1);

  if (!withdrawal) {
    console.warn(`[gateway/webhook] mint.finalized: no withdrawal found for transferId=${transferId}`);
    return;
  }

  if (withdrawal.status === "completed" && withdrawal.txHash) {
    console.info(`[gateway/webhook] mint.finalized: withdrawal ${withdrawal.id} already complete with txHash`);
    return;
  }

  // Update txHash even for already-completed withdrawals (burn intent was submitted
  // before on-chain mint resolved; this backfills the missing on-chain hash).
  await db.update(withdrawalsTable)
    .set({
      status:      "completed",
      txHash:      txHash ?? null,
      completedAt: new Date(),
    })
    .where(eq(withdrawalsTable.id, withdrawal.id));

  console.info(
    `[gateway/webhook] mint.finalized: withdrawal ${withdrawal.id} completed (user ${withdrawal.userId}, chain ${chain})`,
  );
}

export default router;
