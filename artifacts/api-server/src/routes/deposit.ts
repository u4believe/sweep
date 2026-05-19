import { Router, type IRouter } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, usersTable, depositsTable, virtualAccountsTable, bridgeJobsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import {
  createCircleWireBankAccount,
  getCircleWireDepositInstructions,
  createMockWireDeposit,
  getPlatformWalletAddress,
  SUPPORTED_SOURCE_CHAINS,
  type SourceChain,
} from "../lib/circle.js";
import { triggerBridgeWorker } from "../lib/bridgeWorker.js";
import { sendDepositConfirmedEmail } from "../lib/email.js";

const router: IRouter = Router();

// ─── GET /api/deposit/addresses ───────────────────────────────────────────────
// Returns all chain-specific USDC deposit wallet addresses for the user.
// Frontend shows one address per chain so users know where to send from.
router.get("/addresses", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const [dbUser] = await db
      .select({
        circleWalletAddress:      usersTable.circleWalletAddress,
        circleWalletAddressesJson: (usersTable as any).circleWalletAddressesJson,
      })
      .from(usersTable)
      .where(eq(usersTable.id, user.userId))
      .limit(1);

    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Build per-chain address map
    let addresses: Record<string, string> = {};

    if ((dbUser as any).circleWalletAddressesJson) {
      try {
        addresses = JSON.parse((dbUser as any).circleWalletAddressesJson);
      } catch { /* fall through */ }
    }

    // Backfill primary address for BASE-SEPOLIA if multi-chain map is missing
    if (Object.keys(addresses).length === 0 && dbUser.circleWalletAddress) {
      addresses = { "BASE-SEPOLIA": dbUser.circleWalletAddress };
    }

    // Return in consistent order
    const ordered: Record<string, string> = {};
    for (const chain of SUPPORTED_SOURCE_CHAINS) {
      if (addresses[chain]) ordered[chain] = addresses[chain];
    }

    res.json({ addresses: ordered });
  } catch (error: any) {
    req.log.error({ err: error }, "[deposit] Addresses error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── GET /api/deposit/wire/instructions ──────────────────────────────────────
// Returns Circle's wire deposit instructions for the authenticated user.
router.get("/wire/instructions", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;

    const [existing] = await db
      .select()
      .from(virtualAccountsTable)
      .where(and(
        eq(virtualAccountsTable.userId, user.userId),
        eq(virtualAccountsTable.provider, "circle-wire"),
      ))
      .limit(1);

    let wireAccountId: string;
    let trackingRef: string;

    if (existing) {
      wireAccountId = existing.providerRef!;
      trackingRef   = existing.accountNumber;
    } else {
      const wire = await createCircleWireBankAccount(user.userId);
      wireAccountId = wire.id;
      trackingRef   = wire.trackingRef;

      await db.insert(virtualAccountsTable).values({
        userId:        user.userId,
        provider:      "circle-wire",
        accountNumber: trackingRef,
        accountName:   "ARC Finance",
        bankName:      "Circle / JPMorgan Chase",
        bankCode:      null,
        providerRef:   wireAccountId,
        currency:      "USD",
      });

      req.log.info({ userId: user.userId, trackingRef, wireAccountId }, "[deposit] Wire account created");
    }

    const instructions = await getCircleWireDepositInstructions(wireAccountId);

    res.json({
      trackingRef,
      beneficiary:     instructions.beneficiary,
      beneficiaryBank: instructions.beneficiaryBank,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "[deposit] Wire instructions error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── POST /api/deposit/wire/mock ──────────────────────────────────────────────
// Sandbox only: simulate an incoming wire payment.
router.post("/wire/mock", requireAuth, async (req, res) => {
  if (process.env["NODE_ENV"] === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    const user = (req as any).user;
    const { amount } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      res.status(400).json({ error: "Invalid amount", message: "Provide a positive USD amount" });
      return;
    }

    const [wireAccount] = await db
      .select()
      .from(virtualAccountsTable)
      .where(and(
        eq(virtualAccountsTable.userId, user.userId),
        eq(virtualAccountsTable.provider, "circle-wire"),
      ))
      .limit(1);

    if (!wireAccount) {
      res.status(400).json({
        error:   "No wire account",
        message: "Load wire instructions first to create your deposit account",
      });
      return;
    }

    const instructions = await getCircleWireDepositInstructions(wireAccount.providerRef!);

    await createMockWireDeposit(
      wireAccount.accountNumber,
      instructions.beneficiaryBank.accountNumber,
      parseFloat(amount).toFixed(2),
    );

    req.log.info({ userId: user.userId, amount }, "[deposit] Mock wire deposit initiated");
    res.json({
      message:  "Mock wire deposit submitted. Circle processes in batches — your balance will be credited within 15 minutes.",
      amount:   parseFloat(amount).toFixed(2),
      currency: "USD",
    });
  } catch (error: any) {
    req.log.error({ err: error }, "[deposit] Mock wire error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── GET /api/deposit/circle/webhook ─────────────────────────────────────────
// Circle sends a GET request to validate the endpoint URL when saving it.
router.get("/circle/webhook", (_req, res) => {
  res.status(200).json({ ok: true });
});

// ─── POST /api/deposit/circle/webhook ────────────────────────────────────────
// Handles two Circle notification types:
//   "payments"             — wire (fiat) deposits
//   "transactions.inbound" — USDC on-chain deposits to a user's DCW wallet
//
// Security: The webhook URL must include ?token=<CIRCLE_WEBHOOK_SECRET>.
// Set CIRCLE_WEBHOOK_SECRET in .env and configure the same token in the Circle
// dashboard webhook URL. Without this, any caller can fake deposits.
router.post("/circle/webhook", async (req, res) => {
  const webhookSecret = process.env["CIRCLE_WEBHOOK_SECRET"];
  if (webhookSecret) {
    const providedToken = typeof req.query["token"] === "string" ? req.query["token"] : "";
    const hashA = createHmac("sha256", "webhook-verify").update(webhookSecret).digest();
    const hashB = createHmac("sha256", "webhook-verify").update(providedToken).digest();
    if (!timingSafeEqual(hashA, hashB)) {
      console.warn("[circle/webhook] Rejected: invalid or missing token");
      // Return 200 to prevent Circle retry storms if this is a misconfiguration
      res.status(200).json({ received: false });
      return;
    }
  }

  // Respond 200 immediately — Circle retries if no 200 within 5 s
  res.status(200).json({ received: true });

  try {
    const { notificationType, notification } = req.body ?? {};
    console.info(`[circle/webhook] type=${notificationType} body=${JSON.stringify(req.body)}`);

    // ── Wire (fiat) payment ───────────────────────────────────────────────
    if (notificationType === "payments") {
      const payment = notification?.payment ?? notification;
      if (!payment) return;

      const { id: paymentId, type, status, trackingRef, amount } = payment;
      if (type !== "wire" || status !== "paid") return;
      if (!trackingRef || !amount?.amount) return;

      const amountUsd = parseFloat(amount.amount);
      if (amountUsd <= 0) return;

      // Idempotency
      if (paymentId) {
        const [dup] = await db
          .select({ id: depositsTable.id })
          .from(depositsTable)
          .where(eq(depositsTable.depositReference, paymentId))
          .limit(1);
        if (dup) return;
      }

      const [wireAccount] = await db
        .select({ userId: virtualAccountsTable.userId })
        .from(virtualAccountsTable)
        .where(and(
          eq(virtualAccountsTable.provider, "circle-wire"),
          eq(virtualAccountsTable.accountNumber, trackingRef),
        ))
        .limit(1);

      if (!wireAccount) {
        console.warn(`[circle/webhook] No wire account for trackingRef=${trackingRef}`);
        return;
      }

      await db.update(usersTable)
        .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${amountUsd}` })
        .where(eq(usersTable.id, wireAccount.userId));

      await db.insert(depositsTable).values({
        userId:           wireAccount.userId,
        amount:           amountUsd.toFixed(6),
        type:             "bank",
        source:           "Circle Wire Transfer",
        status:           "completed",
        depositReference: paymentId ?? trackingRef,
        creditedAt:       new Date(),
      });

      console.info(`[circle/webhook] Credited $${amountUsd} wire to user ${wireAccount.userId}`);

      const [wireUserEmail] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, wireAccount.userId))
        .limit(1);
      if (wireUserEmail) {
        sendDepositConfirmedEmail(wireUserEmail.email, amountUsd.toFixed(2), "bank", "Circle Wire Transfer").catch(() => {});
      }
      return;
    }

    // ── USDC on-chain inbound ─────────────────────────────────────────────
    if (notificationType !== "transactions.inbound") return;
    if (!notification) return;

    const { id: txId, walletId, amounts, blockchain, txHash, state, destinationAddress } = notification;
    console.info(
      `[circle/webhook] Inbound: state=${state} walletId=${walletId} address=${destinationAddress} amounts=${JSON.stringify(amounts)} txHash=${txHash} txId=${txId} chain=${blockchain}`,
    );

    if (state !== "COMPLETED" && state !== "COMPLETE") return;
    if (!amounts?.length) return;

    const amount = String(amounts[0] ?? "0");
    if (!amount || parseFloat(amount) <= 0) return;

    // Resolve user by walletId or destination address.
    // circleWalletId stores only the PRIMARY (BASE-SEPOLIA) wallet ID.
    // For Arc (and any non-primary chain) deposits, the wallet ID only appears
    // in circleWalletIdsJson — so we must search that JSON too.
    let dbUser: { id: number } | undefined;

    if (walletId) {
      // 1. Primary wallet ID match (BASE-SEPOLIA)
      const [byPrimary] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.circleWalletId, walletId))
        .limit(1);
      dbUser = byPrimary;

      // 2. Search circleWalletIdsJson for non-primary chain wallet IDs (e.g. ARC-TESTNET)
      //    The JSON is a map of chain→walletId; a LIKE search on the UUID is safe
      //    because UUIDs contain only hex chars and hyphens (no SQL wildcards).
      if (!dbUser) {
        const [byJson] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(sql`${usersTable.circleWalletIdsJson} LIKE ${"%" + walletId + "%"}`)
          .limit(1);
        dbUser = byJson;
      }
    }

    if (!dbUser && destinationAddress) {
      // 3. Destination address match — works because SCA wallets share the same
      //    on-chain address across all chains (same CREATE2 derivation).
      const [byAddr] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(sql`lower(${usersTable.circleWalletAddress}) = lower(${destinationAddress})`)
        .limit(1);
      dbUser = byAddr;
    }

    if (!dbUser) {
      console.warn(`[circle/webhook] No user for walletId=${walletId} address=${destinationAddress}`);
      return;
    }

    // Always use "circle-{txId}" as the stable idempotency key — txId is always
    // present in the webhook payload, unlike txHash which may not be indexed yet.
    // This key matches what the deposit indexer uses for the same transaction,
    // preventing double-credits when the indexer runs after the webhook.
    const depositRef = txId ? `circle-${txId}` : (txHash ?? null);

    // Check by depositReference — catches the normal case.
    if (depositRef) {
      const [dupByRef] = await db
        .select({ id: depositsTable.id, currentTxHash: depositsTable.txHash })
        .from(depositsTable)
        .where(eq(depositsTable.depositReference, depositRef))
        .limit(1);
      if (dupByRef) {
        // Already credited — patch in real txHash if the record is still missing it.
        if (!dupByRef.currentTxHash && txHash) {
          await db.update(depositsTable)
            .set({ txHash })
            .where(eq(depositsTable.id, dupByRef.id));
          console.info(`[circle/webhook] Patched missing txHash on deposit ref=${depositRef}`);
        }
        return;
      }
    }

    // Check by txHash — catches edge cases where the indexer inserted first using the real hash.
    if (txHash) {
      const [dupByHash] = await db
        .select({ id: depositsTable.id })
        .from(depositsTable)
        .where(eq(depositsTable.txHash, txHash))
        .limit(1);
      if (dupByHash) return;
    }

    // Credit inside a transaction: INSERT first, balance update second.
    // onConflictDoNothing relies on the unique index on deposit_reference / tx_hash
    // (see schema migration). If the INSERT is skipped the balance is NOT touched.
    const credited = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(depositsTable).values({
        userId:           dbUser.id,
        amount:           parseFloat(amount).toFixed(6),
        type:             "crypto",
        source:           `${blockchain ?? "Circle"} USDC`,
        status:           "completed",
        depositReference: depositRef,
        txHash:           txHash ?? null,
        creditedAt:       new Date(),
      }).onConflictDoNothing().returning({ id: depositsTable.id });

      if (!inserted) return false;

      await tx.update(usersTable)
        .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${parseFloat(amount)}` })
        .where(eq(usersTable.id, dbUser.id));

      return true;
    });

    if (!credited) {
      console.info(`[circle/webhook] Duplicate deposit (conflict on insert) — skipping balance update ref=${depositRef}`);
      return;
    }

    console.info(`[circle/webhook] Credited ${amount} USDC to user ${dbUser.id} from ${blockchain}`);

    const [cryptoUserEmail] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, dbUser.id))
      .limit(1);
    if (cryptoUserEmail) {
      sendDepositConfirmedEmail(cryptoUserEmail.email, parseFloat(amount).toFixed(2), "crypto", `${blockchain ?? "Circle"} USDC`).catch(() => {});
    }

    // Enqueue bridge job to sweep USDC to Arc treasury.
    // depositIndexer handles on-chain detection; webhook is the fast path.
    const sourceChain = (blockchain?.toUpperCase() as SourceChain | undefined);
    if (sourceChain && destinationAddress) {
      const platformAddress = getPlatformWalletAddress();
      // Don't bridge if the destination IS the platform treasury (it's already there).
      if (!platformAddress || destinationAddress.toLowerCase() !== platformAddress.toLowerCase()) {
        try {
          let existingJob: { id: number } | undefined;
          if (txHash) {
            const [found] = await db
              .select({ id: bridgeJobsTable.id })
              .from(bridgeJobsTable)
              .where(eq(bridgeJobsTable.txHash, txHash))
              .limit(1);
            existingJob = found;
          }

          if (!existingJob) {
            await db.insert(bridgeJobsTable).values({
              userId:            dbUser.id,
              sourceChain,
              userWalletAddress: destinationAddress,
              amount:            parseFloat(amount).toFixed(6),
              txHash:            txHash ?? null,
              status:            "pending",
            });
            console.info(`[circle/webhook] Bridge job enqueued for ${amount} USDC on ${sourceChain}`);
            // Kick the bridge worker immediately so the sweep doesn't wait for its poll interval
            triggerBridgeWorker();
          }
        } catch (e: any) {
          console.warn(`[circle/webhook] Bridge job insert failed: ${e?.message}`);
        }
      }
    }
  } catch (err: any) {
    console.error("[circle/webhook] Error:", err?.message);
  }
});

// ─── GET /api/deposit/history ─────────────────────────────────────────────────
router.get("/history", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const deposits = await db
      .select()
      .from(depositsTable)
      .where(eq(depositsTable.userId, user.userId))
      .orderBy(depositsTable.createdAt);
    res.json({ deposits: deposits.reverse() });
  } catch (error: any) {
    req.log.error({ err: error }, "[deposit] History error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

export default router;
