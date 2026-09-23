import { useState } from "react";
import { Link } from "wouter";
import { ChevronLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, OutlineButton, PrimaryButton, SummaryRows, fmtUsd } from "@/components/sweep/ui";
import { ErrorLine, SendHint, TxPasswordField, UnregisteredNote } from "@/components/sweep/send-parts";
import { sanitizeAmount, useSendFlow } from "@/components/sweep/use-send-flow";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface LandingSender {
  email: string;
  hasTransactionPassword: boolean;
  available: number;
}

/** The live "pay by email" widget inside the landing page's Email · USD card. */
export function LandingSend({ sender, onSent }: { sender: LandingSender | null; onSent: () => void }) {
  return (
    <div className="bg-white text-(--sw-ink) rounded-[20px] p-[18px] flex flex-col gap-3">
      {sender ? <SignedInSend sender={sender} onSent={onSent} /> : <SignedOutSend />}
    </div>
  );
}

function AmountRow({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <label htmlFor={id} className="text-xs font-semibold text-(--sw-muted)">You send</label>
      <span className="flex items-baseline font-extrabold text-[32px] tracking-[-0.045em]">
        <span className={value ? "" : "text-[#c5ccd8]"}>$</span>
        <input id={id} value={value} onChange={(e) => onChange(sanitizeAmount(e.target.value))}
          inputMode="decimal" placeholder="0.00" autoComplete="off"
          style={{ width: `${Math.max(4, value.length) * 0.62}em` }}
          className="bg-transparent outline-none text-right tabular-nums caret-(--sw-blue) placeholder:text-[#c5ccd8]" />
      </span>
    </div>
  );
}

function SignedOutSend() {
  const [amount, setAmount] = useState("");
  const [email,  setEmail]  = useState("");
  return (
    <>
      <AmountRow id="landing-amount" value={amount} onChange={setAmount} />
      <Field value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="off"
        aria-label="Recipient email" placeholder="Their email, e.g. kemi@example.com" className="h-11 text-sm" />
      <div className="flex justify-between text-xs text-(--sw-muted)"><span>Fee</span><span className="font-bold text-[#067647]">Free</span></div>
      <Link href={`${BASE}/login`}
        className="h-11 rounded-xl bg-(--sw-blue) text-white text-sm font-bold grid place-items-center hover:bg-(--sw-blue-hover)">
        {amount && parseFloat(amount) > 0 ? `Log in to sweep ${fmtUsd(amount)}` : "Log in to send"}
      </Link>
      <p className="text-xs text-(--sw-muted) text-center">
        No account yet? <Link href={`${BASE}/register`} className="font-bold text-(--sw-blue)">Create one free</Link> — no crypto wallet needed.
      </p>
    </>
  );
}

function SignedInSend({ sender, onSent }: { sender: LandingSender; onSent: () => void }) {
  const flow = useSendFlow({
    available: sender.available,
    userEmail: sender.email,
    hasTransactionPassword: sender.hasTransactionPassword,
    onSent,
  });

  if (flow.step === "sent" && flow.result) {
    return (
      <>
        <span className="text-xs font-semibold tracking-[0.04em] text-(--sw-muted)">{flow.result.kicker}</span>
        <span className="font-extrabold text-[40px] leading-none tracking-[-0.05em]">Swept.</span>
        <span className="text-sm text-(--sw-muted) break-all">
          <span className="font-bold text-(--sw-ink)">{flow.result.received}</span> to {flow.result.to}
        </span>
        <SummaryRows rows={flow.resultRows} className="border-t border-[#f0f2f6] pt-1" />
        <div className="grid grid-cols-2 gap-2">
          <OutlineButton onClick={flow.reset} className="h-11 rounded-xl text-sm">Send again</OutlineButton>
          <Link href={`${BASE}/dashboard`}
            className="h-11 rounded-xl bg-(--sw-blue) text-white text-sm font-bold grid place-items-center hover:bg-(--sw-blue-hover)">
            Dashboard
          </Link>
        </div>
      </>
    );
  }

  if (flow.step === "review") {
    return (
      <>
        <div className="flex items-center gap-2">
          <button type="button" onClick={flow.backToForm} aria-label="Back to form"
            className="w-8 h-8 rounded-lg border border-(--sw-line) grid place-items-center hover:bg-(--sw-bg)">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-extrabold text-base">Review & send</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-(--sw-blue) text-white grid place-items-center font-extrabold shrink-0">
            {(flow.preview?.name ?? flow.to).charAt(0).toUpperCase()}
          </span>
          <span className="flex flex-col min-w-0">
            <span className="font-bold text-sm truncate">{flow.preview?.name ?? flow.to}</span>
            {flow.preview?.name && <span className="text-xs text-(--sw-muted) truncate">{flow.to}</span>}
            <span className={cn("self-start mt-1 text-[11px] font-bold px-2 py-0.5 rounded-full",
              flow.preview?.registered ? "text-[#067647] bg-[#ecfdf3]" : "text-[#b54708] bg-[#fffaeb]")}>
              {flow.preview?.registered ? "Verified Sweep user" : "Not on Sweep yet"}
            </span>
          </span>
          <span className="ml-auto font-extrabold text-2xl tracking-[-0.04em] tabular-nums">{fmtUsd(flow.a)}</span>
        </div>
        <UnregisteredNote flow={flow} />
        {sender.hasTransactionPassword && <TxPasswordField flow={flow} id="landing-txpwd" />}
        {flow.error && <ErrorLine message={flow.error} />}
        <PrimaryButton onClick={flow.send} disabled={flow.busy || flow.pwdMissing} className="h-11 rounded-xl text-sm">
          {flow.busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Sweeping…</> : `Sweep ${fmtUsd(flow.a)}`}
        </PrimaryButton>
      </>
    );
  }

  return (
    <>
      <AmountRow id="landing-amount" value={flow.amount} onChange={flow.setAmount} />
      <Field value={flow.email} onChange={(e) => flow.setEmail(e.target.value)} type="email" inputMode="email" autoComplete="off"
        aria-label="Recipient email" placeholder="Their email, e.g. kemi@example.com" className="h-11 text-sm" />
      <SummaryRows rows={flow.summary} className="[&>div]:py-1 [&>div]:text-xs" />
      <button type="button" onClick={flow.setMax} className="self-start text-xs font-bold text-(--sw-blue)">
        Balance {fmtUsd(sender.available)} · Max
      </button>
      {flow.error && <ErrorLine message={flow.error} />}
      <SendHint flow={flow} />
      <PrimaryButton onClick={flow.goReview} disabled={!!flow.err || flow.busy} className="h-11 rounded-xl text-sm">
        {flow.busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking recipient…</> : flow.a ? `Review ${fmtUsd(flow.a)}` : "Review"}
      </PrimaryButton>
    </>
  );
}
