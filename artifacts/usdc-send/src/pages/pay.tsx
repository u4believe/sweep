import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, CheckCircle2, AlertCircle, CreditCard,
  ArrowRight, LogIn, Wallet, Star, ShieldCheck, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { API_BASE } from "@/lib/api";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanInterval {
  intervalId: number;
  interval:   string;
  amount:     string;
}

interface PlanTier {
  tierId:        number;
  tierName:      string;
  description:   string | null;
  features:      string[];
  isHighlighted: boolean;
  displayOrder:  number;
  intervals:     PlanInterval[];
}

interface PlanInfo {
  planTitle:         string;
  paymentEmail:      string;
  creatorName:       string;
  hasFreeTrial:      boolean;
  trialDurationDays: number | null;
  intervals:         PlanInterval[];
  tiers:             PlanTier[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUSD(val: string | number): string {
  return `$${parseFloat(String(val)).toFixed(2)}`;
}

function intervalLabel(interval: string): string {
  if (interval === "weekly")  return "/ week";
  if (interval === "monthly") return "/ month";
  if (interval === "yearly")  return "/ year";
  return `/ ${interval}`;
}

function nextBillingLabel(interval: string): string {
  if (interval === "weekly")  return "Renews every 7 days";
  if (interval === "monthly") return "Renews every month";
  if (interval === "yearly")  return "Renews every year";
  return "";
}

// ─── Interval selector ────────────────────────────────────────────────────────

function IntervalPicker({
  intervals,
  selected,
  onSelect,
}: {
  intervals:  PlanInterval[];
  selected:   number | null;
  onSelect:   (id: number) => void;
}) {
  if (intervals.length === 1) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Billing cycle</p>
      <div className="grid gap-2">
        {intervals.map((iv) => (
          <button
            key={iv.intervalId}
            type="button"
            onClick={() => onSelect(iv.intervalId)}
            className={cn(
              "flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-all",
              selected === iv.intervalId
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                : "border-border hover:border-indigo-300 bg-background",
            )}
          >
            <span className={cn("font-medium capitalize", selected === iv.intervalId ? "text-indigo-700 dark:text-indigo-300" : "text-foreground")}>
              {iv.interval}
            </span>
            <span className={cn("font-semibold tabular-nums", selected === iv.intervalId ? "text-indigo-700 dark:text-indigo-300" : "text-foreground")}>
              {formatUSD(iv.amount)}{" "}
              <span className="font-normal text-muted-foreground text-xs">{intervalLabel(iv.interval)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PayPage() {
  const params      = useParams<{ merchantId: string }>();
  const merchantId  = params.merchantId ?? "";
  const qp          = new URLSearchParams(window.location.search);
  const externalRef = qp.get("external_ref") ?? "";
  const redirectUrl = qp.get("redirect_url")  ?? "";
  const presetId    = parseInt(qp.get("interval_id") ?? "", 10);

  const token    = localStorage.getItem("token");
  const loggedIn = !!token;

  const [plan,             setPlan]             = useState<PlanInfo | null>(null);
  const [loadError,        setLoadError]        = useState<string | null>(null);
  const [balance,          setBalance]          = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [submitting,       setSubmitting]       = useState(false);
  const [submitError,      setSubmitError]      = useState<string | null>(null);
  const [success,          setSuccess]          = useState<{ planName: string; amount: string; interval: string; isTrial: boolean } | null>(null);
  const [countdown,        setCountdown]        = useState(5);

  // Passport
  const [hasPassport, setHasPassport] = useState(false);
  const [txPassword,      setTxPassword]      = useState("");
  const [showTxPwd,       setShowTxPwd]       = useState(false);
  const [usePassport,     setUsePassport]      = useState(true);  // toggle: passport vs direct checkout

  // Load plan
  useEffect(() => {
    if (!merchantId) return;
    fetch(`${API_BASE}/api/subscriptions/merchant/${encodeURIComponent(merchantId)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.message ?? "Plan not found");
        setPlan(json);

        // Auto-select: prefer preset from URL, then single-interval flat, then first available
        const allIntervals: PlanInterval[] = json.tiers?.length > 0
          ? (json.tiers as PlanTier[]).flatMap((t) => t.intervals)
          : (json.intervals ?? []);

        const match = !isNaN(presetId) ? allIntervals.find((iv) => iv.intervalId === presetId) : null;
        const auto  = match ?? (allIntervals.length === 1 ? allIntervals[0] : null);
        if (auto) { setSelectedId(auto.intervalId); }
      })
      .catch((e: any) => setLoadError(e.message ?? "Could not load plan"))
  }, [merchantId]);

  // Load balance when logged in
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/escrow/balance`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => { if (r.ok) { const j = await r.json(); setBalance(j.claimedBalance ?? "0"); } })
      .catch(() => {});
  }, [token]);

  // Check passport status
  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/subscriptions/passport`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => { if (r.ok) { const j = await r.json(); setHasPassport(j.hasPassport && j.status === "active"); } })
      .catch(() => {});
  }, [token]);

  // Redirect countdown after success
  useEffect(() => {
    if (!success || !redirectUrl) return;
    if (countdown <= 0) { window.location.href = redirectUrl; return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [success, countdown, redirectUrl]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const allIntervals: PlanInterval[] = plan
    ? (plan.tiers?.length > 0
        ? plan.tiers.flatMap((t) => t.intervals)
        : plan.intervals)
    : [];

  const selectedIv      = allIntervals.find((iv) => iv.intervalId === selectedId) ?? null;
  const amount          = selectedIv ? parseFloat(selectedIv.amount) : 0;
  const balanceNum      = parseFloat(balance ?? "0");
  const balanceKnown    = balance !== null;                                // false while fetch is in-flight
  const insufficient    = balanceKnown && !plan?.hasFreeTrial && balanceNum < amount;
  const canPay          = !insufficient;                                   // allow when balance still loading

  function handleSelect(id: number) {
    setSelectedId(id);
    setSubmitError(null);
  }

  async function handlePassportActivate() {
    if (!selectedId || !plan) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API_BASE}/api/subscriptions/passport/activate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          merchantId,
          intervalId:          selectedId,
          externalRef:         externalRef || undefined,
          transactionPassword: txPassword.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Activation failed");
      if (!json.subscription) throw new Error(json.message ?? "Activation failed");
      setSuccess({
        planName: json.subscription.planTitle,
        amount:   json.subscription.amount,
        interval: json.subscription.planInterval,
        isTrial:  json.subscription.status === "trialing",
      });
    } catch (e: any) {
      setSubmitError(e.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckout() {
    if (!selectedId || !plan) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API_BASE}/api/pay/checkout`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ merchantId, intervalId: selectedId, externalRef: externalRef || undefined, redirectUrl: redirectUrl || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Payment failed");
      setSuccess({
        planName:  json.subscription.plan_name,
        amount:    json.subscription.amount,
        interval:  json.subscription.interval,
        isTrial:   json.subscription.status === "trialing",
      });
    } catch (e: any) {
      setSubmitError(e.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (!plan && !loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center space-y-3 max-w-sm">
          <AlertCircle className="w-10 h-10 text-destructive mx-auto" />
          <p className="font-semibold text-foreground">Plan not found</p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md"
        >
          <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-5 shadow-lg">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-bold text-foreground">
                {success.isTrial ? "Free trial started!" : "You're subscribed!"}
              </p>
              <p className="text-sm text-muted-foreground">
                {success.isTrial
                  ? `Your trial for ${success.planName} has begun.`
                  : `${success.planName} — ${formatUSD(success.amount)} ${intervalLabel(success.interval)}`}
              </p>
            </div>
            {redirectUrl ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Redirecting you back in {countdown}s…
                </p>
                <a
                  href={redirectUrl}
                  className="inline-block text-sm text-indigo-600 hover:text-indigo-500 font-medium"
                >
                  Continue now →
                </a>
              </div>
            ) : (
              <a
                href={`${BASE}/dashboard`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                Go to your dashboard <ArrowRight className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  const isTiered = plan!.tiers?.length > 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border px-4 py-3.5 flex items-center gap-3">
        <img src={`${BASE}/Sweep_logo_exact.svg`} alt="Sweep" className="h-6 w-auto" />
        <span className="text-sm text-muted-foreground">Secure checkout</span>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <CreditCard className="w-3.5 h-3.5" />
          Powered by Sweep
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-lg space-y-6">

          {/* Plan header */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-1"
          >
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subscribing to</p>
            <h1 className="text-2xl font-black text-foreground">{plan!.planTitle}</h1>
            {plan!.hasFreeTrial && plan!.trialDurationDays && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-semibold border border-emerald-200 dark:border-emerald-800">
                <Star className="w-3 h-3" /> {plan!.trialDurationDays}-day free trial
              </span>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="rounded-2xl border border-border bg-card shadow-sm divide-y divide-border overflow-hidden"
          >

            {/* Tier + interval selection */}
            <div className={cn("p-5", isTiered ? "space-y-4" : "")}>
              {isTiered ? (
                plan!.tiers.map((tier) => {
                  const tierSelected = tier.intervals.some((iv) => iv.intervalId === selectedId);
                  return (
                    <div
                      key={tier.tierId}
                      className={cn(
                        "rounded-2xl border-2 p-4 space-y-3 transition-all",
                        tier.isHighlighted
                          ? "border-indigo-500 shadow-md shadow-indigo-100"
                          : "border-border",
                        tierSelected && !tier.isHighlighted && "border-indigo-300 bg-indigo-50/40",
                      )}
                    >
                      {/* Tier header */}
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-bold text-foreground">{tier.tierName}</p>
                        {tier.isHighlighted && (
                          <span className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full bg-indigo-600 text-white tracking-wide">
                            Recommended
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      {tier.description && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{tier.description}</p>
                      )}

                      {/* Features — all shown */}
                      {tier.features.length > 0 && (
                        <ul className="space-y-1.5">
                          {tier.features.map((f) => (
                            <li key={f} className="flex items-start gap-2 text-xs text-foreground/80">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Pricing / interval picker */}
                      <div className="pt-1">
                        <IntervalPicker
                          intervals={tier.intervals}
                          selected={selectedId}
                          onSelect={handleSelect}
                        />
                        {/* Single-interval tier shows price inline */}
                        {tier.intervals.length === 1 && (
                          <button
                            type="button"
                            onClick={() => handleSelect(tier.intervals[0].intervalId)}
                            className={cn(
                              "w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-sm transition-all",
                              selectedId === tier.intervals[0].intervalId
                                ? "border-indigo-500 bg-indigo-50"
                                : "border-border hover:border-indigo-300 bg-background",
                            )}
                          >
                            <span className={cn("font-medium capitalize", selectedId === tier.intervals[0].intervalId ? "text-indigo-700" : "text-foreground")}>
                              {tier.intervals[0].interval}
                            </span>
                            <span className={cn("font-bold tabular-nums", selectedId === tier.intervals[0].intervalId ? "text-indigo-700" : "text-foreground")}>
                              {formatUSD(tier.intervals[0].amount)}{" "}
                              <span className="font-normal text-muted-foreground text-xs">{intervalLabel(tier.intervals[0].interval)}</span>
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <IntervalPicker
                  intervals={plan!.intervals}
                  selected={selectedId}
                  onSelect={handleSelect}
                />
              )}
            </div>

            {/* Price summary */}
            {selectedIv && (
              <div className="px-5 py-4 bg-muted/30 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {plan!.hasFreeTrial && plan!.trialDurationDays
                      ? `After ${plan!.trialDurationDays}-day trial`
                      : nextBillingLabel(selectedIv.interval)}
                  </p>
                </div>
                <p className="text-xl font-black text-foreground tabular-nums">
                  {formatUSD(selectedIv.amount)}
                  <span className="text-sm font-normal text-muted-foreground ml-1">
                    {intervalLabel(selectedIv.interval)}
                  </span>
                </p>
              </div>
            )}

            {/* Auth / payment section */}
            <div className="p-5 space-y-4">
              {!loggedIn ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/50 border border-border">
                    <LogIn className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="space-y-1 flex-1">
                      <p className="text-sm font-medium text-foreground">Sign in to complete payment</p>
                      <p className="text-xs text-muted-foreground">
                        You need a Sweep account to pay with USDC. Your balance will be charged when you confirm.
                      </p>
                    </div>
                  </div>
                  <a
                    href={`${BASE}/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors"
                  >
                    <LogIn className="w-4 h-4" /> Sign in to Sweep
                  </a>
                  <p className="text-center text-xs text-muted-foreground">
                    Don't have an account?{" "}
                    <a href={`${BASE}/register?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}
                       className="text-indigo-600 hover:text-indigo-500 font-medium">
                      Create one free
                    </a>
                  </p>
                </div>
              ) : (
                <div className="space-y-4">

                  {/* Balance row */}
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Wallet className="w-4 h-4" />
                      Your Sweep balance
                    </div>
                    <span className={cn(
                      "text-sm font-bold tabular-nums flex items-center gap-1.5",
                      !balanceKnown ? "text-muted-foreground" : !insufficient ? "text-foreground" : "text-destructive",
                    )}>
                      {!balanceKnown && <Loader2 className="w-3 h-3 animate-spin" />}
                      {balance === null ? "Loading…" : formatUSD(balance)}
                    </span>
                  </div>

                  {/* Insufficient balance warning */}
                  {insufficient && selectedIv && (
                    <div className="flex items-start gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        Insufficient balance. You need {formatUSD(selectedIv.amount)} but have {formatUSD(balance ?? "0")}.
                        {" "}<a href={`${BASE}/dashboard`} className="underline font-medium">Add funds →</a>
                      </span>
                    </div>
                  )}

                  {/* Error banner */}
                  <AnimatePresence>
                    {submitError && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className="flex items-start gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="flex-1">{submitError}</span>
                        <button onClick={() => setSubmitError(null)} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* ── PASSPORT PATH ── */}
                  {hasPassport && usePassport ? (
                    <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/60 overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center gap-2.5 px-4 py-3 bg-indigo-600">
                        <ShieldCheck className="w-4 h-4 text-white shrink-0" />
                        <p className="text-sm font-semibold text-white">Subscription Passport</p>
                        <span className="ml-auto text-[11px] font-medium text-indigo-200 bg-indigo-500/60 px-2 py-0.5 rounded-full">
                          One-step activation
                        </span>
                      </div>

                      <div className="px-4 py-4 space-y-3">
                        <p className="text-xs text-indigo-700">
                          Your verified passport lets you subscribe instantly. Enter your transaction password below if you have one set.
                        </p>

                        {/* TX password */}
                        <div className="relative">
                          <input
                            type={showTxPwd ? "text" : "password"}
                            value={txPassword}
                            onChange={(e) => setTxPassword(e.target.value)}
                            placeholder="Transaction password (leave blank if not set)"
                            className="w-full pr-10 px-3 py-2.5 text-sm rounded-xl border-2 border-indigo-200 bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                          />
                          <button
                            type="button"
                            onClick={() => setShowTxPwd((v) => !v)}
                            className="absolute right-3 inset-y-0 flex items-center text-indigo-300 hover:text-indigo-600"
                          >
                            {showTxPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>

                        {/* Select-plan hint */}
                        {!selectedId && (
                          <p className="text-xs text-indigo-500 text-center">
                            ↑ Select a billing plan above to continue
                          </p>
                        )}

                        {/* Activate button */}
                        <button
                          type="button"
                          onClick={handlePassportActivate}
                          disabled={submitting || !selectedId || !canPay}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all",
                            submitting || !selectedId || !canPay
                              ? "bg-indigo-200 text-indigo-400 cursor-not-allowed"
                              : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 hover:shadow-lg hover:shadow-indigo-600/30",
                          )}
                        >
                          {submitting
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Activating…</>
                            : <><ShieldCheck className="w-4 h-4" /> Activate with Passport</>
                          }
                        </button>

                        {/* Fallback: switch to direct balance payment */}
                        <button
                          type="button"
                          onClick={() => { setUsePassport(false); setSubmitError(null); }}
                          className="w-full text-xs text-indigo-400 hover:text-indigo-700 transition-colors py-1 text-center"
                        >
                          Pay directly with your balance instead →
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── STANDARD CHECKOUT PATH ── */
                    <div className="space-y-3">
                      {!selectedId && (
                        <p className="text-xs text-muted-foreground text-center">
                          ↑ Select a billing plan above to continue
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={handleCheckout}
                        disabled={submitting || !selectedId || !canPay}
                        className={cn(
                          "w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm transition-all",
                          submitting || !selectedId || !canPay
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 hover:shadow-lg hover:shadow-indigo-600/30 hover:-translate-y-0.5",
                        )}
                      >
                        {submitting ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                        ) : plan!.hasFreeTrial ? (
                          <>Start free trial <ArrowRight className="w-4 h-4" /></>
                        ) : (
                          <>Subscribe {selectedIv ? `· ${formatUSD(selectedIv.amount)}` : ""} <ArrowRight className="w-4 h-4" /></>
                        )}
                      </button>

                      {/* Switch back to passport if available */}
                      {hasPassport && (
                        <button
                          type="button"
                          onClick={() => { setUsePassport(true); setSubmitError(null); }}
                          className="w-full text-xs text-indigo-400 hover:text-indigo-700 transition-colors py-1 text-center flex items-center justify-center gap-1"
                        >
                          <ShieldCheck className="w-3 h-3" /> Use my Subscription Passport instead
                        </button>
                      )}
                    </div>
                  )}

                  <p className="text-center text-xs text-muted-foreground">
                    {plan!.hasFreeTrial && plan!.trialDurationDays
                      ? `${plan!.trialDurationDays}-day free trial, then ${selectedIv ? formatUSD(selectedIv.amount) : ""} ${selectedIv ? intervalLabel(selectedIv.interval) : ""}. Cancel anytime.`
                      : `You'll be charged ${selectedIv ? formatUSD(selectedIv.amount) : ""} ${selectedIv ? intervalLabel(selectedIv.interval) : ""}. Cancel anytime.`}
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          <p className="text-center text-xs text-muted-foreground">
            Payments settled in USDC on the Sweep platform.{" "}
            <a href={`${BASE}/landing`} className="hover:text-foreground transition-colors">Learn more</a>
          </p>
        </div>
      </div>
    </div>
  );
}