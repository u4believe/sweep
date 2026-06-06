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
  ensureAllChainWallets,
  type SourceChain,
} from "../lib/circle.js";
import { triggerBridgeWorker } from "../lib/bridgeWorker.js";
import { sendDepositConfirmedEmail } from "../lib/email.js";
import { evmGatewaySweep, solanaSweep, arcTestnetSweep } from "../lib/gatewaySweep.js";
import { getChain, isDepositChain, type ChainKey } from "../lib/gatewayConfig.js";

// Map Circle blockchain identifiers → human-readable display labels.
// These labels must match what the frontend's explorer URL matcher expects.
const CIRCLE_CHAIN_LABELS: Record<string, string> = {
  "BASE-SEPOLIA":  "Base Sepolia USDC",
  "ARC-TESTNET":   "Arc Testnet USDC",
  "ETH-SEPOLIA":   "Ethereum Sepolia USDC",
  "AVAX-FUJI":     "Avalanche Fuji USDC",
  "ARB-SEPOLIA":   "Arbitrum Sepolia USDC",
  "MATIC-AMOY":    "Polygon Amoy USDC",
  "SOL-DEVNET":    "Solana Devnet USDC",
  "ETH":           "Ethereum USDC",
  "BASE":          "Base USDC",
  "ARB":           "Arbitrum USDC",
  "AVAX":          "Avalanche USDC",
  "MATIC":         "Polygon USDC",
};

function resolveChainLabel(blockchain: string | null | undefined): string {
  if (!blockchain) return "USDC";
  return CIRCLE_CHAIN_LABELS[blockchain.toUpperCase()] ?? `${blockchain} USDC`;
}

// Resolve chain from walletId when Circle's webhook omits the blockchain field.
async function resolveChainFromWallet(walletId: string | undefined, userId: number): Promise<string | null> {
  if (!walletId) return null;
  const [user] = await db
    .select({ circleWalletId: usersTable.circleWalletId, walletIdsJson: (usersTable as any).circleWalletIdsJson })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) return null;
  if (user.circleWalletId === walletId) return "BASE-SEPOLIA";
  if (user.walletIdsJson) {
    try {
      const map = JSON.parse(user.walletIdsJson) as Record<string, string>;
      for (const [chain, id] of Object.entries(map)) {
        if (id === walletId) return chain;
      }
    } catch { /* ignore */ }
  }
  return null;
}

const router: IRouter = Router();

// ─── GET /api/deposit/addresses ───────────────────────────────────────────────
// Returns all chain-specific USDC deposit wallet addresses for the user.
// Frontend shows one address per chain so users know where to send from.
router.get("/addresses", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const [dbUser] = await db
      .select({
        circleWalletAddress:       usersTable.circleWalletAddress,
        circleWalletAddressesJson: (usersTable as any).circleWalletAddressesJson,
        circleWalletIdsJson:       (usersTable as any).circleWalletIdsJson,
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
    let idsJson: string | null   = dbUser.circleWalletIdsJson ?? null;
    let addrsJson: string | null = dbUser.circleWalletAddressesJson ?? null;

    if (addrsJson) {
      try { addresses = JSON.parse(addrsJson); } catch { /* fall through */ }
    }

    // Backfill primary address for BASE-SEPOLIA if multi-chain map is missing
    if (Object.keys(addresses).length === 0 && dbUser.circleWalletAddress) {
      addresses = { "BASE-SEPOLIA": dbUser.circleWalletAddress };
    }

    // If any deposit-enabled chain is missing (e.g. SOL-DEVNET), provision it now.
    const missingChain = SUPPORTED_SOURCE_CHAINS.find(c => !addresses[c]);
    if (missingChain) {
      try {
        const backfill = await ensureAllChainWallets(idsJson, addrsJson);
        if (backfill) {
          addresses = JSON.parse(backfill.addrsJson);
          await db.update(usersTable)
            .set({ circleWalletIdsJson: backfill.idsJson, circleWalletAddressesJson: backfill.addrsJson } as any)
            .where(eq(usersTable.id, user.userId));
        }
      } catch (e: any) {
        req.log.warn({ err: e?.message }, "[deposit/addresses] Chain wallet backfill failed");
      }
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

    // Accept both PENDING (show deposit in UI early) and COMPLETE (credit balance).
    const isComplete = state === "COMPLETE" || state === "COMPLETED";
    const isPending  = state === "PENDING"  || state === "CONFIRMED" || state === "INITIATED";
    if (!isComplete && !isPending) return;
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
      // 3. Destination address match (SCA wallets share address across chains).
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

    // Resolve the chain label. Circle sometimes omits `blockchain` in the webhook
    // payload; fall back to looking up the chain from the walletId.
    const resolvedChain = blockchain ?? await resolveChainFromWallet(walletId, dbUser.id);
    const sourceLabel   = resolveChainLabel(resolvedChain);
    const sourceChain   = (resolvedChain?.toUpperCase() as SourceChain | undefined);

    // "circle-{txId}" is the stable idempotency key — txId is always present,
    // unlike txHash which may be absent on PENDING notifications.
    const depositRef = txId ? `circle-${txId}` : (txHash ?? null);

    // ── Check for existing record ─────────────────────────────────────────
    if (depositRef) {
      const [existing] = await db
        .select({ id: depositsTable.id, currentTxHash: depositsTable.txHash, status: depositsTable.status })
        .from(depositsTable)
        .where(eq(depositsTable.depositReference, depositRef))
        .limit(1);

      if (existing) {
        if (existing.status === "pending" && isComplete) {
          // Promote: pending deposit → completed, now credit balance.
          const promoted = await db.transaction(async (tx: any) => {
            const updated = await tx.update(depositsTable)
              .set({
                status:     "completed",
                txHash:     txHash ?? existing.currentTxHash ?? null,
                source:     sourceLabel,
                creditedAt: new Date(),
              })
              .where(eq(depositsTable.id, existing.id))
              .returning({ id: depositsTable.id });
            if (!updated.length) return false;
            await tx.update(usersTable)
              .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${parseFloat(amount)}` })
              .where(eq(usersTable.id, dbUser.id));
            return true;
          });

          if (!promoted) return;
          console.info(`[circle/webhook] Promoted pending→completed ${amount} USDC, user ${dbUser.id} from ${resolvedChain}`);

          // Send confirmation email and enqueue bridge job (same as normal COMPLETE flow below).
          const [eu] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, dbUser.id)).limit(1);
          if (eu) sendDepositConfirmedEmail(eu.email, parseFloat(amount).toFixed(2), "crypto", sourceLabel).catch(() => {});
          void triggerGatewaySweep(dbUser.id, resolvedChain ?? "", amount);
          return;
        }

        // Already at completed (or same pending state) — just patch txHash if missing.
        if (!existing.currentTxHash && txHash) {
          await db.update(depositsTable).set({ txHash, source: sourceLabel }).where(eq(depositsTable.id, existing.id));
          console.info(`[circle/webhook] Patched missing txHash ref=${depositRef}`);
        }
        return;
      }
    }

    // Check by txHash — catches the case where the indexer's CONFIRMED pass inserted
    // a pending record first (depositRef may differ, so the check above missed it).
    if (txHash) {
      const [dupByHash] = await db
        .select({ id: depositsTable.id, status: depositsTable.status })
        .from(depositsTable)
        .where(eq(depositsTable.txHash, txHash))
        .limit(1);
      if (dupByHash) {
        if (dupByHash.status === "pending" && isComplete) {
          // Promote the pending record and credit balance — don't strand it.
          const promoted = await db.transaction(async (tx: any) => {
            const updated = await tx.update(depositsTable)
              .set({ status: "completed", source: sourceLabel, creditedAt: new Date() })
              .where(eq(depositsTable.id, dupByHash.id))
              .returning({ id: depositsTable.id });
            if (!updated.length) return false;
            await tx.update(usersTable)
              .set({ claimedBalance: sql`${usersTable.claimedBalance} + ${parseFloat(amount)}` })
              .where(eq(usersTable.id, dbUser.id));
            return true;
          });
          if (promoted) {
            console.info(`[circle/webhook] Promoted pending→completed by txHash match, user ${dbUser.id} from ${resolvedChain}`);
            const [eu] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, dbUser.id)).limit(1);
            if (eu) sendDepositConfirmedEmail(eu.email, parseFloat(amount).toFixed(2), "crypto", sourceLabel).catch(() => {});
            void triggerGatewaySweep(dbUser.id, resolvedChain ?? "", amount);
          }
        }
        return;
      }
    }

    if (isPending && !isComplete) {
      // Insert a "pending" record so the deposit appears in the UI immediately.
      // Balance is NOT credited yet — only credited when COMPLETE arrives.
      await db.insert(depositsTable).values({
        userId:           dbUser.id,
        amount:           parseFloat(amount).toFixed(6),
        type:             "crypto",
        source:           sourceLabel,
        status:           "pending",
        depositReference: depositRef,
        txHash:           txHash ?? null,
        // creditedAt intentionally null — will be set on COMPLETE
      }).onConflictDoNothing();
      console.info(`[circle/webhook] Pending deposit ${amount} USDC to user ${dbUser.id} from ${resolvedChain}`);
      return;
    }

    // isComplete and no existing record — normal credit flow.
    const credited = await db.transaction(async (tx: any) => {
      const [inserted] = await tx.insert(depositsTable).values({
        userId:           dbUser.id,
        amount:           parseFloat(amount).toFixed(6),
        type:             "crypto",
        source:           sourceLabel,
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
      console.info(`[circle/webhook] Duplicate deposit (conflict on insert) — skipping ref=${depositRef}`);
      return;
    }

    console.info(`[circle/webhook] Credited ${amount} USDC to user ${dbUser.id} from ${resolvedChain}`);

    const [cryptoUserEmail] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, dbUser.id))
      .limit(1);
    if (cryptoUserEmail) {
      sendDepositConfirmedEmail(cryptoUserEmail.email, parseFloat(amount).toFixed(2), "crypto", sourceLabel).catch(() => {});
    }

    if (!resolvedChain) {
      console.warn(`[circle/webhook] Could not resolve chain for walletId=${walletId} — sweep skipped. Add blockchain field to webhook or ensure circleWalletIdsJson has the wallet ID.`);
    }
    void triggerGatewaySweep(dbUser.id, resolvedChain ?? "", amount);
  } catch (err: any) {
    console.error("[circle/webhook] Error:", err?.message);
  }
});

// ─── Helper: trigger Gateway sweep after a deposit is credited ────────────────
// For EVM chains: approve() + depositFor() from user SCA via Gas Station.
// For Solana: Step-1 SPL transfer + Step-2 treasury deposit() on Gateway program.
// Skipped if the chain has no deposit support or if the wallet ID is unknown.
async function triggerGatewaySweep(
  userId:   number,
  chainKey: string,
  amount:   string,
): Promise<void> {
  console.info(`[deposit] triggerGatewaySweep: userId=${userId} chain=${chainKey || "(none)"} amount=${amount}`);
  if (!chainKey || !isDepositChain(chainKey)) {
    console.warn(`[deposit] triggerGatewaySweep: chain="${chainKey}" is not a deposit chain — sweep skipped`);
    return;
  }

  const [user] = await db
    .select({
      circleWalletId:  usersTable.circleWalletId,
      walletIdsJson:   (usersTable as any).circleWalletIdsJson,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) return;

  let walletId: string | undefined;

  if (user.walletIdsJson) {
    try {
      const map = JSON.parse(user.walletIdsJson) as Record<string, string>;
      walletId = map[chainKey];
    } catch { /* ignore */ }
  }

  // Fall back to primary wallet ID (BASE-SEPOLIA)
  if (!walletId && chainKey === "BASE-SEPOLIA" && user.circleWalletId) {
    walletId = user.circleWalletId;
  }

  if (!walletId) {
    console.warn(`[deposit] triggerGatewaySweep: no wallet ID for chain=${chainKey} user=${userId} — sweep skipped`);
    return;
  }

  const chain = getChain(chainKey);

  try {
    if (chainKey === "ARC-TESTNET") {
      // Arc USDC is a native precompile — must use createContractExecutionTransaction,
      // not createTransaction (which Circle processes as an off-chain internal ledger
      // transfer that never lands on-chain and never reaches the Unified Balance).
      await arcTestnetSweep({ userWalletId: walletId, amount });
      console.info(`[deposit] Arc sweep submitted: user=${userId}`);
    } else if (chain.type === "evm") {
      const { approveTxId, depositForTxId } = await evmGatewaySweep({
        userWalletId: walletId,
        chainKey:     chainKey as ChainKey,
        amount,
      });
      console.info(
        `[deposit] Gateway sweep submitted: approve=${approveTxId} depositFor=${depositForTxId} user=${userId} chain=${chainKey}`,
      );
    } else if (chainKey === "SOL-DEVNET") {
      // solanaSweep runs Step-1 (SPL transfer) then polls until confirmed,
      // then fires Step-2 (treasury → Gateway program deposit()).
      await solanaSweep({ userSolanaWalletId: walletId, amount });
      console.info(`[deposit] Solana full sweep completed: user=${userId}`);
    }
  } catch (err: any) {
    // Log but don't throw — the user was already credited; reconciliation workers
    // will catch any USDC left on the user SCA.
    console.error(
      `[deposit] triggerGatewaySweep failed: chain=${chainKey} user=${userId} err=${err?.message}`,
    );
  }
}

// ─── Helper: enqueue bridge job (idempotent) ──────────────────────────────────
async function enqueueBridgeJobIfNeeded(
  userId:      number,
  sourceChain: SourceChain | undefined,
  destAddress: string | undefined,
  amount:      string,
  txHash:      string | null | undefined,
): Promise<void> {
  if (!sourceChain || !destAddress) return;
  const platformAddress = getPlatformWalletAddress();
  if (platformAddress && destAddress.toLowerCase() === platformAddress.toLowerCase()) return;

  try {
    if (txHash) {
      const [found] = await db
        .select({ id: bridgeJobsTable.id })
        .from(bridgeJobsTable)
        .where(eq(bridgeJobsTable.txHash, txHash))
        .limit(1);
      if (found) return;
    }

    await db.insert(bridgeJobsTable).values({
      userId,
      sourceChain,
      userWalletAddress: destAddress,
      amount:            parseFloat(amount).toFixed(6),
      txHash:            txHash ?? null,
      status:            "pending",
    });
    console.info(`[circle/webhook] Bridge job enqueued for ${amount} USDC on ${sourceChain}`);
    triggerBridgeWorker();
  } catch (e: any) {
    console.warn(`[circle/webhook] Bridge job insert failed: ${e?.message}`);
  }
}

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
