import { Router, type IRouter } from "express";
import { db, depositsTable, withdrawalsTable, escrowsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth.js";
import { hashEmail } from "../lib/escrow.js";
import { resolveCircleOnChainTxHash } from "../lib/circle.js";

const router: IRouter = Router();

// ─── GET /api/user/history ────────────────────────────────────────────────────
// Returns a unified, date-sorted list of all transactions for the logged-in user:
//   • USDC deposits (on-chain, any supported chain)
//   • USDC crypto withdrawals + USD fiat withdrawals
//   • USD escrow transfers (sent and received)
//
// Each entry includes counterparty info (sender address, recipient address/email,
// bank destination, blockchain network) so the frontend can display full details.

router.get("/history", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const emailHash = hashEmail(user.email);

    const PAGE_SIZE = 10;
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);

    const [deposits, withdrawals, sentEscrows, receivedEscrows] = await Promise.all([
      db
        .select()
        .from(depositsTable)
        .where(eq(depositsTable.userId, user.userId))
        .orderBy(desc(depositsTable.createdAt)),

      db
        .select()
        .from(withdrawalsTable)
        .where(eq(withdrawalsTable.userId, user.userId))
        .orderBy(desc(withdrawalsTable.createdAt)),

      db
        .select()
        .from(escrowsTable)
        .where(eq(escrowsTable.senderAddress, user.email.toLowerCase()))
        .orderBy(desc(escrowsTable.createdAt)),

      db
        .select()
        .from(escrowsTable)
        .where(eq(escrowsTable.emailHash, emailHash))
        .orderBy(desc(escrowsTable.createdAt)),
    ]);

    // ── Resolve on-chain hashes for crypto deposits (fire-and-forget) ───────────
    // Deposits credited by the Circle webhook use depositReference = "circle-{txId}"
    // and may have txHash = null when Circle hadn't indexed the on-chain hash yet.
    // Resolve now so the history shows a clickable block explorer link.
    const pendingDepositHashResolution = deposits
      .filter((d) => d.type === "crypto" && !d.txHash && d.depositReference?.startsWith("circle-"))
      .map(async (d) => {
        try {
          const circleId = d.depositReference!.slice("circle-".length);
          const hash = await resolveCircleOnChainTxHash(circleId);
          if (hash) {
            await db.update(depositsTable).set({ txHash: hash }).where(eq(depositsTable.id, d.id));
            d.txHash = hash;
          }
        } catch { /* non-fatal */ }
      });
    void Promise.allSettled(pendingDepositHashResolution);

    // ── Map deposits → unified format ────────────────────────────────────────
    const depositEntries = deposits.map((d) => ({
      id:          `dep-${d.id}`,
      category:    "deposit" as const,
      currency:    d.type === "bank" ? "USD" : "USDC",
      direction:   "in" as const,
      amount:      d.amount,
      status:      d.status,
      network:     d.source,
      txHash:      d.txHash ?? null,
      fromAddress: null,
      toAddress:   null,
      description: d.source,
      createdAt:   d.createdAt,
      completedAt: d.creditedAt ?? null,
    }));

    // ── Resolve on-chain hashes for crypto withdrawals (fire-and-forget) ───────
    // Two cases that need resolution:
    //   (a) New style: circleTransferId set, txHash null → freshly-completed withdrawal
    //   (b) Old style: txHash contains a Circle UUID (pre-fix), circleTransferId null
    // Non-blocking — response is not delayed.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const pendingHashResolution = withdrawals
      .filter((w) => {
        if (w.type !== "crypto") return false;
        if (!w.txHash && w.circleTransferId) return true;               // case (a)
        if (w.txHash && UUID_RE.test(w.txHash) && !w.circleTransferId) return true; // case (b)
        return false;
      })
      .map(async (w) => {
        try {
          const circleId = w.circleTransferId ?? w.txHash!; // either source
          const hash = await resolveCircleOnChainTxHash(circleId);
          if (hash) {
            await db.update(withdrawalsTable)
              .set({ txHash: hash, circleTransferId: circleId })
              .where(eq(withdrawalsTable.id, w.id));
            w.txHash = hash;
            w.circleTransferId = circleId;
          }
        } catch { /* non-fatal */ }
      });
    void Promise.allSettled(pendingHashResolution);

    // ── Map withdrawals → unified format ─────────────────────────────────────
    const withdrawalEntries = withdrawals.map((w) => ({
      id:          `wd-${w.id}`,
      category:    "withdrawal" as const,
      currency:    w.type === "fiat" ? "USD" : "USDC",
      direction:   "out" as const,
      amount:      w.amount,
      status:      w.status,
      network:     w.type === "crypto"
                     ? (/\(([^)]+)\)$/.exec(w.destination ?? "")?.[1] ?? "Crypto")
                     : "Bank transfer",
      txHash:      w.txHash ?? null,
      fromAddress: null,
      toAddress:   w.destination,
      description: w.type === "crypto"
        ? `Sent to ${w.destination}`
        : `Bank withdrawal — ${w.destination}`,
      createdAt:   w.createdAt,
      completedAt: w.completedAt ?? null,
    }));

    // ── Map escrows → unified format ─────────────────────────────────────────
    const sentEntries = sentEscrows.map((e) => ({
      id:          `esc-s-${e.id}`,
      category:    "escrow" as const,
      currency:    "USD" as const,
      direction:   "out" as const,
      amount:      e.amount,
      status:      e.status,
      network:     "Sweep",
      txHash:      e.txHash ?? null,
      fromAddress: e.senderAddress,
      toAddress:   e.recipientEmail,
      description: `Sent to ${e.recipientEmail}`,
      createdAt:   e.createdAt,
      completedAt: e.claimedAt ?? null,
    }));

    const receivedEntries = receivedEscrows.map((e) => ({
      id:          `esc-r-${e.id}`,
      category:    "escrow" as const,
      currency:    "USD" as const,
      direction:   "in" as const,
      amount:      e.amount,
      status:      e.status,
      network:     "Sweep",
      txHash:      e.txHash ?? null,
      fromAddress: e.senderAddress,
      toAddress:   e.recipientEmail,
      description: `Received from ${e.senderAddress}`,
      createdAt:   e.createdAt,
      completedAt: e.claimedAt ?? null,
    }));

    // ── Merge and sort all entries by date descending ─────────────────────────
    const all = [
      ...depositEntries,
      ...withdrawalEntries,
      ...sentEntries,
      ...receivedEntries,
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total      = all.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage   = Math.min(page, totalPages);
    const start      = (safePage - 1) * PAGE_SIZE;
    const paginated  = all.slice(start, start + PAGE_SIZE);

    res.json({ transactions: paginated, total, page: safePage, totalPages });
  } catch (error: any) {
    req.log.error({ err: error }, "[user/history] Error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

export default router;
