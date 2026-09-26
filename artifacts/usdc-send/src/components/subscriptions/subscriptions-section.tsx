import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Loader2, Plus, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { authHeaders } from "@/lib/wallet";
import { merchantQrUrl } from "@/lib/pay-qr";
import { QrDialog, ShareableQr } from "@/components/sweep/qr";
import { useCopy } from "@/components/sweep/ui";
import { CreatePlan } from "./create-plan";
import { Checkout, type PlanInfo } from "./checkout";

// v5 Subscriptions: Subscribed / Selling lists, Pay with Merchant ID, New plan and
// Manage subscription — one section shared by the web and mobile dashboards.

export interface MySubscription {
  id: number; planId: number; intervalId: number; merchantId: string; planInterval: string; amount: string;
  status: "active" | "trialing" | "past_due" | "cancelled" | "failed" | string;
  startedAt: string; trialEndsAt: string | null; nextBillingAt: string | null; cancelledAt: string | null;
  planTitle: string; creatorName: string; tierName: string | null; features: string[];
  payments: Array<{ id: number; amount: string; status: string; attemptedAt: string }>;
  totalPaid: string;
}
interface MyPlan {
  id: number; planTitle: string; merchantId: string; hasFreeTrial: boolean;
  intervals: Array<{ id: number; tierId: number | null; interval: string; amount: string }>;
  tiers: Array<{ id: number; tierName: string }>;
  activeSubscriberCount: number; monthlyRevenue?: string;
}
interface Subscriber { subscriptionId: number; subscriberName: string; subscriberEmail: string; planInterval: string; amount: string; status: string; startedAt: string }

type View =
  | { kind: "list"; tab: "subscribed" | "selling" }
  | { kind: "create" }
  | { kind: "pay"; merchantId?: string }
  | { kind: "manage"; id: number };

const PER: Record<string, string>   = { weekly: "week", monthly: "month", yearly: "year" };
const LABEL: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const AVATARS = [["#dfe4ff", "#1128f5"], ["#1128f5", "#fff"], ["#0b1220", "#fff"], ["#e8ecf3", "#0b1220"]] as const;
const kicker  = "text-xs font-bold tracking-[0.07em] text-(--sw-faint) uppercase";
const card    = "bg-white border border-(--sw-line) rounded-[24px]";

const usd = (v: number | string) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null | undefined, year = false) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) }) : "—";
const monthly = (s: Pick<MySubscription, "amount" | "planInterval">) => {
  const a = parseFloat(s.amount);
  return s.planInterval === "weekly" ? (a * 52) / 12 : s.planInterval === "yearly" ? a / 12 : a;
};
const isLive  = (s: MySubscription) => s.status === "active" || s.status === "trialing" || s.status === "past_due";
const planName = (s: MySubscription) => (s.tierName && s.tierName !== s.planTitle ? `${s.planTitle} · ${s.tierName}` : s.planTitle);

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  active:    { label: "Active",   fg: "#067647", bg: "#ecfdf3" },
  trialing:  { label: "Trial",    fg: "#1128f5", bg: "#eef1ff" },
  past_due:  { label: "Past due", fg: "#b54708", bg: "#fffaeb" },
  cancelled: { label: "Ended",    fg: "#475467", bg: "#f2f4f7" },
  failed:    { label: "Ended",    fg: "#475467", bg: "#f2f4f7" },
};
const statusOf = (s: string) => STATUS[s] ?? STATUS.active!;

function meta(s: MySubscription): [string, string] {
  if (s.status === "trialing") return [`Trial ends ${day(s.trialEndsAt)}`, "#1128f5"];
  if (s.status === "past_due") return ["Payment failed · retrying daily", "#b54708"];
  if (s.status === "active")   return [`Renews ${day(s.nextBillingAt)}`, "#667085"];
  return [s.status === "failed" ? "Ended · payment failed" : `Ended ${day(s.cancelledAt)}`, "#98a2b3"];
}

export const MY_SUBS_KEY = ["/api/subscriptions/my"];

export function useMySubscriptions() {
  return useQuery({
    queryKey: MY_SUBS_KEY,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res  = await fetch(`${API_BASE}/api/subscriptions/my`, { headers: authHeaders() });
      const json = res.ok ? await res.json().catch(() => null) : null;
      return Array.isArray(json?.subscriptions) ? (json.subscriptions as MySubscription[]) : [];
    },
  });
}

export function SubscriptionsSection({ user, available, onScan, onAddMoney }: {
  user: { name: string; email: string };
  available: number;
  onScan: () => void;
  onAddMoney: () => void;
}) {
  const [view, setView] = useState<View>({ kind: "list", tab: "subscribed" });
  const subs  = useMySubscriptions();
  const plans = useQuery({
    queryKey: ["/api/subscriptions/plans"],
    queryFn: async () => {
      const res  = await fetch(`${API_BASE}/api/subscriptions/plans`, { headers: authHeaders() });
      const json = res.ok ? await res.json().catch(() => null) : null;
      return Array.isArray(json?.plans) ? (json.plans as MyPlan[]) : [];
    },
  });
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: MY_SUBS_KEY }); qc.invalidateQueries({ queryKey: ["/api/subscriptions/plans"] }); };

  const list   = subs.data ?? [];
  const toList = (tab: "subscribed" | "selling" = "subscribed") => setView({ kind: "list", tab });

  if (view.kind === "create") {
    return (
      <SubView title="New subscription plan" sub="Subscribers are billed automatically from their Sweep balance" onBack={() => { refresh(); toList("selling"); }}>
        <CreatePlan user={user} />
      </SubView>
    );
  }
  if (view.kind === "pay") {
    return (
      <SubView title="Pay a subscription" sub="Look up a creator and subscribe in three steps" onBack={() => { refresh(); toList(); }}>
        <PayFlow initialMerchantId={view.merchantId} onScan={onScan} onDone={refresh} onFinish={() => toList()} />
      </SubView>
    );
  }
  if (view.kind === "manage") {
    const sub = list.find((s) => s.id === view.id);
    return (
      <SubView title="Manage subscription" sub="Plan, billing and cancellation" onBack={() => toList()}>
        {sub
          ? <Manage sub={sub} user={user} available={available} onAddMoney={onAddMoney} onChanged={refresh}
              onSwitch={(merchantId) => setView({ kind: "pay", merchantId })} />
          : <Loading />}
      </SubView>
    );
  }

  const selling = plans.data ?? [];
  return (
    <div className="flex flex-col gap-6 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-6 border-b border-(--sw-line) flex-1 min-w-[220px]" role="tablist" aria-label="Subscriptions">
          {([["subscribed", "Subscribed", list.length], ["selling", "Selling", selling.length]] as const).map(([k, label, count]) => {
            const on = view.tab === k;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={() => toList(k)}
                className={cn("pb-3 -mb-px border-b-2 flex items-center gap-2 text-[15px] font-bold transition-colors",
                  on ? "border-(--sw-blue) text-(--sw-ink)" : "border-transparent text-(--sw-muted) hover:text-(--sw-ink)")}>
                {label}
                <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded-md", on ? "bg-(--sw-tint) text-(--sw-blue)" : "bg-[#f2f4f7] text-(--sw-muted)")}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2.5">
          <button type="button" onClick={() => setView({ kind: "pay" })}
            className="h-11 px-4 rounded-[14px] border border-(--sw-field-line) bg-white text-(--sw-blue) text-sm font-bold hover:bg-(--sw-tint) whitespace-nowrap">
            Pay with Merchant ID
          </button>
          <button type="button" onClick={() => setView({ kind: "create" })}
            className="h-11 px-4 rounded-[14px] bg-(--sw-blue) text-white text-sm font-bold hover:bg-(--sw-blue-hover) flex items-center gap-1.5 whitespace-nowrap">
            <Plus className="w-4 h-4" strokeWidth={2.5} /> New plan
          </button>
        </div>
      </div>

      {view.tab === "subscribed"
        ? <Subscribed subs={list} loading={subs.isLoading} onOpen={(id) => setView({ kind: "manage", id })} onPay={() => setView({ kind: "pay" })}
            onAddMoney={onAddMoney} onChanged={refresh} />
        : <Selling plans={selling} loading={plans.isLoading} onCreate={() => setView({ kind: "create" })} />}
    </div>
  );
}

// ── Subscribed ─────────────────────────────────────────────────────────────────

function Subscribed({ subs, loading, onOpen, onPay, onAddMoney, onChanged }: {
  subs: MySubscription[];
  loading: boolean;
  onOpen: (id: number) => void;
  onPay: () => void;
  onAddMoney: () => void;
  onChanged: () => void;
}) {
  const passport = useQuery({
    queryKey: ["/api/subscriptions/passport"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/subscriptions/passport`, { headers: authHeaders() });
      return res.ok ? ((await res.json()) as { hasPassport: boolean; status: string | null; issuedAt?: string }) : null;
    },
  });

  if (loading) return <Loading />;
  if (!subs.length) {
    return (
      <div className={cn(card, "px-6 py-12 flex flex-col items-center text-center gap-3")}>
        <span className="w-12 h-12 rounded-2xl bg-(--sw-tint) grid place-items-center"><img src="/sweep-mark-blue.svg" alt="" className="w-5" /></span>
        <h3 className="font-extrabold text-lg">No subscriptions yet</h3>
        <p className="text-sm text-(--sw-muted) max-w-sm">Got a Merchant ID from a creator? Subscribe in three steps, paid from your Sweep balance.</p>
        <button type="button" onClick={onPay} className="mt-2 h-11 px-5 rounded-[14px] bg-(--sw-blue) text-white text-sm font-bold">Pay with Merchant ID</button>
      </div>
    );
  }

  const live      = subs.filter((s) => s.status === "active" || s.status === "trialing");
  const spend     = live.filter((s) => s.status === "active").reduce((a, s) => a + monthly(s), 0);
  const trials    = subs.filter((s) => s.status === "trialing").length;
  const next      = [...live].map((s) => ({ s, at: s.status === "trialing" ? s.trialEndsAt : s.nextBillingAt }))
    .filter((x) => x.at).sort((a, b) => +new Date(a.at!) - +new Date(b.at!))[0];
  const pastDue   = subs.find((s) => s.status === "past_due");
  const hasPass   = passport.data?.hasPassport && passport.data.status === "active";
  const avatar    = (s: MySubscription) => AVATARS[s.planId % AVATARS.length]!;

  const groups: Array<[string, MySubscription[]]> = [
    ["Active",      subs.filter((s) => s.status === "active" || s.status === "past_due")],
    ["Free trials", subs.filter((s) => s.status === "trialing")],
    ["Ended",       subs.filter((s) => !isLive(s))],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className={cn(card, "grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-(--sw-line)")}>
        <div className="px-6 md:px-8 py-6 flex flex-col gap-1.5">
          <span className={kicker}>Monthly spend</span>
          <span className="font-extrabold text-[40px] tracking-[-0.045em] leading-none tabular-nums">{usd(spend)}</span>
          <span className="text-[13px] text-(--sw-muted)">{live.length} active subscription{live.length === 1 ? "" : "s"}{trials ? ` · ${trials} in trial` : ""}</span>
        </div>
        <div className="px-6 md:px-8 py-6 flex flex-col gap-3 min-w-0">
          <span className={kicker}>Next charge</span>
          {next ? (
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={next.s.creatorName} colors={avatar(next.s)} size="md" />
              <span className="flex flex-col min-w-0">
                <span className="font-bold text-[15px] truncate">{next.s.creatorName}</span>
                <span className="text-sm text-(--sw-muted)">{day(next.at)} · {usd(next.s.amount)}</span>
              </span>
            </div>
          ) : <span className="text-sm text-(--sw-muted)">Nothing scheduled</span>}
        </div>
        <div className="px-6 md:px-8 py-6 flex flex-col gap-3">
          <span className={kicker}>Sweep Passport</span>
          <div className="flex items-center gap-3">
            <span className={cn("w-12 h-12 rounded-[14px] grid place-items-center shrink-0", hasPass ? "bg-(--sw-ink)" : "bg-[#243049]")}>
              <img src="/sweep-mark-white.svg" alt="" className={cn("w-4", !hasPass && "opacity-50")} />
            </span>
            <span className="flex flex-col min-w-0">
              <span className="font-bold text-[15px]">{hasPass ? `Issued ${day(passport.data?.issuedAt, true)}` : "No passport yet"}</span>
              <span className={cn("text-[13px] font-bold", hasPass ? "text-[#067647]" : "text-(--sw-faint)")}>{hasPass ? "ACTIVE" : passport.data?.status?.toUpperCase() ?? "LOCKED"}</span>
            </span>
          </div>
        </div>
      </div>

      {pastDue && <PastDueBanner sub={pastDue} onAddMoney={onAddMoney} onChanged={onChanged} />}

      {groups.filter(([, items]) => items.length).map(([title, items]) => (
        <section key={title} className="flex flex-col gap-3">
          <h3 className="font-extrabold text-lg tracking-[-0.01em] px-1">{title} <span className="text-sm font-bold text-(--sw-faint) ml-1">{items.length}</span></h3>
          <div className={cn(card, "overflow-hidden divide-y divide-[#f0f2f6]")}>
            {items.map((s) => {
              const [m, color] = meta(s);
              return (
                <button key={s.id} type="button" onClick={() => onOpen(s.id)}
                  className="w-full flex items-center gap-4 px-5 sm:px-6 py-4 text-left hover:bg-[#fafbfc] transition-colors">
                  <Avatar name={s.creatorName} colors={avatar(s)} size="lg" muted={!isLive(s)} />
                  <span className="flex flex-col flex-1 min-w-0">
                    <span className="font-bold text-base truncate">{s.creatorName}</span>
                    <span className="text-sm text-(--sw-muted) truncate">{planName(s)}</span>
                  </span>
                  <span className="flex flex-col items-end shrink-0 max-w-[55%]">
                    <span className="font-extrabold text-base tabular-nums">{usd(s.amount)}<span className="text-[13px] font-medium text-(--sw-faint)"> / {PER[s.planInterval] ?? s.planInterval}</span></span>
                    <span className="text-[13px] font-semibold text-right" style={{ color }}>
                      {s.status === "past_due" ? <>Payment failed<span className="hidden sm:inline"> · retrying daily</span></> : m}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-(--sw-faint) shrink-0 hidden sm:block" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function PastDueBanner({ sub, onAddMoney, onChanged }: { sub: MySubscription; onAddMoney: () => void; onChanged: () => void }) {
  const retry = useRetry(sub.id, onChanged);
  return (
    <div className="rounded-[20px] border border-[#fedf89] bg-[#fffaeb] px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[15px] text-[#93370d]">{sub.creatorName} payment failed</p>
        <p className="text-sm text-[#b54708]">{retry.error ?? "Add money, then retry to keep your subscription."}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onAddMoney} className="h-10 px-4 rounded-xl border border-[#fedf89] bg-white text-[#93370d] text-sm font-bold">Add money</button>
        <button type="button" onClick={retry.run} disabled={retry.busy}
          className="h-10 px-4 rounded-xl bg-[#93370d] text-white text-sm font-bold disabled:opacity-60 flex items-center gap-1.5">
          {retry.busy && <Loader2 className="w-4 h-4 animate-spin" />} Retry payment
        </button>
      </div>
    </div>
  );
}

function useRetry(id: number, onChanged: () => void) {
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok,    setOk]    = useState(false);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const res  = await fetch(`${API_BASE}/api/subscriptions/${id}/retry`, { method: "POST", headers: authHeaders(true) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Payment failed");
      setOk(true); onChanged();
    } catch (e: any) {
      setError(e?.message ?? "Payment failed");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, ok, run };
}

// ── Selling ────────────────────────────────────────────────────────────────────

function Selling({ plans, loading, onCreate }: { plans: MyPlan[]; loading: boolean; onCreate: () => void }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [qrFor,  setQrFor]  = useState<MyPlan | null>(null);
  if (loading) return <Loading />;

  const subscribers = plans.reduce((a, p) => a + p.activeSubscriberCount, 0);
  const revenue     = plans.reduce((a, p) => a + parseFloat(p.monthlyRevenue ?? "0"), 0);
  const priceLabel  = (p: MyPlan) => {
    const ivs = [...p.intervals].sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount));
    const first = ivs[0];
    if (!first) return "—";
    return `${p.tiers.length > 1 ? "From " : ""}${usd(first.amount)} / ${PER[first.interval] ?? first.interval}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className={cn(card, "grid grid-cols-3 divide-x divide-(--sw-line)")}>
        {[["Live plans", String(plans.length)], ["Subscribers", String(subscribers)], ["Monthly revenue", usd(revenue)]].map(([k, v]) => (
          <div key={k} className="px-4 sm:px-8 py-6 flex flex-col gap-1.5 min-w-0">
            <span className={kicker}>{k}</span>
            <span className="font-extrabold text-2xl sm:text-[36px] tracking-[-0.04em] leading-none tabular-nums truncate">{v}</span>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="font-extrabold text-lg tracking-[-0.01em] px-1">Your plans <span className="text-sm font-bold text-(--sw-faint) ml-1">{plans.length}</span></h3>
        <div className={cn(card, "overflow-hidden divide-y divide-[#f0f2f6]")}>
          {plans.map((p) => (
            <div key={p.id}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 sm:px-6 py-4">
                <button type="button" onClick={() => setOpenId(openId === p.id ? null : p.id)} aria-expanded={openId === p.id}
                  className="flex flex-col flex-1 min-w-[180px] text-left">
                  <span className="font-bold text-base truncate">{p.planTitle}</span>
                  <span className="text-sm text-(--sw-muted)">{priceLabel(p)}</span>
                </button>
                <Stat k="Subscribers" v={String(p.activeSubscriberCount)} />
                <Stat k="Monthly" v={usd(p.monthlyRevenue ?? "0")} />
                <MerchantPill id={p.merchantId} onQr={() => setQrFor(p)} />
              </div>
              {openId === p.id && <Subscribers planId={p.id} />}
            </div>
          ))}
          <button type="button" onClick={onCreate} className="w-full px-5 sm:px-6 py-4 text-left text-[15px] font-bold text-(--sw-blue) hover:bg-[#fafbfc]">
            + Create a new plan
          </button>
        </div>
      </section>

      <AnimatePresence>
        {qrFor && (
          <QrDialog title="Plan QR code" onClose={() => setQrFor(null)}>
            <p className="text-sm text-(--sw-muted) -mt-2">Subscribers scan this to open the checkout for this plan.</p>
            <ShareableQr value={merchantQrUrl(qrFor.merchantId)} label={qrFor.planTitle}
              sublabel={<code className="text-[13px] font-semibold text-(--sw-blue)">{qrFor.merchantId}</code>}
              fileName={`sweep-plan-${qrFor.merchantId}.png`} shareText={`Subscribe to ${qrFor.planTitle} on Sweep`} />
          </QrDialog>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <span className="flex flex-col w-24">
      <span className="text-[13px] text-(--sw-faint)">{k}</span>
      <span className="font-bold text-[15px] tabular-nums">{v}</span>
    </span>
  );
}

function MerchantPill({ id, onQr }: { id: string; onQr: () => void }) {
  const { copied, copy } = useCopy();
  return (
    <span className="flex items-center gap-1 rounded-xl border border-(--sw-field-line) pl-3.5 pr-1 h-10">
      <code className="font-sans font-bold text-sm tracking-[0.04em] mr-1.5" translate="no">{id}</code>
      <button type="button" onClick={() => copy(id)} className="px-2 h-8 rounded-lg text-sm font-bold text-(--sw-blue) hover:bg-(--sw-tint)">{copied ? "Copied" : "Copy"}</button>
      <button type="button" onClick={onQr} aria-label="Show plan QR code" className="w-8 h-8 rounded-lg grid place-items-center text-(--sw-blue) hover:bg-(--sw-tint)">
        <QrCode className="w-4 h-4" />
      </button>
    </span>
  );
}

function Subscribers({ planId }: { planId: number }) {
  const q = useQuery({
    queryKey: ["/api/subscriptions/plans", planId, "subscribers"],
    queryFn: async () => {
      const res  = await fetch(`${API_BASE}/api/subscriptions/plans/${planId}/subscribers`, { headers: authHeaders() });
      const json = res.ok ? await res.json().catch(() => null) : null;
      return Array.isArray(json?.subscribers) ? (json.subscribers as Subscriber[]) : [];
    },
  });
  return (
    <div className="bg-[#fafbfc] border-t border-[#f0f2f6] px-5 sm:px-6 py-3">
      {q.isLoading ? <Loading small /> : !q.data?.length ? (
        <p className="text-sm text-(--sw-muted) py-2">No subscribers yet. Share your Merchant ID or QR code to get your first.</p>
      ) : (
        <ul className="divide-y divide-(--sw-line)">
          {q.data.map((s) => (
            <li key={s.subscriptionId} className="flex items-center gap-3 py-2.5">
              <span className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-bold truncate">{s.subscriberName}</span>
                <span className="text-xs text-(--sw-muted) truncate">{s.subscriberEmail} · since {day(s.startedAt, true)}</span>
              </span>
              <span className="text-sm font-bold tabular-nums">{usd(s.amount)}/{PER[s.planInterval] ?? s.planInterval}</span>
              <StatusPill status={s.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Pay with Merchant ID ───────────────────────────────────────────────────────

function PayFlow({ initialMerchantId, onScan, onDone, onFinish }: {
  initialMerchantId?: string;
  onScan: () => void;
  onDone: () => void;
  onFinish: () => void;
}) {
  const [mid,     setMid]     = useState(initialMerchantId ?? "");
  const [plan,    setPlan]    = useState<PlanInfo | null>(null);
  const [looking, setLooking] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [paid,    setPaid]    = useState(false);

  const format = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12).replace(/(.{4})(?=.)/g, "$1-");
  const lookup = async (id = mid) => {
    if (id.length < 14) return;
    setLooking(true); setError(null);
    try {
      const res  = await fetch(`${API_BASE}/api/subscriptions/merchant/${encodeURIComponent(id)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Merchant ID not found");
      setPlan(json);
    } catch (e: any) {
      setError(e?.message ?? "Merchant ID not found");
    } finally {
      setLooking(false);
    }
  };
  useEffect(() => { if (initialMerchantId) lookup(initialMerchantId); }, []);

  const step = paid ? 3 : plan ? 1 : 0;
  return (
    <div className="flex flex-col gap-5 max-w-[620px]">
      <ol className="grid grid-cols-3 gap-2.5" aria-label="Progress">
        {["Merchant ID", "Choose plan", "Confirm"].map((label, i) => (
          <li key={label} className="flex flex-col gap-2" aria-current={i === Math.min(step, 2) ? "step" : undefined}>
            <span className={cn("h-1 rounded-full", i <= step || (plan && i === 2) ? "bg-(--sw-blue)" : "bg-(--sw-field-line)")} />
            <span className={cn("text-[13px] font-bold", i <= step || (plan && i === 2) ? "text-(--sw-ink)" : "text-(--sw-faint)")}>{label}</span>
          </li>
        ))}
      </ol>

      {plan ? (
        <div className={cn(card, "p-5 sm:p-7 flex flex-col gap-5")}>
          {!paid && (
            <button type="button" onClick={() => { setPlan(null); setError(null); }} className="self-start text-sm font-bold text-(--sw-muted) hover:text-(--sw-ink)">
              ← Different Merchant ID
            </button>
          )}
          <Checkout merchantId={mid} plan={plan} variant="embedded" onDone={() => { setPaid(true); onDone(); }} onPayAnother={onFinish} />
        </div>
      ) : (
        <form className={cn(card, "p-5 sm:p-7 flex flex-col gap-4")} onSubmit={(e) => { e.preventDefault(); lookup(); }}>
          <div className="flex flex-col gap-1">
            <h3 className="font-extrabold text-2xl tracking-[-0.03em]">Enter Merchant ID</h3>
            <p className="text-sm text-(--sw-muted)">The creator shares this 12-character code with you.</p>
          </div>
          <input value={mid} onChange={(e) => { setMid(format(e.target.value)); setError(null); }} placeholder="XXXX-XXXX-XXXX"
            aria-label="Merchant ID" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            className="h-16 rounded-2xl border border-(--sw-field-line) bg-white px-5 text-[22px] sm:text-[26px] font-extrabold tracking-[0.1em] outline-none placeholder:text-[#c5ccd8] focus:border-(--sw-blue) focus:shadow-[0_0_0_4px_rgb(17_40_245/.1)] transition" />
          {error && <p role="alert" className="rounded-2xl bg-[#fef3f2] text-[#b42318] px-4 py-3 text-sm font-medium">{error}</p>}
          <button type="submit" disabled={mid.length < 14 || looking}
            className="h-[54px] rounded-2xl bg-(--sw-blue) text-white text-[15px] font-bold hover:bg-(--sw-blue-hover) disabled:bg-[#c5ccd8] disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {looking && <Loader2 className="w-4 h-4 animate-spin" />}{looking ? "Looking up…" : "Look up merchant"}
          </button>
          <div className="flex items-center gap-3 text-xs font-bold tracking-[0.06em] text-(--sw-faint)" aria-hidden>
            <span className="flex-1 h-px bg-(--sw-line)" />OR<span className="flex-1 h-px bg-(--sw-line)" />
          </div>
          <button type="button" onClick={onScan}
            className="h-[54px] rounded-2xl border border-(--sw-tint-line) text-(--sw-blue) text-[15px] font-bold hover:bg-(--sw-tint)">
            Scan the creator's QR code
          </button>
        </form>
      )}
    </div>
  );
}

// ── Manage ─────────────────────────────────────────────────────────────────────

function Manage({ sub, user, available, onAddMoney, onChanged, onSwitch }: {
  sub: MySubscription;
  user: { email: string };
  available: number;
  onAddMoney: () => void;
  onChanged: () => void;
  onSwitch: (merchantId: string) => void;
}) {
  const live    = isLive(sub);
  const colors  = AVATARS[sub.planId % AVATARS.length]!;
  const retry   = useRetry(sub.id, onChanged);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling,    setCancelling]    = useState(false);
  const [cancelError,   setCancelError]   = useState<string | null>(null);

  // Other tiers of the same plan, for "Change plan"
  const planInfo = useQuery({
    queryKey: ["/api/subscriptions/merchant", sub.merchantId],
    enabled: live,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/subscriptions/merchant/${encodeURIComponent(sub.merchantId)}`);
      return res.ok ? ((await res.json()) as PlanInfo) : null;
    },
  });
  const options = (planInfo.data?.tiers ?? [])
    .map((t) => ({ t, iv: t.intervals.find((iv) => iv.interval === sub.planInterval) }))
    .filter((x) => x.iv);

  const cancel = async () => {
    setCancelling(true); setCancelError(null);
    try {
      const res  = await fetch(`${API_BASE}/api/subscriptions/${sub.id}`, { method: "DELETE", headers: authHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Could not cancel");
      setConfirmCancel(false); onChanged();
    } catch (e: any) {
      setCancelError(e?.message ?? "Could not cancel");
    } finally {
      setCancelling(false);
    }
  };

  const exportCsv = () => {
    const rows = [["Date", "Reference", "Amount", "Status"], ...sub.payments.map((p) => [new Date(p.attemptedAt).toISOString().slice(0, 10), `INV-${p.id}`, parseFloat(p.amount).toFixed(2), p.status])];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }));
    a.download = `sweep-${sub.merchantId}-billing.csv`;
    a.click();
  };

  const facts = [
    ["Next charge", sub.status === "trialing" ? `${day(sub.trialEndsAt)} · ${usd(sub.amount)}` : sub.status === "active" ? `${day(sub.nextBillingAt)} · ${usd(sub.amount)}` : sub.status === "past_due" ? "Retrying daily" : "None"],
    ["Member since", day(sub.startedAt, true)],
    ["Total paid", usd(sub.totalPaid)],
    ["Merchant ID", sub.merchantId],
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className={cn(card, "overflow-hidden")}>
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 px-5 sm:px-8 py-6">
          <Avatar name={sub.creatorName} colors={colors} size="xl" muted={!live} />
          <div className="flex flex-col flex-1 min-w-[180px] gap-1">
            <span className="font-extrabold text-2xl sm:text-[28px] tracking-[-0.03em] leading-tight">{sub.creatorName}</span>
            <span className="flex flex-wrap items-center gap-2 text-[15px] text-(--sw-muted)">
              {planName(sub)} · {LABEL[sub.planInterval] ?? sub.planInterval}
              <StatusPill status={sub.status} />
            </span>
          </div>
          <span className="font-extrabold text-[36px] sm:text-[44px] tracking-[-0.045em] leading-none tabular-nums">
            {usd(sub.amount)}<span className="text-base font-semibold text-(--sw-faint) tracking-normal"> / {PER[sub.planInterval] ?? sub.planInterval}</span>
          </span>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-4 border-t border-(--sw-line)">
          {facts.map(([k, v], i) => (
            <div key={k} className={cn("px-5 sm:px-6 py-4 flex flex-col gap-1 border-(--sw-line)", i % 2 === 1 && "border-l", i >= 2 && "border-t md:border-t-0", i >= 1 && "md:border-l")}>
              <dt className={kicker}>{k}</dt>
              <dd className="font-bold text-[15px] truncate">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {sub.status === "past_due" && (
        <div className="rounded-[20px] border border-[#fedf89] bg-[#fffaeb] px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1 text-sm text-[#b54708]">
            <strong className="block text-[15px] text-[#93370d]">Your last payment failed</strong>
            {retry.error ?? `We retry daily. Add money and pay now to keep ${sub.creatorName}.`}
          </p>
          <button type="button" onClick={retry.run} disabled={retry.busy}
            className="h-10 px-4 rounded-xl bg-[#93370d] text-white text-sm font-bold disabled:opacity-60 flex items-center gap-1.5 self-start sm:self-auto">
            {retry.busy && <Loader2 className="w-4 h-4 animate-spin" />} Pay {usd(sub.amount)} now
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <div className={cn(card, "px-6 py-6 flex flex-col gap-3.5")}>
            <span className={kicker}>What's included</span>
            {(sub.features.length ? sub.features : [`Full access to ${sub.planTitle}`, "Cancel anytime"]).map((f) => (
              <div key={f} className="flex items-center gap-3 text-[15px]">
                <span className="w-5 h-5 rounded-full bg-(--sw-blue) text-white grid place-items-center shrink-0"><Check className="w-3 h-3" strokeWidth={3} /></span>
                <span className="min-w-0 break-words">{f}</span>
              </div>
            ))}
          </div>

          {live && options.length > 1 && (
            <div className={cn(card, "px-6 py-6 flex flex-col gap-3")}>
              <div>
                <h4 className="font-extrabold text-lg">Change plan</h4>
                <p className="text-sm text-(--sw-muted)">Switching starts the new plan today and replaces this one.</p>
              </div>
              {options.map(({ t, iv }) => {
                const current = iv!.intervalId === sub.intervalId;
                const up = parseFloat(iv!.amount) > parseFloat(sub.amount);
                return (
                  <div key={t.tierId} className={cn("flex items-center gap-3 rounded-2xl border px-4 py-3.5", current ? "border-[#c9d0fd] bg-[#fafbff]" : "border-(--sw-line)")}>
                    <span className="flex flex-col flex-1 min-w-0">
                      <span className="font-bold text-[15px] truncate">{t.tierName}</span>
                      {t.description && <span className="text-[13px] text-(--sw-muted) truncate">{t.description}</span>}
                    </span>
                    <span className="font-extrabold tabular-nums whitespace-nowrap">{usd(iv!.amount)}<span className="text-xs font-medium text-(--sw-faint)">/{({ weekly: "wk", monthly: "mo", yearly: "yr" } as Record<string, string>)[sub.planInterval] ?? sub.planInterval}</span></span>
                    {current ? (
                      <span className="text-xs font-bold px-2.5 py-1.5 rounded-full bg-[#f2f4f7] text-[#475467] whitespace-nowrap">Current plan</span>
                    ) : (
                      <button type="button" onClick={() => onSwitch(sub.merchantId)}
                        className="text-xs font-bold px-2.5 py-1.5 rounded-full bg-(--sw-tint) text-(--sw-blue) hover:bg-[#dfe4ff] whitespace-nowrap">
                        {up ? "Upgrade" : "Downgrade"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <div className={cn(card, "px-6 py-6 flex flex-col gap-4")}>
            <span className={kicker}>Payment method</span>
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-[14px] bg-(--sw-blue) grid place-items-center shrink-0"><img src="/sweep-mark-white.svg" alt="" className="w-4" /></span>
              <span className="flex flex-col flex-1 min-w-0">
                <span className="font-bold text-[15px]">Sweep balance</span>
                <span className="text-[13px] text-(--sw-muted) truncate">{usd(available)} available · {user.email}</span>
              </span>
              <button type="button" onClick={onAddMoney} className="text-sm font-bold text-(--sw-blue) shrink-0">Add money</button>
            </div>
          </div>

          <div className={cn(card, "overflow-hidden")}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <span className={kicker}>Billing history</span>
              {sub.payments.length > 0 && <button type="button" onClick={exportCsv} className="text-sm font-bold text-(--sw-blue)">Export CSV</button>}
            </div>
            {sub.payments.length ? (
              <ul className="divide-y divide-[#f0f2f6] border-t border-[#f0f2f6]">
                {sub.payments.slice(0, 12).map((p) => {
                  const okPay = p.status === "succeeded";
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-6 py-3.5">
                      <span className="flex flex-col flex-1 min-w-0">
                        <span className="font-bold text-[15px]">{day(p.attemptedAt, true)}</span>
                        <span className="text-xs text-(--sw-faint)">INV-{p.id}</span>
                      </span>
                      <span className="font-bold tabular-nums">{usd(p.amount)}</span>
                      <span className={cn("text-xs font-bold px-2 py-1 rounded-md", okPay ? "bg-[#ecfdf3] text-[#067647]" : "bg-[#fffaeb] text-[#b54708]")}>
                        {okPay ? "Paid" : "Failed"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-6 pb-5 text-sm text-(--sw-muted)">{sub.status === "trialing" ? `No charges yet. Your first is on ${day(sub.trialEndsAt)}.` : "No payments recorded yet."}</p>
            )}
          </div>

          {live ? (
            <div className={cn(card, "px-6 py-5 flex flex-col gap-3")}>
              <div className="flex items-center gap-4">
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-[15px]">Cancel subscription</span>
                  <span className="block text-[13px] text-(--sw-muted)">Stops future charges right away. Charges already made aren't refunded.</span>
                </span>
                {!confirmCancel && (
                  <button type="button" onClick={() => setConfirmCancel(true)}
                    className="h-11 px-5 rounded-[14px] border border-[#fda29b] text-[#b42318] text-sm font-bold hover:bg-[#fef3f2] shrink-0">Cancel</button>
                )}
              </div>
              {confirmCancel && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-[#fef3f2] px-4 py-3">
                  <span className="flex-1 min-w-[160px] text-sm font-semibold text-[#b42318]">{cancelError ?? `Cancel ${sub.creatorName}?`}</span>
                  <button type="button" onClick={() => setConfirmCancel(false)} className="h-9 px-3 rounded-lg text-sm font-bold text-(--sw-muted)">Keep it</button>
                  <button type="button" onClick={cancel} disabled={cancelling}
                    className="h-9 px-3.5 rounded-lg bg-[#b42318] text-white text-sm font-bold disabled:opacity-60 flex items-center gap-1.5">
                    {cancelling && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Yes, cancel
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className={cn(card, "px-6 py-5 flex items-center gap-4")}>
              <span className="flex-1 text-[15px] font-bold">This subscription has ended.</span>
              <button type="button" onClick={() => onSwitch(sub.merchantId)}
                className="h-11 px-5 rounded-[14px] bg-(--sw-blue) text-white text-sm font-bold shrink-0">Resubscribe</button>
            </div>
          )}
          {retry.ok && <p role="status" className="rounded-2xl bg-[#ecfdf3] text-[#067647] px-4 py-3 text-sm font-semibold">Payment successful. Your subscription is active.</p>}
        </div>
      </div>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

function SubView({ title, sub, onBack, children }: { title: string; sub: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 min-w-0">
      <div className="flex flex-col gap-1">
        <button type="button" onClick={onBack} className="self-start text-sm font-bold text-(--sw-muted) hover:text-(--sw-ink)">← Subscriptions</button>
        <h2 className="font-extrabold text-[28px] sm:text-[34px] tracking-[-0.04em] leading-tight">{title}</h2>
        <p className="text-[15px] text-(--sw-muted)">{sub}</p>
      </div>
      {children}
    </div>
  );
}

function Avatar({ name, colors, size, muted }: { name: string; colors: readonly [string, string]; size: "md" | "lg" | "xl"; muted?: boolean }) {
  const dims = size === "xl" ? "w-16 h-16 rounded-[18px] text-2xl" : size === "lg" ? "w-[52px] h-[52px] rounded-2xl text-lg" : "w-12 h-12 rounded-[14px] text-lg";
  return (
    <span className={cn(dims, "grid place-items-center font-extrabold shrink-0")}
      style={{ background: muted ? "#e8ecf3" : colors[0], color: muted ? "#475467" : colors[1] }}>
      {(name || "?").charAt(0).toUpperCase()}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = statusOf(status);
  return <span className="text-xs font-bold px-2 py-0.5 rounded-md whitespace-nowrap" style={{ color: s.fg, background: s.bg }}>{s.label}</span>;
}

function Loading({ small }: { small?: boolean }) {
  return <div className={cn("grid place-items-center text-(--sw-muted)", small ? "py-3" : "py-16")}><Loader2 className="w-5 h-5 animate-spin" /></div>;
}
