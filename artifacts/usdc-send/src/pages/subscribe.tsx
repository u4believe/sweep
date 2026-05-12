import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Copy,
  Check,
  ShieldCheck,
  ChevronDown,
  KeyRound,
  Star,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Navbar } from "@/components/layout";
import { fadeUp, staggerContainer } from "@/lib/motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1 rounded hover:bg-secondary transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
    </button>
  );
}

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

interface PassportInfo {
  hasPassport: boolean;
  status:      string | null;
  issuedAt?:   string;
}

export default function SubscribePage() {
  const params            = useParams<{ merchantId: string }>();
  const [, setLocation]   = useLocation();
  const merchantIdParam   = params.merchantId ?? "";

  const [planInfo,            setPlanInfo]            = useState<PlanInfo | null>(null);
  const [loadError,           setLoadError]           = useState<string | null>(null);
  const [isLoading,           setIsLoading]           = useState(true);
  const [selectedInterval,    setSelectedInterval]    = useState("");
  const [selectedIntervalId,  setSelectedIntervalId]  = useState<number | null>(null);
  const [confirmationCode,    setConfirmationCode]    = useState("");
  const [txPassword,          setTxPassword]          = useState("");
  const [isSubmitting,        setIsSubmitting]        = useState(false);
  const [submitError,         setSubmitError]         = useState<string | null>(null);
  const [activated,           setActivated]           = useState<{ status: string; planTitle: string; planInterval: string; amount: string } | null>(null);
  const [passportInfo,        setPassportInfo]        = useState<PassportInfo | null>(null);
  const [passportChecked,     setPassportChecked]     = useState(false);
  const [showCodeFallback,    setShowCodeFallback]    = useState(false);

  const token           = localStorage.getItem("token");
  const isLoggedIn      = !!token;
  const hasActivePassport = passportInfo?.hasPassport && passportInfo.status === "active";

  // Load plan info
  useEffect(() => {
    if (!merchantIdParam) return;
    fetch(`${BASE}/api/subscriptions/merchant/${encodeURIComponent(merchantIdParam)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.message ?? "Plan not found");
        setPlanInfo(json);
        // Auto-select only for flat single-interval plans
        const isTiered = Array.isArray(json.tiers) && json.tiers.length > 0;
        if (!isTiered && json.intervals?.length === 1) {
          setSelectedInterval(json.intervals[0].interval);
          setSelectedIntervalId(json.intervals[0].intervalId);
        }
      })
      .catch((err: any) => setLoadError(err.message ?? "Could not load plan"))
      .finally(() => setIsLoading(false));
  }, [merchantIdParam]);

  // Check passport status if logged in
  useEffect(() => {
    if (!token) { setPassportChecked(true); return; }
    fetch(`${BASE}/api/subscriptions/passport`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        setPassportInfo(json);
      })
      .catch(() => {})
      .finally(() => setPassportChecked(true));
  }, [token]);

  // Passport-based activation
  const handlePassportActivate = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!selectedInterval) return;
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const res  = await fetch(`${BASE}/api/subscriptions/passport/activate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          merchantId:          merchantIdParam,
          planInterval:        selectedInterval,
          intervalId:          selectedIntervalId ?? undefined,
          transactionPassword: txPassword || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Activation failed");
      setActivated(json.subscription);
    } catch (err: any) {
      setSubmitError(err.message ?? "Activation failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirmation-code activation
  const handleActivate = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!selectedInterval || !confirmationCode.trim()) return;
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const res  = await fetch(`${BASE}/api/subscriptions/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId:       merchantIdParam,
          planInterval:     selectedInterval,
          intervalId:       selectedIntervalId ?? undefined,
          confirmationCode: confirmationCode.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Activation failed");
      setActivated(json.subscription);
    } catch (err: any) {
      setSubmitError(err.message ?? "Activation failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectInterval = (iv: PlanInterval) => {
    setSelectedInterval(iv.interval);
    setSelectedIntervalId(iv.intervalId);
  };

  // Shared interval selector — handles both flat and tiered plans
  const IntervalSelector = () => {
    const isTiered = planInfo!.tiers.length > 0;

    if (isTiered) {
      return (
        <div className="space-y-3">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Choose a Plan</label>
          {planInfo!.tiers.map((tier) => (
            <div
              key={tier.tierId}
              className={cn(
                "rounded-2xl border-2 overflow-hidden transition-all",
                tier.isHighlighted ? "border-primary/40 shadow-sm shadow-primary/10" : "border-border",
              )}
            >
              {/* Tier header */}
              <div className={cn(
                "px-4 py-3 border-b",
                tier.isHighlighted ? "bg-primary/5 border-primary/20" : "bg-slate-50 border-border",
              )}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-foreground">{tier.tierName}</span>
                  {tier.isHighlighted && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-primary px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                      <Star className="w-2.5 h-2.5" aria-hidden /> Recommended
                    </span>
                  )}
                </div>
                {tier.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{tier.description}</p>
                )}
                {tier.features.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {tier.features.map((f) => (
                      <span key={f} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary border border-border text-[11px] text-muted-foreground">
                        <Tag className="w-2.5 h-2.5" aria-hidden /> {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Tier intervals */}
              <div className="divide-y divide-border">
                {tier.intervals.map((iv) => {
                  const isSelected = selectedIntervalId === iv.intervalId;
                  return (
                    <button
                      key={iv.intervalId}
                      type="button"
                      onClick={() => selectInterval(iv)}
                      aria-pressed={isSelected}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-3 text-left transition-all",
                        isSelected
                          ? "bg-primary/5"
                          : "bg-white hover:bg-slate-50",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-4 h-4 rounded-full border-2 shrink-0 transition-colors",
                          isSelected ? "border-primary bg-primary" : "border-muted-foreground/40",
                        )} />
                        <span className="text-sm font-semibold capitalize text-foreground">{iv.interval}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-primary">${parseFloat(iv.amount).toFixed(2)}</span>
                        <span className="text-xs text-muted-foreground ml-1">/ {iv.interval === "yearly" ? "yr" : iv.interval === "weekly" ? "wk" : "mo"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // Flat plan
    if (planInfo!.intervals.length > 1) {
      return (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Billing Cycle</label>
          <div className="grid grid-cols-1 gap-2">
            {planInfo!.intervals.map((iv) => {
              const isSelected = selectedIntervalId === iv.intervalId;
              return (
                <button
                  key={iv.intervalId}
                  type="button"
                  onClick={() => selectInterval(iv)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-all",
                    isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 transition-colors",
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground/40",
                    )} />
                    <span className="text-sm font-semibold capitalize text-foreground">{iv.interval}</span>
                  </div>
                  <span className="text-sm font-bold text-primary">${parseFloat(iv.amount).toFixed(2)}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (planInfo!.intervals.length === 1) {
      return (
        <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
          <span className="text-sm font-semibold capitalize text-foreground">{planInfo!.intervals[0]!.interval}</span>
          <span className="text-lg font-bold text-primary">${parseFloat(planInfo!.intervals[0]!.amount).toFixed(2)}</span>
        </div>
      );
    }

    return null;
  };

  const isPageReady = !isLoading && passportChecked;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/80">
      <Navbar />

      <div className="pt-24 pb-16 px-4 flex items-start justify-center min-h-screen">
        <motion.div
          variants={staggerContainer(0.08, 0)}
          initial="hidden"
          animate="show"
          className="w-full max-w-md space-y-6"
        >
          {/* Header */}
          <motion.div variants={fadeUp} className="text-center space-y-1">
            <div className="flex justify-center mb-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <CreditCard className="w-7 h-7 text-primary" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-foreground">Activate Subscription</h1>
            <p className="text-sm text-muted-foreground">
              {hasActivePassport
                ? "Your Subscription Passport is ready — activate in one step."
                : "Enter your confirmation code to start your subscription."}
            </p>
          </motion.div>

          {/* Loading */}
          {(!isPageReady) && (
            <motion.div variants={fadeUp} className="flex items-center justify-center gap-3 py-12 text-muted-foreground text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading plan…
            </motion.div>
          )}

          {/* Load error */}
          {isPageReady && loadError && (
            <motion.div variants={fadeUp}
              className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{loadError}</span>
            </motion.div>
          )}

          {/* Success state */}
          {activated && (
            <motion.div variants={fadeUp}
              className="rounded-2xl bg-white border-2 border-green-200 shadow-lg p-8 flex flex-col items-center gap-4 text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-foreground">
                  {activated.status === "trialing" ? "Free trial started!" : "Subscription activated!"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {activated.planTitle} · {activated.planInterval} · ${parseFloat(activated.amount).toFixed(2)}
                </p>
                {activated.status === "trialing" && (
                  <p className="text-xs text-violet-600 font-medium mt-1">
                    Your free trial is active. You won't be charged until it ends.
                  </p>
                )}
              </div>
              <button
                onClick={() => setLocation("/")}
                className="mt-2 h-10 px-6 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition"
              >
                Go to dashboard
              </button>
            </motion.div>
          )}

          {/* Main card */}
          {isPageReady && !loadError && planInfo && !activated && (
            <motion.div variants={fadeUp} className="rounded-2xl bg-white border-2 border-border shadow-lg overflow-hidden">
              {/* Plan header */}
              <div className="px-6 py-5 border-b border-border bg-slate-50 space-y-2">
                <p className="text-base font-bold text-foreground">{planInfo.planTitle}</p>
                <p className="text-xs text-muted-foreground">by {planInfo.creatorName}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Merchant ID:</span>
                  <code className="text-[11px] font-mono text-foreground tracking-wider">{merchantIdParam}</code>
                  <CopyButton text={merchantIdParam} />
                </div>
                {planInfo.hasFreeTrial && planInfo.trialDurationDays && (
                  <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                    {planInfo.trialDurationDays} day free trial
                  </span>
                )}
              </div>

              {/* ── PASSPORT FLOW ─────────────────────────────────────────── */}
              {hasActivePassport && (
                <form onSubmit={handlePassportActivate} className="px-6 py-5 space-y-5">
                  {/* Passport badge */}
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200">
                    <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-blue-900">Subscription Passport active</p>
                      <p className="text-xs text-blue-600">Your identity is verified — no confirmation code needed.</p>
                    </div>
                  </div>

                  <IntervalSelector />

                  {/* Transaction password */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Transaction Password
                    </label>
                    <p className="text-xs text-muted-foreground">Required if you have a transaction password set.</p>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="password"
                        placeholder="Enter transaction password"
                        value={txPassword}
                        onChange={(e) => setTxPassword(e.target.value)}
                        className="w-full h-11 rounded-xl border border-border bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                      />
                    </div>
                  </div>

                  {submitError && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      className="flex items-start gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive overflow-hidden"
                    >
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{submitError}</span>
                    </motion.div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting || !selectedInterval}
                    className="w-full h-11 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2 transition"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                    {isSubmitting ? "Activating…" : "Activate with Passport"}
                  </button>

                  {/* Fallback: use confirmation code instead */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowCodeFallback((v) => !v)}
                      className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-border hover:bg-slate-50 transition text-sm text-muted-foreground font-medium"
                    >
                      <span>Use a confirmation code instead</span>
                      <ChevronDown className={cn("w-4 h-4 transition-transform", showCodeFallback && "rotate-180")} />
                    </button>

                    <AnimatePresence>
                      {showCodeFallback && (
                        <motion.div
                          key="code-fallback"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="pt-4 space-y-3">
                            <div className="space-y-1.5">
                              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Confirmation Code
                              </label>
                              <input
                                type="text"
                                placeholder="e.g. aB3xY7Kp"
                                maxLength={8}
                                value={confirmationCode}
                                onChange={(e) => setConfirmationCode(e.target.value)}
                                className="w-full h-11 rounded-xl border border-border bg-white px-3 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={isSubmitting || !selectedInterval || confirmationCode.length < 8}
                              onClick={() => {
                                if (!selectedInterval || confirmationCode.length < 8) return;
                                setSubmitError(null);
                                setIsSubmitting(true);
                                fetch(`${BASE}/api/subscriptions/activate`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ merchantId: merchantIdParam, planInterval: selectedInterval, intervalId: selectedIntervalId ?? undefined, confirmationCode: confirmationCode.trim() }),
                                })
                                  .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message ?? "Activation failed"); setActivated(j.subscription); })
                                  .catch((err: any) => setSubmitError(err.message ?? "Activation failed"))
                                  .finally(() => setIsSubmitting(false));
                              }}
                              className="w-full h-10 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2 transition"
                            >
                              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                              {isSubmitting ? "Activating…" : "Activate with Code"}
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </form>
              )}

              {/* ── CONFIRMATION CODE FLOW (no passport / not logged in) ─── */}
              {!hasActivePassport && (
                <form onSubmit={handleActivate} className="px-6 py-5 space-y-5">
                  <IntervalSelector />

                  {/* Confirmation code */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Confirmation Code
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Enter the 8-character code that was sent to your email.
                    </p>
                    <input
                      type="text"
                      placeholder="e.g. aB3xY7Kp"
                      maxLength={8}
                      value={confirmationCode}
                      onChange={(e) => setConfirmationCode(e.target.value)}
                      required
                      className="w-full h-11 rounded-xl border border-border bg-white px-3 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                    />
                  </div>

                  {submitError && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      className="flex items-start gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive overflow-hidden"
                    >
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{submitError}</span>
                    </motion.div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting || !selectedInterval || confirmationCode.length < 8}
                    className="w-full h-11 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2 transition"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {isSubmitting ? "Activating…" : "Activate Subscription"}
                  </button>

                  {!isLoggedIn && (
                    <p className="text-center text-xs text-muted-foreground">
                      Don't have a code yet?{" "}
                      <button type="button" onClick={() => setLocation("/")} className="text-primary hover:underline font-medium">
                        Log in to generate one
                      </button>
                    </p>
                  )}

                  {isLoggedIn && !hasActivePassport && (
                    <p className="text-center text-xs text-muted-foreground">
                      After your first subscription, you'll receive a{" "}
                      <span className="font-medium text-blue-600">Subscription Passport</span>{" "}
                      for instant future activations.
                    </p>
                  )}
                </form>
              )}
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
