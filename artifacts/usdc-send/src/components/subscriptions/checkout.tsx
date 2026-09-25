import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { merchantQrUrl } from "@/lib/pay-qr";
import { BrandedQr } from "@/components/sweep/qr";

// v5 subscription checkout: plan picker and order summary beside "Pay with Sweep"
// (scan-to-pay QR, the signed-in account, transaction password, authorization).
// Used by the hosted /subscribe/:merchantId page and the in-app Pay tab.

export interface PlanInterval { intervalId: number; interval: string; amount: string }
export interface PlanTier {
  tierId: number; tierName: string; description: string | null; features: string[];
  isHighlighted: boolean; displayOrder: number; intervals: PlanInterval[];
}
export interface PlanInfo {
  planTitle: string; creatorName: string; hasFreeTrial: boolean; trialDurationDays: number | null;
  intervals: PlanInterval[]; tiers: PlanTier[];
}

type Cycle = "weekly" | "monthly" | "yearly";
const CYCLES: Cycle[] = ["weekly", "monthly", "yearly"];
const LABEL: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const PER: Record<string, string>   = { weekly: "week", monthly: "month", yearly: "year" };
const SHORT: Record<string, string> = { weekly: "wk", monthly: "mo", yearly: "yr" };
const DAYS: Record<string, number>  = { weekly: 7, monthly: 30, yearly: 365 };

const usd = (v: number | string) =>
  `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateIn = (days: number, from = new Date()) => {
  const d = new Date(from);
  if (days === 30) d.setMonth(d.getMonth() + 1);
  else if (days === 365) d.setFullYear(d.getFullYear() + 1);
  else d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const kicker = "text-xs font-bold tracking-[0.07em] text-(--sw-faint) uppercase";

type Me = { email: string; hasTransactionPassword: boolean; balance: number | null };
type Done = { status: string; tier: string; amount: string; interval: string };

export function Checkout({ merchantId, plan, variant, onPayAnother }: {
  merchantId: string;
  plan: PlanInfo;
  /** "page": the hosted split-screen checkout. "embedded": stacked, inside the dashboard. */
  variant: "page" | "embedded";
  onPayAnother?: () => void;
}) {
  const [, setLocation] = useLocation();
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  // A flat plan is shown as a single option named after the plan.
  const options: PlanTier[] = useMemo(() => plan.tiers.length ? plan.tiers : [{
    tierId: 0, tierName: plan.planTitle, description: null, features: [], isHighlighted: true, displayOrder: 0, intervals: plan.intervals,
  }], [plan]);
  const cycles = CYCLES.filter((c) => options.some((o) => o.intervals.some((iv) => iv.interval === c)));

  const [cycle,   setCycle]   = useState<Cycle>(cycles.includes("monthly") ? "monthly" : cycles[0] ?? "monthly");
  const [pick,    setPick]    = useState(() => Math.max(0, options.findIndex((o) => o.isHighlighted)));
  const [me,      setMe]      = useState<Me | null>(null);
  const [meReady, setMeReady] = useState(!token);
  const [txPwd,   setTxPwd]   = useState("");
  const [agree,   setAgree]   = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [done,    setDone]    = useState<Done | null>(null);

  useEffect(() => {
    if (!token) return;
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${API_BASE}/api/auth/me`, { headers: h }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_BASE}/api/escrow/balance`, { headers: h }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([u, b]) => {
        if (u?.email) setMe({ email: u.email, hasTransactionPassword: !!u.hasTransactionPassword, balance: b ? parseFloat(b.claimedBalance ?? "0") : null });
      })
      .catch(() => {})
      .finally(() => setMeReady(true));
  }, [token]);

  const tier     = options[pick] ?? options[0]!;
  const priceFor = (o: PlanTier, c: string) => o.intervals.find((iv) => iv.interval === c);
  const selected = priceFor(tier, cycle);
  const amount   = selected ? parseFloat(selected.amount) : 0;
  const trial    = plan.hasFreeTrial && plan.trialDurationDays ? plan.trialDurationDays : 0;
  const dueToday = trial ? 0 : amount;
  const low      = !!me && me.balance !== null && me.balance < dueToday;

  // "Yearly · 2 months free" when the chosen option's yearly price beats 12× monthly
  const monthly = priceFor(tier, "monthly"), yearly = priceFor(tier, "yearly");
  const freeMonths = monthly && yearly ? Math.round(12 - parseFloat(yearly.amount) / parseFloat(monthly.amount)) : 0;
  const cycleLabel = (c: string) => (c === "yearly" && freeMonths >= 1 ? `Yearly · ${freeMonths} month${freeMonths > 1 ? "s" : ""} free` : LABEL[c]);

  const summary = selected ? [
    { k: `${tier.tierName} · ${LABEL[cycle]}`, v: usd(amount) },
    { k: "Network fee", v: "Free", ok: true },
    ...(trial ? [{ k: "Free trial", v: `${trial} days` }] : []),
    { k: "Due today", v: usd(dueToday), strong: true },
    trial ? { k: `First charge · ${dateIn(trial)}`, v: usd(amount) } : { k: `Renews · ${dateIn(DAYS[cycle]!)}`, v: usd(amount) },
  ] : [];

  const choose = (c: Cycle) => {
    setCycle(c); setError(null);
    if (!priceFor(tier, c)) { const i = options.findIndex((o) => priceFor(o, c)); if (i >= 0) setPick(i); }
  };

  const loginHref = `/login?next=${encodeURIComponent(`/subscribe/${merchantId}`)}`;
  const switchAccount = () => { localStorage.removeItem("token"); setLocation(loginHref); };

  const canPay = !!selected && !!me?.hasTransactionPassword && !!txPwd && agree && !busy && !low;
  const pay = async () => {
    if (!canPay || !selected) return;
    setError(null); setBusy(true);
    try {
      const res  = await fetch(`${API_BASE}/api/subscriptions/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ merchantId, intervalId: selected.intervalId, transactionPassword: txPwd }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Payment failed");
      setDone({ status: json.subscription?.status ?? "active", tier: tier.tierName, amount: usd(amount), interval: cycle });
      setTxPwd("");
    } catch (e: any) {
      setError(e?.message ?? "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const page = variant === "page";

  // ── Left: plan and summary ─────────────────────────────────────────────────
  const planSide = (
    <div className={cn("w-full flex flex-col gap-8", page && "max-w-[460px]")}>
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-[14px] bg-[#dfe4ff] text-(--sw-blue) grid place-items-center font-extrabold text-[17px] shrink-0">
          {(plan.creatorName || plan.planTitle).charAt(0).toUpperCase()}
        </span>
        <span className="flex flex-col min-w-0">
          <span className="font-extrabold text-base truncate">{plan.creatorName}</span>
          <span className="text-[13px] text-(--sw-muted) truncate">
            {plan.planTitle} · <span className="tracking-[0.04em]" translate="no">{merchantId}</span>
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-(--sw-muted)">Subscribe to {tier.tierName}</span>
        <span className="font-extrabold text-[44px] sm:text-[52px] tracking-[-0.05em] leading-none tabular-nums">
          {selected ? usd(amount) : "—"}
          <span className="text-[17px] font-semibold text-(--sw-faint) tracking-normal"> / {PER[cycle]}</span>
        </span>
        {trial > 0 && selected && (
          <span className="text-sm font-semibold text-(--sw-blue)">{trial}-day free trial, then {usd(amount)} per {PER[cycle]}</span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className={kicker}>Choose a plan</span>
          {cycles.length > 1 && (
            <div className="flex bg-(--sw-line) rounded-[10px] p-[3px] gap-0.5" role="tablist" aria-label="Billing cycle">
              {cycles.map((c) => (
                <button key={c} type="button" role="tab" aria-selected={c === cycle} onClick={() => choose(c)}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap",
                    c === cycle ? "bg-white text-(--sw-ink) shadow-[0_1px_2px_rgb(11_18_32/.08)]" : "text-(--sw-muted)")}>
                  {cycleLabel(c)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3" role="radiogroup" aria-label="Plan">
          {options.map((o, i) => {
            const iv = priceFor(o, cycle), on = i === pick;
            return (
              <button key={o.tierId || i} type="button" role="radio" aria-checked={on} disabled={!iv}
                onClick={() => { setPick(i); setError(null); }}
                className={cn("flex items-center gap-3.5 px-5 py-[18px] rounded-[18px] border-[1.5px] text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                  on ? "border-(--sw-blue) bg-[#f5f7ff]" : "border-(--sw-line) bg-white hover:border-[#c9d0fd]")}>
                <span className={cn("w-5 h-5 rounded-full border-2 grid place-items-center shrink-0", on ? "border-(--sw-blue)" : "border-[#d0d5dd]")}>
                  <span className={cn("w-2.5 h-2.5 rounded-full", on && "bg-(--sw-blue)")} />
                </span>
                <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <span className="font-bold text-[15px] truncate">{o.tierName}</span>
                  {(o.description || !iv) && <span className="text-[13px] text-(--sw-muted)">{iv ? o.description : `No ${LABEL[cycle]!.toLowerCase()} price`}</span>}
                </span>
                {iv && <span className="font-extrabold text-base whitespace-nowrap tabular-nums">{usd(iv.amount)}/{SHORT[cycle]}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {tier.features.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className={kicker}>Included in {tier.tierName}</span>
          {tier.features.map((f) => (
            <div key={f} className="flex items-start gap-2.5 text-sm text-(--sw-label) leading-snug">
              <span className="w-[18px] h-[18px] rounded-full bg-(--sw-blue) text-white grid place-items-center shrink-0 mt-px"><Check className="w-3 h-3" strokeWidth={3} /></span>
              <span className="min-w-0 break-words">{f}</span>
            </div>
          ))}
        </div>
      )}

      {summary.length > 0 && (
        <dl className="border-t border-(--sw-field-line)">
          {summary.map((r) => (
            <div key={r.k} className={cn("flex justify-between gap-3 py-3.5 border-b border-(--sw-line) text-sm", r.strong && "font-bold")}>
              <dt className={r.strong ? "text-(--sw-ink)" : "text-(--sw-muted)"}>{r.k}</dt>
              <dd className={cn("tabular-nums", r.ok ? "text-[#067647] font-semibold" : "text-(--sw-ink)")}>{r.v}</dd>
            </div>
          ))}
        </dl>
      )}

      {page && <p className="text-[13px] text-(--sw-faint)">Cancel anytime from Subscriptions in your Sweep account.</p>}
    </div>
  );

  // ── Right: pay ─────────────────────────────────────────────────────────────
  const paySide = done ? (
    <div className={cn("w-full flex flex-col gap-5", page && "max-w-[440px]")} role="status">
      <div className="relative overflow-hidden bg-(--sw-blue) text-white rounded-[26px] px-7 pt-10 pb-8 min-h-[260px] flex flex-col justify-end gap-1.5">
        <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] opacity-[.08] pointer-events-none" />
        <span className="relative text-xs font-bold tracking-[0.05em] opacity-85">{done.status === "trialing" ? "FREE TRIAL STARTED" : "SUBSCRIPTION ACTIVE"}</span>
        <span className="relative font-extrabold text-[64px] sm:text-[76px] leading-[.92] tracking-[-0.055em]">Swept.</span>
        <span className="relative text-base opacity-90 truncate">{plan.creatorName} · {done.tier}</span>
      </div>
      <dl className="border-t border-(--sw-line)">
        {[
          ["Plan", `${done.tier} · ${LABEL[done.interval]}`],
          ["Charged today", done.status === "trialing" ? usd(0) : done.amount],
          [done.status === "trialing" ? "First charge" : "Next charge", `${trial && done.status === "trialing" ? dateIn(trial) : dateIn(DAYS[done.interval]!)} · ${done.amount}`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-3.5 border-b border-(--sw-line) text-sm">
            <dt className="text-(--sw-muted)">{k}</dt><dd className="font-bold text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {page ? (
        <Link href="/" className="h-[54px] rounded-2xl bg-(--sw-blue) text-white text-[15px] font-bold grid place-items-center hover:bg-(--sw-blue-hover)">Manage subscriptions</Link>
      ) : (
        <button type="button" onClick={onPayAnother} className="h-[54px] rounded-2xl border border-(--sw-tint-line) text-(--sw-blue) text-[15px] font-bold hover:bg-(--sw-tint)">
          Pay another subscription
        </button>
      )}
    </div>
  ) : (
    <div className={cn("w-full flex flex-col gap-6", page && "max-w-[440px]")}>
      <h2 className="font-extrabold text-2xl tracking-[-0.03em]">Pay with Sweep</h2>

      {page && (
        <>
          <div className="border border-(--sw-line) rounded-[20px] p-[18px] flex flex-wrap items-center gap-[18px]">
            <BrandedQr value={merchantQrUrl(merchantId)} label={`QR code for ${plan.planTitle}`} className="w-32" />
            <span className="flex flex-col gap-1.5 min-w-[180px] flex-1">
              <span className="font-extrabold text-base">Scan to pay on your phone</span>
              <span className="text-[13px] text-(--sw-muted) leading-normal">Open the Sweep app and scan. This plan opens with the Merchant ID already filled in.</span>
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs font-bold tracking-[0.06em] text-(--sw-faint)" aria-hidden>
            <span className="flex-1 h-px bg-(--sw-line)" />OR PAY ON THIS DEVICE<span className="flex-1 h-px bg-(--sw-line)" />
          </div>
        </>
      )}

      {!meReady ? (
        <div className="h-24 grid place-items-center text-(--sw-muted)"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : !me ? (
        <div className="flex flex-col gap-3.5">
          <Link href={loginHref} className="h-[54px] rounded-2xl bg-(--sw-blue) text-white text-[15px] font-bold grid place-items-center hover:bg-(--sw-blue-hover)">
            Log in to pay
          </Link>
          <p className="text-[13px] text-(--sw-muted) text-center">
            No account? <Link href="/register" className="font-bold text-(--sw-blue)">Open one free</Link>
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-[18px]">
          <div className="border border-(--sw-line) rounded-[18px] px-[18px] py-4 flex items-center gap-3.5">
            <span className="w-10 h-10 rounded-xl bg-(--sw-blue) grid place-items-center shrink-0"><img src="/sweep-mark-white.svg" alt="" className="w-3.5" /></span>
            <span className="flex flex-col flex-1 min-w-0">
              <span className="font-bold text-[15px] truncate">{me.email}</span>
              <span className={cn("text-[13px]", low ? "text-[#b54708] font-semibold" : "text-(--sw-muted)")}>
                Balance {me.balance === null ? "—" : usd(me.balance)}{low ? " · not enough for today's charge" : ""}
              </span>
            </span>
            {page && <button type="button" onClick={switchAccount} className="text-[13px] font-bold text-(--sw-muted) hover:text-(--sw-ink) shrink-0">Switch</button>}
          </div>

          {me.hasTransactionPassword ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="co-txpwd" className="text-[13px] font-bold text-(--sw-label)">Transaction password</label>
              <input id="co-txpwd" type="password" value={txPwd} onChange={(e) => { setTxPwd(e.target.value); setError(null); }}
                placeholder="Authorize this subscription" autoComplete="off"
                className="h-[52px] rounded-[14px] border border-(--sw-field-line) bg-white px-4 text-[15px] font-medium outline-none placeholder:text-[#9aa4b5] focus:border-(--sw-blue) focus:shadow-[0_0_0_4px_rgb(17_40_245/.1)] transition" />
            </div>
          ) : (
            <p className="rounded-2xl bg-[#fffaeb] text-[#b54708] px-4 py-3 text-sm font-medium">
              Set a transaction password in Settings to pay for subscriptions.
            </p>
          )}

          <button type="button" role="checkbox" aria-checked={agree} onClick={() => setAgree(!agree)}
            className="flex gap-2.5 items-start text-left text-[13px] text-[#475467] leading-[1.55]">
            <span className={cn("w-5 h-5 rounded-md border-[1.5px] grid place-items-center shrink-0 mt-px text-white",
              agree ? "bg-(--sw-blue) border-(--sw-blue)" : "bg-white border-[#d0d5dd]")}>
              {agree && <Check className="w-3 h-3" strokeWidth={3} />}
            </span>
            <span>
              I authorize {plan.creatorName} to charge {selected ? usd(amount) : "this plan's price"} every {PER[cycle]} from my Sweep balance
              {trial ? ` after the ${trial}-day trial` : ""}, until I cancel.
            </span>
          </button>

          {error && <p role="alert" className="rounded-2xl bg-[#fef3f2] text-[#b42318] px-4 py-3 text-sm font-medium">{error}</p>}

          <button type="button" onClick={pay} disabled={!canPay}
            className="h-[58px] rounded-2xl bg-(--sw-blue) text-white text-base font-bold hover:bg-(--sw-blue-hover) active:scale-[.99] disabled:bg-[#c5ccd8] disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center gap-2 transition">
            {busy && <Loader2 className="w-5 h-5 animate-spin" />}
            {busy ? "Paying…" : trial ? "Start free trial" : selected ? `Pay ${usd(amount)} & subscribe` : "Choose a plan"}
          </button>
        </div>
      )}

      <span className="text-xs text-(--sw-faint) flex items-center justify-center gap-1.5">
        <img src="/sweep-mark-blue.svg" alt="" className="w-2.5" /> Secured by Sweep · Testnet · USDC by Circle
      </span>
    </div>
  );

  if (!page) {
    return <div className="flex flex-col gap-8">{planSide}<div className="border-t border-(--sw-line) pt-7">{paySide}</div></div>;
  }

  return (
    <div className="sweep-ui min-h-[100dvh] grid grid-cols-1 lg:grid-cols-2 bg-white">
      <section className="bg-(--sw-bg) lg:border-r border-(--sw-line) flex justify-center lg:justify-end px-5 sm:px-10 lg:px-14 py-10 lg:py-12">
        {planSide}
      </section>
      <section className="flex justify-center lg:justify-start px-5 sm:px-10 lg:px-14 py-10 lg:py-12">
        {paySide}
      </section>
    </div>
  );
}
