import { useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { format, isToday, isYesterday } from "date-fns";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getExplorerUrl, isOnChainHash, type UnifiedTx } from "@/lib/wallet";

// ── Formatting ────────────────────────────────────────────────────────────────

export const fmtUsd = (v: number | string) => {
  const n = typeof v === "string" ? parseFloat(v) || 0 : v;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const shortAddr = (x: string) => (x.length > 18 ? `${x.slice(0, 6)}…${x.slice(-4)}` : x);

export const whenLabel = (iso: string) => {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
};

/** Message from an ApiError body when present, otherwise the raw error message. */
export const errorMessage = (e: any, fallback: string) =>
  e?.data?.message ?? e?.message ?? fallback;

// ── Status pill ───────────────────────────────────────────────────────────────

type Tone = "ok" | "warn" | "bad" | "muted";

const TONE: Record<Tone, string> = {
  ok:    "text-[#067647] bg-[#ecfdf3]",
  warn:  "text-[#b54708] bg-[#fffaeb]",
  bad:   "text-[#b42318] bg-[#fef3f2]",
  muted: "text-[#475467] bg-[#f2f4f7]",
};

export function txStatus(tx: Pick<UnifiedTx, "status" | "category" | "direction">): { label: string; tone: Tone } {
  const s = tx.status.toLowerCase();
  if (["completed", "claimed", "confirmed", "credited", "complete", "success"].includes(s)) return { label: "Completed", tone: "ok" };
  if (s === "pending" && tx.category === "escrow" && tx.direction === "out") return { label: "Awaiting signup", tone: "warn" };
  if (["pending", "pending_transfer", "processing", "confirming", "initiated", "queued"].includes(s)) return { label: "Pending", tone: "warn" };
  if (["failed", "rejected", "error"].includes(s)) return { label: "Failed", tone: "bad" };
  if (s === "cancelled") return { label: "Cancelled", tone: "bad" };
  if (s === "refunded") return { label: "Refunded", tone: "muted" };
  return { label: s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " "), tone: "muted" };
}

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap", TONE[tone])}>
      {label}
    </span>
  );
}

// ── Transaction row ───────────────────────────────────────────────────────────

const AVATARS = [
  "bg-(--m-blue) text-white",
  "bg-[#dfe4ff] text-(--m-blue)",
  "bg-(--m-ink) text-white",
  "bg-[#e8ecf3] text-(--m-ink)",
];

const CHAIN_ABBR: Array<[string, string]> = [
  ["arb", "ARB"], ["optimism", "OP"], ["op-", "OP"], ["polygon", "POL"], ["matic", "POL"],
  ["avalanche", "AVAX"], ["avax", "AVAX"], ["unichain", "UNI"], ["sol", "SOL"], ["base", "BASE"], ["arc", "ARC"],
];

function chainAbbr(network: string) {
  const n = network.toLowerCase();
  return CHAIN_ABBR.find(([m]) => n.includes(m))?.[1];
}

function hashIndex(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % AVATARS.length;
}

export function txView(tx: UnifiedTx) {
  const isEmail = tx.category === "escrow";
  const party   = isEmail ? (tx.direction === "out" ? tx.toAddress : tx.fromAddress) ?? "Sweep user" : "";
  const bankOut = tx.category === "withdrawal" && tx.network === "Bank transfer";
  const title =
    isEmail ? party :
    tx.category === "deposit" ? "Deposit" :
    bankOut ? "Bank withdrawal" :
    shortAddr((tx.toAddress ?? "Withdrawal").replace(/\s*\([^)]*\)$/, ""));
  const sub = isEmail ? "Email transfer" : tx.network;
  const mono =
    isEmail ? party.charAt(0).toUpperCase() :
    tx.category === "deposit" ? "IN" :
    bankOut ? "BANK" : chainAbbr(tx.network) ?? "OUT";
  const avatar =
    isEmail ? AVATARS[hashIndex(party)] :
    tx.category === "deposit" ? "bg-[#ecfdf3] text-[#067647]" : "bg-(--m-tint) text-(--m-blue)";
  const amount = (tx.direction === "in" ? "+" : "−") + fmtUsd(tx.amount);
  return { title, sub, mono, avatar, isEmail, amount, status: txStatus(tx) };
}

export function TxRow({ tx, expandable = false }: { tx: UnifiedTx; expandable?: boolean }) {
  const [open, setOpen] = useState(false);
  const v = txView(tx);
  const explorerUrl = getExplorerUrl(tx.network, tx.txHash ?? "");

  const row = (
    <div className="grid grid-cols-[42px_minmax(0,1fr)_auto] gap-3 items-center px-[18px] py-2.5">
      <span className={cn("w-[42px] h-[42px] rounded-full grid place-items-center font-extrabold tracking-wide", v.isEmail ? "text-base" : "text-[10px]", v.avatar)}>
        {v.mono}
      </span>
      <span className="flex flex-col min-w-0">
        <span className="font-bold text-[15px] truncate">{v.title}</span>
        <span className="text-[13px] text-(--m-muted) truncate">{v.sub} · {whenLabel(tx.createdAt)}</span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className={cn("font-bold text-[15px] tabular-nums", tx.direction === "in" ? "text-[#067647]" : "text-(--m-ink)")}>{v.amount}</span>
        <StatusPill {...v.status} />
      </span>
    </div>
  );

  if (!expandable) return row;

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full text-left hover:bg-[#f8f9fc] transition-colors">
        {row}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden">
            <div className="mx-[18px] mb-3 rounded-2xl bg-(--m-bg) px-4 py-3 space-y-2 text-[13px]">
              <DetailRow k="Date" v={format(new Date(tx.createdAt), "MMM d, yyyy · h:mm a")} />
              {tx.fromAddress && <DetailRow k="From" v={tx.fromAddress} mono={!tx.fromAddress.includes("@")} />}
              {tx.toAddress && <DetailRow k="To" v={tx.toAddress} mono={!tx.toAddress.includes("@")} />}
              {tx.txHash && isOnChainHash(tx.txHash) && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-(--m-muted)">Tx hash</span>
                  <span className="flex items-center gap-1 font-semibold font-mono text-xs">
                    {tx.txHash.slice(0, 10)}…{tx.txHash.slice(-6)} <CopyIcon text={tx.txHash} />
                  </span>
                </div>
              )}
              {explorerUrl && (
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-bold text-(--m-blue)">
                  View on explorer <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-(--m-muted) shrink-0">{k}</span>
      <span className={cn("font-semibold text-right break-all", mono && "font-mono text-xs")}>{v}</span>
    </div>
  );
}

// ── Building blocks ───────────────────────────────────────────────────────────

export function useCopy(timeout = 1600) {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), timeout);
  };
  return { copied, copy };
}

export function CopyIcon({ text, label = "Copy" }: { text: string; label?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); copy(text); }} aria-label={label}
      className={cn("w-8 h-8 rounded-[10px] grid place-items-center transition-colors hover:bg-(--m-tint)",
        copied ? "text-[#067647] bg-[#ecfdf3]" : "text-(--m-blue)")}>
      {copied ? <Check className="w-4 h-4" strokeWidth={2.5} /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

export function ScreenHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-1.5 pb-2.5">
      {onBack && (
        <button type="button" onClick={onBack} aria-label="Back"
          className="w-10 h-10 rounded-xl border border-(--m-line) bg-white grid place-items-center shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      <h1 className={cn("font-extrabold tracking-[-0.02em] truncate flex-1", onBack ? "text-xl" : "text-[22px]")}>{title}</h1>
      {right}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("bg-white border border-(--m-line) rounded-[22px]", className)}>{children}</div>;
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-(--m-line) rounded-xl p-[3px] gap-[3px]" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cn("flex-1 py-2 rounded-[9px] text-[13px] font-bold transition-colors",
            value === o.value ? "bg-white text-(--m-ink) shadow-sm" : "text-(--m-muted)")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("px-3 py-[7px] rounded-full text-[13px] font-bold border transition-colors",
        active ? "bg-(--m-blue) text-white border-(--m-blue)" : "bg-white text-(--m-label) border-(--m-field-line)")}>
      {children}
    </button>
  );
}

export function Field(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input {...rest}
      className={cn("h-[52px] w-full min-w-0 rounded-xl border border-(--m-field-line) bg-(--m-bg) px-3.5 text-[15px] font-medium text-(--m-ink) outline-none placeholder:text-[#9aa4b5] focus:border-(--m-blue) focus:bg-white transition-colors disabled:opacity-60",
        className)} />
  );
}

export function PrimaryButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={cn("h-14 w-full rounded-2xl bg-(--m-blue) text-white text-base font-bold transition active:scale-[.98] hover:bg-(--m-blue-hover) disabled:bg-[#c5ccd8] disabled:active:scale-100 disabled:cursor-not-allowed flex items-center justify-center gap-2",
        className)} />
  );
}

export function OutlineButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={cn("h-[52px] w-full rounded-2xl border border-[#c9d0fd] bg-white text-(--m-blue) text-[15px] font-bold hover:bg-(--m-tint) transition-colors",
        className)} />
  );
}

export function SummaryRows({ rows, className }: { rows: Array<{ k: string; v: ReactNode; tone?: "ok" }>; className?: string }) {
  return (
    <div className={className}>
      {rows.map((r) => (
        <div key={r.k} className="flex justify-between gap-3 py-2 text-[13px]">
          <span className="text-(--m-muted)">{r.k}</span>
          <span className={cn("font-bold tabular-nums text-right", r.tone === "ok" && "text-[#067647]")}>{r.v}</span>
        </div>
      ))}
    </div>
  );
}

export function MenuGroup({ rows }: { rows: Array<{ k: string; v?: string; onClick: () => void }> }) {
  return (
    <Card className="rounded-[20px] overflow-hidden">
      {rows.map((r, i) => (
        <button key={r.k} type="button" onClick={r.onClick}
          className={cn("w-full flex items-center gap-2.5 px-[18px] py-[17px] text-left hover:bg-[#f8f9fc] transition-colors",
            i > 0 && "border-t border-[#f0f2f6]")}>
          <span className="flex-1 font-semibold text-base">{r.k}</span>
          {r.v && <span className="text-[13px] font-medium text-(--m-muted)">{r.v}</span>}
          <ChevronRight className="w-4 h-4 text-(--m-faint)" />
        </button>
      ))}
    </Card>
  );
}
