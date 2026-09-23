/**
 * Authenticator-app 2FA (TOTP, RFC 6238) — compatible with Google Authenticator,
 * Authy, 1Password, etc. SHA-1, 6 digits, 30-second steps.
 *
 * Secrets are stored AES-256-GCM encrypted with TOTP_ENCRYPTION_KEY, never in plaintext.
 */

import crypto from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS       = 6;
const DRIFT_STEPS  = 1; // accept the previous and next step for clock drift
const ISSUER       = "Sweep";

// ── Base32 (RFC 4648, no padding) ────────────────────────────────────────────

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── Core algorithm ───────────────────────────────────────────────────────────

/** HOTP (RFC 4226) for a given counter. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS, algo: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac(algo, secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const currentStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / STEP_SECONDS);

/**
 * Returns the matching time step, or null. Pass `lastStep` to reject a code that
 * was already used (same or earlier step). Comparison is constant-time.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, nowMs = Date.now()): number | null {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretB32);
  const now = currentStep(nowMs);
  for (let d = -DRIFT_STEPS; d <= DRIFT_STEPS; d++) {
    const step = now + d;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = hotp(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) return step;
  }
  return null;
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20)); // 160-bit, as RFC 4226 recommends
}

export function otpauthUrl(secretB32: string, accountEmail: string): string {
  const label = encodeURIComponent(`${ISSUER}:${accountEmail}`);
  const params = new URLSearchParams({ secret: secretB32, issuer: ISSUER, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Encryption at rest ───────────────────────────────────────────────────────

function encryptionKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("TOTP_ENCRYPTION_KEY is not configured (needs 32+ characters) — authenticator 2FA is unavailable");
  }
  // Accept any sufficiently long secret; derive a fixed 32-byte key from it.
  return crypto.createHash("sha256").update(raw).digest();
}

export function isTotpConfigured(): boolean {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  return !!raw && raw.length >= 32;
}

/** Output format: base64(iv).base64(tag).base64(ciphertext) */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(stored: string): string {
  const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !enc) throw new Error("Malformed encrypted TOTP secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
