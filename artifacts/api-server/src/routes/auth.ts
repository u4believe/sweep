import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcrypt";
import { db, usersTable, otpCodesTable, escrowsTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { generateToken, requireAuth } from "../lib/auth.js";
import { hashEmail } from "../lib/escrow.js";
import { createUserCircleWallet, ensureArcTestnetWallet } from "../lib/circle.js";
import { sendOtpEmail, sendVerificationEmail, sendPasswordResetEmail } from "../lib/email.js";
import { randomUUID, randomInt } from "node:crypto";
import {
  RegisterUserBody,
  LoginUserBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ─── Real IP resolution ───────────────────────────────────────────────────────
// When behind Cloudflare, CF-Connecting-IP is the real client IP.
// Falls back to Express's req.ip (which uses X-Forwarded-For when trust proxy=1).
function realIp(req: any): string {
  return (
    (req.headers["cf-connecting-ip"] as string | undefined) ||
    req.ip ||
    "unknown"
  );
}

// ─── Cloudflare Turnstile verification ───────────────────────────────────────
// Server-side token verification. Returns true if TURNSTILE_SECRET_KEY is not
// configured (dev mode bypass) so development isn't blocked.
async function verifyTurnstile(token: string | undefined): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured — allow through
  if (!token)  return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ secret, response: token }),
    });
    const data = await res.json() as { success: boolean };
    return data.success === true;
  } catch {
    return true; // on network error don't block real users
  }
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

const registerLimiter = rateLimit({
  windowMs:         60 * 60 * 1000, // 1 hour
  max:              5,
  keyGenerator:     (req) => realIp(req),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many requests", message: "Too many registration attempts. Try again in 1 hour." },
});

const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              10,
  keyGenerator:     (req) => realIp(req),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many requests", message: "Too many login attempts. Try again in 15 minutes." },
});

const otpLimiter = rateLimit({
  windowMs:         10 * 60 * 1000,
  max:              5,
  keyGenerator:     (req) => String((req.body as any)?.userId ?? realIp(req)),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many requests", message: "Too many verification attempts. Try again in 10 minutes." },
});

const resendLimiter = rateLimit({
  windowMs:         10 * 60 * 1000,
  max:              3,
  keyGenerator:     (req) => String((req.body as any)?.userId ?? realIp(req)),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many requests", message: "Too many resend attempts. Try again in 10 minutes." },
});

const resendVerificationLimiter = rateLimit({
  windowMs:         60 * 60 * 1000, // 1 hour
  max:              5,
  keyGenerator:     (req) => realIp(req),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many requests", message: "Too many resend attempts. Try again in 1 hour." },
});

const forgotPasswordLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              5,
  keyGenerator:     (req) => realIp(req),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many requests", message: "Too many password reset attempts. Try again in 15 minutes." },
});

const resetPasswordLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              5,
  keyGenerator:     (req) => realIp(req),
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many requests", message: "Too many reset attempts. Try again in 15 minutes." },
});

function generateOtp(): string {
  return String(randomInt(100000, 1000000));
}

async function issueOtp(userId: number, type: "register" | "login"): Promise<string> {
  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  await db.insert(otpCodesTable).values({ userId, code, type, expiresAt });
  return code;
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
// Creates user account and sends an email verification link.
// The user must click the link before they can perform any transactions.
router.post("/register", registerLimiter, async (req, res) => {
  try {
    const parsed = RegisterUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }

    const { email, password, name } = parsed.data;
    const { cfToken } = req.body as { cfToken?: string };
    if (!(await verifyTurnstile(cfToken))) {
      res.status(400).json({ error: "Bot check failed", message: "Please complete the security check." });
      return;
    }
    const normalizedEmail = email.toLowerCase().trim();

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);

    if (existing) {
      if ((existing as any).emailVerified) {
        // Verified account — this email is taken.
        res.status(409).json({ error: "Conflict", message: "Email already registered" });
        return;
      }

      // Unverified account — treat as if they never finished registering.
      // Re-issue a fresh 72-hour verification link and return the same response
      // as a new registration so they can complete verification.
      const verificationToken = randomUUID();
      const tokenExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 h
      await db.update(usersTable)
        .set({
          emailVerificationToken:          verificationToken,
          emailVerificationTokenExpiresAt: tokenExpiry,
        } as any)
        .where(eq(usersTable.id, existing.id));

      const appUrl = process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT || 3001}`;
      const verificationUrl = `${appUrl}/api/auth/verify-email?token=${verificationToken}`;
      await sendVerificationEmail(normalizedEmail, verificationUrl);

      res.status(200).json({
        requiresEmailVerification: true,
        resent: true,
        email: normalizedEmail,
        message: "A new verification link has been sent to your email.",
      });
      return;
    }

    const emailHash = hashEmail(normalizedEmail);
    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = randomUUID();
    const tokenExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 h

    const [user] = await db.insert(usersTable).values({
      email: normalizedEmail,
      emailHash,
      passwordHash,
      name,
      emailVerified: false,
      emailVerificationToken:          verificationToken,
      emailVerificationTokenExpiresAt: tokenExpiry,
    } as any).returning();

    // Provision Circle wallet in background
    (async () => {
      try {
        const { walletId, address, walletIdsJson, walletAddressesJson } = await createUserCircleWallet(user.id);
        await db.update(usersTable)
          .set({ circleWalletId: walletId, circleWalletAddress: address, circleWalletIdsJson: walletIdsJson, circleWalletAddressesJson: walletAddressesJson } as any)
          .where(eq(usersTable.id, user.id));
      } catch (e: any) {
        console.warn(`[Circle] Wallet provisioning failed for user ${user.id}:`, e?.message || e);
      }
    })();

    const appUrl = process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT || 3001}`;
    const verificationUrl = `${appUrl}/api/auth/verify-email?token=${verificationToken}`;

    await sendVerificationEmail(normalizedEmail, verificationUrl);
    res.status(201).json({ requiresEmailVerification: true, email: normalizedEmail });
  } catch (error: any) {
    req.log.error({ err: error }, "Registration error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── GET /api/auth/verify-email ───────────────────────────────────────────────
// Clicked from the link in the verification email. Marks email as verified and
// redirects the user to the login page with a ?verified=true flag.
router.get("/verify-email", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";

  if (!token) {
    res.redirect("/login?error=missing-token");
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq((usersTable as any).emailVerificationToken, token))
      .limit(1);

    if (!user) {
      res.redirect("/login?error=invalid-token");
      return;
    }

    if ((user as any).emailVerified) {
      res.redirect("/login?verified=already");
      return;
    }

    // Check 72-hour expiry (if the column exists).
    const tokenExpiry: Date | null = (user as any).emailVerificationTokenExpiresAt ?? null;
    if (tokenExpiry && tokenExpiry < new Date()) {
      res.redirect("/login?error=link-expired");
      return;
    }

    await db.update(usersTable)
      .set({ emailVerified: true, emailVerificationToken: null, emailVerificationTokenExpiresAt: null } as any)
      .where(eq(usersTable.id, user.id));

    req.log.info({ userId: user.id }, "[auth] Email verified");
    res.redirect("/login?verified=true");
  } catch (error: any) {
    req.log.error({ err: error }, "Email verification error");
    res.redirect("/login?error=server-error");
  }
});

// ─── POST /api/auth/resend-verification ──────────────────────────────────────
// Sends a fresh verification email for an unverified account.
router.post("/resend-verification", resendVerificationLimiter, async (req, res) => {
  const { email } = req.body as { email?: unknown };
  if (typeof email !== "string" || !email.trim()) {
    res.status(400).json({ error: "Validation error", message: "email is required" });
    return;
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);

    if (user && !(user as any).emailVerified) {
      const verificationToken = randomUUID();
      const tokenExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
      await db.update(usersTable)
        .set({ emailVerificationToken: verificationToken, emailVerificationTokenExpiresAt: tokenExpiry } as any)
        .where(eq(usersTable.id, user.id));

      const appUrl = process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT || 3001}`;
      const verificationUrl = `${appUrl}/api/auth/verify-email?token=${verificationToken}`;
      await sendVerificationEmail(normalizedEmail, verificationUrl);
    }

    // Always return success to avoid email enumeration
    res.json({ success: true, message: "If that email exists and is unverified, a new link has been sent." });
  } catch (error: any) {
    req.log.error({ err: error }, "Resend verification error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Step 1: validates credentials, sends OTP.
// Returns { requiresOtp: true, userId } — JWT issued after verify-otp.
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const parsed = LoginUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", message: parsed.error.message });
      return;
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
    if (!user) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid email or password" });
      return;
    }

    // Only fully-registered (verified) users may log in.
    if (!(user as any).emailVerified) {
      res.status(403).json({
        error: "Email not verified",
        message: "Please verify your email address before logging in. Check your inbox for the verification link.",
        code: "EMAIL_NOT_VERIFIED",
      });
      return;
    }

    if (!user.emailHash) {
      await db.update(usersTable)
        .set({ emailHash: hashEmail(normalizedEmail) })
        .where(eq(usersTable.id, user.id));
    }

    if (!user.circleWalletAddress) {
      (async () => {
        try {
          const { walletId, address, walletIdsJson, walletAddressesJson } = await createUserCircleWallet(user.id);
          await db.update(usersTable)
            .set({ circleWalletId: walletId, circleWalletAddress: address, circleWalletIdsJson: walletIdsJson, circleWalletAddressesJson: walletAddressesJson } as any)
            .where(eq(usersTable.id, user.id));
        } catch (e: any) {
          console.warn(`[Circle] Wallet backfill failed for user ${user.id}:`, e?.message || e);
        }
      })();
    } else {
      // Backfill Arc Testnet wallet if missing (existing users pre-dating dual-chain provisioning)
      (async () => {
        try {
          const result = await ensureArcTestnetWallet(
            user.circleWalletIdsJson as string | null,
            (user as any).circleWalletAddressesJson as string | null,
          );
          if (result) {
            await db.update(usersTable)
              .set({ circleWalletIdsJson: result.idsJson, circleWalletAddressesJson: result.addrsJson } as any)
              .where(eq(usersTable.id, user.id));
          }
        } catch (e: any) {
          console.warn(`[Circle] Arc wallet backfill failed for user ${user.id}:`, e?.message || e);
        }
      })();
    }

    const code = await issueOtp(user.id, "login");
    await sendOtpEmail(normalizedEmail, code, "login");
    res.json({ requiresOtp: true, userId: user.id });
  } catch (error: any) {
    req.log.error({ err: error }, "Login error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────────
// Step 2 (both flows): verifies OTP, issues JWT.
router.post("/verify-otp", otpLimiter, async (req, res) => {
  try {
    const { userId, code, type } = req.body as { userId?: unknown; code?: unknown; type?: unknown };

    if (typeof userId !== "number" || typeof code !== "string" || (type !== "register" && type !== "login")) {
      res.status(400).json({ error: "Validation error", message: "userId (number), code (string), and type (register|login) are required" });
      return;
    }

    const now = new Date();
    const [otp] = await db
      .select()
      .from(otpCodesTable)
      .where(
        and(
          eq(otpCodesTable.userId, userId),
          eq(otpCodesTable.code, code.trim()),
          eq(otpCodesTable.type, type),
          eq(otpCodesTable.used, false),
          gt(otpCodesTable.expiresAt, now),
        )
      )
      .limit(1);

    if (!otp) {
      res.status(401).json({ error: "Invalid code", message: "Incorrect verification code or it has expired. Please try again." });
      return;
    }

    await db.update(otpCodesTable).set({ used: true }).where(eq(otpCodesTable.id, otp.id));

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "Not found", message: "User not found" });
      return;
    }

    // Auto-credit any pending escrows sent to this email before they registered
    if (type === "register") {
      try {
        const { hashEmail } = await import("../lib/escrow.js");
        const emailHash = hashEmail(user.email);
        const pendingEscrows = await db.select().from(escrowsTable)
          .where(and(eq(escrowsTable.emailHash, emailHash), eq(escrowsTable.status, "pending")));
        if (pendingEscrows.length > 0) {
          const total = pendingEscrows.reduce((s, e) => s + parseFloat(e.amount), 0);
          const newBalance = (parseFloat(user.claimedBalance ?? "0") + total).toFixed(6);
          await db.update(usersTable).set({ claimedBalance: newBalance }).where(eq(usersTable.id, user.id));
          for (const e of pendingEscrows) {
            await db.update(escrowsTable)
              .set({ status: "claimed", recipientUserId: user.id, claimedAt: new Date() })
              .where(eq(escrowsTable.id, e.id));
          }
          req.log.info({ userId: user.id, total, count: pendingEscrows.length }, "[register] Auto-credited pending escrows");
        }
      } catch (e: any) {
        req.log.warn({ err: e.message }, "[register] Auto-credit pending escrows failed (non-fatal)");
      }
    }

    const token = generateToken({ userId: user.id, email: user.email });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        walletAddress: user.walletAddress,
        circleWalletAddress: user.circleWalletAddress,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    req.log.error({ err: error }, "Verify OTP error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── POST /api/auth/resend-otp ────────────────────────────────────────────────
// Resend OTP for a pending verification.
router.post("/resend-otp", resendLimiter, async (req, res) => {
  try {
    const { userId, type } = req.body as { userId?: unknown; type?: unknown };

    if (typeof userId !== "number" || (type !== "register" && type !== "login")) {
      res.status(400).json({ error: "Validation error", message: "userId and type are required" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "Not found", message: "User not found" });
      return;
    }

    const code = await issueOtp(userId, type);
    await sendOtpEmail(user.email, code, type);
    res.json({ success: true, message: "A new verification code has been sent to your email." });
  } catch (error: any) {
    req.log.error({ err: error }, "Resend OTP error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
// Sends a password-reset link. Always returns 200 to prevent email enumeration.
// Token is a random UUID (128 bits), expires in 1 hour, single-use.
// Only works for verified accounts — unverified accounts are not real users.
router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email, cfToken } = req.body as { email?: unknown; cfToken?: string };
  if (typeof email !== "string" || !email.trim()) {
    res.status(400).json({ error: "Validation error", message: "email is required" });
    return;
  }

  if (!(await verifyTurnstile(cfToken))) {
    res.status(400).json({ error: "Bot check failed", message: "Please complete the security check." });
    return;
  }

  // Respond immediately — never reveal whether the email exists.
  res.json({ success: true, message: "If that email is registered, a reset link has been sent." });

  // Process in background so the response time is constant (timing-safe).
  void (async () => {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);

      // Only send reset emails to verified accounts.
      if (!user || !(user as any).emailVerified) return;

      const resetToken = randomUUID();
      const expiresAt  = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.update(usersTable)
        .set({ passwordResetToken: resetToken, passwordResetTokenExpiresAt: expiresAt } as any)
        .where(eq(usersTable.id, user.id));

      const frontendUrl = (process.env.FRONTEND_URL ?? process.env.APP_URL ?? `http://localhost:5173`).replace(/\/$/, "");
      const resetUrl    = `${frontendUrl}/reset-password?token=${resetToken}`;
      await sendPasswordResetEmail(normalizedEmail, resetUrl);
    } catch (e: any) {
      console.error("[forgot-password] Error:", e?.message);
    }
  })();
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
// Verifies the reset token and sets a new password.
// Token is invalidated immediately on use regardless of success.
router.post("/reset-password", resetPasswordLimiter, async (req, res) => {
  const { token, password } = req.body as { token?: unknown; password?: unknown };

  if (typeof token !== "string" || !token.trim()) {
    res.status(400).json({ error: "Validation error", message: "token is required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Validation error", message: "New password must be at least 8 characters" });
    return;
  }

  try {
    const now = new Date();
    const [user] = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq((usersTable as any).passwordResetToken, token.trim()),
          gt((usersTable as any).passwordResetTokenExpiresAt, now),
        ),
      )
      .limit(1);

    if (!user) {
      res.status(400).json({
        error: "Invalid or expired link",
        message: "This password reset link is invalid or has expired. Please request a new one.",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Invalidate the token and save the new password atomically.
    await db.update(usersTable)
      .set({
        passwordHash,
        passwordResetToken:          null,
        passwordResetTokenExpiresAt: null,
      } as any)
      .where(eq(usersTable.id, user.id));

    res.json({ success: true, message: "Password reset successfully. You can now log in with your new password." });
  } catch (error: any) {
    req.log.error({ err: error }, "Reset password error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const [dbUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.userId)).limit(1);
    if (!dbUser) {
      res.status(401).json({ error: "Unauthorized", message: "User not found" });
      return;
    }

    if (!dbUser.circleWalletAddress) {
      (async () => {
        try {
          const { walletId, address, walletIdsJson, walletAddressesJson } = await createUserCircleWallet(dbUser.id);
          await db.update(usersTable)
            .set({ circleWalletId: walletId, circleWalletAddress: address, circleWalletIdsJson: walletIdsJson, circleWalletAddressesJson: walletAddressesJson } as any)
            .where(eq(usersTable.id, dbUser.id));
        } catch (e: any) {
          console.warn(`[Circle] Wallet backfill failed for user ${dbUser.id}:`, e?.message || e);
        }
      })();
    } else {
      // Backfill Arc Testnet wallet if missing (existing users pre-dating dual-chain provisioning)
      (async () => {
        try {
          const result = await ensureArcTestnetWallet(
            dbUser.circleWalletIdsJson as string | null,
            (dbUser as any).circleWalletAddressesJson as string | null,
          );
          if (result) {
            await db.update(usersTable)
              .set({ circleWalletIdsJson: result.idsJson, circleWalletAddressesJson: result.addrsJson } as any)
              .where(eq(usersTable.id, dbUser.id));
          }
        } catch (e: any) {
          console.warn(`[Circle] Arc wallet backfill failed for user ${dbUser.id}:`, e?.message || e);
        }
      })();
    }

    const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;
    const hasPak = !!dbUser.pakHash;
    let pakCanRegenerate = !hasPak;
    let nextPakAllowedAt: string | null = null;
    if (hasPak && dbUser.pakCreatedAt) {
      const elapsed = Date.now() - dbUser.pakCreatedAt.getTime();
      pakCanRegenerate = elapsed >= SIX_MONTHS_MS;
      if (!pakCanRegenerate) {
        nextPakAllowedAt = new Date(dbUser.pakCreatedAt.getTime() + SIX_MONTHS_MS).toISOString();
      }
    }

    res.json({
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      walletAddress: dbUser.walletAddress,
      circleWalletAddress: dbUser.circleWalletAddress,
      createdAt: dbUser.createdAt,
      emailVerified: !!(dbUser as any).emailVerified,
      // Security status
      hasTransactionPassword: !!dbUser.transactionPasswordHash,
      hasPak,
      pakCopied: !!dbUser.pakCopiedAt,
      pakPreview: hasPak && dbUser.pakPrefix && dbUser.pakSuffix
        ? `${dbUser.pakPrefix}${"*".repeat(33)}${dbUser.pakSuffix}`
        : null,
      pakCreatedAt: dbUser.pakCreatedAt?.toISOString() ?? null,
      pakCanRegenerate,
      nextPakAllowedAt,
    });
  } catch (error: any) {
    req.log.error({ err: error }, "Get current user error");
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

// ─── POST /api/auth/test-email ────────────────────────────────────────────────
// Dev/admin tool — sends a test email and reports the exact SMTP result.
// Requires auth so it can't be hit by anonymous callers.
router.post("/test-email", requireAuth, async (req, res) => {
  const { to } = req.body as { to?: unknown };
  if (typeof to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    res.status(400).json({ error: "Validation error", message: "to (valid email) is required" });
    return;
  }

  try {
    await sendOtpEmail(to, "123456", "login");
    res.json({ success: true, message: `Test email sent successfully to ${to}` });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: "SMTP error",
      message: err.message ?? String(err),
      code: err.code,
      command: err.command,
    });
  }
});

export default router;
