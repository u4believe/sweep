/**
 * Security routes — transaction password, PAK, and password changes.
 *
 * All routes require authentication (JWT).
 *
 * Transaction password
 * ─────────────────────
 *  POST /api/security/txn-password/request-otp   — sends OTP to email
 *  POST /api/security/txn-password/set            — verifies OTP + sets the password
 *
 * Personal Authorization Key (PAK)
 * ─────────────────────────────────
 *  GET  /api/security/status                      — returns security status flags
 *  POST /api/security/pak/request-otp             — checks 6-month rule, sends OTP
 *  POST /api/security/pak/generate                — verifies OTP, creates PAK, returns plaintext ONCE
 *  POST /api/security/pak/confirm-copied          — marks pakCopiedAt; key is permanently masked after
 *
 * Password changes (require PAK + OTP)
 * ─────────────────────────────────────
 *  POST /api/security/change-login-password/request-otp  — verifies PAK, sends OTP
 *  POST /api/security/change-login-password/confirm      — verifies OTP, updates login password
 *  POST /api/security/change-txn-password/request-otp   — verifies PAK (with 2FA on: nothing), sends OTP
 *  POST /api/security/change-txn-password/confirm        — OTP + PAK (with 2FA on: OTP + authenticator code)
 *
 * Authenticator-app 2FA (optional)
 * ─────────────────────────────────
 *  POST /api/security/2fa/setup                  — creates a pending secret, returns it + otpauth URL
 *  POST /api/security/2fa/enable                 — verifies a code from the app, turns 2FA on
 *  POST /api/security/2fa/disable/request-otp    — sends an email code
 *  POST /api/security/2fa/disable                — email code + authenticator code (or PAK), turns 2FA off
 */

import { Router, type IRouter } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db, usersTable, otpCodesTable, subscriptionPassportsTable } from "@workspace/db";
import { hashEmail } from "../lib/escrow.js";
import { eq, and, gt, ne, sql } from "drizzle-orm";
import { requireAuth, requireEmailVerified } from "../lib/auth.js";
import { sendSecurityOtpEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { encryptSecret, decryptSecret, generateTotpSecret, isTotpConfigured, otpauthUrl, verifyTotp } from "../lib/totp.js";
import { checkUserTotp, hasTotp } from "../lib/two-factor.js";

const router: IRouter = Router();

// ── Constants ────────────────────────────────────────────────────────────────

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000; // approx. 6 calendar months
const PAK_CHARSET   = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars, no 0/O/I/1
const PAK_LENGTH    = 40;
const BCRYPT_ROUNDS = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateOtp(): string {
  return String(crypto.randomInt(100000, 1000000));
}

async function issueOtp(userId: number, type: string): Promise<string> {
  const code      = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.insert(otpCodesTable).values({ userId, code, type, expiresAt });
  return code;
}

async function findOtp(userId: number, code: string, type: string): Promise<number | null> {
  const [otp] = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.userId, userId),
        eq(otpCodesTable.code, code.trim()),
        eq(otpCodesTable.type, type),
        eq(otpCodesTable.used, false),
        gt(otpCodesTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return otp?.id ?? null;
}

/** Marks an OTP used; false if another request already used it. */
async function consumeOtp(id: number): Promise<boolean> {
  const rows = await db.update(otpCodesTable)
    .set({ used: true })
    .where(and(eq(otpCodesTable.id, id), eq(otpCodesTable.used, false)))
    .returning({ id: otpCodesTable.id });
  return rows.length === 1;
}

async function verifyOtp(userId: number, code: string, type: string): Promise<boolean> {
  const id = await findOtp(userId, code, type);
  return id !== null && consumeOtp(id);
}

function generatePak(): string {
  const bytes = crypto.randomBytes(PAK_LENGTH);
  let pak = "";
  for (let i = 0; i < PAK_LENGTH; i++) {
    pak += PAK_CHARSET[bytes[i] % PAK_CHARSET.length];
  }
  return pak;
}

function maskPak(prefix: string, suffix: string): string {
  return `${prefix}${"*".repeat(PAK_LENGTH - prefix.length - suffix.length)}${suffix}`;
}

// ── GET /api/security/status ─────────────────────────────────────────────────

router.get("/status", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found", message: "User not found" }); return; }

    const hasPak = !!user.pakHash;
    const pakCopied = !!user.pakCopiedAt;
    let pakCanRegenerate = !hasPak; // if no PAK, can always create one
    let nextPakAllowedAt: string | null = null;

    if (hasPak && user.pakCreatedAt) {
      const elapsed = Date.now() - user.pakCreatedAt.getTime();
      pakCanRegenerate = elapsed >= SIX_MONTHS_MS;
      if (!pakCanRegenerate) {
        nextPakAllowedAt = new Date(user.pakCreatedAt.getTime() + SIX_MONTHS_MS).toISOString();
      }
    }

    res.json({
      hasTransactionPassword: !!user.transactionPasswordHash,
      hasPak,
      pakCopied,
      pakPreview: hasPak && user.pakPrefix && user.pakSuffix
        ? maskPak(user.pakPrefix, user.pakSuffix)
        : null,
      pakCreatedAt: user.pakCreatedAt?.toISOString() ?? null,
      pakCanRegenerate,
      nextPakAllowedAt,
      twoFactorEnabled: hasTotp(user),
    });
  } catch (err: any) {
    logger.error({ err }, "[security/status]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/txn-password/request-otp ──────────────────────────────

router.post("/txn-password/request-otp", requireAuth, async (req, res) => {
  try {
    const { userId, email } = (req as any).user;
    const code = await issueOtp(userId, "txn-pwd");
    await sendSecurityOtpEmail(email, code, "txn-pwd");
    res.json({ sent: true, message: "Verification code sent to your email." });
  } catch (err: any) {
    logger.error({ err }, "[security/txn-password/request-otp]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/txn-password/set ──────────────────────────────────────

// First-time transaction password setup — no OTP required.
// PAK must exist first (users set PAK before transaction password during onboarding).
// To CHANGE an existing transaction password, use /change-txn-password which requires OTP.
router.post("/txn-password/set", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const { password } = req.body as { password?: unknown };

    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Validation error", message: "password must be at least 6 characters" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found", message: "User not found" }); return; }

    // Enforce that PAK is generated before transaction password
    if (!user.pakHash) {
      res.status(409).json({ error: "PAK required", message: "Generate your PAK before setting a transaction password." });
      return;
    }

    // Only allowed when no transaction password exists — use /change-txn-password to update
    if (user.transactionPasswordHash) {
      res.status(409).json({ error: "Conflict", message: "Transaction password already set. Use change-txn-password to update it." });
      return;
    }

    const transactionPasswordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.update(usersTable).set({ transactionPasswordHash }).where(eq(usersTable.id, userId));

    res.json({ success: true, message: "Transaction password set successfully." });
  } catch (err: any) {
    logger.error({ err }, "[security/txn-password/set]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/pak/request-otp ───────────────────────────────────────

router.post("/pak/request-otp", requireAuth, async (req, res) => {
  try {
    const { userId, email } = (req as any).user;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found", message: "User not found" }); return; }

    // Enforce 6-month regeneration lock
    if (user.pakHash && user.pakCreatedAt) {
      const elapsed = Date.now() - user.pakCreatedAt.getTime();
      if (elapsed < SIX_MONTHS_MS) {
        const nextAllowed = new Date(user.pakCreatedAt.getTime() + SIX_MONTHS_MS).toISOString();
        res.status(429).json({
          error: "Too soon",
          message: "Your PAK can only be regenerated once every 6 months.",
          nextPakAllowedAt: nextAllowed,
        });
        return;
      }
    }

    const code = await issueOtp(userId, "pak-gen");
    await sendSecurityOtpEmail(email, code, "pak-gen");
    res.json({ sent: true, message: "Verification code sent to your email." });
  } catch (err: any) {
    logger.error({ err }, "[security/pak/request-otp]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/pak/generate-first ────────────────────────────────────
// First-time PAK generation — no OTP required. Only works when no PAK exists.
// Email is already verified at this point (requireEmailVerified enforced).

router.post("/pak/generate-first", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found", message: "User not found" }); return; }

    if (user.pakHash) {
      res.status(409).json({ error: "Conflict", message: "A PAK already exists. Use regenerate instead." });
      return;
    }

    const pak       = generatePak();
    const pakHash   = await bcrypt.hash(pak, BCRYPT_ROUNDS);
    const pakPrefix = pak.slice(0, 3);
    const pakSuffix = pak.slice(-4);

    await db.update(usersTable)
      .set({ pakHash, pakPrefix, pakSuffix, pakCreatedAt: new Date(), pakCopiedAt: null })
      .where(eq(usersTable.id, userId));

    res.json({
      success: true,
      pak,
      pakPreview: maskPak(pakPrefix, pakSuffix),
      message: "PAK generated. Copy it now — it will not be shown again.",
    });
  } catch (err: any) {
    logger.error({ err }, "[security/pak/generate-first]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/pak/generate ──────────────────────────────────────────
// Returns the full PAK plaintext exactly once. After pakCopiedAt is set the
// full key is permanently irretrievable — not even the server can recover it.

router.post("/pak/generate", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const { otp } = req.body as { otp?: unknown };

    if (typeof otp !== "string") {
      res.status(400).json({ error: "Validation error", message: "otp is required" });
      return;
    }

    const valid = await verifyOtp(userId, otp, "pak-gen");
    if (!valid) {
      res.status(401).json({ error: "Invalid code", message: "OTP is invalid or has expired" });
      return;
    }

    const pak    = generatePak();
    const pakHash = await bcrypt.hash(pak, BCRYPT_ROUNDS);
    const pakPrefix = pak.slice(0, 3);
    const pakSuffix = pak.slice(-4);

    await db.update(usersTable)
      .set({ pakHash, pakPrefix, pakSuffix, pakCreatedAt: new Date(), pakCopiedAt: null })
      .where(eq(usersTable.id, userId));

    // Return the full PAK in plaintext — this is the ONLY time it will be available.
    res.json({
      success: true,
      pak,
      pakPreview: maskPak(pakPrefix, pakSuffix),
      message: "PAK generated. Copy it now — it will not be shown again.",
    });
  } catch (err: any) {
    logger.error({ err }, "[security/pak/generate]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/pak/confirm-copied ─────────────────────────────────────
// The client calls this once the user confirms they have securely stored the PAK.
// After this, the full key is permanently unavailable.

router.post("/pak/confirm-copied", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user?.pakHash) {
      res.status(400).json({ error: "No PAK", message: "No PAK has been generated yet" });
      return;
    }
    await db.update(usersTable).set({ pakCopiedAt: new Date() }).where(eq(usersTable.id, userId));
    res.json({ success: true, message: "PAK confirmed. The full key is now permanently hidden." });
  } catch (err: any) {
    logger.error({ err }, "[security/pak/confirm-copied]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/change-login-password/request-otp ─────────────────────
// Step 1: verify PAK, then send OTP.

router.post("/change-login-password/request-otp", requireAuth, async (req, res) => {
  try {
    const { userId, email } = (req as any).user;
    const { pak } = req.body as { pak?: unknown };

    if (typeof pak !== "string" || !pak.trim()) {
      res.status(400).json({ error: "Validation error", message: "pak is required" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user?.pakHash) {
      res.status(400).json({ error: "No PAK", message: "You must generate a PAK before changing your password" });
      return;
    }

    const pakValid = await bcrypt.compare(pak.trim(), user.pakHash);
    if (!pakValid) {
      res.status(401).json({ error: "Invalid PAK", message: "The authorization key you entered is incorrect" });
      return;
    }

    const code = await issueOtp(userId, "chg-login");
    await sendSecurityOtpEmail(email, code, "chg-login");
    res.json({ sent: true, message: "Verification code sent to your email." });
  } catch (err: any) {
    logger.error({ err }, "[security/change-login-password/request-otp]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/change-login-password/confirm ─────────────────────────
// Step 2: verify PAK again + OTP, then update the login password.

router.post("/change-login-password/confirm", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const { pak, newPassword, otp } = req.body as { pak?: unknown; newPassword?: unknown; otp?: unknown };

    if (typeof pak !== "string" || typeof newPassword !== "string" || typeof otp !== "string") {
      res.status(400).json({ error: "Validation error", message: "pak, newPassword, and otp are required" });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "Validation error", message: "New password must be at least 8 characters" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user?.pakHash) {
      res.status(400).json({ error: "No PAK", message: "You must generate a PAK before changing your password" });
      return;
    }

    const pakValid = await bcrypt.compare(pak.trim(), user.pakHash);
    if (!pakValid) {
      res.status(401).json({ error: "Invalid PAK", message: "The authorization key you entered is incorrect" });
      return;
    }

    const otpValid = await verifyOtp(userId, otp, "chg-login");
    if (!otpValid) {
      res.status(401).json({ error: "Invalid code", message: "OTP is invalid or has expired" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, userId));

    res.json({ success: true, message: "Login password updated successfully." });
  } catch (err: any) {
    logger.error({ err }, "[security/change-login-password/confirm]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/change-txn-password/request-otp ───────────────────────
// Step 1: verify PAK, then send OTP.

router.post("/change-txn-password/request-otp", requireAuth, async (req, res) => {
  try {
    const { userId, email } = (req as any).user;
    const { pak } = req.body as { pak?: unknown };

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "Not found", message: "User not found" });
      return;
    }

    // With authenticator 2FA on, the authenticator code (checked at confirm) replaces the PAK.
    if (!hasTotp(user)) {
      if (typeof pak !== "string" || !pak.trim()) {
        res.status(400).json({ error: "Validation error", message: "pak is required" });
        return;
      }
      if (!user.pakHash) {
        res.status(400).json({ error: "No PAK", message: "You must generate a PAK before changing your transaction password" });
        return;
      }
      if (!(await bcrypt.compare(pak.trim(), user.pakHash))) {
        res.status(401).json({ error: "Invalid PAK", message: "The authorization key you entered is incorrect" });
        return;
      }
    }

    const code = await issueOtp(userId, "chg-txn-pwd");
    await sendSecurityOtpEmail(email, code, "chg-txn-pwd");
    res.json({ sent: true, message: "Verification code sent to your email." });
  } catch (err: any) {
    logger.error({ err }, "[security/change-txn-password/request-otp]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/change-txn-password/confirm ───────────────────────────
// Step 2: verify PAK again + OTP, then update the transaction password.

router.post("/change-txn-password/confirm", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const { pak, newPassword, otp, totp } = req.body as { pak?: unknown; newPassword?: unknown; otp?: unknown; totp?: unknown };

    if (typeof newPassword !== "string" || typeof otp !== "string") {
      res.status(400).json({ error: "Validation error", message: "newPassword and otp are required" });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: "Validation error", message: "Transaction password must be at least 6 characters" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "Not found", message: "User not found" });
      return;
    }

    // Check the email code without spending it, so a wrong second factor doesn't burn it.
    const otpId = await findOtp(userId, otp, "chg-txn-pwd");
    if (otpId === null) {
      res.status(401).json({ error: "Invalid code", message: "OTP is invalid or has expired" });
      return;
    }

    if (hasTotp(user)) {
      if (!(await checkUserTotp(user, totp))) {
        res.status(401).json({ error: "Invalid authenticator code", code: "TOTP_INVALID", message: "That authenticator code is incorrect or has already been used." });
        return;
      }
    } else {
      if (typeof pak !== "string" || !user.pakHash) {
        res.status(400).json({ error: "No PAK", message: "You must generate a PAK before changing your transaction password" });
        return;
      }
      if (!(await bcrypt.compare(pak.trim(), user.pakHash))) {
        res.status(401).json({ error: "Invalid PAK", message: "The authorization key you entered is incorrect" });
        return;
      }
    }

    if (!(await consumeOtp(otpId))) {
      res.status(401).json({ error: "Invalid code", message: "OTP is invalid or has expired" });
      return;
    }

    const transactionPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.update(usersTable).set({ transactionPasswordHash }).where(eq(usersTable.id, userId));

    // Suspend any active passport — old TXN password verification is now stale
    await db.update(subscriptionPassportsTable)
      .set({ status: "suspended" })
      .where(and(eq(subscriptionPassportsTable.userId, userId), ne(subscriptionPassportsTable.status, "revoked")));

    res.json({ success: true, message: "Transaction password updated successfully." });
  } catch (err: any) {
    logger.error({ err }, "[security/change-txn-password/confirm]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/delete-account/request-otp ────────────────────────────
// Step 1: verify PAK, then send OTP to email.

router.post("/delete-account/request-otp", requireAuth, async (req, res) => {
  try {
    const { userId, email } = (req as any).user;
    const { pak } = req.body as { pak?: unknown };

    if (typeof pak !== "string" || !pak.trim()) {
      res.status(400).json({ error: "Validation error", message: "pak is required" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found", message: "User not found" }); return; }

    if (!user.pakHash) {
      res.status(400).json({ error: "No PAK", message: "You must generate a PAK before deleting your account" });
      return;
    }

    const pakValid = await bcrypt.compare(pak.trim(), user.pakHash);
    if (!pakValid) {
      res.status(401).json({ error: "Invalid PAK", message: "The authorization key you entered is incorrect" });
      return;
    }

    const code = await issueOtp(userId, "del-account");
    await sendSecurityOtpEmail(email, code, "del-account");
    res.json({ sent: true, message: "Verification code sent to your email." });
  } catch (err: any) {
    logger.error({ err }, "[security/delete-account/request-otp]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/delete-account/confirm ─────────────────────────────────
// Step 2: verify PAK again + OTP, then permanently delete the account and all data.

router.post("/delete-account/confirm", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const { pak, otp } = req.body as { pak?: unknown; otp?: unknown };

    if (typeof pak !== "string" || typeof otp !== "string") {
      res.status(400).json({ error: "Validation error", message: "pak and otp are required" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found", message: "User not found" }); return; }

    if (!user.pakHash) {
      res.status(400).json({ error: "No PAK", message: "You must generate a PAK before deleting your account" });
      return;
    }

    const pakValid = await bcrypt.compare(pak.trim(), user.pakHash);
    if (!pakValid) {
      res.status(401).json({ error: "Invalid PAK", message: "The authorization key you entered is incorrect" });
      return;
    }

    const otpValid = await verifyOtp(userId, otp, "del-account");
    if (!otpValid) {
      res.status(401).json({ error: "Invalid code", message: "OTP is invalid or has expired" });
      return;
    }

    // Hard-delete ALL user data across every table in dependency order.
    const emailHash = hashEmail(user.email);

    await db.execute(sql`DELETE FROM otp_codes            WHERE user_id        = ${userId}`);
    await db.execute(sql`DELETE FROM claim_nonces          WHERE user_id        = ${userId}`);
    await db.execute(sql`DELETE FROM recurring_transfers   WHERE sender_user_id = ${userId}`);
    await db.execute(sql`DELETE FROM withdrawals           WHERE user_id        = ${userId}`);
    await db.execute(sql`DELETE FROM deposits              WHERE user_id        = ${userId}`);
    await db.execute(sql`DELETE FROM virtual_accounts      WHERE user_id        = ${userId}`);
    // Escrows: delete rows where the user was either sender or recipient
    await db.execute(sql`DELETE FROM escrows WHERE sender_address = ${user.email}`);
    await db.execute(sql`DELETE FROM escrows WHERE email_hash     = ${emailHash}`);
    await db.execute(sql`DELETE FROM escrows WHERE recipient_user_id = ${userId}`);
    // Escrow on-chain balance record keyed by email hash
    await db.execute(sql`DELETE FROM escrow_balances       WHERE email_hash     = ${emailHash}`);
    // On-chain transaction records (escrow deposits/claims) keyed by email hash
    await db.execute(sql`DELETE FROM chain_transactions    WHERE email_hash     = ${emailHash}`);
    await db.execute(sql`DELETE FROM users                 WHERE id             = ${userId}`);

    logger.info({ userId }, "[security/delete-account] Account permanently deleted");
    res.json({ success: true, message: "Your account has been permanently deleted." });
  } catch (err: any) {
    logger.error({ err }, "[security/delete-account/confirm]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/2fa/setup ─────────────────────────────────────────────
// Creates a new (pending) secret. It only becomes active after /2fa/enable
// verifies a code from the app, so a half-finished setup never locks anyone out.

router.post("/2fa/setup", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { userId, email } = (req as any).user;
    if (!isTotpConfigured()) {
      res.status(503).json({ error: "Unavailable", message: "Authenticator 2FA isn't available right now." });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found", message: "User not found" }); return; }
    if (hasTotp(user)) {
      res.status(400).json({ error: "Already enabled", message: "Two-factor authentication is already on." });
      return;
    }

    const secret = generateTotpSecret();
    await db.update(usersTable).set({ totpPendingSecretEnc: encryptSecret(secret) }).where(eq(usersTable.id, userId));
    res.json({ secret, otpauthUrl: otpauthUrl(secret, email) });
  } catch (err: any) {
    logger.error({ err }, "[security/2fa/setup]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/2fa/enable ────────────────────────────────────────────

router.post("/2fa/enable", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const { code } = req.body as { code?: unknown };
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found", message: "User not found" }); return; }
    if (hasTotp(user)) {
      res.status(400).json({ error: "Already enabled", message: "Two-factor authentication is already on." });
      return;
    }
    if (!user.totpPendingSecretEnc) {
      res.status(400).json({ error: "No setup in progress", message: "Start the setup again to get a new QR code." });
      return;
    }

    const step = typeof code === "string" ? verifyTotp(decryptSecret(user.totpPendingSecretEnc), code, null) : null;
    if (step === null) {
      res.status(401).json({ error: "Invalid code", code: "TOTP_INVALID", message: "That code doesn't match. Check the time on your phone and try the current code." });
      return;
    }

    await db.update(usersTable).set({
      totpSecretEnc: user.totpPendingSecretEnc,
      totpPendingSecretEnc: null,
      totpEnabledAt: new Date(),
      totpLastStep: step,
    }).where(eq(usersTable.id, userId));
    logger.info({ userId }, "[security] Authenticator 2FA enabled");
    res.json({ success: true, message: "Two-factor authentication is on." });
  } catch (err: any) {
    logger.error({ err }, "[security/2fa/enable]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/2fa/disable/request-otp ───────────────────────────────

router.post("/2fa/disable/request-otp", requireAuth, async (req, res) => {
  try {
    const { userId, email } = (req as any).user;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user || !hasTotp(user)) {
      res.status(400).json({ error: "Not enabled", message: "Two-factor authentication is not on." });
      return;
    }
    const code = await issueOtp(userId, "disable-2fa");
    await sendSecurityOtpEmail(email, code, "disable-2fa");
    res.json({ sent: true, message: "Verification code sent to your email." });
  } catch (err: any) {
    logger.error({ err }, "[security/2fa/disable/request-otp]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ── POST /api/security/2fa/disable ───────────────────────────────────────────
// Email code + authenticator code. If the phone is lost, the PAK can stand in
// for the authenticator code.

router.post("/2fa/disable", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const { otp, totp, pak } = req.body as { otp?: unknown; totp?: unknown; pak?: unknown };
    if (typeof otp !== "string") {
      res.status(400).json({ error: "Validation error", message: "otp is required" });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user || !hasTotp(user)) {
      res.status(400).json({ error: "Not enabled", message: "Two-factor authentication is not on." });
      return;
    }

    const otpId = await findOtp(userId, otp, "disable-2fa");
    if (otpId === null) {
      res.status(401).json({ error: "Invalid code", message: "OTP is invalid or has expired" });
      return;
    }

    if (typeof pak === "string" && pak.trim()) {
      if (!user.pakHash || !(await bcrypt.compare(pak.trim(), user.pakHash))) {
        res.status(401).json({ error: "Invalid PAK", message: "The authorization key you entered is incorrect" });
        return;
      }
    } else if (!(await checkUserTotp(user, totp))) {
      res.status(401).json({ error: "Invalid authenticator code", code: "TOTP_INVALID", message: "That authenticator code is incorrect or has already been used." });
      return;
    }

    if (!(await consumeOtp(otpId))) {
      res.status(401).json({ error: "Invalid code", message: "OTP is invalid or has expired" });
      return;
    }

    await db.update(usersTable).set({
      totpSecretEnc: null,
      totpPendingSecretEnc: null,
      totpEnabledAt: null,
      totpLastStep: null,
    }).where(eq(usersTable.id, userId));
    logger.info({ userId }, "[security] Authenticator 2FA disabled");
    res.json({ success: true, message: "Two-factor authentication is off." });
  } catch (err: any) {
    logger.error({ err }, "[security/2fa/disable]");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;
