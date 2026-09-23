/**
 * Google Sign-In — verifies the ID token ("credential") returned by Google
 * Identity Services in the browser. Signature is checked against Google's
 * published JWKS; audience must be our GOOGLE_CLIENT_ID.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS: [string, string] = ["accounts.google.com", "https://accounts.google.com"];

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
}

export const googleClientId = () => process.env.GOOGLE_CLIENT_ID?.trim() || null;

let jwksCache: { keys: Map<string, crypto.KeyObject>; expiresAt: number } | null = null;

async function signingKey(kid: string): Promise<crypto.KeyObject> {
  if (!jwksCache || jwksCache.expiresAt < Date.now() || !jwksCache.keys.has(kid)) {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`Could not fetch Google signing keys (${res.status})`);
    const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1];
    const body = await res.json() as { keys: Array<{ kid: string } & Record<string, unknown>> };
    jwksCache = {
      keys: new Map(body.keys.map((k) => [k.kid, crypto.createPublicKey({ key: k as any, format: "jwk" })])),
      expiresAt: Date.now() + (maxAge ? Number(maxAge) * 1000 : 3_600_000),
    };
  }
  const key = jwksCache.keys.get(kid);
  if (!key) throw new Error("Unknown Google signing key");
  return key;
}

export async function verifyGoogleCredential(credential: string): Promise<GoogleIdentity> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("Google sign-in is not configured");

  const decoded = jwt.decode(credential, { complete: true });
  if (!decoded || typeof decoded === "string" || !decoded.header.kid) throw new Error("Malformed Google credential");

  const payload = jwt.verify(credential, await signingKey(decoded.header.kid), {
    algorithms: ["RS256"],
    audience: clientId,
    issuer: ISSUERS,
  }) as jwt.JwtPayload & { email?: string; email_verified?: boolean | string; name?: string };

  if (!payload.sub || !payload.email) throw new Error("Google account has no email");
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    throw new Error("Your Google email address isn't verified");
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase().trim(),
    name: payload.name?.trim() || payload.email.split("@")[0]!,
  };
}
