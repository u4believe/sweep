/**
 * Authenticator-app 2FA for user accounts: checking a user's code (with replay
 * protection) and the short-lived challenge used between Google sign-in and the
 * authenticator step.
 */

import { db, usersTable } from "@workspace/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { decryptSecret, verifyTotp } from "./totp.js";
import { signScopedToken, verifyScopedToken } from "./auth.js";

type UserRow = typeof usersTable.$inferSelect;

export const hasTotp = (u: Pick<UserRow, "totpSecretEnc" | "totpEnabledAt">) => !!u.totpSecretEnc && !!u.totpEnabledAt;

/**
 * Verifies `code` against the user's active authenticator secret and records the
 * step atomically, so the same code can't be accepted twice (even concurrently).
 */
export async function checkUserTotp(user: UserRow, code: unknown): Promise<boolean> {
  if (!hasTotp(user) || typeof code !== "string") return false;
  const step = verifyTotp(decryptSecret(user.totpSecretEnc!), code, user.totpLastStep ?? null);
  if (step === null) return false;
  const claimed = await db.update(usersTable)
    .set({ totpLastStep: step })
    .where(and(eq(usersTable.id, user.id), or(isNull(usersTable.totpLastStep), lt(usersTable.totpLastStep, step))))
    .returning({ id: usersTable.id });
  return claimed.length === 1;
}

// ── Login challenge (Google sign-in → authenticator code) ───────────────────

const CHALLENGE_SCOPE = "2fa-login";
const MAX_CHALLENGE_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; expiresAt: number }>();

export function issueLoginChallenge(userId: number): string {
  return signScopedToken(CHALLENGE_SCOPE, { userId }, "5m");
}

/**
 * Returns the challenge's userId, or throws. Each challenge allows a limited number
 * of code attempts before it must be restarted.
 */
export function readLoginChallenge(token: unknown): { userId: number; jti: string } {
  if (typeof token !== "string") throw new Error("Missing challenge");
  const payload = verifyScopedToken<{ userId: number }>(CHALLENGE_SCOPE, token);
  const now = Date.now();
  for (const [k, v] of attempts) if (v.expiresAt < now) attempts.delete(k);
  const entry = attempts.get(payload.jti) ?? { count: 0, expiresAt: now + 5 * 60_000 };
  if (entry.count >= MAX_CHALLENGE_ATTEMPTS) throw new Error("Too many attempts — please sign in again");
  entry.count++;
  attempts.set(payload.jti, entry);
  return { userId: payload.userId, jti: payload.jti };
}

export function consumeLoginChallenge(jti: string): void {
  attempts.set(jti, { count: MAX_CHALLENGE_ATTEMPTS, expiresAt: Date.now() + 5 * 60_000 });
}
