// ─── Email one-time codes ─────────────────────────────────────────────────────
// One place for every 6-digit email code (sign-up, login, security actions,
// subscriptions):
//   • expire after 5 minutes
//   • only the newest code for an account + purpose is valid
//   • a new code at most every 30 s and 10 per hour per account + purpose
//   • 5 wrong guesses void the code; a new one must be requested
//   • entering the right code clears both limits, so people who sign in and out
//     often are never held back — only someone who keeps guessing wrong is
// That caps an online guesser at ~50 guesses an hour against 1,000,000 codes.
// Throttle and failure counters are in memory, per process.

import crypto from "node:crypto";
import { db, otpCodesTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";

export const OTP_TTL_MS         = 5 * 60 * 1000;
export const OTP_TTL_MINUTES    = OTP_TTL_MS / 60_000;
const OTP_MAX_FAILURES          = 5;
const RESEND_MIN_GAP_MS         = 30 * 1000;
const MAX_ISSUES_PER_HOUR       = 10;

export class OtpThrottledError extends Error {
  constructor(public retryAfterSec: number) { super(`Please wait ${retryAfterSec}s before requesting another code`); }
}
export class OtpLockedError extends Error {
  constructor() { super("Too many incorrect codes. Request a new code and try again."); }
}

const key = (userId: number, type: string) => `${userId}:${type}`;
const failures = new Map<string, number>();
const issued   = new Map<string, number[]>(); // issue timestamps in the last hour

/** Create a new code (voiding earlier ones). Throws OtpThrottledError if requested too often. */
export async function issueOtp(userId: number, type: string): Promise<string> {
  const k   = key(userId, type);
  const now = Date.now();
  const recent = (issued.get(k) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  const last = recent[recent.length - 1];
  if (last !== undefined && now - last < RESEND_MIN_GAP_MS) {
    throw new OtpThrottledError(Math.ceil((RESEND_MIN_GAP_MS - (now - last)) / 1000));
  }
  if (recent.length >= MAX_ISSUES_PER_HOUR) {
    throw new OtpThrottledError(Math.ceil((recent[0]! + 60 * 60 * 1000 - now) / 1000));
  }

  await db.update(otpCodesTable).set({ used: true })
    .where(and(eq(otpCodesTable.userId, userId), eq(otpCodesTable.type, type), eq(otpCodesTable.used, false)));

  const code = String(crypto.randomInt(100000, 1000000));
  await db.insert(otpCodesTable).values({ userId, code, type, expiresAt: new Date(now + OTP_TTL_MS) });
  issued.set(k, [...recent, now]);
  failures.delete(k);
  return code;
}

/**
 * Issue and send a code where one was just requested implicitly (login, sign-up).
 * When throttled, nothing new is sent — the last code is still valid — and the
 * caller gets retryAfterSec so it can tell the user to use that code.
 */
export async function issueAndSendOtp(
  userId: number, type: string, send: (code: string) => Promise<void>,
): Promise<{ sent: true } | { sent: false; retryAfterSec: number }> {
  try {
    await send(await issueOtp(userId, type));
    return { sent: true };
  } catch (err) {
    if (err instanceof OtpThrottledError) return { sent: false, retryAfterSec: err.retryAfterSec };
    throw err;
  }
}

/** Extra response fields when no new code was sent. */
export const codeStatus = (r: Awaited<ReturnType<typeof issueAndSendOtp>>) =>
  r.sent ? {} : { codeAlreadySent: true, retryAfterSec: r.retryAfterSec };

/**
 * The id of the matching live code, or null. A wrong code counts toward the
 * limit; at the limit the code is voided and OtpLockedError is thrown.
 */
export async function findOtp(userId: number, code: string, type: string): Promise<number | null> {
  const k = key(userId, type);
  if ((failures.get(k) ?? 0) >= OTP_MAX_FAILURES) throw new OtpLockedError();

  const [otp] = await db.select({ id: otpCodesTable.id }).from(otpCodesTable)
    .where(and(
      eq(otpCodesTable.userId, userId),
      eq(otpCodesTable.code, String(code).trim()),
      eq(otpCodesTable.type, type),
      eq(otpCodesTable.used, false),
      gt(otpCodesTable.expiresAt, new Date()),
    ))
    .limit(1);

  if (otp) {
    // Right code: this person has the inbox, so lift the send and guess limits
    failures.delete(k);
    issued.delete(k);
    return otp.id;
  }

  const n = (failures.get(k) ?? 0) + 1;
  failures.set(k, n);
  if (n >= OTP_MAX_FAILURES) {
    await db.update(otpCodesTable).set({ used: true })
      .where(and(eq(otpCodesTable.userId, userId), eq(otpCodesTable.type, type), eq(otpCodesTable.used, false)));
    throw new OtpLockedError();
  }
  return null;
}

/** Mark a code used; false if another request already used it. */
export async function consumeOtp(id: number): Promise<boolean> {
  const rows = await db.update(otpCodesTable).set({ used: true })
    .where(and(eq(otpCodesTable.id, id), eq(otpCodesTable.used, false)))
    .returning({ id: otpCodesTable.id });
  return rows.length === 1;
}

/** Find + consume in one step. */
export async function verifyOtp(userId: number, code: string, type: string): Promise<boolean> {
  const id = await findOtp(userId, code, type);
  return id !== null && consumeOtp(id);
}

/** Send the 429 for a throttled request or a locked code; false for any other error. */
export function otpErrorResponse(res: { status: (n: number) => { json: (b: unknown) => unknown }; setHeader?: (k: string, v: string) => unknown }, err: unknown): boolean {
  if (err instanceof OtpThrottledError) {
    res.setHeader?.("Retry-After", String(err.retryAfterSec));
    res.status(429).json({ error: "Too many requests", message: `Please wait ${err.retryAfterSec} seconds before requesting another code.`, retryAfterSec: err.retryAfterSec });
    return true;
  }
  if (err instanceof OtpLockedError) {
    res.status(429).json({ error: "Too many attempts", message: err.message, code: "OTP_LOCKED" });
    return true;
  }
  return false;
}
