import { useState, type ReactNode } from "react";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { authHeaders } from "@/lib/wallet";
import { merchantQrUrl } from "@/lib/pay-qr";
import { BrandedQr, downloadQr } from "@/components/sweep/qr";
import { useCopy } from "@/components/sweep/ui";

// v5 "New subscription plan": a numbered form (details → pricing → free trial → authorize)
// beside a live "What subscribers see" preview, then a published screen with the
// checkout link, Merchant ID and QR code.

type Interval = "weekly" | "monthly" | "yearly";
const INTERVALS: Interval[] = ["weekly", "monthly", "yearly"];
const LABEL: Record<Interval, string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const PER: Record<Interval, string>   = { weekly: "week", monthly: "month", yearly: "year" };
const MAX_TIERS    = 5;
const MAX_FEATURES = 20;
const TRIAL_DAYS   = [7, 14, 30];

type Tier = { key: number; name: string; prices: Partial<Record<Interval, string>>; features: string[]; draft: string };

const num = (v: string | undefined) => { const n = parseFloat(v ?? ""); return Number.isFinite(n) && n > 0 ? n : 0; };
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const priceInput = (raw: string) => {
  const cleaned = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
  const [w, d] = cleaned.split(".");
  return (d !== undefined ? `${w}.${d.slice(0, 2)}` : w).slice(0, 9);
};

let tierKey = 0;
const newTier = (name = "", features: string[] = []): Tier => ({ key: ++tierKey, name, prices: {}, features, draft: "" });

const field = "h-12 w-full min-w-0 rounded-xl border border-(--sw-field-line) bg-white px-3.5 text-[15px] font-medium text-(--sw-ink) outline-none placeholder:text-[#9aa4b5] focus:border-(--sw-blue) focus:shadow-[0_0_0_4px_rgb(17_40_245/.1)] transition";
const kicker = "text-xs font-bold tracking-[0.06em] text-(--sw-faint) uppercase";

export function CreatePlan({ user }: { user: { name: string; email: string } }) {
  const [title,       setTitle]       = useState("");
  const [structure,   setStructure]   = useState<"simple" | "tiered">("simple");
  const [simpleRows,  setSimpleRows]  = useState<Array<{ interval: Interval; price: string }>>([{ interval: "monthly", price: "" }]);
  const [planFeats,   setPlanFeats]   = useState<string[]>([]);
  const [planDraft,   setPlanDraft]   = useState("");
  const [tierIvs,     setTierIvs]     = useState<Interval[]>(["monthly", "yearly"]);
  const [yearlyDeal,  setYearlyDeal]  = useState(true);
  const [tiers,       setTiers]       = useState<Tier[]>(() => [
    newTier("Basic", ["Monthly asset drops", "Community access"]),
    newTier("Pro", ["Everything in Basic", "Source files", "Priority requests"]),
  ]);
  const [recommended, setRecommended] = useState(1);
  const [trial,       setTrial]       = useState(false);
  const [trialDays,   setTrialDays]   = useState(7);
  const [pak,         setPak]         = useState("");
  const [showPak,     setShowPak]     = useState(false);
  const [previewIv,   setPreviewIv]   = useState<Interval | null>(null);
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [published,   setPublished]   = useState<{ name: string; merchantId: string } | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────
  const ivs     = INTERVALS.filter((k) => tierIvs.includes(k));
  const dealOn  = yearlyDeal && ivs.includes("monthly") && ivs.includes("yearly");
  const priceOf = (t: Tier, iv: Interval) => (iv === "yearly" && dealOn ? num(t.prices.monthly) * 10 : num(t.prices[iv]));

  const simpleOk = simpleRows.every((r) => num(r.price) > 0);
  const tiersOk  = tiers.every((t) => t.name.trim() && ivs.every((iv) => priceOf(t, iv) > 0));
  const blocker  =
    !title.trim()                                     ? "Name your plan to continue" :
    structure === "simple" ? (!simpleOk ? "Add a price for every interval" : null)
                           : (!tiersOk ? "Name every tier and price every interval" : null);
  const hint = blocker ?? (pak.trim() ? "Ready to publish" : "Enter your authorization key to publish");
  const canPublish = !blocker && !!pak.trim() && !busy;

  const pvList = structure === "simple" ? simpleRows.map((r) => r.interval) : ivs;
  const pvIv   = previewIv && pvList.includes(previewIv) ? previewIv : pvList[0] ?? "monthly";
  const pvCards = structure === "simple"
    ? [{ name: title.trim() || "Your plan", price: num(simpleRows.find((r) => r.interval === pvIv)?.price), feats: planFeats, rec: false, hi: true }]
    : tiers.map((t, i) => ({ name: t.name.trim() || `Tier ${i + 1}`, price: priceOf(t, pvIv), feats: t.features, rec: recommended === i, hi: recommended === i }));

  // ── Actions ────────────────────────────────────────────────────────────────
  const updTier = (i: number, patch: Partial<Tier>) => setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const addTierFeat = (i: number) => {
    const t = tiers[i]!, d = t.draft.trim();
    if (!d || t.features.includes(d) || t.features.length >= MAX_FEATURES) return;
    updTier(i, { features: [...t.features, d], draft: "" });
  };
  const addPlanFeat = () => {
    const d = planDraft.trim();
    if (!d || planFeats.includes(d) || planFeats.length >= MAX_FEATURES) return;
    setPlanFeats([...planFeats, d]); setPlanDraft("");
  };
  const removeTier = (i: number) => {
    if (tiers.length === 1) return;
    setTiers(tiers.filter((_, j) => j !== i));
    setRecommended((r) => (r === i ? -1 : r > i ? r - 1 : r));
  };
  const toggleTierIv = (k: Interval) => {
    const on = ivs.includes(k);
    if (on && ivs.length === 1) return;
    setTierIvs(on ? tierIvs.filter((x) => x !== k) : [...tierIvs, k]);
  };

  const publish = async () => {
    if (!canPublish) return;
    setError(null); setBusy(true);
    const planTitle = title.trim();
    // A simple plan with a feature list is stored as a single tier, since features live on tiers.
    const tiersBody = structure === "tiered"
      ? tiers.map((t, i) => ({
          tierName: t.name.trim(), features: t.features, isHighlighted: recommended === i, displayOrder: i,
          intervals: ivs.map((iv) => ({ interval: iv, amount: priceOf(t, iv).toFixed(2) })),
        }))
      : planFeats.length
        ? [{ tierName: planTitle, features: planFeats, isHighlighted: false, displayOrder: 0,
             intervals: simpleRows.map((r) => ({ interval: r.interval, amount: num(r.price).toFixed(2) })) }]
        : undefined;
    try {
      const res  = await fetch(`${API_BASE}/api/subscriptions/plans`, {
        method: "POST", headers: authHeaders(true),
        body: JSON.stringify({
          planTitle, paymentEmail: user.email, pak: pak.trim(),
          hasFreeTrial: trial, trialDurationDays: trial ? trialDays : undefined,
          ...(tiersBody ? { tiers: tiersBody } : { intervals: simpleRows.map((r) => ({ interval: r.interval, amount: num(r.price).toFixed(2) })) }),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Failed to create plan");
      setPublished({ name: planTitle, merchantId: json.plan?.merchantId ?? "" });
      setPak("");
    } catch (e: any) {
      setError(e?.message ?? "Failed to create plan");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPublished(null); setTitle(""); setStructure("simple");
    setSimpleRows([{ interval: "monthly", price: "" }]); setPlanFeats([]); setPlanDraft("");
    setTiers([newTier("Basic", ["Monthly asset drops", "Community access"]), newTier("Pro", ["Everything in Basic", "Source files", "Priority requests"])]);
    setRecommended(1); setTrial(false); setTrialDays(7); setPreviewIv(null); setError(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.95fr)] gap-6 items-start">
      <div className="bg-white border border-(--sw-line) rounded-[24px] overflow-hidden min-w-0">
        {published ? <Published plan={published} onReset={reset} /> : (
          <>
            <Section n="01" title="Details">
              <Label htmlFor="plan-title">Plan name</Label>
              <input id="plan-title" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 80))} placeholder="e.g. Creator Pro" className={field} />
              <span className="block pt-2"><Label>Payouts go to</Label></span>
              <div className="h-12 rounded-xl bg-(--sw-bg) border border-(--sw-line) px-3.5 flex items-center justify-between gap-3">
                <span className="text-[15px] font-semibold truncate">{user.email}</span>
                <span className="text-xs font-semibold text-(--sw-muted) shrink-0">Your payment ID</span>
              </div>
            </Section>

            <Section n="02" title="Pricing">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {([["simple", "Simple", "One price, one or more intervals"], ["tiered", "Tiered", "Several tiers, different prices"]] as const).map(([k, label, sub]) => (
                  <button key={k} type="button" onClick={() => setStructure(k)} aria-pressed={structure === k}
                    className={cn("text-left rounded-2xl border px-4 py-3 transition-colors",
                      structure === k ? "border-(--sw-blue) bg-[#f5f7ff]" : "border-(--sw-field-line) bg-white hover:border-[#c9d0fd]")}>
                    <span className={cn("block font-bold text-[15px]", structure === k ? "text-(--sw-blue)" : "text-(--sw-ink)")}>{label}</span>
                    <span className="block text-xs text-(--sw-muted) mt-0.5">{sub}</span>
                  </button>
                ))}
              </div>

              {structure === "simple" ? (
                <>
                  <div className="space-y-2.5 pt-1">
                    {simpleRows.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select value={r.interval} aria-label="Billing interval"
                          onChange={(e) => setSimpleRows(simpleRows.map((x, j) => (j === i ? { ...x, interval: e.target.value as Interval } : x)))}
                          className={cn(field, "w-[140px] flex-none font-semibold")}>
                          {INTERVALS.map((k) => (
                            <option key={k} value={k} disabled={k !== r.interval && simpleRows.some((x) => x.interval === k)}>{LABEL[k]}</option>
                          ))}
                        </select>
                        <PriceField value={r.price} label={`${LABEL[r.interval]} price`}
                          onChange={(v) => setSimpleRows(simpleRows.map((x, j) => (j === i ? { ...x, price: v } : x)))} />
                        <RemoveButton disabled={simpleRows.length === 1} label="Remove interval"
                          onClick={() => setSimpleRows(simpleRows.filter((_, j) => j !== i))} />
                      </div>
                    ))}
                  </div>
                  {simpleRows.length < INTERVALS.length && (
                    <button type="button" className="text-sm font-bold text-(--sw-blue) hover:text-(--sw-blue-hover)"
                      onClick={() => setSimpleRows([...simpleRows, { interval: INTERVALS.find((k) => !simpleRows.some((x) => x.interval === k))!, price: "" }])}>
                      + Add billing interval
                    </button>
                  )}
                  <div className="border-t border-(--sw-line) pt-4 space-y-2.5">
                    <span className={kicker}>What's included</span>
                    <FeatureList feats={planFeats} onRemove={(k) => setPlanFeats(planFeats.filter((_, q) => q !== k))} />
                    <FeatureInput value={planDraft} onChange={setPlanDraft} onAdd={addPlanFeat} />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2 pt-1">
                    <Label>Billing intervals offered</Label>
                    <div className="flex flex-wrap gap-2">
                      {INTERVALS.map((k) => {
                        const on = ivs.includes(k);
                        return (
                          <button key={k} type="button" onClick={() => toggleTierIv(k)} aria-pressed={on}
                            className={cn("h-10 pl-2.5 pr-3.5 rounded-full border flex items-center gap-2 text-sm font-semibold transition-colors",
                              on ? "border-(--sw-blue) bg-[#f5f7ff] text-(--sw-blue)" : "border-(--sw-field-line) bg-white text-(--sw-label)")}>
                            <span className={cn("w-[18px] h-[18px] rounded-[5px] border grid place-items-center", on ? "bg-(--sw-blue) border-(--sw-blue) text-white" : "border-[#c5ccd8] bg-white")}>
                              {on && <Check className="w-3 h-3" strokeWidth={3} />}
                            </span>
                            {LABEL[k]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {ivs.includes("monthly") && ivs.includes("yearly") && (
                    <div className="flex items-center justify-between gap-3 rounded-2xl bg-(--sw-bg) border border-(--sw-line) px-4 py-3">
                      <span className="min-w-0">
                        <span className="block text-sm font-bold">Yearly = 2 months free</span>
                        <span className="block text-xs text-(--sw-muted)">Yearly prices are set to 10× monthly automatically</span>
                      </span>
                      <Switch on={yearlyDeal} onToggle={() => setYearlyDeal(!yearlyDeal)} label="Yearly = 2 months free" />
                    </div>
                  )}
                  <div className="space-y-3">
                    {tiers.map((t, i) => {
                      const rec = recommended === i;
                      return (
                        <div key={t.key} className={cn("rounded-2xl border overflow-hidden", rec ? "border-(--sw-blue)" : "border-(--sw-line)")}>
                          <div className={cn("flex items-center gap-2.5 px-4 py-3 border-b border-(--sw-line)", rec ? "bg-[#f5f7ff]" : "bg-[#fafbfc]")}>
                            <span className="text-[11px] font-bold tracking-[0.06em] text-(--sw-faint) shrink-0">TIER {i + 1}</span>
                            <input value={t.name} onChange={(e) => updTier(i, { name: e.target.value.slice(0, 40) })} placeholder="Tier name"
                              aria-label={`Tier ${i + 1} name`}
                              className="flex-1 min-w-0 bg-transparent outline-none font-bold text-base placeholder:text-[#9aa4b5]" />
                            <button type="button" onClick={() => setRecommended(rec ? -1 : i)} aria-pressed={rec}
                              className={cn("h-8 px-3 rounded-full border text-xs font-bold whitespace-nowrap shrink-0",
                                rec ? "bg-(--sw-blue) border-(--sw-blue) text-white" : "bg-white border-(--sw-field-line) text-(--sw-muted)")}>
                              {rec ? "★ Recommended" : "Mark recommended"}
                            </button>
                            <RemoveButton disabled={tiers.length === 1} label={`Remove tier ${i + 1}`} onClick={() => removeTier(i)} />
                          </div>
                          <div className="p-4 space-y-4">
                            <div className="space-y-2">
                              <span className={kicker}>Pricing</span>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                {ivs.map((iv) => {
                                  const auto = iv === "yearly" && dealOn;
                                  const m = num(t.prices.monthly);
                                  return (
                                    <label key={iv} className="space-y-1 min-w-0">
                                      <span className="flex items-center justify-between text-xs font-semibold text-(--sw-label)">
                                        {LABEL[iv]}{auto && m > 0 && <span className="text-[#067647]">2 mo free</span>}
                                      </span>
                                      <PriceField value={auto ? (m ? (m * 10).toFixed(2) : "") : t.prices[iv] ?? ""} readOnly={auto}
                                        label={`${t.name || `Tier ${i + 1}`} ${LABEL[iv]} price`}
                                        onChange={(v) => updTier(i, { prices: { ...t.prices, [iv]: v } })} />
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="space-y-2.5">
                              <span className={kicker}>What's included</span>
                              <FeatureList feats={t.features} onRemove={(k) => updTier(i, { features: t.features.filter((_, q) => q !== k) })} />
                              <FeatureInput value={t.draft} onChange={(v) => updTier(i, { draft: v })} onAdd={() => addTierFeat(i)} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {tiers.length < MAX_TIERS && (
                    <button type="button" onClick={() => setTiers([...tiers, newTier()])}
                      className="text-sm font-bold text-(--sw-blue) hover:text-(--sw-blue-hover)">+ Add tier</button>
                  )}
                </>
              )}
            </Section>

            <Section n="03" title="Free trial">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold">Offer a free trial</span>
                  <span className="block text-[13px] text-(--sw-muted)">Subscribers aren't charged until the trial ends.</span>
                </span>
                <Switch on={trial} onToggle={() => setTrial(!trial)} label="Offer a free trial" />
              </div>
              {trial && (
                <div className="flex gap-2 pt-1">
                  {TRIAL_DAYS.map((d) => (
                    <button key={d} type="button" onClick={() => setTrialDays(d)} aria-pressed={trialDays === d}
                      className={cn("h-10 px-4 rounded-full border text-sm font-bold transition-colors",
                        trialDays === d ? "bg-(--sw-blue) border-(--sw-blue) text-white" : "bg-white border-(--sw-field-line) text-(--sw-label)")}>
                      {d} days
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section n="04" title="Authorize">
              <Label htmlFor="plan-pak">Authorization key</Label>
              <div className="relative">
                <input id="plan-pak" type={showPak ? "text" : "password"} value={pak} onChange={(e) => setPak(e.target.value)}
                  placeholder="Your payment authorization key" autoComplete="off" className={cn(field, "pr-16 font-mono")} />
                <button type="button" onClick={() => setShowPak(!showPak)}
                  className="absolute inset-y-0 right-0 px-3.5 text-[13px] font-bold text-(--sw-blue)">{showPak ? "Hide" : "Show"}</button>
              </div>
              <p className="text-xs text-(--sw-muted)">The key you created when you set up your account. It confirms plans you publish are yours.</p>
            </Section>

            <div className="px-5 sm:px-6 py-5 bg-[#fafbfc] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                {error
                  ? <p role="alert" className="text-sm font-semibold text-[#b42318]">{error}</p>
                  : <p className={cn("text-sm font-semibold", blocker || !pak.trim() ? "text-(--sw-muted)" : "text-[#067647]")}>{hint}</p>}
              </div>
              <button type="button" onClick={publish} disabled={!canPublish}
                className="h-12 px-6 rounded-2xl bg-(--sw-blue) text-white font-bold text-[15px] hover:bg-(--sw-blue-hover) disabled:bg-[#c5ccd8] disabled:cursor-not-allowed flex items-center justify-center gap-2 shrink-0">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}{busy ? "Publishing…" : "Publish plan"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* What subscribers see */}
      <div className="flex flex-col gap-3 min-w-0 xl:sticky xl:top-6">
        <div className="flex items-center justify-between gap-3 min-h-9">
          <span className={kicker}>What subscribers see</span>
          {pvList.length > 1 && (
            <div className="flex bg-(--sw-line) rounded-xl p-[3px] gap-[3px]" role="tablist" aria-label="Preview interval">
              {pvList.map((k) => (
                <button key={k} type="button" role="tab" aria-selected={k === pvIv} onClick={() => setPreviewIv(k)}
                  className={cn("h-8 px-3 rounded-[9px] text-[13px] font-bold", k === pvIv ? "bg-white text-(--sw-ink) shadow-[0_1px_2px_rgb(11_18_32/.08)]" : "text-(--sw-muted)")}>
                  {LABEL[k]}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white border border-(--sw-line) rounded-[24px] p-[18px] flex flex-col gap-3.5">
          <div className="flex items-center gap-3 px-1">
            <span className="w-10 h-10 rounded-xl bg-(--sw-blue) grid place-items-center shrink-0"><img src="/sweep-mark-white.svg" alt="" className="w-4" /></span>
            <span className="flex flex-col min-w-0">
              <span className="font-extrabold text-base truncate">{published?.name || title.trim() || "Your plan name"}</span>
              <span className="text-[13px] text-(--sw-muted) truncate">by {user.name}</span>
            </span>
          </div>
          {pvCards.map((c, i) => (
            <div key={i} className={cn("rounded-[18px] border p-[18px] flex flex-col gap-3", c.hi ? "border-(--sw-blue) bg-[#f5f7ff]" : "border-(--sw-line) bg-white")}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-base truncate">{c.name}</span>
                {c.rec && <span className="text-[10px] font-bold tracking-[0.06em] px-2 py-1 rounded-full bg-(--sw-blue) text-white shrink-0">RECOMMENDED</span>}
              </div>
              <div className="flex items-baseline gap-1 border-b border-(--sw-line) pb-3">
                <span className="font-extrabold text-[32px] tracking-[-0.03em] leading-none">{c.price ? usd(c.price) : "$—"}</span>
                <span className="text-sm text-(--sw-muted)">/ {PER[pvIv]}</span>
              </div>
              {c.feats.length ? (
                <ul className="space-y-2">
                  {c.feats.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm">
                      <span className="w-4 h-4 rounded-full bg-(--sw-tint) text-(--sw-blue) grid place-items-center shrink-0"><Check className="w-2.5 h-2.5" strokeWidth={3} /></span>
                      <span className="min-w-0 break-words">{f}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] text-(--sw-faint)">Add features to show what's included.</p>}
              <span aria-hidden className={cn("h-11 rounded-xl grid place-items-center text-sm font-bold border",
                c.hi ? "bg-(--sw-blue) border-(--sw-blue) text-white" : "bg-white border-(--sw-tint-line) text-(--sw-blue)")}>Subscribe</span>
            </div>
          ))}
          <p className="text-xs text-(--sw-faint) text-center">Paid from Sweep balance · cancel anytime</p>
        </div>
      </div>
    </div>
  );
}

// ── Published ──────────────────────────────────────────────────────────────────

function Published({ plan, onReset }: { plan: { name: string; merchantId: string }; onReset: () => void }) {
  const link = merchantQrUrl(plan.merchantId);
  const linkCopy = useCopy();
  const idCopy   = useCopy();
  const mailto = `mailto:?subject=${encodeURIComponent(`Subscribe to ${plan.name} on Sweep`)}&body=${encodeURIComponent(link)}`;
  const chip = "h-10 px-4 rounded-full border border-(--sw-field-line) bg-white text-[13px] font-bold text-(--sw-ink) hover:border-[#c9d0fd] inline-flex items-center";

  return (
    <div role="status">
      <div className="relative overflow-hidden bg-(--sw-blue) text-white px-6 sm:px-7 pt-9 pb-8">
        <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute right-6 -bottom-16 w-56 opacity-[.08] pointer-events-none" />
        <span className="relative text-xs font-bold tracking-[0.08em] opacity-85">PLAN PUBLISHED</span>
        <h2 className="relative font-extrabold text-[32px] sm:text-[40px] leading-[1.05] tracking-[-0.04em] mt-2 break-words">{plan.name} is live.</h2>
      </div>
      <div className="px-5 sm:px-6 py-6 flex flex-col gap-4">
        <p className="text-[15px] text-(--sw-muted) leading-relaxed">
          Share one link. It opens a checkout with this plan, your Merchant ID and a QR code for anyone paying from their phone.
        </p>
        <div className="space-y-2">
          <span className={kicker}>Checkout link</span>
          <div className="flex items-center gap-2 rounded-2xl border border-(--sw-blue) pl-4 pr-1.5 py-1.5">
            <span className="flex-1 min-w-0 truncate text-sm font-bold">{link.replace(/^https?:\/\//, "")}</span>
            <button type="button" onClick={() => linkCopy.copy(link)}
              className="h-10 px-4 rounded-xl bg-(--sw-blue) text-white text-sm font-bold hover:bg-(--sw-blue-hover) shrink-0">
              {linkCopy.copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={link} target="_blank" rel="noreferrer" className={chip}>Open checkout</a>
          <a href={mailto} className={chip}>Share by email</a>
          <button type="button" onClick={() => downloadQr(link, `sweep-plan-${plan.merchantId}.png`)} className={chip}>Download QR</button>
        </div>
        <div className="rounded-2xl border border-(--sw-line) p-4 flex flex-col sm:flex-row gap-4 sm:items-center">
          <BrandedQr value={link} label={`QR code for ${plan.name}`} className="w-[148px]" />
          <div className="min-w-0 space-y-1.5">
            <span className={kicker}>Merchant ID</span>
            <div className="flex items-center gap-2">
              <code className="font-extrabold text-xl tracking-[0.04em] font-sans" translate="no">{plan.merchantId}</code>
              <button type="button" onClick={() => idCopy.copy(plan.merchantId)} className="text-sm font-bold text-(--sw-blue)">
                {idCopy.copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="text-[13px] text-(--sw-muted) leading-relaxed">
              Customers can scan the QR with the Sweep app or type the ID under Pay. Both are also shown on the checkout page.
            </p>
          </div>
        </div>
        <button type="button" onClick={onReset} className="self-start h-11 px-5 rounded-2xl border border-(--sw-tint-line) text-(--sw-blue) text-sm font-bold hover:bg-(--sw-tint)">
          Create another plan
        </button>
      </div>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

function Section({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="px-5 sm:px-6 py-6 border-b border-(--sw-line) flex flex-col gap-2.5">
      <h3 className="text-xs font-bold tracking-[0.08em] text-(--sw-blue) uppercase mb-1">{n} · {title}</h3>
      {children}
    </section>
  );
}

function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="text-[13px] font-bold text-(--sw-label)">{children}</label>;
}

function PriceField({ value, onChange, readOnly, label }: { value: string; onChange: (v: string) => void; readOnly?: boolean; label: string }) {
  return (
    <div className="relative flex-1 min-w-0">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-medium text-(--sw-faint) pointer-events-none">$</span>
      <input value={value} onChange={(e) => onChange(priceInput(e.target.value))} readOnly={readOnly} inputMode="decimal" placeholder="0.00"
        aria-label={label}
        className={cn(field, "pl-7 tabular-nums", readOnly && "bg-(--sw-bg) text-(--sw-label) focus:shadow-none focus:border-(--sw-field-line)")} />
    </div>
  );
}

function RemoveButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      className="w-8 h-8 rounded-lg grid place-items-center text-[#b42318] hover:bg-[#fef3f2] disabled:text-[#d0d5dd] disabled:hover:bg-transparent shrink-0">
      <X className="w-4 h-4" />
    </button>
  );
}

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
      className={cn("relative w-12 h-7 rounded-full transition-colors shrink-0", on ? "bg-(--sw-blue)" : "bg-[#d0d5dd]")}>
      <span className={cn("absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow transition-[left]", on ? "left-[23px]" : "left-[3px]")} />
    </button>
  );
}

function FeatureList({ feats, onRemove }: { feats: string[]; onRemove: (k: number) => void }) {
  if (!feats.length) return null;
  return (
    <ul className="space-y-2">
      {feats.map((f, k) => (
        <li key={f} className="flex items-center gap-2.5 rounded-xl bg-(--sw-bg) pl-3 pr-1.5 py-2">
          <span className="w-[18px] h-[18px] rounded-full bg-(--sw-blue) text-white grid place-items-center shrink-0"><Check className="w-3 h-3" strokeWidth={3} /></span>
          <span className="flex-1 min-w-0 text-sm font-semibold break-words">{f}</span>
          <button type="button" onClick={() => onRemove(k)} aria-label={`Remove ${f}`}
            className="w-7 h-7 rounded-lg grid place-items-center text-(--sw-faint) hover:text-(--sw-ink) hover:bg-white shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function FeatureInput({ value, onChange, onAdd }: { value: string; onChange: (v: string) => void; onAdd: () => void }) {
  return (
    <div className="flex gap-2">
      <input value={value} onChange={(e) => onChange(e.target.value.slice(0, 80))} placeholder="Add a feature, e.g. Source files"
        aria-label="New feature"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }} className={cn(field, "flex-1")} />
      <button type="button" onClick={onAdd} disabled={!value.trim()}
        className="h-12 px-4 rounded-xl border border-(--sw-tint-line) bg-white text-(--sw-blue) text-sm font-bold hover:bg-(--sw-tint) disabled:opacity-50 shrink-0">
        Add
      </button>
    </div>
  );
}
