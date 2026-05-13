/**
 * Developer Portal account management.
 *
 * POST /api/developer/register — create developer account
 * POST /api/developer/login    — authenticate and get JWT
 * GET  /api/developer/me       — profile + API keys + stats
 * POST /api/developer/api-keys — generate a new API key
 * DELETE /api/developer/api-keys/:id — revoke a key
 * GET  /api/developer/stats    — subscriber + revenue stats
 */

import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db, developersTable, developerApiKeysTable, subscriptionsTable, subscriptionPaymentsTable, subscriptionPlansTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { hashApiKey, generateApiKey } from "../lib/apiKeyAuth.js";
import { sendDevPasswordResetEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const DEV_JWT_SECRET = process.env.DEV_JWT_SECRET!;
const MERCHANT_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateMerchantId(): string {
  const bytes = crypto.randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += MERCHANT_CHARSET[bytes[i]! % MERCHANT_CHARSET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

function devToken(id: number, email: string) {
  return jwt.sign({ developerId: id, email, type: "developer" }, DEV_JWT_SECRET, { expiresIn: "7d" });
}

function requireDevAuth(req: Request, res: Response, next: () => void): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), DEV_JWT_SECRET) as any;
    if (payload.type !== "developer") throw new Error("Not a developer token");
    (req as any).devUser = { developerId: payload.developerId, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
  }
}

// ─── POST /api/developer/register ────────────────────────────────────────────

router.post("/register", async (req, res) => {
  try {
    const { email, password, name, paymentEmail } = req.body as Record<string, unknown>;

    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Validation", message: "Valid email is required" });
      return;
    }
    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Validation", message: "Name is required" });
      return;
    }
    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "Validation", message: "Password must be at least 8 characters" });
      return;
    }
    if (typeof paymentEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paymentEmail)) {
      res.status(400).json({ error: "Validation", message: "Valid paymentEmail is required" });
      return;
    }

    const [existing] = await db
      .select({ id: developersTable.id })
      .from(developersTable)
      .where(eq(developersTable.email, email.toLowerCase().trim()))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "Conflict", message: "An account with this email already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Generate unique merchant ID
    let merchantId: string;
    let attempts = 0;
    while (true) {
      merchantId = generateMerchantId();
      const dup = await db.select({ id: developersTable.id })
        .from(developersTable)
        .where(eq(developersTable.merchantId, merchantId))
        .limit(1);
      if (dup.length === 0) break;
      if (++attempts > 10) throw new Error("Could not generate unique merchant ID");
    }

    const [developer] = await db.insert(developersTable).values({
      email:        email.toLowerCase().trim(),
      passwordHash,
      name:         name.trim(),
      merchantId:   merchantId!,
      paymentEmail: paymentEmail.toLowerCase().trim(),
    }).returning({ id: developersTable.id, email: developersTable.email, merchantId: developersTable.merchantId, name: developersTable.name });

    // Auto-provision initial live + test API keys
    const liveKey = generateApiKey("live");
    const testKey = generateApiKey("test");

    await db.insert(developerApiKeysTable).values([
      {
        developerId: developer!.id,
        keyHash:     hashApiKey(liveKey),
        keyPrefix:   liveKey.slice(0, 20) + "...",
        type:        "live",
        label:       "Default live key",
      },
      {
        developerId: developer!.id,
        keyHash:     hashApiKey(testKey),
        keyPrefix:   testKey.slice(0, 20) + "...",
        type:        "test",
        label:       "Default test key",
      },
    ]);

    const token = devToken(developer!.id, developer!.email);

    logger.info({ developerId: developer!.id, merchantId: merchantId! }, "[developer] Registered");

    res.status(201).json({
      token,
      developer: {
        id:         developer!.id,
        email:      developer!.email,
        name:       developer!.name,
        merchantId: developer!.merchantId,
      },
      // Show keys once at registration — they cannot be retrieved again
      apiKeys: { live: liveKey, test: testKey },
      message: "Save your API keys — they are shown once and cannot be retrieved again.",
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[developer] Register error");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /api/developer/login ────────────────────────────────────────────────

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as Record<string, unknown>;
    if (typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Validation", message: "email and password are required" });
      return;
    }

    const [developer] = await db
      .select()
      .from(developersTable)
      .where(eq(developersTable.email, email.toLowerCase().trim()))
      .limit(1);

    if (!developer) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(password, developer.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid email or password" });
      return;
    }

    const token = devToken(developer.id, developer.email);
    res.json({
      token,
      developer: {
        id:         developer.id,
        email:      developer.email,
        name:       developer.name,
        merchantId: developer.merchantId,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /api/developer/me ────────────────────────────────────────────────────

router.get("/me", requireDevAuth as any, async (req, res) => {
  try {
    const { developerId } = (req as any).devUser;

    const [developer] = await db
      .select()
      .from(developersTable)
      .where(eq(developersTable.id, developerId))
      .limit(1);

    if (!developer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const keys = await db
      .select({
        id:         developerApiKeysTable.id,
        keyPrefix:  developerApiKeysTable.keyPrefix,
        type:       developerApiKeysTable.type,
        label:      developerApiKeysTable.label,
        active:     developerApiKeysTable.active,
        lastUsedAt: developerApiKeysTable.lastUsedAt,
        createdAt:  developerApiKeysTable.createdAt,
      })
      .from(developerApiKeysTable)
      .where(eq(developerApiKeysTable.developerId, developerId));

    res.json({
      developer: {
        id:           developer.id,
        email:        developer.email,
        name:         developer.name,
        merchantId:   developer.merchantId,
        paymentEmail: developer.paymentEmail,
        createdAt:    developer.createdAt,
      },
      apiKeys: keys,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /api/developer/api-keys ────────────────────────────────────────────

router.post("/api-keys", requireDevAuth as any, async (req, res) => {
  try {
    const { developerId } = (req as any).devUser;
    const { type, label } = req.body as { type?: string; label?: string };

    if (type !== "live" && type !== "test") {
      res.status(400).json({ error: "Validation", message: "type must be 'live' or 'test'" });
      return;
    }

    const rawKey = generateApiKey(type as "live" | "test");

    const [keyRow] = await db.insert(developerApiKeysTable).values({
      developerId,
      keyHash:    hashApiKey(rawKey),
      keyPrefix:  rawKey.slice(0, 20) + "...",
      type,
      label:      label?.trim() || `${type} key`,
    }).returning({ id: developerApiKeysTable.id, createdAt: developerApiKeysTable.createdAt });

    res.status(201).json({
      id:        keyRow!.id,
      key:       rawKey,
      type,
      label:     label?.trim() || `${type} key`,
      createdAt: keyRow!.createdAt,
      message:   "Save this key — it cannot be retrieved again.",
    });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── DELETE /api/developer/api-keys/:id ───────────────────────────────────────

router.delete("/api-keys/:id", requireDevAuth as any, async (req, res) => {
  try {
    const { developerId } = (req as any).devUser;
    const keyId = parseInt(String(req.params["id"]), 10);

    const [key] = await db
      .select()
      .from(developerApiKeysTable)
      .where(
        and(
          eq(developerApiKeysTable.id, keyId),
          eq(developerApiKeysTable.developerId, developerId),
        ),
      )
      .limit(1);

    if (!key) {
      res.status(404).json({ error: "Not found", message: "API key not found" });
      return;
    }

    await db.update(developerApiKeysTable)
      .set({ active: false, revokedAt: new Date() })
      .where(eq(developerApiKeysTable.id, keyId));

    res.json({ message: "API key revoked" });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /api/developer/stats ─────────────────────────────────────────────────

router.get("/stats", requireDevAuth as any, async (req, res) => {
  try {
    const { developerId } = (req as any).devUser;

    const [developer] = await db
      .select({ merchantId: developersTable.merchantId })
      .from(developersTable)
      .where(eq(developersTable.id, developerId))
      .limit(1);

    if (!developer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const allSubs = await db
      .select({ status: subscriptionsTable.status, amount: subscriptionsTable.amount })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.merchantId, developer.merchantId));

    const active    = allSubs.filter((s) => s.status === "active").length;
    const trialing  = allSubs.filter((s) => s.status === "trialing").length;
    const cancelled = allSubs.filter((s) => s.status === "cancelled" || s.status === "failed").length;
    const mrr       = allSubs
      .filter((s) => s.status === "active")
      .reduce((sum, s) => sum + parseFloat(s.amount), 0);

    const payments = await db
      .select({ status: subscriptionPaymentsTable.status, amount: subscriptionPaymentsTable.amount })
      .from(subscriptionPaymentsTable)
      .where(eq(subscriptionPaymentsTable.merchantId, developer.merchantId));

    const totalRevenue = payments
      .filter((p) => p.status === "succeeded")
      .reduce((sum, p) => sum + parseFloat(p.amount), 0);

    res.json({
      merchantId: developer.merchantId,
      subscribers: { active, trialing, cancelled, total: allSubs.length },
      mrr:          mrr.toFixed(2),
      totalRevenue: totalRevenue.toFixed(2),
    });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /api/developer/forgot-password ─────────────────────────────────────

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body as { email?: unknown };

    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Validation", message: "Valid email is required" });
      return;
    }

    const [developer] = await db
      .select({ id: developersTable.id, email: developersTable.email })
      .from(developersTable)
      .where(eq(developersTable.email, email.toLowerCase().trim()))
      .limit(1);

    // Always respond 200 — never reveal whether the email is registered
    if (!developer) {
      res.json({ message: "If that email is registered you will receive a reset link shortly." });
      return;
    }

    const plaintext  = crypto.randomBytes(32).toString("hex");
    const tokenHash  = crypto.createHash("sha256").update(plaintext).digest("hex");
    const expiresAt  = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await db.update(developersTable)
      .set({ resetToken: tokenHash, resetTokenExpiresAt: expiresAt })
      .where(eq(developersTable.id, developer.id));

    const origin   = process.env.APP_ORIGIN ?? "http://localhost:5173";
    const resetUrl = `${origin}/developer/reset-password?token=${plaintext}`;

    await sendDevPasswordResetEmail(developer.email, resetUrl);

    res.json({ message: "If that email is registered you will receive a reset link shortly." });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /api/developer/reset-password ──────────────────────────────────────

router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body as { token?: unknown; newPassword?: unknown };

    if (typeof token !== "string" || !token.trim()) {
      res.status(400).json({ error: "Validation", message: "Reset token is required" });
      return;
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      res.status(400).json({ error: "Validation", message: "Password must be at least 8 characters" });
      return;
    }

    const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");

    const [developer] = await db
      .select({ id: developersTable.id, resetTokenExpiresAt: developersTable.resetTokenExpiresAt })
      .from(developersTable)
      .where(eq(developersTable.resetToken, tokenHash))
      .limit(1);

    if (!developer || !developer.resetTokenExpiresAt || developer.resetTokenExpiresAt < new Date()) {
      res.status(400).json({ error: "Invalid token", message: "This reset link is invalid or has expired." });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await db.update(developersTable)
      .set({
        passwordHash,
        resetToken:          null,
        resetTokenExpiresAt: null,
        updatedAt:           new Date(),
      })
      .where(eq(developersTable.id, developer.id));

    res.json({ message: "Password updated successfully. You can now log in." });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /api/developer/subscribers ──────────────────────────────────────────

router.get("/subscribers", requireDevAuth as any, async (req, res) => {
  try {
    const { developerId } = (req as any).devUser;

    const [developer] = await db
      .select({ merchantId: developersTable.merchantId })
      .from(developersTable)
      .where(eq(developersTable.id, developerId))
      .limit(1);

    if (!developer) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const rows = await db
      .select({
        id:               subscriptionsTable.id,
        subscriberEmail:  usersTable.email,
        planId:           subscriptionsTable.planId,
        planName:         subscriptionPlansTable.planTitle,
        planInterval:     subscriptionsTable.planInterval,
        amount:           subscriptionsTable.amount,
        status:           subscriptionsTable.status,
        externalRef:      subscriptionsTable.externalRef,
        activationMethod: subscriptionsTable.activationMethod,
        startedAt:        subscriptionsTable.startedAt,
        trialEndsAt:      subscriptionsTable.trialEndsAt,
        nextBillingAt:    subscriptionsTable.nextBillingAt,
        cancelledAt:      subscriptionsTable.cancelledAt,
        createdAt:        subscriptionsTable.createdAt,
      })
      .from(subscriptionsTable)
      .innerJoin(usersTable,               eq(usersTable.id,               subscriptionsTable.subscriberUserId))
      .innerJoin(subscriptionPlansTable,   eq(subscriptionPlansTable.id,   subscriptionsTable.planId))
      .where(eq(subscriptionsTable.merchantId, developer.merchantId))
      .orderBy(desc(subscriptionsTable.createdAt));

    res.json({ subscribers: rows });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;