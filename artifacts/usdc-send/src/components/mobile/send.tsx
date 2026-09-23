import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { authHeaders, EVM_ADDR_RE, SOL_ADDR_RE, WITHDRAWAL_CHAINS, type WithdrawalChain } from "@/lib/wallet";
import {
  Card, Chip, Field, OutlineButton, PrimaryButton, ScreenHeader, Segmented, SummaryRows,
  errorMessage, fmtUsd, shortAddr,
} from "./ui";

export type SendStep = "form" | "review" | "sent";
type Mode = "usd" | "usdc";
type RecipientPreview = { registered: boolean; name: string | null; email: string };

export interface WithdrawMutation {
  mutateAsync: (vars: { data: any }) => Promise<any>;
  isPending: boolean;
}

interface SendResult {
  mode: Mode;
  amount: number;
  received: string;
  to: string;
  kicker: string;
  status: string;
  newBalance: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CONTACT_COLORS = ["bg-(--m-blue) text-white", "bg-[#dfe4ff] text-(--m-blue)", "bg-(--m-ink) text-white"];

function sanitizeAmount(raw: string) {
  const cleaned = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
  const [whole, dec] = cleaned.split(".");
  return (dec !== undefined ? `${whole}.${dec.slice(0, 2)}` : whole).slice(0, 9);
}

export function MobileSend({
  available, userEmail, hasTransactionPassword, circleWallet, contacts, withdraw, onSent, onDone, onStepChange,
}: {
  available: number;
  userEmail: string;
  hasTransactionPassword: boolean;
  circleWallet?: string;
  contacts: string[];
  withdraw: WithdrawMutation;
  onSent: () => void;
  onDone: () => void;
  onStepChange: (step: SendStep) => void;
}) {
  const [step,     setStep]     = useState<SendStep>("form");
  const [mode,     setMode]     = useState<Mode>("usd");
  const [amount,   setAmount]   = useState("");
  const [email,    setEmail]    = useState("");
  const [chainKey, setChainKey] = useState<WithdrawalChain["key"]>("BASE-SEPOLIA");
  const [address,  setAddress]  = useState("");
  const [txPwd,    setTxPwd]    = useState("");
  const [preview,  setPreview]  = useState<RecipientPreview | null>(null);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [result,   setResult]   = useState<SendResult | null>(null);

  useEffect(() => { onStepChange(step); }, [step]);

  const chain  = WITHDRAWAL_CHAINS.find((c) => c.key === chainKey)!;
  const usd    = mode === "usd";
  const a      = parseFloat(amount) || 0;
  const to     = usd ? email.trim().toLowerCase() : address.trim();
  const net    = a > chain.platformFee ? a - chain.platformFee : 0;
  const isSol  = chain.type === "solana";

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
        { k: "They get",    v: net ? `${net.toFixed(2)} USDC` : "—" },
      ];

  const resetForm = () => {
    setAmount(""); setEmail(""); setAddress(""); setTxPwd("");
    setPreview(null); setError(null); setResult(null);
    setStep("form");
  };

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

  // ── Sent ────────────────────────────────────────────────────────────────────
  if (step === "sent" && result) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 bg-(--m-blue) text-white px-6 pt-16 pb-11 flex flex-col justify-end gap-1.5 relative overflow-hidden">
          <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[260px] opacity-[.08] pointer-events-none" />
          <div className="text-[13px] font-semibold tracking-[0.04em] opacity-85 relative">{result.kicker}</div>
          <div className="font-extrabold text-[84px] leading-[.95] tracking-[-0.05em] relative">Swept.</div>
          <div className="font-bold text-3xl tracking-[-0.03em] tabular-nums relative">{result.received}</div>
          <div className="text-[15px] opacity-90 break-all relative">to {result.to}</div>
        </div>
        <div className="bg-white rounded-t-3xl -mt-5 relative px-5 pt-3.5 pb-6">
          {[
            { k: "Status", v: result.status },
            ...(result.mode === "usdc" ? [{ k: "Deducted", v: fmtUsd(result.amount) }] : []),
            ...(result.newBalance !== null ? [{ k: "New balance", v: fmtUsd(result.newBalance) }] : []),
          ].map((r) => (
            <div key={r.k} className="flex justify-between py-[11px] border-b border-[#f0f2f6] text-sm">
              <span className="text-(--m-muted)">{r.k}</span><span className="font-bold">{r.v}</span>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2.5 mt-4">
            <OutlineButton onClick={resetForm} className="h-[54px]">Send again</OutlineButton>
            <PrimaryButton onClick={() => { resetForm(); onDone(); }} className="h-[54px] text-[15px]">Done</PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  // ── Review ──────────────────────────────────────────────────────────────────
  if (step === "review") {
    const rows = usd
      ? [
          { k: "Recipient", v: preview?.registered ? "On Sweep" : "Not on Sweep yet" },
          ...summary,
        ]
      : [
          { k: "Network", v: chain.label },
          { k: "Address", v: shortAddr(to) },
          { k: "Network fee", v: fmtUsd(chain.platformFee) },
          { k: "They get", v: `${net.toFixed(2)} USDC` },
        ];
    const pwdMissing = hasTransactionPassword && !txPwd;
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <ScreenHeader title="Review & send" onBack={() => { setError(null); setStep("form"); }} />
        <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-2 pb-4 space-y-3">
          <Card className="px-[18px] pt-[22px] pb-2 flex flex-col items-center">
            <span className="w-[52px] h-[52px] rounded-full bg-(--m-blue) text-white grid place-items-center font-extrabold text-[19px]">
              {usd ? (preview?.name ?? to).charAt(0).toUpperCase() : chain.label.slice(0, 2).toUpperCase()}
            </span>
            <span className="text-[13px] text-(--m-muted) mt-3 font-medium">Sending to</span>
            {usd && preview?.name && <span className="font-bold text-base text-center">{preview.name}</span>}
            <span className={cn("text-center break-all", usd && preview?.name ? "text-sm text-(--m-muted)" : "font-bold text-base")}>
              {usd ? to : shortAddr(to)}
            </span>
            <span className="font-extrabold text-[46px] tracking-[-0.04em] mt-2.5 mb-3.5 tabular-nums">{fmtUsd(a)}</span>
            <SummaryRows rows={rows} className="w-full border-t border-dashed border-(--m-field-line) pt-1 [&>div]:py-[11px] [&>div]:text-sm" />
          </Card>
          {usd && preview && !preview.registered && (
            <p className="text-[13px] text-[#b54708] bg-[#fffaeb] rounded-2xl px-4 py-3 leading-relaxed">
              {to} isn't on Sweep yet. The money is held for them and lands the moment they sign up with this email.
            </p>
          )}
          {hasTransactionPassword && (
            <Card className="rounded-[20px] p-4 space-y-2.5">
              <label htmlFor="m-txpwd" className="text-[13px] font-bold text-(--m-label)">Transaction password</label>
              <Field id="m-txpwd" type="password" value={txPwd} onChange={(e) => setTxPwd(e.target.value)}
                placeholder="Enter to authorize" autoComplete="off" disabled={busy} />
            </Card>
          )}
          {error && <ErrorLine message={error} />}
        </div>
        <div className="px-4 pt-2.5 pb-3">
          <PrimaryButton onClick={send} disabled={busy || pwdMissing}>
            {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Sweeping…</> : `Sweep ${fmtUsd(a)}`}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  const maxAmount = Math.floor(available * 100) / 100;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title="Send money" />
      <div className="px-4">
        <Segmented<Mode>
          value={mode}
          onChange={(m) => { setMode(m); setError(null); }}
          options={[{ value: "usd", label: "Email · USD" }, { value: "usdc", label: "Wallet · USDC" }]}
        />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-4">
        <div className="flex flex-col items-center pt-6 pb-5">
          <label htmlFor="m-amount" className="text-[13px] font-semibold text-(--m-muted)">You send · {usd ? "USD" : "USDC"}</label>
          <div className="flex items-baseline justify-center w-full font-extrabold text-[60px] tracking-[-0.045em] leading-[1.15]">
            <span className={a ? "text-(--m-ink)" : "text-[#c5ccd8]"}>$</span>
            <input id="m-amount" value={amount} onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
              inputMode="decimal" placeholder="0" autoComplete="off"
              style={{ width: `${Math.max(1, amount.length) * 0.62}em` }}
              className="bg-transparent outline-none min-w-[1ch] max-w-[260px] tabular-nums caret-(--m-blue) placeholder:text-[#c5ccd8]" />
          </div>
          <button type="button" onClick={() => setAmount(maxAmount > 0 ? maxAmount.toFixed(2) : "")}
            className="mt-2 text-[13px] font-bold text-(--m-blue) px-3 py-1.5 rounded-full border border-(--m-tint-line) hover:bg-(--m-tint)">
            Balance {fmtUsd(available)} · Max
          </button>
        </div>

        {usd ? (
          <Card className="rounded-[20px] p-4 space-y-2.5">
            <label htmlFor="m-email" className="text-[13px] font-bold text-(--m-label)">To · Sweep payment ID</label>
            <Field id="m-email" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" type="email"
              autoComplete="off" autoCapitalize="none" placeholder="Their email, e.g. satoshi@example.com" />
            {contacts.length > 0 && (
              <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
                {contacts.map((c, i) => (
                  <button key={c} type="button" onClick={() => setEmail(c)}
                    className={cn("flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-[13px] font-semibold whitespace-nowrap hover:border-[#c9d0fd]",
                      to === c ? "border-(--m-blue)" : "border-(--m-line)")}>
                    <span className={cn("w-6 h-6 rounded-full grid place-items-center font-extrabold text-[11px]", CONTACT_COLORS[i % CONTACT_COLORS.length])}>
                      {c.charAt(0).toUpperCase()}
                    </span>
                    {c.split("@")[0]}
                  </button>
                ))}
              </div>
            )}
            <SummaryRows rows={summary} className="border-t border-[#f0f2f6] pt-1" />
          </Card>
        ) : (
          <Card className="rounded-[20px] p-4 space-y-3">
            <span className="text-[13px] font-bold text-(--m-label)">Network</span>
            <div className="flex flex-wrap gap-1.5">
              {WITHDRAWAL_CHAINS.map((c) => (
                <Chip key={c.key} active={c.key === chainKey}
                  onClick={() => { if (c.type !== chain.type) setAddress(""); setChainKey(c.key); }}>
                  {c.label}
                </Chip>
              ))}
            </div>
            <Field value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false}
              aria-label={`${chain.label} address`}
              placeholder={isSol ? "Solana address" : `${chain.label} address (0x…)`} className="text-sm font-mono" />
            {circleWallet && !isSol && (
              <button type="button" onClick={() => setAddress(circleWallet)} className="text-[13px] font-bold text-(--m-blue)">
                Use my Circle wallet
              </button>
            )}
            <SummaryRows rows={summary} className="border-t border-[#f0f2f6] pt-1" />
          </Card>
        )}
        {error && <div className="mt-3"><ErrorLine message={error} /></div>}
      </div>
      <div className="px-4 pt-2.5 pb-3">
        <div aria-live="polite" className={cn("text-xs font-semibold text-center min-h-[18px] mb-1.5", err ? "text-[#b42318]" : "text-[#067647]")}>
          {hint}
        </div>
        <PrimaryButton onClick={goReview} disabled={!!err || busy}>
          {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Checking recipient…</> : a ? `Review ${fmtUsd(a)}` : "Review"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-2xl bg-[#fef3f2] text-[#b42318] px-4 py-3 text-[13px] font-medium">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{message}</span>
    </div>
  );
}
