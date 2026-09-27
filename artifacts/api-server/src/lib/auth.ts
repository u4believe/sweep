import jwt from "jsonwebtoken";
import { createHmac, randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";

// ─── JWT secret validation ────────────────────────────────────────────────────
// Fail hard at startup if no secret is configured; never use a default in prod.
const INSECURE_DEFAULT = "usdc-send-secret-key-change-in-prod";
const JWT_SECRET = process.env.JWT_SECRET || INSECURE_DEFAULT;

if (JWT_SECRET === INSECURE_DEFAULT && process.env.NODE_ENV === "production") {
  throw new Error(
    "[auth] JWT_SECRET is set to the insecure default value. " +
    "Set a strong random secret via the JWT_SECRET environment variable before running in production.",
  );
}

if (JWT_SECRET.length < 32) {
  // Warn loudly in any environment; a short secret is cryptographically weak
  console.warn("[auth] WARNING: JWT_SECRET is shorter than 32 characters. Use a securely generated random value.");
}

export interface JwtPayload {
  userId: number;
  email: string;
  /** The user's session version when the token was issued (missing = 0). */
  sv?: number;
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

/** A session token for this user, tied to their current session version. */
export function sessionToken(user: { id: number; email: string; sessionVersion: number }): string {
  return generateToken({ userId: user.id, email: user.email, sv: user.sessionVersion });
}

/**
 * Signs the user out everywhere: every token issued before this call stops
 * working. Returns the new version, for a fresh token on the current device.
 */
export async function endAllSessions(userId: number): Promise<number> {
  const { db, usersTable } = await import("@workspace/db");
  const { eq, sql } = await import("drizzle-orm");
  const [row] = await db.update(usersTable)
    .set({ sessionVersion: sql`${usersTable.sessionVersion} + 1` })
    .where(eq(usersTable.id, userId))
    .returning({ sessionVersion: usersTable.sessionVersion });
  return row?.sessionVersion ?? 0;
}

async function currentSessionVersion(userId: number): Promise<number | null> {
  const { db, usersTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const [row] = await db.select({ sessionVersion: usersTable.sessionVersion })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return row ? row.sessionVersion : null;
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// Short-lived tokens for a single purpose (e.g. a pending 2FA login). Signed with a
// key derived per scope, so they can never pass verifyToken / requireAuth.
const scopedSecret = (scope: string) => createHmac("sha256", JWT_SECRET).update(`scope:${scope}`).digest("hex");

export function signScopedToken(scope: string, payload: object, expiresIn: `${number}m`): string {
  return jwt.sign({ ...payload, jti: randomUUID() }, scopedSecret(scope), { expiresIn });
}

export function verifyScopedToken<T extends object>(scope: string, token: string): T & { jti: string } {
  return jwt.verify(token, scopedSecret(scope)) as T & { jti: string };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized", message: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.substring(7);
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token", code: "SESSION_EXPIRED" });
    return;
  }

  // A password change or reset bumps the version, ending every older session.
  try {
    const version = await currentSessionVersion(payload.userId);
    if (version === null || (payload.sv ?? 0) !== version) {
      res.status(401).json({ error: "Unauthorized", message: "You've been signed out. Please log in again.", code: "SESSION_ENDED" });
      return;
    }
  } catch (err) {
    next(err);
    return;
  }

  (req as any).user = payload;
  next();
}

/**
 * Middleware: ensures the authenticated user has verified their email.
 * Must be used AFTER requireAuth.
 */
export async function requireEmailVerified(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as any).user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized", message: "Not authenticated" });
    return;
  }
  try {
    const { db, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [user] = await db.select({ emailVerified: (usersTable as any).emailVerified })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!user?.emailVerified) {
      res.status(403).json({
        error: "Email not verified",
        message: "Please verify your email address before performing this action.",
        code: "EMAIL_NOT_VERIFIED",
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
