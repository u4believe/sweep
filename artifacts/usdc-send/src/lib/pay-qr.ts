// Sweep QR codes are plain links, so a phone's own camera app opens them too:
//   user     → <origin>/send/<payment ID>        (a user's fixed code for collecting money)
//   merchant → <origin>/subscribe/<Merchant ID>  (a subscription plan's checkout)

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const EMAIL_RE       = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MERCHANT_ID_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const PAY_TO_KEY     = "sweep.payTo";

export type ScannedCode =
  | { kind: "user"; paymentId: string }
  | { kind: "merchant"; merchantId: string };

export const userQrUrl     = (paymentId: string)  => `${window.location.origin}${BASE}/send/${encodeURIComponent(paymentId)}`;
export const merchantQrUrl = (merchantId: string) => `${window.location.origin}${BASE}/subscribe/${merchantId}`;

/** Read a scanned code: a Sweep link, or a bare payment ID / Merchant ID. Null if it isn't a Sweep code. */
export function parseScannedCode(raw: string): ScannedCode | null {
  const text = raw.trim();
  let path = "";
  try { path = decodeURIComponent(new URL(text).pathname); } catch { /* not a link */ }

  const user     = path.match(/\/send\/([^/]+)\/?$/)?.[1] ?? text;
  const merchant = (path.match(/\/(?:subscribe|pay)\/([^/]+)\/?$/)?.[1] ?? text).toUpperCase();

  if (EMAIL_RE.test(user)) return { kind: "user", paymentId: user.toLowerCase() };
  if (MERCHANT_ID_RE.test(merchant)) return { kind: "merchant", merchantId: merchant };
  return null;
}

/** Hand a payment ID from a /send/<id> link to the dashboard, across the login redirect if needed. */
export function stashPayTo(paymentId: string) {
  try { sessionStorage.setItem(PAY_TO_KEY, paymentId); } catch { /* storage unavailable */ }
}

export function takePayTo(): string | null {
  try {
    const id = sessionStorage.getItem(PAY_TO_KEY);
    sessionStorage.removeItem(PAY_TO_KEY);
    return id;
  } catch { return null; }
}
