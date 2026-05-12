import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence, useInView } from "framer-motion";
import {
  ArrowRight, ArrowLeft, Code2, Key, Webhook, Shield, Zap,
  Globe, CheckCircle2, Circle, Terminal, BookOpen, Layers,
  Users, RefreshCw, Lock, ChevronRight, Menu, X, Copy,
  Check, ExternalLink, CreditCard, Bell, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Animation helpers ─────────────────────────────────────────────────────────

const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};
const fadeIn = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4 } },
};
const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

function useScrolled(threshold = 20) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > threshold);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [threshold]);
  return scrolled;
}

function useCopyCode() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };
  return { copied, copy };
}

// ── Inline CodeBlock ──────────────────────────────────────────────────────────

interface CodeBlockProps {
  id: string;
  language: string;
  code: string;
  copied: string | null;
  onCopy: (id: string, code: string) => void;
}

function CodeBlock({ id, language, code, copied, onCopy }: CodeBlockProps) {
  return (
    <div className="relative rounded-xl overflow-hidden border border-white/10 bg-[#0d1117]">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10">
        <span className="text-xs text-white/40 font-mono">{language}</span>
        <button
          onClick={() => onCopy(id, code)}
          className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/80 transition-colors"
        >
          {copied === id ? (
            <><Check className="w-3.5 h-3.5 text-green-400" /><span className="text-green-400">Copied</span></>
          ) : (
            <><Copy className="w-3.5 h-3.5" />Copy</>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
        <code className="text-white/85 font-mono whitespace-pre">{code}</code>
      </pre>
    </div>
  );
}

// ── Build-status pill ─────────────────────────────────────────────────────────

function StatusPill({ built }: { built: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border",
      built
        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
        : "bg-amber-500/10 text-amber-400 border-amber-500/20",
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full", built ? "bg-emerald-400" : "bg-amber-400")} />
      {built ? "Live" : "In Progress"}
    </span>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

function DevNav() {
  const scrolled = useScrolled();
  const [menuOpen, setMenuOpen] = useState(false);

  const sections = [
    { id: "overview",        label: "Overview" },
    { id: "how-it-works",    label: "How It Works" },
    { id: "api-reference",   label: "API Reference" },
    { id: "infrastructure",  label: "Infrastructure" },
  ];

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMenuOpen(false);
  };

  return (
    <header className={cn(
      "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
      scrolled
        ? "bg-[#0a0e1a]/95 backdrop-blur-md border-b border-white/10 shadow-2xl"
        : "bg-transparent",
    )}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo / back */}
          <Link href={`${BASE}/landing`} className="flex items-center gap-2 group">
            <ArrowLeft className="w-4 h-4 text-white/50 group-hover:text-white/90 transition-colors" />
            <img
              src={`${BASE}/Sweep_logo_exact.svg`}
              alt="Sweep"
              className="h-8 w-auto brightness-0 invert"
            />
            <span className="text-white/40 text-sm pl-1 border-l border-white/20 ml-1">
              Developer Portal
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className="px-3 py-1.5 text-sm text-white/60 hover:text-white rounded-lg hover:bg-white/8 transition-colors"
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <a
              href={`${BASE}/developer/login`}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          <button
            className="md:hidden p-2 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden overflow-hidden border-t border-white/10"
            >
              <div className="py-3 space-y-1">
                {sections.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => scrollTo(s.id)}
                    className="w-full text-left px-4 py-2.5 rounded-xl text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
                <div className="pt-2 px-1">
                  <a
                    href={`${BASE}/developer/login`}
                    className="block text-center px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white"
                  >
                    Request Access
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section
      id="overview"
      className="relative min-h-screen flex items-center justify-center bg-[#060912] overflow-hidden pt-16"
    >
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(#6366f1 1px, transparent 1px), linear-gradient(90deg, #6366f1 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px]" />

      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          <motion.div variants={fadeIn}>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-sm font-medium">
              <Code2 className="w-3.5 h-3.5" />
              Developer API — Early Access
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="text-4xl sm:text-5xl md:text-6xl font-black text-white leading-tight tracking-tight"
          >
            Build subscription-driven
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
              USD payment flows
            </span>
            <br />
            in minutes
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-lg text-white/55 max-w-2xl mx-auto leading-relaxed"
          >
            The Sweep Developer API lets your platform issue subscriptions, receive
            recurring USD payments, and verify user credentials — without building
            the financial infrastructure yourself.
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <a
              href={`${BASE}/developer/login`}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all hover:shadow-lg hover:shadow-indigo-600/25 hover:-translate-y-0.5"
            >
              Request Early Access <ArrowRight className="w-4 h-4" />
            </a>
            <button
              onClick={() => document.getElementById("api-reference")?.scrollIntoView({ behavior: "smooth" })}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 hover:text-white font-semibold text-sm border border-white/10 transition-colors"
            >
              <Terminal className="w-4 h-4" /> View API Docs
            </button>
          </motion.div>

          {/* Quick stats */}
          <motion.div
            variants={stagger}
            className="pt-10 grid grid-cols-3 gap-4 max-w-lg mx-auto"
          >
            {[
              { value: "REST",     label: "API style" },
              { value: "USDC",     label: "Settlement" },
              { value: "Webhooks", label: "Real-time events" },
            ].map((s) => (
              <motion.div
                key={s.label}
                variants={fadeUp}
                className="text-center p-4 rounded-xl bg-white/4 border border-white/8"
              >
                <div className="text-xl font-black text-white">{s.value}</div>
                <div className="text-xs text-white/40 mt-0.5">{s.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ── How It Works ─────────────────────────────────────────────────────────────

function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const steps = [
    {
      step: "01",
      icon: <Key className="w-5 h-5" />,
      title: "Get your API key",
      desc: "Register as a developer, verify your platform domain, and receive a live API key (live_sk_…). Use test keys during development with no real USD moved.",
    },
    {
      step: "02",
      icon: <Users className="w-5 h-5" />,
      title: "Identify subscribers with external_ref",
      desc: "Pass your internal user ID as external_ref on every subscription call. Sweep bridges your identity system to ours — no user account creation required on your end.",
    },
    {
      step: "03",
      icon: <CreditCard className="w-5 h-5" />,
      title: "Create a plan & share your payment link",
      desc: "POST /v1/plans to define the billing terms and intervals. Share your Sweep payment link with users — they subscribe through Sweep's UI, and you receive a webhook when they're active.",
    },
    {
      step: "04",
      icon: <Bell className="w-5 h-5" />,
      title: "Receive webhook events",
      desc: "Sweep fires signed webhook events (subscription.activated, payment.succeeded, payment.failed, subscription.cancelled) to your endpoint. Verify using the HMAC signature header.",
    },
    {
      step: "05",
      icon: <Shield className="w-5 h-5" />,
      title: "Issue a Subscription Passport",
      desc: "On first subscription activation Sweep auto-issues a tamper-proof Subscription Passport — an HMAC-signed JSON credential your platform can verify offline.",
    },
  ];

  return (
    <section id="how-it-works" className="py-24 bg-[#070b16]" ref={ref}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="space-y-16"
        >
          <motion.div variants={fadeUp} className="text-center space-y-3">
            <span className="text-indigo-400 text-sm font-semibold uppercase tracking-widest">Integration flow</span>
            <h2 className="text-3xl sm:text-4xl font-black text-white">How the API works</h2>
            <p className="text-white/50 max-w-xl mx-auto">
              Five steps from zero to live recurring USD payments on your platform.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-5 gap-6">
            {steps.map((s) => (
              <motion.div
                key={s.step}
                variants={fadeUp}
                className="relative p-5 rounded-2xl bg-white/3 border border-white/8 hover:border-indigo-500/30 hover:bg-white/5 transition-all group"
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-600/30 transition-colors">
                    {s.icon}
                  </div>
                  <span className="text-xs font-black text-white/25 font-mono">{s.step}</span>
                </div>
                <h3 className="text-sm font-bold text-white mb-2">{s.title}</h3>
                <p className="text-xs text-white/50 leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ── API Reference ─────────────────────────────────────────────────────────────

const SNIPPETS = {
  createPlan: `// POST /v1/plans
// Authorization: Bearer live_sk_••••••••

{
  "name": "Pro Monthly",
  "payment_email": "payouts@yourplatform.com",
  "intervals": [
    { "interval": "monthly", "amount": "29.99" }
  ]
}

// Response
{
  "plan_id": 42,
  "merchant_id": "ABCD-EFGH-IJKL",
  "name": "Pro Monthly",
  "payment_email": "payouts@yourplatform.com",
  "status": "active",
  "active_subscribers": 0,
  "is_tiered": false,
  "tiers": [],
  "intervals": [
    { "interval_id": 1, "interval": "monthly", "amount": "29.990000", "currency": "USD" }
  ],
  "created_at": "2025-01-15T10:00:00.000Z"
}`,

  activateSub: `// GET /v1/subscriptions/status?external_ref=usr_abc123
// Authorization: Bearer live_sk_••••••••
// Use this to gate access in your app — check if a user has an active sub.

// Response (subscribed user)
{
  "has_active_subscription": true,
  "subscription_id": 7,
  "plan_name": "Pro Monthly",
  "status": "active",
  "current_period_end": "2025-02-15T10:00:00.000Z",
  "activation_method": "confirmation_code"
}

// Response (not subscribed)
{
  "has_active_subscription": false,
  "subscription_id": null,
  "plan_name": null,
  "status": null,
  "current_period_end": null
}`,

  webhook: `// POST https://your-server.com/webhooks/sweep
// Headers sent by Sweep:
//   X-Signature-256: sha256=<hmac>
//   X-Event-Type: subscription.cancelled
//   Content-Type: application/json

{
  "event_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "event_type": "subscription.cancelled",
  "created_at": "2025-01-15T11:00:00.000Z",
  "developer_id": 12,
  "data": {
    "subscription_id": 7,
    "merchant_id": "ABCD-EFGH-IJKL",
    "external_ref": "usr_abc123",
    "status": "cancelled",
    "cancelled_at": "2025-01-15T11:00:00.000Z"
  }
}`,

  verifyPassport: `// Verify a Sweep webhook signature (Node.js / Express)
import crypto from "crypto";

function verifySignature(rawBody, sigHeader, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody)        // raw bytes — do NOT parse JSON first
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(sigHeader),
    Buffer.from(expected)
  );
}

// Register your endpoint with express.raw() so the body is not parsed
app.post("/webhooks/sweep", express.raw({ type: "*/*" }), (req, res) => {
  const sig = req.headers["x-signature-256"];
  if (!verifySignature(req.body, sig, process.env.SWEEP_WEBHOOK_SECRET)) {
    return res.status(401).send("Invalid signature");
  }
  const { event_type, data } = JSON.parse(req.body);
  if (event_type === "subscription.cancelled") { /* revoke access */ }
  res.status(200).send("ok");
});`,
};

function ApiReference() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const { copied, copy } = useCopyCode();
  const [activeTab, setActiveTab] = useState<keyof typeof SNIPPETS>("createPlan");

  const tabs: { id: keyof typeof SNIPPETS; label: string }[] = [
    { id: "createPlan",      label: "Create plan" },
    { id: "activateSub",     label: "Check subscription" },
    { id: "webhook",         label: "Webhook event" },
    { id: "verifyPassport",  label: "Verify signature" },
  ];

  const endpoints = [
    { method: "GET",    path: "/v1/plans",                                      desc: "List all plans for your API key" },
    { method: "POST",   path: "/v1/plans",                                      desc: "Create a new subscription plan" },
    { method: "GET",    path: "/v1/plans/:id",                                  desc: "Retrieve a specific plan" },
    { method: "PATCH",  path: "/v1/plans/:id",                                  desc: "Update plan name or payment email" },
    { method: "DELETE", path: "/v1/plans/:id",                                  desc: "Archive a plan (existing subs continue)" },
    { method: "GET",    path: "/v1/subscriptions",                              desc: "List subscriptions (filter: status, plan_id, external_ref)" },
    { method: "GET",    path: "/v1/subscriptions/status",                       desc: "Check if a user has an active subscription" },
    { method: "GET",    path: "/v1/subscriptions/lookup",                       desc: "All subscriptions for an external_ref" },
    { method: "GET",    path: "/v1/subscriptions/:id",                          desc: "Retrieve a specific subscription" },
    { method: "POST",   path: "/v1/subscriptions/:id/cancel",                   desc: "Cancel subscription at period end" },
    { method: "POST",   path: "/v1/webhooks",                                   desc: "Register a webhook endpoint" },
    { method: "GET",    path: "/v1/webhooks",                                   desc: "List registered webhooks" },
    { method: "DELETE", path: "/v1/webhooks/:id",                               desc: "Remove a webhook endpoint" },
    { method: "GET",    path: "/v1/webhooks/:id/events",                        desc: "Delivery log for a webhook endpoint" },
    { method: "POST",   path: "/v1/webhooks/:webhook_id/replay/:event_id",      desc: "Re-queue a specific event for delivery" },
  ];

  const methodColor: Record<string, string> = {
    GET:    "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    POST:   "text-indigo-400  bg-indigo-500/10  border-indigo-500/20",
    PATCH:  "text-amber-400   bg-amber-500/10   border-amber-500/20",
    DELETE: "text-red-400     bg-red-500/10     border-red-500/20",
  };

  return (
    <section id="api-reference" className="py-24 bg-[#060912]" ref={ref}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="space-y-16"
        >
          <motion.div variants={fadeUp} className="text-center space-y-3">
            <span className="text-indigo-400 text-sm font-semibold uppercase tracking-widest">API Reference</span>
            <h2 className="text-3xl sm:text-4xl font-black text-white">Every endpoint you need</h2>
          </motion.div>

          {/* Code examples */}
          <motion.div variants={fadeUp} className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border",
                    activeTab === t.id
                      ? "bg-indigo-600 text-white border-indigo-500"
                      : "bg-white/4 text-white/55 border-white/10 hover:bg-white/8 hover:text-white/80",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <CodeBlock
              id={activeTab}
              language={activeTab === "verifyPassport" ? "javascript" : "json"}
              code={SNIPPETS[activeTab]}
              copied={copied}
              onCopy={copy}
            />
          </motion.div>

          {/* Endpoint table */}
          <motion.div variants={fadeUp} className="space-y-3">
            <h3 className="text-lg font-bold text-white">Endpoint listing</h3>
            <div className="rounded-2xl border border-white/8 overflow-hidden">
              {endpoints.map((e, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-4 px-5 py-3.5 text-sm",
                    i % 2 === 0 ? "bg-white/[0.02]" : "bg-transparent",
                    i < endpoints.length - 1 && "border-b border-white/6",
                  )}
                >
                  <span className={cn(
                    "shrink-0 w-16 text-center text-xs font-bold px-2 py-0.5 rounded border font-mono",
                    methodColor[e.method],
                  )}>
                    {e.method}
                  </span>
                  <code className="text-white/80 font-mono text-xs flex-1">{e.path}</code>
                  <span className="text-white/40 text-xs hidden sm:block">{e.desc}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ── Infrastructure status ─────────────────────────────────────────────────────

function Infrastructure() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const modules = [
    {
      category: "Subscription Core",
      items: [
        { label: "Subscription plans (name, amount, interval, tiers)", built: true },
        { label: "Plan activation & status lifecycle (active → cancelled → expired)", built: true },
        { label: "One-time confirmation code flow (OTP → code → activate)", built: true },
        { label: "Subscription Passport — HMAC-signed credential", built: true },
        { label: "Email notifications (activated, payment, expiry warnings)", built: true },
        { label: "Creator-class no-code dashboard (manage plans + subscribers)", built: true },
      ],
    },
    {
      category: "Developer API Layer",
      items: [
        { label: "API key issuance & management (live_sk_ / test_ prefixes)", built: true },
        { label: "Versioned REST namespace — /v1/plans, /v1/subscriptions, /v1/webhooks", built: true },
        { label: "external_ref identity bridge field on subscriptions", built: true },
        { label: "Webhook delivery engine with exponential-backoff retries", built: true },
        { label: "Webhook signature verification (HMAC-SHA256 header)", built: true },
        { label: "Developer dashboard — API key portal + analytics", built: true },
      ],
    },
    {
      category: "Billing Engine",
      items: [
        { label: "USD balance deduction & transfer (platform-level)", built: true },
        { label: "Recurring payment scheduler (cron-based auto-charge)", built: true },
        { label: "Payment ledger per subscription (payments table)", built: true },
        { label: "Failed-payment retry logic (3× over 72 h)", built: true },
        { label: "Proration & mid-cycle plan changes", built: false },
      ],
    },
    {
      category: "Sandbox & Testing",
      items: [
        { label: "Test API key prefix (test_sk_) — separate from live keys", built: true },
        { label: "Full sandbox data isolation (test keys hit separate dataset)", built: false },
        { label: "Simulated webhook test-fire endpoint", built: false },
        { label: "Sandbox subscription lifecycle tools", built: false },
      ],
    },
  ];

  const totalItems = modules.flatMap((m) => m.items).length;
  const builtItems = modules.flatMap((m) => m.items).filter((i) => i.built).length;
  const pct = Math.round((builtItems / totalItems) * 100);

  return (
    <section id="infrastructure" className="py-24 bg-[#070b16]" ref={ref}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="space-y-16"
        >
          <motion.div variants={fadeUp} className="text-center space-y-3">
            <span className="text-indigo-400 text-sm font-semibold uppercase tracking-widest">Build Status</span>
            <h2 className="text-3xl sm:text-4xl font-black text-white">What's built. What's next.</h2>
            <p className="text-white/50 max-w-xl mx-auto">
              The core subscription engine is fully operational. The developer-facing layer
              is under active construction for early-access partners.
            </p>
          </motion.div>

          {/* Progress bar */}
          <motion.div variants={fadeUp} className="max-w-md mx-auto space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-white/60">Platform completion</span>
              <span className="text-white font-bold">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/8 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-violet-500"
                initial={{ width: 0 }}
                animate={inView ? { width: `${pct}%` } : { width: 0 }}
                transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-white/35">
              <span>{builtItems} of {totalItems} modules live</span>
              <span>Core infra ✓</span>
            </div>
          </motion.div>

          {/* Module grid */}
          <div className="grid sm:grid-cols-2 gap-6">
            {modules.map((m) => (
              <motion.div
                key={m.category}
                variants={fadeUp}
                className="p-6 rounded-2xl bg-white/3 border border-white/8 space-y-4"
              >
                <h3 className="text-sm font-bold text-white/90">{m.category}</h3>
                <ul className="space-y-2.5">
                  {m.items.map((item) => (
                    <li key={item.label} className="flex items-start gap-2.5">
                      {item.built ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                      ) : (
                        <Circle className="w-4 h-4 shrink-0 mt-0.5 text-white/20" />
                      )}
                      <span className={cn("text-xs leading-relaxed", item.built ? "text-white/70" : "text-white/35")}>
                        {item.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ── CTA ───────────────────────────────────────────────────────────────────────

function CTA() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section className="py-24 bg-[#060912] relative overflow-hidden" ref={ref}>
      <div className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "radial-gradient(circle at 50% 50%, #6366f1 0%, transparent 70%)",
        }}
      />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="space-y-8"
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-black text-white">
            Ready to build with Sweep?
          </motion.h2>
          <motion.p variants={fadeUp} className="text-white/50 text-lg">
            Join the early-access program. We'll onboard your platform first and work
            with you directly to integrate the Developer API.
          </motion.p>
          <motion.div variants={fadeUp} className="flex flex-wrap justify-center gap-4">
            <a
              href={`${BASE}/developer/login`}
              className="flex items-center gap-2 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-all hover:shadow-xl hover:shadow-indigo-600/30 hover:-translate-y-0.5"
            >
              Request Early Access <ArrowRight className="w-4 h-4" />
            </a>
            <Link
              href={`${BASE}/landing`}
              className="flex items-center gap-2 px-8 py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white font-semibold text-sm border border-white/10 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Sweep
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function DevFooter() {
  return (
    <footer className="py-10 bg-[#040609] border-t border-white/6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src={`${BASE}/Sweep_logo_exact.svg`} alt="Sweep" className="h-6 w-auto brightness-0 invert" />
          <span className="text-white/30 text-sm">Developer Portal</span>
        </div>
        <p className="text-white/25 text-xs">
          © {new Date().getFullYear()} Sweep. All rights reserved. Built on Circle's developer-controlled wallet infrastructure.
        </p>
      </div>
    </footer>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DeveloperPortal() {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = "Developer Portal — Sweep";
    return () => { document.title = "Sweep"; };
  }, []);

  return (
    <div className="min-h-screen bg-[#060912] text-white">
      <DevNav />
      <Hero />
      <HowItWorks />
      <ApiReference />
      <Infrastructure />
      <CTA />
      <DevFooter />
    </div>
  );
}