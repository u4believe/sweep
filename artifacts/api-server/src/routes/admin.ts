/**
 * Admin routes — protected by ADMIN_SECRET header.
 *
 *   GET  /api/admin/treasury                  — Platform treasury balance (ARC-TESTNET)
 *   POST /api/admin/withdraw                  — Send USDC from treasury to any address
 *   POST /api/admin/setup-gateway-delegate    — One-time: create EOA signer + addDelegate on all chains
 *   GET  /api/admin/blocked-ips               — List currently blocked IPs
 *   GET  /api/admin/ip-stats/:ip              — Violation history for a specific IP
 *   POST /api/admin/unblock-ip                — Manually lift a block
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  circleTransferUsdc,
  getDcwClient,
  getWalletUsdcBalance,
  getPlatformWalletId,
  getPlatformWalletAddress,
  probeGasStationStatus,
  isGasStationEnabled,
  PRIMARY_BLOCKCHAIN,
} from "../lib/circle.js";
import { getBlockedIps, getIpStats, unblockIp } from "../lib/threatMonitor.js";
import { provisionGatewayDelegate, arcTestnetSweep, getGatewayUnifiedBalance, arcTreasuryDepositFor } from "../lib/gatewaySweep.js";

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

// ─── GET /api/admin/treasury-wallets ─────────────────────────────────────────
// Diagnostic: fetches the actual blockchain + address for each treasury wallet ID
// from Circle's API. Use this to verify CIRCLE_PLATFORM_WALLET_ADDRESS_* env vars
// match the real wallet addresses (mismatch = sweeps go to the wrong address).
router.get("/treasury-wallets", requireAdmin, async (req, res) => {
  const client = getDcwClient();
  if (!client) {
    res.status(503).json({ error: "Circle DCW client not configured" });
    return;
  }

  const walletIds: Record<string, string | undefined> = {
    "ARC-TESTNET":    process.env.CIRCLE_PLATFORM_WALLET_ID_ARC_TESTNET,
    "BASE-SEPOLIA":   process.env.CIRCLE_PLATFORM_WALLET_ID_BASE_SEPOLIA,
    "ARB-SEPOLIA":    process.env.CIRCLE_PLATFORM_WALLET_ID_ARB_SEPOLIA,
    "OP-SEPOLIA":     process.env.CIRCLE_PLATFORM_WALLET_ID_OP_SEPOLIA,
    "MATIC-AMOY":     process.env.CIRCLE_PLATFORM_WALLET_ID_MATIC_AMOY,
    "AVAX-FUJI":      process.env.CIRCLE_PLATFORM_WALLET_ID_AVAX_FUJI,
    "SOL-DEVNET":     process.env.CIRCLE_PLATFORM_WALLET_ID_SOL,
  };

  const configuredAddresses: Record<string, string> = {
    "ARC-TESTNET":  process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_ARC_TESTNET ?? process.env.CIRCLE_PLATFORM_WALLET_ADDRESS ?? "",
    "BASE-SEPOLIA": process.env.CIRCLE_PLATFORM_WALLET_ADDRESS ?? "",
  };

  const results: Record<string, any> = {};

  for (const [chain, walletId] of Object.entries(walletIds)) {
    if (!walletId) { results[chain] = { walletId: null, note: "not configured" }; continue; }
    try {
      const info = await (client as any).getWallet({ id: walletId });
      const raw    = (info as any)?.data;
      const wallet = raw?.data?.wallet ?? raw?.wallet ?? null;
      const actualAddress   = wallet?.address   ?? null;
      const actualBlockchain = wallet?.blockchain ?? null;
      const configured      = configuredAddresses[chain] ?? null;
      results[chain] = {
        walletId,
        actualAddress,
        actualBlockchain,
        configuredAddress: configured,
        addressMatch: configured ? actualAddress?.toLowerCase() === configured.toLowerCase() : null,
      };
    } catch (e: any) {
      results[chain] = { walletId, error: e?.message };
    }
  }

  res.json({ treasuryWallets: results });
});

// ─── POST /api/admin/arc-depositfor ──────────────────────────────────────────
// One-time recovery: pushes USDC already sitting in the Arc treasury wallet
// into the Gateway Unified Balance (approve + depositFor, no user→treasury step).
// Use this when old sweeps moved USDC to treasury but never called depositFor.
// Body: { "amount": "100.000000" }
router.post("/arc-depositfor", requireAdmin, async (req, res) => {
  const { amount } = req.body as { amount?: unknown };
  if (typeof amount !== "string" || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    res.status(400).json({ error: "Validation error", message: "amount (positive USDC string) is required" });
    return;
  }
  try {
    const result = await arcTreasuryDepositFor(amount);
    res.json({ success: true, amount, ...result });
  } catch (err: any) {
    req.log.error({ err }, "[admin] Arc depositFor error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /api/admin/unified-balance ──────────────────────────────────────────
router.get("/unified-balance", requireAdmin, async (req, res) => {
  try {
    const { perChain, total } = await getGatewayUnifiedBalance();
    res.json({
      depositor: process.env.CIRCLE_PLATFORM_WALLET_ADDRESS,
      perChain,
      totalUsdc: total.toFixed(6),
    });
  } catch (err: any) {
    req.log.error({ err }, "[admin] Unified balance error");
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
  const ip    = String(req.params.ip);
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

// ─── POST /api/admin/setup-gateway-delegate ───────────────────────────────────
// One-time setup for cross-chain Gateway withdrawals.
//
// 1. Creates a Circle DCW EOA wallet (or reuses CIRCLE_GATEWAY_SIGNER_WALLET_ID
//    if already set in .env).
// 2. Submits addDelegate(usdcAddress, eoaAddress) on the GatewayWallet contract
//    from each SCA treasury wallet on every Gateway-supported chain.
//
// After running, copy the returned signerWalletId and signerAddress into .env:
//   CIRCLE_GATEWAY_SIGNER_WALLET_ID=<signerWalletId>
//   CIRCLE_GATEWAY_SIGNER_ADDRESS=<signerAddress>
// then restart the server. addDelegate txs confirm in ~30 s on testnets.
//
// Optional body: { "walletSetId": "<id>" } to use a specific wallet set.
router.post("/setup-gateway-delegate", requireAdmin, async (req, res) => {
  try {
    const walletSetId: string | undefined = req.body?.walletSetId;
    const result = await provisionGatewayDelegate(walletSetId ? { walletSetId } : undefined);

    req.log.info(result, "[admin] Gateway delegate provisioned");

    res.json({
      ...result,
      message:
        result.delegated.length > 0
          ? `addDelegate submitted on ${result.delegated.join(", ")}. ` +
            "Add CIRCLE_GATEWAY_SIGNER_WALLET_ID and CIRCLE_GATEWAY_SIGNER_ADDRESS to .env, then restart."
          : "Wallet created but no addDelegate txs succeeded — check treasury wallet config.",
    });
  } catch (err: any) {
    req.log.error({ err: err.message }, "[admin] setup-gateway-delegate failed");
    res.status(500).json({ error: "Setup failed", message: err.message });
  }
});

// ─── POST /api/admin/sweep-wallet ─────────────────────────────────────────────
// Sweeps USDC from any Circle DCW wallet on Arc Testnet to the platform treasury.
//
// Body (one of):
//   { "sourceWalletId": "<circle-wallet-uuid>", "amount"?: "n.nnnnnn" }
//   { "sourceAddress":  "0x...",                "amount"?: "n.nnnnnn" }
//
// sourceAddress is resolved to a Circle wallet ID by looking up the user in the
// DB. Omit amount to sweep the full available balance.
router.post("/sweep-wallet", requireAdmin, async (req, res) => {
  try {
    const { sourceWalletId: rawWalletId, sourceAddress, amount } = req.body as {
      sourceWalletId?: string;
      sourceAddress?:  string;
      amount?:         string;
    };

    let walletId = rawWalletId;

    // Resolve EVM address → Circle wallet ID
    if (!walletId && sourceAddress) {
      const addr = sourceAddress.toLowerCase();

      // Check users table (primary address or per-chain JSON map)
      const [byPrimary] = await db
        .select({ circleWalletId: usersTable.circleWalletId, walletIdsJson: (usersTable as any).circleWalletIdsJson })
        .from(usersTable)
        .where(sql`lower(${usersTable.circleWalletAddress}) = ${addr}`)
        .limit(1);

      if (byPrimary) {
        // Prefer the Arc Testnet wallet ID if available in the JSON map
        if (byPrimary.walletIdsJson) {
          const ids = JSON.parse(byPrimary.walletIdsJson) as Record<string, string>;
          walletId = ids["ARC-TESTNET"] ?? byPrimary.circleWalletId ?? undefined;
        } else {
          walletId = byPrimary.circleWalletId ?? undefined;
        }
      }

      if (!walletId) {
        // Check per-chain addresses JSON
        const [byChainAddr] = await db
          .select({ walletIdsJson: (usersTable as any).circleWalletIdsJson })
          .from(usersTable)
          .where(sql`lower(${(usersTable as any).circleWalletAddressesJson}::text) like ${"%" + addr + "%"}`)
          .limit(1);

        if (byChainAddr?.walletIdsJson) {
          const ids = JSON.parse(byChainAddr.walletIdsJson) as Record<string, string>;
          walletId = ids["ARC-TESTNET"] ?? Object.values(ids)[0];
        }
      }

      if (!walletId) {
        res.status(404).json({
          error:   "Not found",
          message: `No Circle wallet found for address ${sourceAddress}. Pass sourceWalletId directly instead.`,
        });
        return;
      }
    }

    if (!walletId) {
      res.status(400).json({
        error:   "Validation error",
        message: "Provide either sourceWalletId (Circle wallet UUID) or sourceAddress (EVM 0x...)",
      });
      return;
    }

    let sweepAmount = amount ? parseFloat(amount) : 0;

    if (!sweepAmount) {
      const balance = await getWalletUsdcBalance(walletId);
      sweepAmount = parseFloat(balance);
      if (sweepAmount <= 0) {
        res.status(400).json({
          error:   "No balance",
          message: `Wallet ${walletId} has no USDC on Arc Testnet to sweep`,
        });
        return;
      }
    }

    const treasury = process.env.CIRCLE_PLATFORM_WALLET_ADDRESS_ARC_TESTNET
                  ?? process.env.CIRCLE_PLATFORM_WALLET_ADDRESS;

    const txId = await arcTestnetSweep({ userWalletId: walletId, amount: sweepAmount.toFixed(6) });

    req.log.info({ txId, walletId, sourceAddress, sweepAmount, treasury }, "[admin] sweep-wallet submitted");

    res.json({
      txId,
      sourceWalletId: walletId,
      sourceAddress:  sourceAddress ?? null,
      amount:         sweepAmount.toFixed(6),
      treasury,
      message: `Sweeping ${sweepAmount.toFixed(6)} USDC from ${sourceAddress ?? walletId} → ${treasury}`,
    });
  } catch (err: any) {
    req.log.error({ err: err.message }, "[admin] sweep-wallet failed");
    res.status(502).json({ error: "Sweep failed", message: err.message });
  }
});

export default router;
