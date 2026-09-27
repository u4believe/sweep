// ─── Transaction approval ────────────────────────────────────────────────────
// Every send, withdrawal, recurring transfer and subscription payment is approved
// with either the transaction password or a Face ID / fingerprint assertion
// (body.biometric, answering POST /api/webauthn/approve/options).

import bcrypt from "bcrypt";
import { approvalKey, verifyAuthentication } from "./webauthn.js";

type Approver = { id: number; transactionPasswordHash: string | null };

/** null when approved; otherwise the 403 body to send. */
export async function checkTransactionApproval(
  user: Approver,
  body: { transactionPassword?: unknown; biometric?: unknown } | undefined,
  what = "this transaction",
): Promise<{ error: string; message: string; code?: string } | null> {
  if (body?.biometric) {
    return (await verifyAuthentication(user.id, approvalKey(user.id), body.biometric as any))
      ? null
      : { error: "Biometric approval failed", code: "BIOMETRIC_FAILED", message: "Face ID / fingerprint couldn't be verified. Try again or use your transaction password." };
  }
  if (!user.transactionPasswordHash) return null;
  const pwd = typeof body?.transactionPassword === "string" ? body.transactionPassword : "";
  if (!pwd) return { error: "Transaction password required", message: `Please enter your transaction password to authorize ${what}` };
  if (!(await bcrypt.compare(pwd, user.transactionPasswordHash))) {
    return { error: "Invalid transaction password", message: "The transaction password you entered is incorrect" };
  }
  return null;
}
