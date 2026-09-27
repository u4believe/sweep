import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { API_BASE } from "@/lib/api";
import { authHeaders } from "@/lib/wallet";

// Face ID / fingerprint via passkeys. The phone's own biometric unlocks a key
// stored on the device; the server only checks a signature from it.
// This device's passkey id is remembered locally so the app knows to offer it.

const DEVICE_KEY = "sweep.passkeyId";

export const BIOMETRIC_NAME = "Face ID / fingerprint";

export function enrolledCredentialId(): string | null {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}
function rememberCredential(id: string | null) {
  try { id ? localStorage.setItem(DEVICE_KEY, id) : localStorage.removeItem(DEVICE_KEY); } catch { /* storage unavailable */ }
}

/** Whether this device has a built-in biometric authenticator the browser can use. */
export async function biometricSupported(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

export function useBiometricSupported(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { biometricSupported().then(setOk).catch(() => setOk(false)); }, []);
  return ok;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

async function post(path: string, body?: object) {
  const res  = await fetch(`${API_BASE}/api/webauthn${path}`, { method: "POST", headers: authHeaders(true), ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? "Request failed");
  return json;
}

/** A readable message for a failed or cancelled biometric prompt. */
export function biometricError(err: unknown): string {
  const name = (err as any)?.name;
  if (name === "NotAllowedError" || name === "AbortError") return `${BIOMETRIC_NAME} was cancelled or not recognised.`;
  if (name === "InvalidStateError") return `${BIOMETRIC_NAME} is already set up on this device.`;
  return (err as any)?.message ?? `${BIOMETRIC_NAME} didn't work.`;
}

/** Register this device's Face ID / fingerprint for the signed-in user. */
export async function registerThisDevice(): Promise<void> {
  const optionsJSON = await post("/register/options");
  const response = await startRegistration({ optionsJSON });
  const json = await post("/register/verify", { response, deviceName: deviceLabel() });
  rememberCredential(json.credential?.credentialId ?? response.id);
}

export async function listDevices(): Promise<Array<{ id: number; credentialId: string; deviceName: string | null; createdAt: string; lastUsedAt: string | null }>> {
  const res = await fetch(`${API_BASE}/api/webauthn/credentials`, { headers: authHeaders() });
  const json = await res.json().catch(() => ({}));
  return Array.isArray(json?.credentials) ? json.credentials : [];
}

export async function removeDevice(id: number, credentialId?: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/webauthn/credentials/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error("Couldn't remove this device");
  if (credentialId && credentialId === enrolledCredentialId()) rememberCredential(null);
}

/** Forget a local passkey id the server no longer knows (removed elsewhere). */
export function forgetIfMissing(serverIds: string[]) {
  const mine = enrolledCredentialId();
  if (mine && !serverIds.includes(mine)) rememberCredential(null);
}

/** Ask for Face ID / fingerprint to approve a transaction; returns { biometric } for the request body. */
export async function getApproval(): Promise<{ biometric: unknown }> {
  const optionsJSON = await post("/approve/options");
  const biometric = await startAuthentication({ optionsJSON });
  return { biometric };
}

/** Finish a password login with Face ID / fingerprint. */
export async function biometricLogin(ticket: string, optionsJSON: any): Promise<{ token: string }> {
  const response = await startAuthentication({ optionsJSON });
  const res  = await fetch(`${API_BASE}/api/auth/login/biometric`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket, response }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.message ?? "Not recognised"), { code: json.code });
  return json;
}

/**
 * For approval screens: Face ID / fingerprint when this device is set up, with
 * "Use password instead" as the fallback.
 */
export function useBiometricApproval() {
  const [available] = useState(() => !!enrolledCredentialId());
  const [usePassword, setUsePassword] = useState(false);
  const active = available && !usePassword;
  return { available, active, usePassword, setUsePassword };
}
