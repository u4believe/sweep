import { useState } from "react";
import { API_BASE } from "@/lib/api";
import { authHeaders, EVM_ADDR_RE, SOL_ADDR_RE, WITHDRAWAL_CHAINS, type WithdrawalChain } from "@/lib/wallet";
import { errorMessage, fmtUsd, shortAddr } from "./ui";

// Send logic shared by the mobile Send screen and the desktop "Sweep money" panel:
// form → review (recipient lookup + transaction password) → sent.

export type SendStep = "form" | "review" | "sent";
export type SendMode = "usd" | "usdc";
export type RecipientPreview = { registered: boolean; name: string | null; email: string };

export interface WithdrawMutation {
  mutateAsync: (vars: { data: any }) => Promise<any>;
  isPending: boolean;
}

export interface SendResult {
  mode: SendMode;
  amount: number;
  received: string;
  to: string;
  kicker: string;
  status: string;
  newBalance: string | null;
}

export interface SendFlowOptions {
  available: number;
  userEmail: string;
  hasTransactionPassword: boolean;
  withdraw: WithdrawMutation;
  onSent: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function sanitizeAmount(raw: string) {
  const cleaned = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
  const [whole, dec] = cleaned.split(".");
  return (dec !== undefined ? `${whole}.${dec.slice(0, 2)}` : whole).slice(0, 9);
}

export function useSendFlow({ available, userEmail, hasTransactionPassword, withdraw, onSent }: SendFlowOptions) {
  const [step,     setStep]     = useState<SendStep>("form");
  const [mode,     setModeRaw]  = useState<SendMode>("usd");
  const [amount,   setAmountRaw] = useState("");
  const [email,    setEmail]    = useState("");
  const [chainKey, setChainKeyRaw] = useState<WithdrawalChain["key"]>("BASE-SEPOLIA");
  const [address,  setAddress]  = useState("");
  const [txPwd,    setTxPwd]    = useState("");
  const [preview,  setPreview]  = useState<RecipientPreview | null>(null);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [result,   setResult]   = useState<SendResult | null>(null);

  const chain = WITHDRAWAL_CHAINS.find((c) => c.key === chainKey)!;
  const usd   = mode === "usd";
  const a     = parseFloat(amount) || 0;
  const to    = usd ? email.trim().toLowerCase() : address.trim();
  const net   = a > chain.platformFee ? a - chain.platformFee : 0;
  const isSol = chain.type === "solana";

  // Live validation — drives both the hint line and the CTA
  const validate = (): string | null => {
    if (!a) return "Enter an amount";
    if (a > available) return "More than your available balance";
    if (usd) {
      if (a < 0.01) return "Minimum is $0.01";
      if (!EMAIL_RE.test(to)) return "Add the recipient's payment ID";
      if (to === userEmail.toLowerCase()) return "That's your own payment ID";
    } else {
      if (a < chain.minWithdrawal) return `Minimum on ${chain.label} is ${fmtUsd(chain.minWithdrawal)}`;
      if (a <= chain.platformFee) return `Amount must be more than the ${fmtUsd(chain.platformFee)} network fee`;
      if (!(isSol ? SOL_ADDR_RE : EVM_ADDR_RE).test(to)) return isSol ? "Enter a valid Solana address" : "Enter a valid 0x… address";
    }
    return null;
  };
  const err     = validate();
  const touched = !!(amount || email || address);
  const hint    = err ? (touched ? err : "") : "Ready to sweep";

  const summary = usd
    ? [
        { k: "Fee",      v: "Free",      tone: "ok" as const },
        { k: "Gas",      v: "Sponsored", tone: "ok" as const },
        { k: "They get", v: a ? fmtUsd(a) : "—" },
      ]
    : [
        { k: "Network fee", v: fmtUsd(chain.platformFee) },
        { k: "Minimum",     v: fmtUsd(chain.minWithdrawal) },
        { k: "Deducted",    v: a ? fmtUsd(a) : "—" },
        { k: "They get",    v: net ? `${net.toFixed(2)} USDC` : "—" },
      ];

  const reviewRows = usd
    ? [{ k: "Recipient", v: preview?.registered ? "On Sweep" : "Not on Sweep yet" }, ...summary]
    : [
        { k: "Network",     v: chain.label },
        { k: "Address",     v: shortAddr(to) },
        { k: "Network fee", v: fmtUsd(chain.platformFee) },
        { k: "They get",    v: `${net.toFixed(2)} USDC` },
      ];

  const setMode = (m: SendMode) => { setModeRaw(m); setError(null); };
  const setAmount = (raw: string) => setAmountRaw(sanitizeAmount(raw));
  const setMax = () => {
    const max = Math.floor(available * 100) / 100;
    setAmountRaw(max > 0 ? max.toFixed(2) : "");
  };
  const setChainKey = (key: WithdrawalChain["key"]) => {
    const next = WITHDRAWAL_CHAINS.find((c) => c.key === key)!;
    if (next.type !== chain.type) setAddress("");
    setChainKeyRaw(key);
  };

  const reset = () => {
    setAmountRaw(""); setEmail(""); setAddress(""); setTxPwd("");
    setPreview(null); setError(null); setResult(null);
    setStep("form");
  };

  const backToForm = () => { setError(null); setStep("form"); };

  const goReview = async () => {
    if (err) return;
    setError(null);
    if (!usd) { setStep("review"); return; }
    setBusy(true);
    try {
      const res  = await fetch(`${API_BASE}/api/escrow/lookup-recipient?email=${encodeURIComponent(to)}`, { headers: authHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Could not look up recipient");
      setPreview(json as RecipientPreview);
      setStep("review");
    } catch (e: any) {
      setError(errorMessage(e, "Could not look up recipient. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      if (usd) {
        const res  = await fetch(`${API_BASE}/api/escrow/send/platform`, {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify({
            recipientEmail: to,
            amount: a.toFixed(2),
            ...(hasTransactionPassword ? { transactionPassword: txPwd } : {}),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message ?? "Failed to send payment");
        setResult({
          mode, amount: a, received: fmtUsd(a), to: preview?.name || to,
          kicker: json.credited ? "DELIVERED BY EMAIL" : "HELD UNTIL THEY JOIN",
          status: json.credited ? "Delivered" : "Awaiting signup",
          newBalance: json.remainingBalance ?? null,
        });
      } else {
        const json = await withdraw.mutateAsync({
          data: {
            walletAddress: to,
            amount: a.toFixed(2),
            chainKey: chain.key,
            ...(hasTransactionPassword ? { transactionPassword: txPwd } : {}),
          },
        });
        setResult({
          mode, amount: a, received: `${net.toFixed(2)} USDC`, to: shortAddr(to),
          kicker: `SUBMITTED ON ${chain.label.toUpperCase()}`,
          status: "Processing",
          newBalance: json?.newBalance ?? null,
        });
      }
      setTxPwd("");
      setStep("sent");
      onSent();
    } catch (e: any) {
      setError(errorMessage(e, "Transfer failed. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const resultRows = result
    ? [
        { k: "Status", v: result.status },
        ...(result.mode === "usdc" ? [{ k: "Deducted", v: fmtUsd(result.amount) }] : []),
        ...(result.newBalance !== null ? [{ k: "New balance", v: fmtUsd(result.newBalance) }] : []),
      ]
    : [];

  return {
    // state
    step, mode, amount, email, chainKey, address, txPwd, preview, busy, error, result,
    // derived
    chain, usd, a, to, isSol, err, hint, summary, reviewRows, resultRows,
    pwdMissing: hasTransactionPassword && !txPwd,
    // actions
    setMode, setAmount, setMax, setEmail, setChainKey, setAddress, setTxPwd,
    goReview, send, reset, backToForm,
  };
}

export type SendFlow = ReturnType<typeof useSendFlow>;
