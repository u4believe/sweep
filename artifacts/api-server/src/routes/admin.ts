/**
 * Admin routes — protected by ADMIN_SECRET header.
 *
 *   GET  /api/admin/treasury          — Platform treasury balance (ARC-TESTNET)
 *   GET  /api/admin/bridge-jobs       — Bridge job ledger (paginated)
 *   POST /api/admin/bridge-jobs/:id/retry — Manually requeue a failed job
 *   POST /api/admin/withdraw          — Send USDC from treasury to any address
 *   GET  /api/admin/blocked-ips       — List currently blocked IPs
 *   GET  /api/admin/ip-stats/:ip      — Violation history for a specific IP
 *   POST /api/admin/unblock-ip        — Manually lift a block
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, bridgeJobsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  circleTransferUsdc,
  getWalletUsdcBalance,
  getPlatformWalletId,
  getPlatformWalletAddress,
  probeGasStationStatus,
  isGasStationEnabled,
  PRIMARY_BLOCKCHAIN,
} from "../lib/circle.js";
import { getBlockedIps, getIpStats, unblockIp } from "../lib/threatMonitor.js";

const router: IRouter = Router();

// ─── Admin auth ───────────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || adminSecret.length < 20) {
    res.status(503).json({ error: "Admin not configured", message: "ADMIN_SECRET env var is not set or too short" });
    return;
  }
  const token = (req.headers.authorization ?? "").replace("Bearer ", "");
  const hashA = createHmac("sha256", "admin-verify").update(adminSecret).digest();
  const hashB = createHmac("sha256", "admin-verify").update(token).digest();
  if (!token || !timingSafeEqual(hashA, hashB)) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or missing admin secret" });
    return;
  }
  next();
}

// ─── GET /api/admin/treasury ──────────────────────────────────────────────────
router.get("/treasury", requireAdmin, async (req, res) => {
  try {
    const payoutWalletId = getPlatformWalletId();
    const payoutAddress  = getPlatformWalletAddress();

    const [payoutBalance] = await Promise.all([
      payoutWalletId ? getWalletUsdcBalance(payoutWalletId) : Promise.resolve("0"),
      probeGasStationStatus().catch(() => {}),
    ]);

    res.json({
      treasury: {
        chain:    PRIMARY_BLOCKCHAIN,
        walletId: payoutWalletId,
        address:  payoutAddress,
        balance:  payoutBalance,
        note:     "All user withdrawals are paid from this Circle DCW wallet",
      },
      gasStation: isGasStationEnabled() ? "enabled" : "disabled",
    });
  } catch (err: any) {
    req.log.error({ err }, "[admin] Treasury error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /api/admin/bridge-jobs ───────────────────────────────────────────────
router.get("/bridge-jobs", requireAdmin, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(String(req.query.limit  ?? "50"), 10), 200);
    const offset = parseInt(String(req.query.offset ?? "0"),  10);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    const jobs = status
      ? await db.select().from(bridgeJobsTable)
          .where(eq(bridgeJobsTable.status, status))
          .orderBy(desc(bridgeJobsTable.createdAt))
          .limit(limit).offset(offset)
      : await db.select().from(bridgeJobsTable)
          .orderBy(desc(bridgeJobsTable.createdAt))
          .limit(limit).offset(offset);

    res.json({ jobs, limit, offset });
  } catch (err: any) {
    req.log.error({ err }, "[admin] Bridge jobs error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /api/admin/bridge-jobs/:id/retry ────────────────────────────────────
router.post("/bridge-jobs/:id/retry", requireAdmin, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Validation error", message: "Invalid job id" });
      return;
    }

    const [job] = await db.select().from(bridgeJobsTable)
      .where(eq(bridgeJobsTable.id, id)).limit(1);

    if (!job) {
      res.status(404).json({ error: "Not found", message: `Bridge job ${id} not found` });
      return;
    }

    await db.update(bridgeJobsTable)
      .set({ status: "pending", attempts: 0, lastError: null, updatedAt: new Date() })
      .where(eq(bridgeJobsTable.id, id));

    req.log.info({ jobId: id }, "[admin] Bridge job manually requeued");
    res.json({ success: true, jobId: id, message: "Job requeued — bridge worker will pick it up shortly" });
  } catch (err: any) {
    req.log.error({ err }, "[admin] Retry bridge job error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /api/admin/withdraw ─────────────────────────────────────────────────
// Sends USDC from the ARC-TESTNET treasury to any address.
router.post("/withdraw", requireAdmin, async (req, res) => {
  try {
    const { destinationAddress, amount } = req.body as { destinationAddress?: string; amount?: string };

    if (!destinationAddress || !/^0x[0-9a-fA-F]{40}$/.test(destinationAddress)) {
      res.status(400).json({ error: "Validation error", message: "destinationAddress must be a valid EVM address" });
      return;
    }

    const numAmount = parseFloat(amount ?? "");
    if (isNaN(numAmount) || numAmount <= 0) {
      res.status(400).json({ error: "Validation error", message: "amount must be a positive number" });
      return;
    }

    const platformAddress = getPlatformWalletAddress();
    if (!platformAddress) {
      res.status(503).json({ error: "Not configured", message: "CIRCLE_PLATFORM_WALLET_ADDRESS is not set" });
      return;
    }

    const txId = await circleTransferUsdc(
      platformAddress,
      destinationAddress,
      PRIMARY_BLOCKCHAIN,
      "",
      numAmount.toFixed(6),
    );

    req.log.info({ txId, destinationAddress, amount: numAmount }, "[admin] Withdrawal initiated");

    res.json({
      txId,
      destinationAddress,
      amount:     numAmount.toFixed(6),
      blockchain: PRIMARY_BLOCKCHAIN,
      message:    `Initiated transfer of ${numAmount.toFixed(6)} USDC to ${destinationAddress} on ${PRIMARY_BLOCKCHAIN}`,
    });
  } catch (err: any) {
    req.log.error({ err }, "[admin] Withdraw error");
    res.status(502).json({ error: "Transfer failed", message: err.message });
  }
});

// ─── GET /api/admin/blocked-ips ──────────────────────────────────────────────
router.get("/blocked-ips", requireAdmin, (_req, res) => {
  res.json({ blocked: getBlockedIps() });
});

// ─── GET /api/admin/ip-stats/:ip ─────────────────────────────────────────────
router.get("/ip-stats/:ip", requireAdmin, (req, res) => {
  const ip    = req.params.ip;
  const stats = getIpStats(ip);
  if (!stats) {
    res.status(404).json({ error: "Not found", message: "No record for this IP" });
    return;
  }
  const now = Date.now();
  res.json({
    ip,
    blocked:          stats.blockUntil > now,
    blockUntil:       stats.blockUntil > now ? new Date(stats.blockUntil).toISOString() : null,
    retryAfterSec:    stats.blockUntil > now ? Math.ceil((stats.blockUntil - now) / 1_000) : 0,
    blockCount:       stats.blockCount,
    recentViolations: stats.violations.length,
    reqCount:         stats.reqCount,
  });
});

// ─── POST /api/admin/unblock-ip ──────────────────────────────────────────────
router.post("/unblock-ip", requireAdmin, (req, res) => {
  const { ip } = req.body as { ip?: string };
  if (!ip?.trim()) {
    res.status(400).json({ error: "Validation error", message: "ip is required" });
    return;
  }
  const removed = unblockIp(ip.trim());
  if (!removed) {
    res.status(404).json({ error: "Not found", message: "No active block for this IP" });
    return;
  }
  req.log.info({ ip }, "[admin] IP manually unblocked");
  res.json({ success: true, message: `Block lifted for ${ip}` });
});

export default router;
