// ─── Face ID / fingerprint (WebAuthn passkeys) ───────────────────────────────
// The phone's own biometric unlocks a device-bound key; we only ever see a
// signature, never biometric data. Used to log in (instead of the email /
// authenticator codes, after the password) and to approve transactions
// (instead of the transaction password).
//
// The relying-party ID is the web app's domain, taken from the request's Origin
// when it's an allowed origin: FRONTEND_URL (and its www. twin), anything in
// WEBAUTHN_ORIGINS / ALLOWED_ORIGINS (comma-separated), and localhost outside production.

import { randomUUID } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { db, webauthnCredentialsTable, type WebauthnCredential } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const CHALLENGE_TTL_MS = 3 * 60 * 1000;

function allowedOrigins(): string[] {
  const list = new Set<string>();
  const add = (o?: string) => { if (o) list.add(o.trim().replace(/\/$/, "")); };
  const frontend = process.env.FRONTEND_URL;
  add(frontend);
  if (frontend) {
    try {
      const u = new URL(frontend);
      add(`${u.protocol}//${u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`}${u.port ? `:${u.port}` : ""}`);
    } catch { /* ignore */ }
  }
  (process.env.WEBAUTHN_ORIGINS ?? "").split(",").forEach((o) => add(o));
  (process.env.ALLOWED_ORIGINS ?? "").split(",").forEach((o) => add(o));
  if (process.env.NODE_ENV !== "production") ["http://localhost:5173", "http://localhost:4173", "http://localhost:4179"].forEach(add);
  return [...list];
}

/** The origin and RP ID for this request, or null if the page's origin isn't ours. */
export function rpFor(originHeader: unknown): { origin: string; rpID: string } | null {
  const origin = typeof originHeader === "string" ? originHeader.replace(/\/$/, "") : "";
  if (!origin || !allowedOrigins().includes(origin)) return null;
  const host = new URL(origin).hostname;
  return { origin, rpID: host.startsWith("www.") ? host.slice(4) : host };
}

// ── Challenges (in memory, single use) ──────────────────────────────────────
const challenges = new Map<string, { challenge: string; rpID: string; origin: string; expires: number }>();
const putChallenge = (key: string, challenge: string, rp: { origin: string; rpID: string }) => {
  challenges.set(key, { challenge, ...rp, expires: Date.now() + CHALLENGE_TTL_MS });
};
const takeChallenge = (key: string) => {
  const c = challenges.get(key);
  challenges.delete(key);
  return c && c.expires > Date.now() ? c : null;
};

export async function listCredentials(userId: number): Promise<WebauthnCredential[]> {
  return db.select().from(webauthnCredentialsTable).where(eq(webauthnCredentialsTable.userId, userId));
}

const toDescriptor = (c: WebauthnCredential) => ({
  id: c.credentialId,
  transports: (c.transports ? c.transports.split(",") : undefined) as AuthenticatorTransportFuture[] | undefined,
});

// ── Registration ────────────────────────────────────────────────────────────
export async function registrationOptions(user: { id: number; email: string; name: string }, rp: { origin: string; rpID: string }) {
  const existing = await listCredentials(user.id);
  const options = await generateRegistrationOptions({
    rpName:          "Sweep",
    rpID:            rp.rpID,
    userID:          isoUint8Array.fromUTF8String(String(user.id)),
    userName:        user.email,
    userDisplayName: user.name || user.email,
    attestationType: "none",
    excludeCredentials: existing.map(toDescriptor),
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
  });
  putChallenge(`register:${user.id}`, options.challenge, rp);
  return options;
}

export async function verifyRegistration(userId: number, response: RegistrationResponseJSON, deviceName: string | undefined) {
  const c = takeChallenge(`register:${userId}`);
  if (!c) throw new Error("This setup request expired. Please try again.");
  const { verified, registrationInfo } = await verifyRegistrationResponse({
    response, expectedChallenge: c.challenge, expectedOrigin: c.origin, expectedRPID: c.rpID, requireUserVerification: true,
  });
  if (!verified || !registrationInfo) throw new Error("Face ID / fingerprint couldn't be verified.");
  const { credential } = registrationInfo;
  const [row] = await db.insert(webauthnCredentialsTable).values({
    userId,
    credentialId: credential.id,
    publicKey:    isoBase64URL.fromBuffer(credential.publicKey),
    counter:      credential.counter,
    transports:   credential.transports?.join(",") ?? null,
    deviceName:   (deviceName ?? "").slice(0, 60) || null,
  }).returning();
  return row!;
}

// ── Authentication (login ticket or transaction approval) ───────────────────
export async function authenticationOptions(userId: number, key: string, rp: { origin: string; rpID: string }) {
  const creds = await listCredentials(userId);
  if (!creds.length) return null;
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, allowCredentials: creds.map(toDescriptor), userVerification: "required" });
  putChallenge(key, options.challenge, rp);
  return options;
}

/** True if `response` is a valid, user-verified assertion for this user and challenge key. */
export async function verifyAuthentication(userId: number, key: string, response: AuthenticationResponseJSON | undefined): Promise<boolean> {
  if (!response || typeof response !== "object" || typeof response.id !== "string") return false;
  const c = takeChallenge(key);
  if (!c) return false;
  const [cred] = await db.select().from(webauthnCredentialsTable)
    .where(and(eq(webauthnCredentialsTable.userId, userId), eq(webauthnCredentialsTable.credentialId, response.id))).limit(1);
  if (!cred) return false;
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response, expectedChallenge: c.challenge, expectedOrigin: c.origin, expectedRPID: c.rpID, requireUserVerification: true,
      credential: { id: cred.credentialId, publicKey: isoBase64URL.toBuffer(cred.publicKey), counter: cred.counter, transports: toDescriptor(cred).transports },
    });
    if (!verified) return false;
    await db.update(webauthnCredentialsTable)
      .set({ counter: authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(webauthnCredentialsTable.id, cred.id));
    return true;
  } catch {
    return false;
  }
}

export const approvalKey = (userId: number) => `approve:${userId}`;

// ── Login tickets: issued after a correct password when the user has a passkey ─
const tickets = new Map<string, { userId: number; expires: number }>();

export function issueLoginTicket(userId: number): string {
  const ticket = randomUUID();
  tickets.set(ticket, { userId, expires: Date.now() + CHALLENGE_TTL_MS });
  return ticket;
}

/** The ticket's user id, or null. `consume` ends the ticket. */
export function readLoginTicket(ticket: unknown, consume = false): number | null {
  if (typeof ticket !== "string") return null;
  const t = tickets.get(ticket);
  if (!t || t.expires < Date.now()) { tickets.delete(ticket as string); return null; }
  if (consume) tickets.delete(ticket);
  return t.userId;
}
