import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { WITHDRAWAL_CHAINS } from "@/lib/wallet";
import { Card, Chip, Field, SummaryRows, fmtUsd, shortAddr } from "./ui";
import type { SendFlow } from "./use-send-flow";

// Presentational pieces of the send flow, laid out by MobileSend and the desktop SendPanel.

const CONTACT_COLORS = ["bg-(--sw-blue) text-white", "bg-[#dfe4ff] text-(--sw-blue)", "bg-(--sw-ink) text-white"];

export function AmountInput({ flow, available, size = "lg", id }: {
  flow: SendFlow;
  available: number;
  size?: "lg" | "md";
  id: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <label htmlFor={id} className="text-[13px] font-semibold text-(--sw-muted)">
        You send · {flow.usd ? "USD" : "USDC"}
      </label>
      <div className={cn("flex items-baseline justify-center w-full font-extrabold tracking-[-0.045em] leading-[1.15]",
        size === "lg" ? "text-[60px]" : "text-[54px]")}>
        <span className={flow.a ? "text-(--sw-ink)" : "text-[#c5ccd8]"}>$</span>
        <input id={id} value={flow.amount} onChange={(e) => flow.setAmount(e.target.value)}
          inputMode="decimal" placeholder="0" autoComplete="off"
          style={{ width: `${Math.max(1, flow.amount.length) * 0.62}em` }}
          className="bg-transparent outline-none min-w-[1ch] max-w-[260px] tabular-nums caret-(--sw-blue) placeholder:text-[#c5ccd8]" />
      </div>
      <button type="button" onClick={flow.setMax}
        className="mt-2 text-[13px] font-bold text-(--sw-blue) px-3 py-1.5 rounded-full border border-(--sw-tint-line) hover:bg-(--sw-tint)">
        Balance {fmtUsd(available)} · Max
      </button>
    </div>
  );
}

export function RecipientFields({ flow, contacts, circleWallet, idPrefix }: {
  flow: SendFlow;
  contacts: string[];
  circleWallet?: string;
  idPrefix: string;
}) {
  if (flow.usd) {
    return (
      <div className="space-y-2.5">
        <label htmlFor={`${idPrefix}-email`} className="block text-[13px] font-bold text-(--sw-label)">To · Sweep payment ID</label>
        <Field id={`${idPrefix}-email`} value={flow.email} onChange={(e) => flow.setEmail(e.target.value)} inputMode="email" type="email"
          autoComplete="off" autoCapitalize="none" placeholder="Their email, e.g. satoshi@example.com" />
        {contacts.length > 0 && (
          <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] flex-wrap">
            {contacts.map((c, i) => (
              <button key={c} type="button" onClick={() => flow.setEmail(c)}
                className={cn("flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-[13px] font-semibold whitespace-nowrap hover:border-[#c9d0fd]",
                  flow.to === c ? "border-(--sw-blue)" : "border-(--sw-line)")}>
                <span className={cn("w-6 h-6 rounded-full grid place-items-center font-extrabold text-[11px]", CONTACT_COLORS[i % CONTACT_COLORS.length])}>
                  {c.charAt(0).toUpperCase()}
                </span>
                {c.split("@")[0]}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <span className="block text-[13px] font-bold text-(--sw-label)">Network</span>
      <div className="flex flex-wrap gap-1.5">
        {WITHDRAWAL_CHAINS.map((c) => (
          <Chip key={c.key} active={c.key === flow.chainKey} onClick={() => flow.setChainKey(c.key)}>{c.label}</Chip>
        ))}
      </div>
      <Field value={flow.address} onChange={(e) => flow.setAddress(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false}
        aria-label={`${flow.chain.label} address`}
        placeholder={flow.isSol ? "Solana address" : `${flow.chain.label} address (0x…)`} className="text-sm font-mono" />
      {circleWallet && !flow.isSol && (
        <button type="button" onClick={() => flow.setAddress(circleWallet)} className="text-[13px] font-bold text-(--sw-blue)">
          Use my Circle wallet
        </button>
      )}
    </div>
  );
}

export function SendHint({ flow }: { flow: SendFlow }) {
  return (
    <div aria-live="polite" className={cn("text-xs font-semibold text-center min-h-[18px]", flow.err ? "text-[#b42318]" : "text-[#067647]")}>
      {flow.hint}
    </div>
  );
}

export function ReviewCard({ flow, className }: { flow: SendFlow; className?: string }) {
  const { usd, preview, to, chain } = flow;
  return (
    <Card className={cn("px-[18px] pt-[22px] pb-2 flex flex-col items-center", className)}>
      <span className="w-[52px] h-[52px] rounded-full bg-(--sw-blue) text-white grid place-items-center font-extrabold text-[19px]">
        {usd ? (preview?.name ?? to).charAt(0).toUpperCase() : chain.label.slice(0, 2).toUpperCase()}
      </span>
      <span className="text-[13px] text-(--sw-muted) mt-3 font-medium">Sending to</span>
      {usd && preview?.name && <span className="font-bold text-base text-center">{preview.name}</span>}
      <span className={cn("text-center break-all", usd && preview?.name ? "text-sm text-(--sw-muted)" : "font-bold text-base")}>
        {usd ? to : shortAddr(to)}
      </span>
      {usd && preview && (
        <span className={cn("mt-2 text-[11px] font-bold px-2 py-0.5 rounded-full",
          preview.registered ? "text-[#067647] bg-[#ecfdf3]" : "text-[#b54708] bg-[#fffaeb]")}>
          {preview.registered ? "Verified Sweep user" : "Not on Sweep yet"}
        </span>
      )}
      <span className="font-extrabold text-[46px] tracking-[-0.04em] mt-2.5 mb-3.5 tabular-nums">{fmtUsd(flow.a)}</span>
      <SummaryRows rows={flow.reviewRows} className="w-full border-t border-dashed border-(--sw-field-line) pt-1 [&>div]:py-[11px] [&>div]:text-sm" />
    </Card>
  );
}

export function UnregisteredNote({ flow }: { flow: SendFlow }) {
  if (!flow.usd || !flow.preview || flow.preview.registered) return null;
  return (
    <p className="text-[13px] text-[#b54708] bg-[#fffaeb] rounded-2xl px-4 py-3 leading-relaxed">
      {flow.to} isn't on Sweep yet. The money is held for them and lands the moment they sign up with this email.
    </p>
  );
}

export function TxPasswordField({ flow, id }: { flow: SendFlow; id: string }) {
  return (
    <div className="space-y-2.5">
      <label htmlFor={id} className="block text-[13px] font-bold text-(--sw-label)">Transaction password</label>
      <Field id={id} type="password" value={flow.txPwd} onChange={(e) => flow.setTxPwd(e.target.value)}
        placeholder="Enter to authorize" autoComplete="off" disabled={flow.busy} />
    </div>
  );
}

export function SentHero({ flow, size = "md", className }: { flow: SendFlow; size?: "lg" | "md"; className?: string }) {
  if (!flow.result) return null;
  return (
    <div className={cn("bg-(--sw-blue) text-white flex flex-col justify-end gap-1.5 relative overflow-hidden", className)}>
      <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[240px] opacity-[.08] pointer-events-none" />
      <div className="text-[13px] font-semibold tracking-[0.04em] opacity-85 relative">{flow.result.kicker}</div>
      <div className={cn("font-extrabold leading-[.95] tracking-[-0.05em] relative", size === "lg" ? "text-[84px]" : "text-[72px]")}>Swept.</div>
      <div className="font-bold text-[28px] tracking-[-0.03em] tabular-nums relative">{flow.result.received}</div>
      <div className="text-[15px] opacity-90 break-all relative">to {flow.result.to}</div>
    </div>
  );
}

export function ResultRows({ flow }: { flow: SendFlow }) {
  return (
    <>
      {flow.resultRows.map((r) => (
        <div key={r.k} className="flex justify-between py-[11px] border-b border-[#f0f2f6] text-sm">
          <span className="text-(--sw-muted)">{r.k}</span><span className="font-bold">{r.v}</span>
        </div>
      ))}
    </>
  );
}

export function ErrorLine({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-2xl bg-[#fef3f2] text-[#b42318] px-4 py-3 text-[13px] font-medium">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{message}</span>
    </div>
  );
}
