import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  Key, Webhook, BarChart3, Copy, Check,
  Plus, Trash2, ArrowLeft, LogOut, AlertCircle,
  RefreshCw, Terminal, Shield, CreditCard, Archive, Link2, Users,
  ChevronDown, ChevronUp, Info, TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE as API_URL } from "@/lib/api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ───────────────────────────────────────────────────────────────────

interface DevUser {
  id: number;
  email: string;
  name: string;
  merchantId: string;
  paymentEmail: string;
  createdAt: string;
}
interface ApiKey {
  id: number;
  keyPrefix: string;
  type: "live" | "test";
  label: string;
  active: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}
interface Stats {
  merchantId: string;
  subscribers: { active: number; trialing: number; cancelled: number; total: number };
  mrr: string;
  totalRevenue: string;
}
interface Webhook {
  id: number;
  url: string;
  label: string;
  active: boolean;
  createdAt: string;
}
interface PlanInterval {
  interval_id: number;
  interval: "weekly" | "monthly" | "yearly";
  amount: string;
}
interface PlanTier {
  tier_id: number;
  tier_name: string;
  description: string | null;
  features: string[];
  is_highlighted: boolean;
  display_order: number;
  intervals: PlanInterval[];
}
interface Subscriber {
  id: number;
  subscriberEmail: string;
  planId: number;
  planName: string;
  planInterval: string;
  amount: string;
  status: string;
  externalRef: string | null;
  activationMethod: string | null;
  startedAt: string;
  trialEndsAt: string | null;
  nextBillingAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

interface Plan {
  plan_id: number;
  merchant_id: string;
  name: string;
  payment_email: string;
  has_free_trial: boolean;
  trial_days: number;
  status: string;
  is_tiered: boolean;
  intervals: PlanInterval[];
  tiers: PlanTier[];
  active_subscribers: number;
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function devToken() { return localStorage.getItem("dev_token") ?? ""; }

async function devFetch(path: string, opts?: RequestInit) {
  const r = await fetch(`${API_URL}/api/developer${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${devToken()}`,
      ...opts?.headers,
    },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? r.statusText);
  return r.json();
}

async function v1Fetch(path: string, opts?: RequestInit) {
  const r = await fetch(`${API_URL}/v1${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${devToken()}`,
      ...opts?.headers,
    },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? r.statusText);
  return r.json();
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };
  return { copied, copy };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="p-5 rounded-2xl bg-white border border-border">
      <div className="text-2xl font-black text-foreground">{value}</div>
      <div className="text-sm text-muted-foreground mt-0.5">{label}</div>
      {sub && <div className="text-xs text-muted-foreground/70 mt-1">{sub}</div>}
    </div>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  active:    "bg-emerald-50 text-emerald-700 border-emerald-200",
  trialing:  "bg-indigo-50 text-indigo-700 border-indigo-200",
  past_due:  "bg-amber-50 text-amber-700 border-amber-200",
  cancelled: "bg-zinc-100 text-zinc-500 border-zinc-200",
  failed:    "bg-red-50 text-red-700 border-red-200",
};

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 2))}@${domain}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function SubscribersSection() {
  const [subs, setSubs]       = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string | null>(null);
  const [filter, setFilter]   = useState<"all" | "active" | "trialing" | "cancelled" | "failed">("all");

  async function load() {
    setErr(null);
    try {
      const data = await devFetch("/subscribers");
      setSubs(data.subscribers ?? []);
    } catch (e: any) { setErr(e.message); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const displayed = filter === "all" ? subs : subs.filter((s) => {
    if (filter === "cancelled") return s.status === "cancelled" || s.status === "failed";
    return s.status === filter;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold">Subscribers</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{subs.length} total</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {(["all", "active", "trialing", "cancelled", "failed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              filter === f
                ? "bg-primary text-white border-primary"
                : "bg-white text-muted-foreground border-border hover:border-foreground/30",
            )}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {err && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-sm text-muted-foreground">Loading…</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <Users className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">
            {filter === "all" ? "No subscribers yet." : `No ${filter} subscribers.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((s) => (
            <div key={s.id} className="p-4 rounded-2xl bg-white border border-border space-y-2.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">{maskEmail(s.subscriberEmail)}</p>
                  {s.externalRef && (
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">ref: {s.externalRef}</p>
                  )}
                </div>
                <span className={cn("text-xs px-2.5 py-0.5 rounded-full border font-medium shrink-0", STATUS_STYLE[s.status] ?? STATUS_STYLE.cancelled)}>
                  {s.status}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
                <div>
                  <span className="text-muted-foreground">Plan</span>
                  <p className="font-medium text-foreground">{s.planName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Billing</span>
                  <p className="font-medium text-foreground capitalize">${s.amount} / {s.planInterval}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Started</span>
                  <p className="font-medium text-foreground">{fmtDate(s.startedAt)}</p>
                </div>
                {s.status === "trialing" && s.trialEndsAt && (
                  <div>
                    <span className="text-muted-foreground">Trial ends</span>
                    <p className="font-medium text-foreground">{fmtDate(s.trialEndsAt)}</p>
                  </div>
                )}
                {(s.status === "active" || s.status === "trialing") && s.nextBillingAt && (
                  <div>
                    <span className="text-muted-foreground">Next billing</span>
                    <p className="font-medium text-foreground">{fmtDate(s.nextBillingAt)}</p>
                  </div>
                )}
                {s.cancelledAt && (
                  <div>
                    <span className="text-muted-foreground">Cancelled</span>
                    <p className="font-medium text-foreground">{fmtDate(s.cancelledAt)}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OverviewSection({ stats, developer }: { stats: Stats | null; developer: DevUser | null }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Overview</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Merchant ID: <span className="font-mono text-foreground font-semibold">{developer?.merchantId}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Active subscribers"  value={stats?.subscribers.active  ?? "—"} />
        <StatCard label="Trialing"            value={stats?.subscribers.trialing ?? "—"} />
        <StatCard label="MRR"                 value={stats ? `$${stats.mrr}` : "—"} sub="Monthly recurring" />
        <StatCard label="Total revenue"       value={stats ? `$${stats.totalRevenue}` : "—"} />
      </div>

      <div className="p-5 rounded-2xl bg-indigo-50 border border-indigo-100 space-y-2">
        <div className="flex items-center gap-2 text-indigo-700 font-semibold text-sm">
          <Terminal className="w-4 h-4" /> Base URL
        </div>
        <code className="text-sm font-mono text-indigo-900 block">
          {window.location.origin}/v1/
        </code>
        <p className="text-xs text-indigo-600">
          All API requests must include <code className="bg-indigo-100 px-1 rounded">Authorization: Bearer &lt;api_key&gt;</code>
        </p>
      </div>
    </div>
  );
}

function ApiKeysSection({ keys, onRefresh }: { keys: ApiKey[]; onRefresh: () => void }) {
  const { copied, copy } = useCopy();
  const [creating, setCreating]       = useState(false);
  const [newType, setNewType]         = useState<"live" | "test">("test");
  const [newLabel, setNewLabel]       = useState("");
  const [newKey, setNewKey]           = useState<string | null>(null);
  const [revoking, setRevoking]       = useState<number | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<number | null>(null);
  const [err, setErr]                 = useState<string | null>(null);

  async function createKey() {
    setErr(null);
    try {
      const res = await devFetch("/api-keys", {
        method: "POST",
        body:   JSON.stringify({ type: newType, label: newLabel || undefined }),
      });
      setNewKey(res.key);
      onRefresh();
    } catch (e: any) { setErr(e.message); }
  }

  async function revokeKey(id: number) {
    setRevokeConfirm(null);
    setRevoking(id);
    try {
      await devFetch(`/api-keys/${id}`, { method: "DELETE" });
      onRefresh();
    } catch (e: any) { setErr(e.message); }
    setRevoking(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">API Keys</h2>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New key
        </button>
      </div>

      {creating && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 rounded-2xl bg-white border border-border space-y-4"
        >
          <h3 className="text-sm font-bold">Generate new API key</h3>
          <div className="flex gap-3 flex-wrap">
            {(["test", "live"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setNewType(t)}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-medium border transition-colors",
                  newType === t
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-muted-foreground border-border hover:border-primary/40",
                )}
              >
                {t === "live" ? "Live (production)" : "Test (sandbox)"}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Label (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={createKey}
            className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Generate
          </button>
        </motion.div>
      )}

      {newKey && (
        <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
            <Shield className="w-4 h-4" /> Save this key — shown once only
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-white border border-emerald-200 rounded-lg px-3 py-2 text-emerald-900 break-all">
              {newKey}
            </code>
            <button
              onClick={() => copy("newKey", newKey)}
              className="shrink-0 p-2 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition-colors"
            >
              {copied === "newKey" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="text-xs text-emerald-600 hover:underline">
            I've saved it — dismiss
          </button>
        </div>
      )}

      {err && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      <div className="space-y-3">
        {keys.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No API keys yet.</p>
        )}
        {keys.map((k) => (
          <div key={k.id} className="rounded-xl bg-white border border-border overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <div className={cn(
                "w-2 h-2 rounded-full shrink-0",
                k.active ? "bg-emerald-400" : "bg-zinc-300",
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "text-xs font-bold px-2 py-0.5 rounded-full border",
                    k.type === "live"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-amber-50 text-amber-700 border-amber-200",
                  )}>
                    {k.type}
                  </span>
                  <span className="text-sm font-medium text-foreground">{k.label}</span>
                </div>
                <code className="text-xs text-muted-foreground font-mono mt-0.5 block">{k.keyPrefix}</code>
                {k.lastUsedAt && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Last used {new Date(k.lastUsedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              {k.active && (
                revoking === k.id
                  ? <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                  : (
                    <button
                      onClick={() => setRevokeConfirm(revokeConfirm === k.id ? null : k.id)}
                      className={cn(
                        "p-2 rounded-lg transition-colors",
                        revokeConfirm === k.id
                          ? "text-red-600 bg-red-50"
                          : "text-muted-foreground hover:text-red-600 hover:bg-red-50",
                      )}
                      title="Revoke key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )
              )}
            </div>

            {/* Inline revoke confirmation */}
            {revokeConfirm === k.id && (
              <div className="px-4 pb-4 pt-0">
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800 leading-relaxed">
                      <strong>Revocation is immediate.</strong> Any API calls your backend makes with this key will
                      return <code className="bg-amber-100 px-1 rounded">401 Unauthorized</code> the moment it is revoked.
                      Existing subscribers and billing are unaffected — only your server's API access breaks.
                      Update your backend to use a new key before revoking this one.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => revokeKey(k.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors"
                    >
                      Yes, revoke now
                    </button>
                    <button
                      onClick={() => setRevokeConfirm(null)}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const INTERVAL_LABELS: Record<string, string> = {
  weekly: "Weekly", monthly: "Monthly", yearly: "Yearly",
};

const BLANK_INTERVALS = () => [
  { interval: "weekly",  amount: "", enabled: false },
  { interval: "monthly", amount: "", enabled: true  },
  { interval: "yearly",  amount: "", enabled: false },
];

interface TierDraft {
  id: string;
  tier_name: string;
  description: string;
  features: string[];
  featureInput: string;
  is_highlighted: boolean;
  intervals: { interval: string; amount: string; enabled: boolean }[];
}

function blankTier(order: number): TierDraft {
  return {
    id: crypto.randomUUID(),
    tier_name: "",
    description: "",
    features: [],
    featureInput: "",
    is_highlighted: order === 0,
    intervals: BLANK_INTERVALS(),
  };
}

// ─── Interval row (reused for flat + per-tier) ────────────────────────────────
function IntervalRows({
  intervals,
  onToggle,
  onAmount,
}: {
  intervals: { interval: string; amount: string; enabled: boolean }[];
  onToggle: (idx: number) => void;
  onAmount: (idx: number, v: string) => void;
}) {
  return (
    <div className="space-y-2">
      {intervals.map((iv, idx) => (
        <div key={iv.interval} className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onToggle(idx)}
            className={cn(
              "w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
              iv.enabled ? "bg-primary border-primary" : "border-border",
            )}
          >
            {iv.enabled && <Check className="w-2.5 h-2.5 text-white" />}
          </button>
          <span className="text-sm w-14 shrink-0 text-muted-foreground">{INTERVAL_LABELS[iv.interval]}</span>
          <div className="flex items-center gap-1 flex-1">
            <span className="text-sm text-muted-foreground">$</span>
            <input
              type="number" min="0.01" step="0.01" placeholder="0.00"
              disabled={!iv.enabled}
              value={iv.amount}
              onChange={(e) => onAmount(idx, e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40"
            />
            <span className="text-xs text-muted-foreground shrink-0">USDC</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlansSection({ defaultPaymentEmail }: { defaultPaymentEmail: string }) {
  const [plans, setPlans]         = useState<Plan[]>([]);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [archiving, setArchiving] = useState<number | null>(null);
  const [err, setErr]             = useState<string | null>(null);
  const { copied, copy }          = useCopy();

  // ── Shared form fields ──────────────────────────────────────────────────────
  const [name, setName]                 = useState("");
  const [paymentEmail, setPaymentEmail] = useState(defaultPaymentEmail);
  const [hasFreeTrial, setHasFreeTrial] = useState(false);
  const [trialDays, setTrialDays]       = useState("14");
  const [planMode, setPlanMode]         = useState<"flat" | "tiered">("flat");

  // ── Flat plan ───────────────────────────────────────────────────────────────
  const [flatIntervals, setFlatIntervals] = useState(BLANK_INTERVALS());

  // ── Tiered plan ─────────────────────────────────────────────────────────────
  const [tiers, setTiers] = useState<TierDraft[]>([blankTier(0)]);

  async function load() {
    try {
      const res = await v1Fetch("/plans");
      setPlans(res.plans ?? []);
    } catch {}
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function resetForm() {
    setName(""); setPaymentEmail(defaultPaymentEmail);
    setHasFreeTrial(false); setTrialDays("14");
    setPlanMode("flat");
    setFlatIntervals(BLANK_INTERVALS());
    setTiers([blankTier(0)]);
    setErr(null);
  }

  // Tier helpers
  function updateTier(id: string, patch: Partial<TierDraft>) {
    setTiers((ts) => ts.map((t) => t.id === id ? { ...t, ...patch } : t));
  }
  function addFeature(id: string, value: string) {
    if (!value.trim()) return;
    setTiers((ts) => ts.map((t) => t.id === id
      ? { ...t, features: [...t.features, value.trim()], featureInput: "" }
      : t));
  }
  function removeFeature(tierId: string, idx: number) {
    setTiers((ts) => ts.map((t) => t.id === tierId
      ? { ...t, features: t.features.filter((_, i) => i !== idx) }
      : t));
  }
  function tierToggleInterval(tierId: string, idx: number) {
    setTiers((ts) => ts.map((t) => t.id === tierId
      ? { ...t, intervals: t.intervals.map((iv, i) => i === idx ? { ...iv, enabled: !iv.enabled } : iv) }
      : t));
  }
  function tierSetAmount(tierId: string, idx: number, val: string) {
    setTiers((ts) => ts.map((t) => t.id === tierId
      ? { ...t, intervals: t.intervals.map((iv, i) => i === idx ? { ...iv, amount: val } : iv) }
      : t));
  }

  async function createPlan() {
    setErr(null);
    if (!name.trim())         { setErr("Plan name is required"); return; }
    if (!paymentEmail.trim()) { setErr("Payment email is required"); return; }
    if (hasFreeTrial && parseInt(trialDays) < 1) { setErr("Trial days must be ≥ 1"); return; }

    let body: Record<string, unknown>;

    if (planMode === "tiered") {
      for (const t of tiers) {
        if (!t.tier_name.trim()) { setErr("Each tier needs a name"); return; }
        if (!t.intervals.some((iv) => iv.enabled && iv.amount)) {
          setErr(`Tier "${t.tier_name || "unnamed"}" needs at least one interval`); return;
        }
      }
      body = {
        name: name.trim(),
        payment_email: paymentEmail.trim(),
        has_free_trial: hasFreeTrial,
        trial_days: hasFreeTrial ? parseInt(trialDays) : undefined,
        tiers: tiers.map((t, i) => ({
          tier_name:      t.tier_name.trim(),
          description:    t.description.trim() || undefined,
          features:       t.features,
          is_highlighted: t.is_highlighted,
          display_order:  i,
          intervals:      t.intervals.filter((iv) => iv.enabled && iv.amount)
            .map((iv) => ({ interval: iv.interval, amount: iv.amount })),
        })),
      };
    } else {
      const enabled = flatIntervals.filter((iv) => iv.enabled && iv.amount);
      if (enabled.length === 0) { setErr("Enable at least one billing interval"); return; }
      body = {
        name: name.trim(),
        payment_email: paymentEmail.trim(),
        has_free_trial: hasFreeTrial,
        trial_days: hasFreeTrial ? parseInt(trialDays) : undefined,
        intervals: enabled.map((iv) => ({ interval: iv.interval, amount: iv.amount })),
      };
    }

    setSaving(true);
    try {
      await v1Fetch("/plans", { method: "POST", body: JSON.stringify(body) });
      setCreating(false);
      resetForm();
      load();
    } catch (e: any) { setErr(e.message); }
    setSaving(false);
  }

  async function archivePlan(id: number) {
    setArchiving(id);
    try {
      await v1Fetch(`/plans/${id}`, { method: "DELETE" });
      load();
    } catch (e: any) { setErr(e.message); }
    setArchiving(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Plans</h2>
        <button
          onClick={() => { setCreating((v) => !v); if (creating) resetForm(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New plan
        </button>
      </div>

      {creating && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 rounded-2xl bg-white border border-border space-y-5"
        >
          <h3 className="text-sm font-bold">Create a new plan</h3>

          {/* Name + email */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Plan name</label>
              <input type="text" placeholder="e.g. Pro, Enterprise…" value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Payout email</label>
              <input type="email" placeholder="payments@yourapp.com" value={paymentEmail}
                onChange={(e) => setPaymentEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>

          {/* Plan mode toggle */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Plan type</label>
            <div className="flex gap-2">
              {(["flat", "tiered"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setPlanMode(m)}
                  className={cn(
                    "px-4 py-2 rounded-xl text-sm font-medium border transition-colors",
                    planMode === m ? "bg-primary text-white border-primary" : "bg-white text-muted-foreground border-border hover:border-primary/40",
                  )}
                >
                  {m === "flat" ? "Flat (single price)" : "Tiered (multiple tiers)"}
                </button>
              ))}
            </div>
          </div>

          {/* Flat intervals */}
          {planMode === "flat" && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Billing intervals</label>
              <IntervalRows
                intervals={flatIntervals}
                onToggle={(idx) => setFlatIntervals((iv) => iv.map((r, i) => i === idx ? { ...r, enabled: !r.enabled } : r))}
                onAmount={(idx, v) => setFlatIntervals((iv) => iv.map((r, i) => i === idx ? { ...r, amount: v } : r))}
              />
            </div>
          )}

          {/* Tier builder */}
          {planMode === "tiered" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground font-medium">Tiers (up to 5)</label>
                {tiers.length < 5 && (
                  <button type="button" onClick={() => setTiers((ts) => [...ts, blankTier(ts.length)])}
                    className="text-xs text-primary hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add tier
                  </button>
                )}
              </div>
              {tiers.map((tier, ti) => (
                <div key={tier.id} className="p-4 rounded-xl border border-border bg-secondary/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Tier {ti + 1}</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <button type="button"
                          onClick={() => updateTier(tier.id, { is_highlighted: !tier.is_highlighted })}
                          className={cn("w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                            tier.is_highlighted ? "bg-amber-400 border-amber-400" : "border-border")}
                        >
                          {tier.is_highlighted && <Check className="w-2.5 h-2.5 text-white" />}
                        </button>
                        Recommended
                      </label>
                      {tiers.length > 1 && (
                        <button type="button" onClick={() => setTiers((ts) => ts.filter((t) => t.id !== tier.id))}
                          className="text-muted-foreground hover:text-red-500 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <input type="text" placeholder="Tier name (e.g. Basic, Pro, Team)"
                    value={tier.tier_name}
                    onChange={(e) => updateTier(tier.id, { tier_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />

                  <input type="text" placeholder="Short description (optional)"
                    value={tier.description}
                    onChange={(e) => updateTier(tier.id, { description: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />

                  {/* Features */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Features</label>
                    {tier.features.map((f, fi) => (
                      <div key={fi} className="flex items-center gap-2">
                        <span className="text-xs flex-1 bg-white border border-border rounded-lg px-2.5 py-1.5">{f}</span>
                        <button type="button" onClick={() => removeFeature(tier.id, fi)}
                          className="text-muted-foreground hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input type="text" placeholder="Add a feature…"
                        value={tier.featureInput}
                        onChange={(e) => updateTier(tier.id, { featureInput: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFeature(tier.id, tier.featureInput); }}}
                        className="flex-1 px-2.5 py-1.5 rounded-lg border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      <button type="button" onClick={() => addFeature(tier.id, tier.featureInput)}
                        className="px-2.5 py-1.5 rounded-lg bg-secondary border border-border text-xs hover:bg-secondary/80">
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Intervals per tier */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Pricing</label>
                    <IntervalRows
                      intervals={tier.intervals}
                      onToggle={(idx) => tierToggleInterval(tier.id, idx)}
                      onAmount={(idx, v) => tierSetAmount(tier.id, idx, v)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Free trial */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setHasFreeTrial((v) => !v)}
              className={cn("w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                hasFreeTrial ? "bg-primary border-primary" : "border-border")}
            >
              {hasFreeTrial && <Check className="w-2.5 h-2.5 text-white" />}
            </button>
            <span className="text-sm">Free trial</span>
            {hasFreeTrial && (
              <div className="flex items-center gap-1 ml-2">
                <input type="number" min="1" value={trialDays} onChange={(e) => setTrialDays(e.target.value)}
                  className="w-14 px-2 py-1 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-center" />
                <span className="text-xs text-muted-foreground">days</span>
              </div>
            )}
          </div>

          {err && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> {err}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={createPlan} disabled={saving}
              className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1.5">
              {saving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              Create plan
            </button>
            <button onClick={() => { setCreating(false); resetForm(); }}
              className="px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        </motion.div>
      )}

      {!creating && err && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-8">Loading…</div>
      ) : plans.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <CreditCard className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">No plans yet. Create your first plan to start accepting subscriptions.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => (
            <div key={plan.plan_id} className="p-4 rounded-2xl bg-white border border-border space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground">{plan.name}</p>
                    {plan.is_tiered && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
                        Tiered · {plan.tiers?.length} tiers
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <code className="text-xs font-mono text-muted-foreground">{plan.merchant_id}</code>
                    <button onClick={() => copy(String(plan.plan_id), plan.merchant_id)}
                      className="text-muted-foreground hover:text-foreground transition-colors" title="Copy Merchant ID">
                      {copied === String(plan.plan_id) ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Link2 className="w-3 h-3 text-muted-foreground shrink-0" />
                    <code className="text-xs font-mono text-muted-foreground truncate max-w-[220px]">
                      {window.location.origin}/pay/{plan.merchant_id}
                    </code>
                    <button
                      onClick={() => copy(`link-${plan.plan_id}`, `${window.location.origin}/pay/${plan.merchant_id}`)}
                      className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                      title="Copy payment link"
                    >
                      {copied === `link-${plan.plan_id}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">{plan.active_subscribers} sub{plan.active_subscribers !== 1 ? "s" : ""}</span>
                  <button onClick={() => archivePlan(plan.plan_id)} disabled={archiving === plan.plan_id}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Archive plan">
                    {archiving === plan.plan_id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Flat plan intervals */}
              {!plan.is_tiered && (
                <div className="flex flex-wrap gap-2">
                  {plan.intervals.map((iv) => (
                    <span key={iv.interval_id} className="px-2.5 py-1 rounded-full bg-secondary text-xs font-medium text-muted-foreground">
                      ${parseFloat(iv.amount).toFixed(2)} / {iv.interval}
                    </span>
                  ))}
                </div>
              )}

              {/* Tiered plan summary */}
              {plan.is_tiered && plan.tiers && plan.tiers.length > 0 && (
                <div className="grid gap-2">
                  {plan.tiers.map((tier) => (
                    <div key={tier.tier_id} className={cn(
                      "flex items-start justify-between gap-2 px-3 py-2 rounded-xl border text-sm",
                      tier.is_highlighted ? "bg-amber-50 border-amber-200" : "bg-secondary/40 border-border",
                    )}>
                      <div>
                        <span className="font-medium text-foreground">{tier.tier_name}</span>
                        {tier.is_highlighted && <span className="ml-2 text-xs text-amber-600">Recommended</span>}
                        {tier.features.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">{tier.features.slice(0, 3).join(" · ")}{tier.features.length > 3 ? " …" : ""}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 shrink-0">
                        {tier.intervals.map((iv) => (
                          <span key={iv.interval_id} className="px-2 py-0.5 rounded-full bg-white border border-border text-xs text-muted-foreground whitespace-nowrap">
                            ${parseFloat(iv.amount).toFixed(2)}/{iv.interval.slice(0, 2)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                {plan.has_free_trial && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-xs font-medium text-emerald-700 border border-emerald-200">
                    {plan.trial_days}-day trial
                  </span>
                )}
                <p className="text-xs text-muted-foreground">Payout → {plan.payment_email}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Webhook event reference data ─────────────────────────────────────────────

const WEBHOOK_EVENTS = [
  {
    type: "subscription.created",
    desc: "Fired when a subscriber activates a plan for the first time.",
    data: `{
  "subscription_id": 42,
  "merchant_id": "ABCD-EFGH-IJKL",
  "plan_id": 3,
  "plan_name": "Pro Plan",
  "external_ref": "user_123",
  "interval": "monthly",
  "amount": "29.000000",
  "currency": "USD",
  "status": "active",
  "trial_end": null,
  "current_period_end": "2026-06-11T00:00:00.000Z",
  "created_at": "2026-05-11T00:00:00.000Z"
}`,
  },
  {
    type: "subscription.renewed",
    desc: "Fired after each successful billing cycle charge.",
    data: `{
  "subscription_id": 42,
  "external_ref": "user_123",
  "merchant_id": "ABCD-EFGH-IJKL",
  "amount": "29.000000",
  "next_billing_date": "2026-07-11T00:00:00.000Z"
}`,
  },
  {
    type: "subscription.past_due",
    desc: "Fired when a billing attempt fails but retries remain.",
    data: `{
  "subscription_id": 42,
  "external_ref": "user_123",
  "merchant_id": "ABCD-EFGH-IJKL",
  "retry_count": 1
}`,
  },
  {
    type: "subscription.failed",
    desc: "Fired when all retry attempts are exhausted. Subscription is cancelled.",
    data: `{
  "subscription_id": 42,
  "external_ref": "user_123",
  "merchant_id": "ABCD-EFGH-IJKL",
  "retry_count": 4
}`,
  },
];

const WEBHOOK_VERIFY_SNIPPET = `const crypto = require('crypto');

function verifyWebhook(rawBody, signatureHeader, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)        // must be the raw request body Buffer/string
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expected),
  );
}

// Express example
app.post('/webhooks/sweep', express.raw({ type: '*/*' }), (req, res) => {
  const sig = req.headers['x-signature-256'];
  if (!verifyWebhook(req.body, sig, process.env.SWEEP_WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }
  const event = JSON.parse(req.body);
  // handle event.event_type …
  res.sendStatus(200);
});`;

function WebhookReferencePanel() {
  const [open, setOpen]             = useState(false);
  const [activeEvent, setActiveEvent] = useState(0);
  const { copied, copy }            = useCopy();

  return (
    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2 text-indigo-700 font-semibold text-sm">
          <Info className="w-4 h-4 shrink-0" />
          Webhook reference — events, payloads &amp; signature verification
        </div>
        {open
          ? <ChevronUp   className="w-4 h-4 text-indigo-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-indigo-400 shrink-0" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-6 border-t border-indigo-200">

          {/* Envelope */}
          <div className="space-y-2 pt-4">
            <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Request envelope</p>
            <p className="text-xs text-indigo-600">Every event is delivered as a POST with this outer structure:</p>
            <pre className="text-xs font-mono bg-white border border-indigo-200 rounded-xl p-4 overflow-x-auto text-indigo-900 leading-relaxed">{`{
  "event_id":    "uuid-v4",
  "event_type":  "subscription.created",
  "created_at":  "2026-05-11T00:00:00.000Z",
  "developer_id": 1,
  "data": { … }
}`}</pre>
          </div>

          {/* Event catalog */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Events</p>
            <div className="flex gap-1.5 flex-wrap">
              {WEBHOOK_EVENTS.map((ev, i) => (
                <button
                  key={ev.type}
                  onClick={() => setActiveEvent(i)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-mono font-medium border transition-colors",
                    activeEvent === i
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-indigo-700 border-indigo-200 hover:border-indigo-400",
                  )}
                >
                  {ev.type}
                </button>
              ))}
            </div>
            <p className="text-xs text-indigo-600">{WEBHOOK_EVENTS[activeEvent]!.desc}</p>
            <pre className="text-xs font-mono bg-white border border-indigo-200 rounded-xl p-4 overflow-x-auto text-indigo-900 leading-relaxed">
              {WEBHOOK_EVENTS[activeEvent]!.data}
            </pre>
          </div>

          {/* Signature verification */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Signature verification</p>
            <p className="text-xs text-indigo-600">
              Each request includes an <code className="bg-indigo-100 px-1 rounded">X-Signature-256</code> header and an{" "}
              <code className="bg-indigo-100 px-1 rounded">X-Event-Type</code> header.
              Always verify the signature using the <strong>raw request body</strong> before processing.
            </p>
            <div className="relative">
              <pre className="text-xs font-mono bg-white border border-indigo-200 rounded-xl p-4 overflow-x-auto text-indigo-900 leading-relaxed pr-12">
                {WEBHOOK_VERIFY_SNIPPET}
              </pre>
              <button
                onClick={() => copy("snippet", WEBHOOK_VERIFY_SNIPPET)}
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-500 border border-indigo-200"
                title="Copy snippet"
              >
                {copied === "snippet" ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Delivery rules */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Delivery &amp; retries</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "Response required",  value: "Any 2xx within 15 seconds" },
                { label: "Retry attempts",      value: "5 total (including first)" },
                { label: "Retry schedule",      value: "Immediately → +1 min → +5 min → +30 min → +2 hrs" },
                { label: "After all retries",   value: "Event is abandoned — no further attempts" },
              ].map((r) => (
                <div key={r.label} className="bg-white border border-indigo-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-indigo-500">{r.label}</p>
                  <p className="text-xs font-medium text-indigo-900 mt-0.5">{r.value}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

function WebhooksSection() {
  const [webhooks, setWebhooks]   = useState<Webhook[]>([]);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [url, setUrl]             = useState("");
  const [label, setLabel]         = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [err, setErr]             = useState<string | null>(null);
  const { copied, copy }          = useCopy();

  async function load() {
    try {
      const res = await devFetch("/../../v1/webhooks");
      setWebhooks(res.webhooks ?? []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addWebhook() {
    setErr(null);
    try {
      const res = await devFetch("/../../v1/webhooks", {
        method: "POST",
        body:   JSON.stringify({ url, label: label || undefined }),
      });
      setNewSecret(res.secret);
      setUrl(""); setLabel(""); setCreating(false);
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function removeWebhook(id: number) {
    try {
      await devFetch(`/../../v1/webhooks/${id}`, { method: "DELETE" });
      load();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Webhooks</h2>
        <button
          onClick={() => setCreating((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" /> Add endpoint
        </button>
      </div>

      <WebhookReferencePanel />

      {creating && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 rounded-2xl bg-white border border-border space-y-4"
        >
          <input
            type="url"
            placeholder="https://yourapp.com/webhooks/sweep"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            type="text"
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            onClick={addWebhook}
            disabled={!url.trim()}
            className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            Register endpoint
          </button>
        </motion.div>
      )}

      {newSecret && (
        <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-3">
          <div className="text-emerald-700 font-semibold text-sm flex items-center gap-2">
            <Shield className="w-4 h-4" /> Signing secret — save this now, it won't be shown again
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-white border border-emerald-200 rounded-lg px-3 py-2 break-all text-emerald-900">
              {newSecret}
            </code>
            <button
              onClick={() => copy("secret", newSecret)}
              className="shrink-0 p-2 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700"
            >
              {copied === "secret" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-emerald-600">
            Use this secret in the verification snippet above. Store it in an environment variable — never in code.
          </p>
          <button onClick={() => setNewSecret(null)} className="text-xs text-emerald-600 hover:underline">Dismiss</button>
        </div>
      )}

      {err && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-8">Loading…</div>
      ) : webhooks.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No webhook endpoints registered.</p>
      ) : (
        <div className="space-y-3">
          {webhooks.map((w) => (
            <div key={w.id} className="flex items-center gap-3 p-4 rounded-xl bg-white border border-border">
              <Webhook className="w-4 h-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{w.label}</p>
                <code className="text-xs text-muted-foreground truncate block">{w.url}</code>
              </div>
              <button
                onClick={() => removeWebhook(w.id)}
                className="p-2 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export default function DeveloperDashboard() {
  const [, navigate] = useLocation();
  const [tab, setTab]           = useState<"overview" | "subscribers" | "plans" | "keys" | "webhooks">("overview");
  const [developer, setDeveloper] = useState<DevUser | null>(null);
  const [keys, setKeys]         = useState<ApiKey[]>([]);
  const [stats, setStats]       = useState<Stats | null>(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!devToken()) { navigate(`${BASE}/developer/login`); return; }

    async function load(initial = false) {
      try {
        const [me, st] = await Promise.all([
          devFetch("/me"),
          devFetch("/stats"),
        ]);
        setDeveloper(me.developer);
        setKeys(me.apiKeys ?? []);
        setStats(st);
      } catch {
        if (initial) {
          localStorage.removeItem("dev_token");
          navigate(`${BASE}/developer/login`);
        }
      }
      if (initial) setLoading(false);
    }

    load(true);
    const interval = setInterval(() => load(false), 30_000);
    return () => clearInterval(interval);
  }, []);

  function logout() {
    localStorage.removeItem("dev_token");
    navigate(`${BASE}/developer/login`);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabs = [
    { id: "overview"    as const, label: "Overview",     icon: <BarChart3  className="w-4 h-4" /> },
    { id: "subscribers" as const, label: "Subscribers",  icon: <Users      className="w-4 h-4" /> },
    { id: "plans"       as const, label: "Plans",        icon: <CreditCard className="w-4 h-4" /> },
    { id: "keys"        as const, label: "API Keys",     icon: <Key        className="w-4 h-4" /> },
    { id: "webhooks"    as const, label: "Webhooks",     icon: <Webhook    className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-secondary/30">
      {/* Topbar */}
      <header className="sticky top-0 z-10 bg-white border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <Link href={`${BASE}/developer`} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <img src={`${BASE}/Sweep_logo_exact.svg`} alt="Sweep" className="h-7 w-auto" />
            <span className="text-xs text-muted-foreground border-l border-border pl-3 ml-1">Developer Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">{developer?.email}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex gap-8">
          {/* Sidebar */}
          <aside className="hidden sm:flex flex-col gap-1 w-44 shrink-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left",
                  tab === t.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                )}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </aside>

          {/* Mobile tabs */}
          <div className="sm:hidden w-full">
            <div className="flex gap-1 mb-6 overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                    tab === t.id ? "bg-primary text-white" : "bg-white text-muted-foreground border border-border",
                  )}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <main className="flex-1 min-w-0">
            {tab === "overview"    && <OverviewSection stats={stats} developer={developer} />}
            {tab === "subscribers" && <SubscribersSection />}
            {tab === "plans"       && <PlansSection defaultPaymentEmail={developer?.paymentEmail ?? ""} />}
            {tab === "keys"     && <ApiKeysSection keys={keys} onRefresh={async () => {
              const me = await devFetch("/me");
              setKeys(me.apiKeys ?? []);
            }} />}
            {tab === "webhooks" && <WebhooksSection />}
          </main>
        </div>
      </div>
    </div>
  );
}