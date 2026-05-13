import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRight, ShieldCheck, Mail, Zap, Loader2, CheckCircle2,
  AlertCircle, LogIn, UserPlus, Lock, Globe, RefreshCw,
  Send, Users, Menu, X, Layers, ChevronRight, ChevronLeft,
  Wallet, CreditCard, BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fadeUp, slideRight, scaleIn, staggerContainer, fadeIn } from "@/lib/motion";

import { API_BASE } from "@/lib/api";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Form schema ───────────────────────────────────────────────────────────────

const sendSchema = z.object({
  recipientEmail: z.string().email("Please enter a valid email address"),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, "Must be a positive number")
    .refine((v) => Number(v) >= 0.01, "Minimum send is $0.01 USDC"),
});
type SendFormValues = z.infer<typeof sendSchema>;

// ── World map ─────────────────────────────────────────────────────────────────

const CITIES = [
  { name: "New York",   x: 230, y: 175 },
  { name: "London",     x: 460, y: 145 },
  { name: "Lagos",      x: 472, y: 265 },
  { name: "Dubai",      x: 592, y: 210 },
  { name: "Singapore",  x: 720, y: 280 },
  { name: "Tokyo",      x: 790, y: 175 },
  { name: "São Paulo",  x: 278, y: 330 },
  { name: "Nairobi",    x: 548, y: 288 },
  { name: "Mumbai",     x: 638, y: 232 },
  { name: "Sydney",     x: 810, y: 370 },
  { name: "Toronto",    x: 215, y: 155 },
  { name: "Frankfurt",  x: 490, y: 143 },
];
const ARCS: [number, number][] = [
  [0, 1], [1, 3], [3, 4], [4, 5], [0, 6], [1, 2],
  [2, 7], [7, 3], [8, 4], [1, 11], [10, 0], [4, 9],
];
function cubicBezierArc(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const lift = Math.min(len * 0.38, 120);
  const cpx = mx - (dy / len) * lift;
  const cpy = my - (dx / len) * lift * 0.4 - lift * 0.5;
  return `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
}

function WorldMapBackground() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/80" />
      <img
        src={`${BASE}/images/world-map.png`}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover opacity-[0.18] select-none pointer-events-none"
        style={{ filter: "saturate(0.4) contrast(0.9)" }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,rgba(99,102,241,0.07)_0%,transparent_70%)]" />
      <svg viewBox="0 0 1000 500" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0" />
            <stop offset="50%" stopColor="#6366f1" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
          </linearGradient>
          <filter id="dotGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id="mapClip"><rect x="0" y="0" width="1000" height="500" /></clipPath>
        </defs>
        <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="0.8" fill="#94a3b8" />
        </pattern>
        <rect width="1000" height="500" fill="url(#dots)" opacity="0.2" />
        <g clipPath="url(#mapClip)">
          {ARCS.map(([i, j], idx) => {
            const a = CITIES[i], b = CITIES[j];
            const d = cubicBezierArc(a.x, a.y, b.x, b.y);
            return (
              <g key={idx}>
                <path d={d} fill="none" stroke="#6366f1" strokeWidth="0.8" opacity="0.18" />
                <motion.path
                  d={d} fill="none" stroke="url(#arcGrad)" strokeWidth="1.6"
                  strokeDasharray="12 200"
                  initial={{ strokeDashoffset: 220 }}
                  animate={{ strokeDashoffset: -220 }}
                  transition={{ duration: 2.8 + (idx % 4) * 0.5, delay: idx * 0.45, repeat: Infinity, ease: "linear", repeatDelay: 0.8 }}
                />
              </g>
            );
          })}
        </g>
        {CITIES.map((city, idx) => (
          <g key={city.name} filter="url(#dotGlow)">
            <motion.circle cx={city.x} cy={city.y} r={6} fill="none" stroke="#6366f1" strokeWidth="1"
              initial={{ opacity: 0.6, scale: 1 }} animate={{ opacity: 0, scale: 2.8 }}
              transition={{ duration: 2.2, delay: idx * 0.18, repeat: Infinity, ease: "easeOut" }}
              style={{ transformOrigin: `${city.x}px ${city.y}px` }}
            />
            <circle cx={city.x} cy={city.y} r={3} fill="#6366f1" opacity="0.85" />
            <circle cx={city.x} cy={city.y} r={1.5} fill="white" opacity="0.9" />
          </g>
        ))}
      </svg>
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-slate-50 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-slate-50/90 to-transparent" />
      <div className="absolute top-[-80px] left-[8%]  w-[420px] h-[420px] rounded-full bg-indigo-400/10 blur-[90px] pointer-events-none" />
      <div className="absolute top-[15%]  right-[4%]  w-[340px] h-[340px] rounded-full bg-cyan-400/10   blur-[80px] pointer-events-none" />
      <div className="absolute bottom-[8%] left-[32%] w-[300px] h-[300px] rounded-full bg-violet-400/8  blur-[70px] pointer-events-none" />
    </div>
  );
}

// ── Animated counter ──────────────────────────────────────────────────────────

function AnimatedCounter({
  target, prefix = "", suffix = "", decimals = 0,
}: { target: number; prefix?: string; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) { setCount(target); return; }
    const steps = 50;
    const stepMs = 1800 / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const eased = 1 - Math.pow(1 - step / steps, 3);
      setCount(eased * target);
      if (step >= steps) clearInterval(timer);
    }, stepMs);
    return () => clearInterval(timer);
  }, [isInView, target]);

  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(count)}
      {suffix}
    </span>
  );
}

// ── Landing nav ───────────────────────────────────────────────────────────────

function LandingNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled]  = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setIsLoggedIn(!!localStorage.getItem("token"));
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMenuOpen(false);
  };

  const navLinks = [
    { label: "Features",     id: "features"     },
    { label: "How It Works", id: "how-it-works" },
    { label: "Use Cases",    id: "use-cases"    },
  ];

  return (
    <header className={cn(
      "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
      scrolled
        ? "bg-white/95 backdrop-blur-md border-b border-border/50 shadow-sm"
        : "bg-primary shadow-lg shadow-primary/20",
    )}>
      {/* Skip link */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:left-4 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:bg-white focus-visible:text-primary focus-visible:rounded-lg focus-visible:text-sm focus-visible:font-medium"
      >
        Skip to main content
      </a>

      <nav aria-label="Main navigation" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20 lg:h-24">

          <Link href={`${BASE}/landing`} className="flex items-center shrink-0" aria-label="Sweep home">
            <img
              src="/Sweep_logo_exact.svg"
              alt="Sweep"
              className={cn(
                "h-20 lg:h-28 w-auto object-contain transition-all duration-300",
                scrolled ? "" : "brightness-0 invert",
              )}
            />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1" role="list">
            {navLinks.map((link) => (
              <button
                key={link.id}
                role="listitem"
                onClick={() => scrollTo(link.id)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                  scrolled
                    ? "text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:ring-primary/40"
                    : "text-white/80 hover:text-white hover:bg-white/15 focus-visible:ring-white/40",
                )}
              >
                {link.label}
              </button>
            ))}
            <Link
              href={`${BASE}/developer`}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                scrolled
                  ? "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  : "text-white/80 hover:text-white hover:bg-white/15",
              )}
            >
              Developer Portal
            </Link>
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            {isLoggedIn ? (
              <Link
                href={`${BASE}/dashboard`}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2",
                  scrolled
                    ? "bg-primary text-white hover:bg-primary/90 focus-visible:ring-primary/40"
                    : "bg-white text-primary hover:bg-white/90 focus-visible:ring-white/40",
                )}
              >
                Dashboard <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
            ) : (
              <>
                <Link
                  href={`${BASE}/login`}
                  className={cn(
                    "px-4 py-2 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2",
                    scrolled
                      ? "text-foreground hover:bg-secondary/60 focus-visible:ring-primary/40"
                      : "text-white/90 hover:text-white hover:bg-white/15 focus-visible:ring-white/40",
                  )}
                >
                  Log in
                </Link>
                <Link
                  href={`${BASE}/register`}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold hover:shadow-md hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2",
                    scrolled
                      ? "bg-foreground text-background hover:bg-foreground/90 focus-visible:ring-foreground/40"
                      : "bg-white text-primary hover:bg-white/90 focus-visible:ring-white/40",
                  )}
                >
                  Get started <ChevronRight className="w-4 h-4" aria-hidden />
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              "md:hidden p-2 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2",
              scrolled
                ? "text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:ring-primary/40"
                : "text-white hover:bg-white/15 focus-visible:ring-white/40",
            )}
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              id="mobile-nav"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={cn(
                "md:hidden overflow-hidden border-t",
                scrolled ? "border-border/50" : "border-white/20",
              )}
            >
              <div className="py-3 space-y-1">
                {navLinks.map((link) => (
                  <button
                    key={link.id}
                    onClick={() => scrollTo(link.id)}
                    className={cn(
                      "w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-colors",
                      scrolled
                        ? "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                        : "text-white/80 hover:text-white hover:bg-white/15",
                    )}
                  >
                    {link.label}
                  </button>
                ))}
                <Link
                  href={`${BASE}/developer`}
                  className={cn(
                    "block px-4 py-2.5 rounded-xl text-sm font-medium transition-colors",
                    scrolled
                      ? "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                      : "text-white/80 hover:text-white hover:bg-white/15",
                  )}
                >
                  Developer Portal
                </Link>
                <div className="pt-2 flex flex-col gap-2 px-1">
                  {isLoggedIn ? (
                    <Link
                      href={`${BASE}/dashboard`}
                      className={cn(
                        "text-center px-4 py-2.5 rounded-xl text-sm font-semibold",
                        scrolled ? "bg-primary text-white" : "bg-white text-primary",
                      )}
                    >
                      Dashboard
                    </Link>
                  ) : (
                    <>
                      <Link
                        href={`${BASE}/login`}
                        className={cn(
                          "text-center px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors",
                          scrolled
                            ? "border-border hover:bg-secondary/60"
                            : "border-white/30 text-white hover:bg-white/15",
                        )}
                      >
                        Log in
                      </Link>
                      <Link
                        href={`${BASE}/register`}
                        className={cn(
                          "text-center px-4 py-2.5 rounded-xl text-sm font-semibold",
                          scrolled ? "bg-foreground text-background" : "bg-white text-primary",
                        )}
                      >
                        Get started
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </header>
  );
}

// ── Hero section ──────────────────────────────────────────────────────────────

function HeroSection({
  isLoggedIn, hasTransactionPassword, txnPwd, setTxnPwd,
  isSending, isLooking, formError, didSucceed,
  successEmail, successAmount, successName,
  preview, pendingData, setPreview, setFormError,
  handleSubmit, onReview, onConfirm, register, errors, handleSendAnother,
}: any) {
  return (
    <section
      aria-label="Hero"
      className="relative overflow-hidden min-h-[calc(100vh-4rem)] lg:min-h-screen flex items-center pt-16 lg:pt-20"
    >
      <WorldMapBackground />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24 w-full">
        <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">

          {/* Left — copy */}
          <motion.div variants={staggerContainer(0.12, 0.1)} initial="hidden" animate="show">
            <motion.div variants={fadeUp}>
              <motion.div
                whileHover={{ scale: 1.04 }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary font-medium text-sm mb-6 border border-primary/20 cursor-default"
              >
                <motion.span
                  animate={{ rotate: [0, 15, -15, 0] }}
                  transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                  aria-hidden
                >
                  <Zap className="w-4 h-4" />
                </motion.span>
                <span>Instant Web3 + Web2 Payments</span>
              </motion.div>
            </motion.div>

            <motion.div variants={fadeUp}>
              <h1 className="text-5xl lg:text-6xl xl:text-7xl font-bold text-foreground leading-[1.06] mb-6 text-balance">
                Send USD/USDC{" "}
                <span className="block">
                  <span className="text-gradient-animated">Globally in Seconds</span>
                </span>
              </h1>
            </motion.div>

            <motion.p variants={fadeUp} className="text-lg lg:text-xl text-muted-foreground mb-8 leading-relaxed max-w-lg text-balance">
              No wallet required. Send stablecoins by email — funds are locked in a smart
              contract until the recipient signs up and claims them.
            </motion.p>

            {/* Trust badges */}
            <motion.div variants={staggerContainer(0.08)} className="flex flex-wrap gap-3 mb-10">
              {[
                { icon: <ShieldCheck className="w-4 h-4" aria-hidden />, label: "Smart Contract Secured" },
                { icon: <BadgeCheck className="w-4 h-4" aria-hidden />,   label: "Circle-Powered" },
                { icon: <Globe className="w-4 h-4" aria-hidden />,        label: "Worldwide Transfers" },
              ].map((b) => (
                <motion.div
                  key={b.label}
                  variants={fadeUp}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/80 border border-border/60 shadow-sm text-sm text-muted-foreground font-medium"
                >
                  <span className="text-primary">{b.icon}</span>
                  {b.label}
                </motion.div>
              ))}
            </motion.div>

            {/* Feature cards */}
            <motion.div variants={staggerContainer(0.1)} className="grid sm:grid-cols-2 gap-4">
              {[
                {
                  icon: <ShieldCheck className="w-6 h-6 text-primary" />, bg: "bg-blue-100",
                  title: "Secure Escrow",
                  desc: "Smart contract locked with email hashes — only the verified recipient can claim.",
                },
                {
                  icon: <Mail className="w-6 h-6 text-teal-600" />, bg: "bg-teal-100",
                  title: "No Onboarding",
                  desc: "Recipients only need their email address to claim funds — no wallet setup.",
                },
              ].map((f) => (
                <motion.div
                  key={f.title}
                  variants={fadeUp}
                  whileHover={{ y: -4, transition: { type: "spring", stiffness: 400, damping: 20 } }}
                  className="flex gap-3 p-4 rounded-2xl bg-white/70 backdrop-blur border border-white/60 shadow-sm"
                >
                  <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0", f.bg)}>
                    {f.icon}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground">{f.title}</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">{f.desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>

          {/* Right — send card */}
          <motion.div variants={slideRight} initial="hidden" animate="show" transition={{ delay: 0.25 }}>
            <div className="relative">
              <div className="absolute inset-0 -m-8 pointer-events-none" aria-hidden>
                <div className="absolute inset-0 rounded-full border border-primary/10 spin-slow" />
                <div className="absolute inset-4 rounded-full border border-accent/10 spin-slow-reverse" />
              </div>

              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ repeat: Infinity, duration: 5, ease: "easeInOut" }}
                className="glass-panel rounded-3xl p-8 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" aria-hidden />
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-accent/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none" aria-hidden />

                <AnimatePresence mode="wait">
                  {didSucceed ? (
                    <motion.div key="success" variants={scaleIn} initial="hidden" animate="show" exit="hidden" className="text-center py-6">
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
                        className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg shadow-green-500/20"
                        aria-hidden
                      >
                        <CheckCircle2 className="w-10 h-10" />
                      </motion.div>
                      <motion.div variants={staggerContainer(0.08)} initial="hidden" animate="show">
                        <motion.h2 variants={fadeUp} className="text-2xl font-bold mb-1" aria-live="polite">Funds Sent!</motion.h2>
                        <motion.p variants={fadeUp} className="text-muted-foreground text-sm mb-3">
                          <span className="font-medium text-foreground">${successAmount} USD</span>{" "}
                          sent to{" "}
                          <span className="font-medium text-foreground">{successName || successEmail}</span>
                          {successName && <span className="text-muted-foreground"> ({successEmail})</span>}.
                          Their balance has been credited instantly.
                        </motion.p>
                        <motion.div variants={fadeUp} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-50 text-violet-700 text-xs font-medium border border-violet-200 mb-5">
                          <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
                          Sent from your platform balance — no wallet needed
                        </motion.div>
                        <br />
                        <motion.button
                          variants={fadeUp} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                          onClick={handleSendAnother}
                          className="px-6 py-3 bg-secondary text-foreground rounded-xl font-medium hover:bg-secondary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          Send Another Payment
                        </motion.button>
                      </motion.div>
                    </motion.div>
                  ) : preview ? (
                    /* ── Confirmation screen ── */
                    <motion.div key="confirm" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
                      <button
                        type="button"
                        onClick={() => { setPreview(null); setFormError(null); }}
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
                      >
                        <ChevronLeft className="w-4 h-4" aria-hidden /> Back
                      </button>
                      <h2 className="text-2xl font-bold font-display mb-1">Confirm Transfer</h2>
                      <p className="text-sm text-muted-foreground mb-5">Please review the details before sending</p>

                      {/* Recipient card */}
                      <div className="rounded-2xl border border-border bg-white/60 overflow-hidden mb-4">
                        <div className="px-5 py-4 border-b border-border/60">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sending to</p>
                          <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg shrink-0">
                              {(preview.name ?? preview.email).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              {preview.name && <p className="font-semibold text-foreground truncate">{preview.name}</p>}
                              <p className="text-sm text-muted-foreground truncate">{preview.email}</p>
                              {preview.registered ? (
                                <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 mt-1">
                                  <CheckCircle2 className="w-3 h-3" aria-hidden /> Verified Sweep user
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 mt-1">
                                  <AlertCircle className="w-3 h-3" aria-hidden /> Not yet on Sweep — funds held until they join
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="px-5 py-4 flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Amount</span>
                          <span className="text-2xl font-bold text-foreground tabular-nums">
                            ${parseFloat(pendingData.amount).toFixed(2)}{" "}
                            <span className="text-base font-medium text-muted-foreground">USD</span>
                          </span>
                        </div>
                      </div>

                      {/* Transaction password on confirm screen */}
                      {isLoggedIn && hasTransactionPassword && (
                        <div className="mb-4">
                          <label htmlFor="hero-tx-password-confirm" className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-2">
                            <Lock className="w-3.5 h-3.5 opacity-60" aria-hidden />
                            Transaction Password
                          </label>
                          <input
                            id="hero-tx-password-confirm"
                            type="password"
                            autoComplete="current-password"
                            value={txnPwd}
                            onChange={(e) => setTxnPwd(e.target.value)}
                            disabled={isSending}
                            placeholder="Enter your transaction password"
                            className="w-full px-4 py-3 rounded-xl bg-white border-2 border-border focus:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 transition-all disabled:opacity-60 text-sm"
                          />
                        </div>
                      )}

                      <AnimatePresence>
                        {formError && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                            className="flex items-start gap-3 px-4 py-3 mb-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive overflow-hidden"
                            role="alert"
                          >
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                            <span>{formError}</span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <motion.button
                        type="button"
                        onClick={onConfirm}
                        disabled={isSending}
                        whileHover={!isSending ? { scale: 1.02, y: -1 } : {}}
                        whileTap={!isSending ? { scale: 0.98 } : {}}
                        className="w-full relative group flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold text-white overflow-hidden bg-primary disabled:opacity-70 disabled:cursor-not-allowed transition-shadow hover:shadow-xl hover:shadow-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-primary to-accent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" aria-hidden />
                        <span className="relative z-10 flex items-center gap-2">
                          {isSending
                            ? <><Loader2 className="w-5 h-5 animate-spin" aria-hidden />Sending…</>
                            : <><ShieldCheck className="w-5 h-5" aria-hidden />Confirm &amp; Send <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" aria-hidden /></>}
                        </span>
                      </motion.button>
                    </motion.div>

                  ) : (
                    <motion.div key="form" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
                      <div className="flex items-center justify-between mb-5">
                        <h2 className="text-2xl font-bold font-display">Send Payment</h2>
                        {isLoggedIn ? (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 text-violet-700 rounded-full text-xs font-semibold border border-violet-200"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
                            No wallet needed
                          </motion.div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <motion.a href={`${BASE}/login`} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-foreground rounded-xl text-xs font-medium hover:bg-secondary/80 transition-colors">
                              <LogIn className="w-3.5 h-3.5" aria-hidden /> Sign In
                            </motion.a>
                            <motion.a href={`${BASE}/register`} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-xl text-xs font-medium hover:bg-primary/90 transition-colors">
                              <UserPlus className="w-3.5 h-3.5" aria-hidden /> Create Account
                            </motion.a>
                          </div>
                        )}
                      </div>

                      {!isLoggedIn && (
                        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                          className="flex items-start gap-3 px-4 py-3 mb-5 rounded-xl bg-primary/5 border border-primary/10 text-sm text-muted-foreground" role="note">
                          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-primary" aria-hidden />
                          <span>Sign in or create a free account to send USD without a crypto wallet.</span>
                        </motion.div>
                      )}

                      <AnimatePresence>
                        {formError && (
                          <motion.div
                            initial={{ opacity: 0, height: 0, y: -6 }} animate={{ opacity: 1, height: "auto", y: 0 }} exit={{ opacity: 0, height: 0 }}
                            className="flex items-start gap-3 px-4 py-3 mb-5 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive overflow-hidden"
                            role="alert"
                          >
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                            <span>{formError}</span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <motion.form
                        onSubmit={handleSubmit(onReview)}
                        variants={staggerContainer(0.08, 0.05)} initial="hidden" animate="show"
                        className="space-y-5"
                        noValidate
                      >
                        <motion.div variants={fadeUp}>
                          <label htmlFor="hero-recipient-email" className="block text-sm font-medium text-foreground mb-2">
                            Recipient Email
                          </label>
                          <input
                            id="hero-recipient-email"
                            {...register("recipientEmail")}
                            disabled={isLooking}
                            type="email"
                            name="recipientEmail"
                            autoComplete="email"
                            spellCheck={false}
                            placeholder="satoshi@example.com"
                            aria-invalid={!!errors.recipientEmail}
                            aria-describedby={errors.recipientEmail ? "hero-email-error" : undefined}
                            className={cn(
                              "w-full px-4 py-3 rounded-xl bg-white border-2 border-border focus:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 transition-all disabled:opacity-60",
                              errors.recipientEmail && "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/10",
                            )}
                          />
                          <AnimatePresence>
                            {errors.recipientEmail && (
                              <motion.p id="hero-email-error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 text-sm text-destructive">
                                {errors.recipientEmail.message}
                              </motion.p>
                            )}
                          </AnimatePresence>
                        </motion.div>

                        <motion.div variants={fadeUp}>
                          <label htmlFor="hero-amount" className="block text-sm font-medium text-foreground mb-2">
                            Amount (USD)
                          </label>
                          <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none" aria-hidden>
                              <span className="text-muted-foreground font-medium">$</span>
                            </div>
                            <input
                              id="hero-amount"
                              {...register("amount")}
                              disabled={isLooking}
                              type="number"
                              name="amount"
                              step="0.01"
                              min="0.01"
                              autoComplete="off"
                              placeholder="100.00"
                              aria-invalid={!!errors.amount}
                              aria-describedby={errors.amount ? "hero-amount-error" : undefined}
                              className={cn(
                                "w-full pl-8 pr-16 py-3 rounded-xl bg-white border-2 border-border focus:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 transition-all font-medium disabled:opacity-60",
                                errors.amount && "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/10",
                              )}
                            />
                            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none" aria-hidden>
                              <span className="text-muted-foreground font-medium text-sm">USD</span>
                            </div>
                          </div>
                          <AnimatePresence>
                            {errors.amount && (
                              <motion.p id="hero-amount-error" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 text-sm text-destructive">
                                {errors.amount.message}
                              </motion.p>
                            )}
                          </AnimatePresence>
                        </motion.div>

                        <motion.div variants={fadeUp}>
                          <motion.button
                            type="submit"
                            disabled={isLooking}
                            whileHover={!isLooking ? { scale: 1.02, y: -1 } : {}}
                            whileTap={!isLooking ? { scale: 0.98 } : {}}
                            className="w-full relative group flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold text-white overflow-hidden bg-primary disabled:opacity-70 disabled:cursor-not-allowed transition-shadow hover:shadow-xl hover:shadow-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-primary to-accent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" aria-hidden />
                            <span className="relative z-10 flex items-center gap-2">
                              {isLooking
                                ? <><Loader2 className="w-5 h-5 animate-spin" aria-hidden />Looking up recipient…</>
                                : isLoggedIn
                                  ? <>Review Transfer <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" aria-hidden /></>
                                  : <>Sign In to Send <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" aria-hidden /></>}
                            </span>
                          </motion.button>
                        </motion.div>
                      </motion.form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Scroll hint */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden lg:flex flex-col items-center gap-2 text-muted-foreground/50" aria-hidden>
        <span className="text-xs font-medium uppercase tracking-widest">Scroll</span>
        <motion.div animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
          className="w-5 h-8 rounded-full border-2 border-current flex items-start justify-center p-1.5">
          <div className="w-1 h-1.5 bg-current rounded-full" />
        </motion.div>
      </div>
    </section>
  );
}

// ── Stats section ─────────────────────────────────────────────────────────────

const STATS = [
  { prefix: "$", target: 48.3, suffix: "K+", decimals: 1, label: "Total Sent"       },
  { prefix: "",  target: 280,  suffix: "+",  decimals: 0, label: "Active Users"      },
  { prefix: "",  target: 99.9, suffix: "%",  decimals: 1, label: "Uptime"            },
  { prefix: "<", target: 1,    suffix: "s",  decimals: 0, label: "Settlement Time"   },
];

function StatsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px 0px" });

  return (
    <section aria-label="Platform statistics" className="border-y border-border bg-white">
      <div ref={ref} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-0 lg:divide-x divide-border">
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 16 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className="text-center lg:px-8 py-2"
            >
              <p className="text-3xl lg:text-4xl font-bold text-foreground font-display mb-1">
                {isInView && <AnimatedCounter target={stat.target} prefix={stat.prefix} suffix={stat.suffix} decimals={stat.decimals} />}
              </p>
              <p className="text-sm text-muted-foreground font-medium">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Features section ──────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <Send className="w-6 h-6" />,
    color: "text-blue-600 bg-blue-50 border-blue-100",
    title: "Instant USDC Transfers",
    desc: "Send USD stablecoins to any email address in seconds. No wallet address, no gas fees for the sender.",
  },
  {
    icon: <Wallet className="w-6 h-6" />,
    color: "text-violet-600 bg-violet-50 border-violet-100",
    title: "No Wallet Required",
    desc: "Recipients claim funds with just their email — no seed phrases, no exchange accounts, no setup friction.",
  },
  {
    icon: <ShieldCheck className="w-6 h-6" />,
    color: "text-green-600 bg-green-50 border-green-100",
    title: "Smart Contract Escrow",
    desc: "Every transfer is locked on-chain. Funds can only be released to the verified recipient — no middlemen.",
  },
  {
    icon: <RefreshCw className="w-6 h-6" />,
    color: "text-cyan-600 bg-cyan-50 border-cyan-100",
    title: "Recurring Subscriptions",
    desc: "Create billing plans for your services. Customers subscribe once and are charged automatically.",
  },
  {
    icon: <Layers className="w-6 h-6" />,
    color: "text-primary bg-primary/5 border-primary/15",
    title: "Circle-Powered Infrastructure",
    desc: "Built on Circle's enterprise-grade developer-controlled wallets — the same infrastructure trusted by Coinbase.",
  },
];

function FeaturesSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px 0px" });

  return (
    <section id="features" aria-labelledby="features-heading" className="bg-slate-50/80 py-20 lg:py-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <motion.p
            initial={{ opacity: 0, y: 12 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5 }}
            className="text-sm font-bold uppercase tracking-widest text-primary mb-3"
          >
            Everything You Need
          </motion.p>
          <motion.h2
            id="features-heading"
            initial={{ opacity: 0, y: 16 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay: 0.08 }}
            className="text-3xl lg:text-4xl font-bold text-foreground text-balance mb-4"
          >
            Move Money Across Borders — Without the Friction
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay: 0.16 }}
            className="text-muted-foreground text-lg text-balance"
          >
            One platform for sending, receiving, and managing USDC payments globally.
          </motion.p>
        </div>

        <div ref={ref} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 24 }} animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.5 }}
              whileHover={{ y: -4, transition: { type: "spring", stiffness: 400, damping: 20 } }}
              className="group p-6 rounded-2xl bg-white border border-border shadow-sm hover:shadow-md hover:border-primary/20 transition-all"
            >
              <div className={cn("w-12 h-12 rounded-xl border flex items-center justify-center mb-4 transition-transform group-hover:scale-110", f.color)}>
                {f.icon}
              </div>
              <h3 className="text-base font-bold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── How It Works section ──────────────────────────────────────────────────────

const STEPS = [
  {
    step: "01",
    icon: <UserPlus className="w-7 h-7" aria-hidden />,
    title: "Create Your Account",
    desc: "Sign up with your email in under 60 seconds. Set a transaction password for extra security — no crypto knowledge needed.",
    cta: { label: "Create free account", href: "/register" },
  },
  {
    step: "02",
    icon: <Send className="w-7 h-7" aria-hidden />,
    title: "Send by Email",
    desc: "Enter the recipient's email and amount. Your USDC is locked in a smart contract escrow immediately — off your balance in seconds.",
    cta: null,
  },
  {
    step: "03",
    icon: <CheckCircle2 className="w-7 h-7" aria-hidden />,
    title: "Recipient Claims",
    desc: "The recipient gets a notification, signs up, and verifies their email. Funds are released to their balance automatically.",
    cta: null,
  },
];

function HowItWorksSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px 0px" });

  return (
    <section id="how-it-works" aria-labelledby="hiw-heading" className="bg-white py-20 lg:py-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <motion.p
            initial={{ opacity: 0, y: 12 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5 }}
            className="text-sm font-bold uppercase tracking-widest text-primary mb-3"
          >
            Simple by Design
          </motion.p>
          <motion.h2
            id="hiw-heading"
            initial={{ opacity: 0, y: 16 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay: 0.08 }}
            className="text-3xl lg:text-4xl font-bold text-foreground text-balance"
          >
            Send Your First Payment in 3 Steps
          </motion.h2>
        </div>

        <div ref={ref} className="relative">
          {/* Connecting line on desktop */}
          <div className="absolute top-[3.25rem] left-[calc(50%/3+3.25rem)] right-[calc(50%/3+3.25rem)] h-px bg-gradient-to-r from-primary/20 via-primary/50 to-primary/20 hidden lg:block" aria-hidden />

          <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0, y: 28 }} animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.15 + i * 0.15, duration: 0.55 }}
                className="flex flex-col items-center text-center lg:items-start lg:text-left"
              >
                <div className="relative mb-6">
                  <div className="w-[6.5rem] h-[6.5rem] rounded-2xl bg-primary/5 border border-primary/15 flex items-center justify-center text-primary shadow-sm">
                    {s.icon}
                  </div>
                  <span className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center shadow-md shadow-primary/30" aria-label={`Step ${s.step}`}>
                    {s.step}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3">{s.title}</h3>
                <p className="text-muted-foreground leading-relaxed text-balance mb-4">{s.desc}</p>
                {s.cta && (
                  <Link
                    href={`${BASE}${s.cta.href}`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                  >
                    {s.cta.label} <ArrowRight className="w-4 h-4" aria-hidden />
                  </Link>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Use Cases section ─────────────────────────────────────────────────────────

const USE_CASES = [
  {
    icon: <Users className="w-8 h-8" aria-hidden />,
    color: "from-violet-500 to-indigo-600",
    audience: "Freelancers & Remote Workers",
    headline: "Get Paid in USDC — Anywhere on Earth",
    points: [
      "Share your email instead of a wallet address",
      "Receive payments from global clients instantly",
      "No exchange accounts or conversion fees",
      "Withdraw to bank or hold as USDC",
    ],
  },
  {
    icon: <CreditCard className="w-8 h-8" aria-hidden />,
    color: "from-blue-500 to-cyan-500",
    audience: "Merchants & Creators",
    headline: "Automate Billing With Subscription Plans",
    points: [
      "Create weekly, monthly, or yearly billing plans",
      "Customers activate with a one-click confirmation code",
      "Automatic recurring charges with email receipts",
      "Real-time dashboard of active subscribers",
    ],
  },
  {
    icon: <Globe className="w-8 h-8" aria-hidden />,
    color: "from-teal-500 to-emerald-600",
    audience: "Businesses & Teams",
    headline: "Cross-Border Payroll Without the Complexity",
    points: [
      "Send to multiple recipients by email",
      "On-chain records for full auditability",
      "No correspondent banks or SWIFT delays",
      "Escrow protection on every transfer",
    ],
  },
];

function UseCasesSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px 0px" });

  return (
    <section id="use-cases" aria-labelledby="uc-heading" className="bg-slate-50/80 py-20 lg:py-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <motion.p
            initial={{ opacity: 0, y: 12 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5 }}
            className="text-sm font-bold uppercase tracking-widest text-primary mb-3"
          >
            Built for Everyone
          </motion.p>
          <motion.h2
            id="uc-heading"
            initial={{ opacity: 0, y: 16 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay: 0.08 }}
            className="text-3xl lg:text-4xl font-bold text-foreground text-balance"
          >
            Who Uses Sweep?
          </motion.h2>
        </div>

        <div ref={ref} className="grid lg:grid-cols-3 gap-6">
          {USE_CASES.map((uc, i) => (
            <motion.div
              key={uc.audience}
              initial={{ opacity: 0, y: 28 }} animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.1 + i * 0.12, duration: 0.55 }}
              className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-1 transition-all group"
            >
              <div className={cn("h-2 bg-gradient-to-r", uc.color)} aria-hidden />
              <div className="p-6">
                <div className={cn("w-14 h-14 rounded-2xl bg-gradient-to-br text-white flex items-center justify-center mb-4 shadow-lg group-hover:scale-105 transition-transform", uc.color)}>
                  {uc.icon}
                </div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{uc.audience}</p>
                <h3 className="text-xl font-bold text-foreground mb-4 text-balance leading-snug">{uc.headline}</h3>
                <ul className="space-y-2.5" role="list">
                  {uc.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2.5 text-sm text-muted-foreground" role="listitem">
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" aria-hidden />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Trust section ─────────────────────────────────────────────────────────────

const TRUST_POINTS = [
  {
    icon: <Layers className="w-6 h-6" aria-hidden />,
    title: "Circle-Verified Infrastructure",
    desc: "Wallets are powered by Circle's developer-controlled wallet API — the same stack used by Coinbase and Binance.US.",
  },
  {
    icon: <ShieldCheck className="w-6 h-6" aria-hidden />,
    title: "On-Chain Auditability",
    desc: "Every transfer creates an immutable on-chain record. Anyone can verify transactions on the ARC testnet explorer.",
  },
  {
    icon: <Lock className="w-6 h-6" aria-hidden />,
    title: "Email-Hash Privacy",
    desc: "Recipient emails are stored as cryptographic hashes on-chain — never exposed in plaintext. Privacy-first architecture.",
  },
  {
    icon: <BadgeCheck className="w-6 h-6" aria-hidden />,
    title: "Non-Custodial by Default",
    desc: "Your private keys are never held by us. Developer-controlled wallets mean you own your funds at all times.",
  },
];

function TrustSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px 0px" });

  return (
    <section aria-labelledby="trust-heading" className="bg-slate-900 py-20 lg:py-28">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <motion.p
            initial={{ opacity: 0, y: 12 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5 }}
            className="text-sm font-bold uppercase tracking-widest text-primary/80 mb-3"
          >
            Security First
          </motion.p>
          <motion.h2
            id="trust-heading"
            initial={{ opacity: 0, y: 16 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay: 0.08 }}
            className="text-3xl lg:text-4xl font-bold text-white text-balance"
          >
            Built on Enterprise-Grade Security
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }} animate={isInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay: 0.16 }}
            className="text-slate-400 text-lg mt-4 text-balance"
          >
            Your funds are protected by the same standards used by the world's largest financial institutions.
          </motion.p>
        </div>

        <div ref={ref} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {TRUST_POINTS.map((tp, i) => (
            <motion.div
              key={tp.title}
              initial={{ opacity: 0, y: 24 }} animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.1 + i * 0.09, duration: 0.5 }}
              className="p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/20 text-primary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                {tp.icon}
              </div>
              <h3 className="text-sm font-bold text-white mb-2">{tp.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{tp.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── CTA banner ────────────────────────────────────────────────────────────────

function CTABanner({ isLoggedIn }: { isLoggedIn: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px 0px" });

  return (
    <section aria-labelledby="cta-heading" className="bg-white py-20 lg:py-28">
      <div ref={ref} className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }} animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.6 }}
          className="rounded-3xl bg-gradient-to-br from-primary via-blue-600 to-accent p-10 lg:p-16 relative overflow-hidden shadow-2xl shadow-primary/25"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(255,255,255,0.15)_0%,transparent_60%)]" aria-hidden />
          <div className="relative">
            <motion.h2
              id="cta-heading"
              initial={{ opacity: 0, y: 16 }} animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="text-3xl lg:text-4xl xl:text-5xl font-bold text-white text-balance mb-4"
            >
              Start Sending in Minutes
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }} animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.25, duration: 0.5 }}
              className="text-white/80 text-lg text-balance mb-8 max-w-xl mx-auto"
            >
              Join thousands of users sending USDC globally — no wallet, no complexity, no barriers.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.35, duration: 0.5 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              {isLoggedIn ? (
                <Link href={`${BASE}/dashboard`}
                  className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-white text-primary font-bold text-sm hover:bg-white/90 hover:shadow-lg hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                  Go to Dashboard <ArrowRight className="w-5 h-5" aria-hidden />
                </Link>
              ) : (
                <>
                  <Link href={`${BASE}/register`}
                    className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-white text-primary font-bold text-sm hover:bg-white/90 hover:shadow-lg hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                    Create Free Account <ArrowRight className="w-5 h-5" aria-hidden />
                  </Link>
                  <Link href={`${BASE}/login`}
                    className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-white/10 text-white font-semibold text-sm border border-white/20 hover:bg-white/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
                    Sign In
                  </Link>
                </>
              )}
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }} animate={isInView ? { opacity: 1 } : {}}
              transition={{ delay: 0.5, duration: 0.5 }}
              className="text-white/50 text-xs mt-6"
            >
              Free to join · No credit card required · Cancel subscriptions any time
            </motion.p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function LandingFooter() {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <footer className="bg-slate-900 border-t border-white/10" role="contentinfo">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-8 lg:gap-12">

          {/* Brand */}
          <div className="col-span-2 lg:col-span-1">
            <Link href={`${BASE}/landing`} className="inline-block mb-4" aria-label="Sweep home">
              <img src="/Sweep_logo_exact.svg" alt="Sweep" className="h-14 w-auto object-contain brightness-[4] saturate-0" />
            </Link>
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs text-balance">
              Send and receive USDC globally using just an email address. Powered by Circle's
              developer-controlled wallet infrastructure.
            </p>
          </div>

          {/* Product */}
          <nav aria-label="Product links">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Product</p>
            <ul className="space-y-2.5" role="list">
              {[
                { label: "Sweep",            action: () => scrollTo("features")     },
                { label: "Subscriptions",   action: () => scrollTo("use-cases")    },
                { label: "How It Works",    action: () => scrollTo("how-it-works") },
                { label: "Security",        action: () => document.getElementById("trust-heading")?.scrollIntoView({ behavior: "smooth" }) },
              ].map((l) => (
                <li key={l.label} role="listitem">
                  <button
                    onClick={l.action}
                    className="text-sm text-slate-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:underline"
                  >
                    {l.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Account */}
          <nav aria-label="Account links">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Account</p>
            <ul className="space-y-2.5" role="list">
              {[
                { label: "Sign Up",    href: `${BASE}/register`  },
                { label: "Log In",     href: `${BASE}/login`     },
                { label: "Dashboard",  href: `${BASE}/dashboard` },
              ].map((l) => (
                <li key={l.label} role="listitem">
                  <Link href={l.href} className="text-sm text-slate-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Legal */}
          <nav aria-label="Legal links">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Legal</p>
            <ul className="space-y-2.5" role="list">
              {["Privacy Policy", "Terms of Service", "Cookie Policy"].map((l) => (
                <li key={l} role="listitem">
                  <span className="text-sm text-slate-500 cursor-default">{l}</span>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} <span translate="no">Sweep</span>. All rights reserved.
          </p>
          <p className="text-xs text-slate-500">
            Powered by <span translate="no">Circle</span> Developer-Controlled Wallets
          </p>
        </div>
      </div>
    </footer>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

type LandingRecipientPreview = { registered: boolean; name: string | null; email: string };

export default function Landing() {
  const [isLoggedIn,            setIsLoggedIn]            = useState(false);
  const [hasTransactionPassword, setHasTransactionPassword] = useState(false);
  const [txnPwd,                setTxnPwd]                = useState("");
  const [isSending,             setIsSending]             = useState(false);
  const [isLooking,             setIsLooking]             = useState(false);
  const [formError,             setFormError]             = useState<string | null>(null);
  const [successEmail,          setSuccessEmail]          = useState("");
  const [successAmount,         setSuccessAmount]         = useState("");
  const [successName,           setSuccessName]           = useState("");
  const [didSucceed,            setDidSucceed]            = useState(false);
  const [preview,               setPreview]               = useState<LandingRecipientPreview | null>(null);
  const [pendingData,           setPendingData]           = useState<SendFormValues | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    setIsLoggedIn(!!token);
    if (token) {
      fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((u) => { if (u?.hasTransactionPassword) setHasTransactionPassword(true); })
        .catch(() => {});
    }
  }, []);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<SendFormValues>({
    resolver: zodResolver(sendSchema),
  });

  // Step 1 — redirect to login if not logged in; otherwise look up recipient
  const onReview = async (data: SendFormValues) => {
    if (!isLoggedIn) {
      window.location.href = `${BASE}/login`;
      return;
    }
    setFormError(null);
    setIsLooking(true);
    try {
      const jwt = localStorage.getItem("token");
      const headers: Record<string, string> = {};
      if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
      const email = data.recipientEmail.toLowerCase().trim();
      const res = await fetch(`${API_BASE}/api/escrow/lookup-recipient?email=${encodeURIComponent(email)}`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Could not look up recipient");
      setPendingData(data);
      setPreview(json as LandingRecipientPreview);
    } catch (err: any) {
      setFormError(err?.message ?? "Could not look up recipient. Please try again.");
    } finally {
      setIsLooking(false);
    }
  };

  // Step 2 — confirmed; execute the transfer
  const onConfirm = async () => {
    if (!pendingData || !preview) return;
    setFormError(null);
    setIsSending(true);
    try {
      const jwt = localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
      const payload: Record<string, string> = {
        recipientEmail: pendingData.recipientEmail.toLowerCase().trim(),
        amount: pendingData.amount,
      };
      if (hasTransactionPassword && txnPwd) payload["transactionPassword"] = txnPwd;
      const res = await fetch(`${API_BASE}/api/escrow/send/platform`, {
        method: "POST", headers, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to send payment");
      setSuccessEmail(pendingData.recipientEmail.toLowerCase().trim());
      setSuccessAmount(pendingData.amount);
      setSuccessName(preview.name ?? "");
      setTxnPwd("");
      setPreview(null);
      setPendingData(null);
      setDidSucceed(true);
    } catch (err: any) {
      setFormError(err?.message ?? "Failed to send. Please try again.");
      setPreview(null);
    } finally {
      setIsSending(false);
    }
  };

  const handleSendAnother = () => {
    setDidSucceed(false);
    setFormError(null);
    setSuccessEmail("");
    setSuccessAmount("");
    setSuccessName("");
    setPreview(null);
    setPendingData(null);
    reset();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background" lang="en">
      <LandingNav />

      <main id="main-content" className="flex-1">
        <HeroSection
          isLoggedIn={isLoggedIn}
          hasTransactionPassword={hasTransactionPassword}
          txnPwd={txnPwd}
          setTxnPwd={setTxnPwd}
          isSending={isSending}
          isLooking={isLooking}
          formError={formError}
          didSucceed={didSucceed}
          successEmail={successEmail}
          successAmount={successAmount}
          successName={successName}
          preview={preview}
          pendingData={pendingData}
          setPreview={setPreview}
          setFormError={setFormError}
          handleSubmit={handleSubmit}
          onReview={onReview}
          onConfirm={onConfirm}
          register={register}
          errors={errors}
          handleSendAnother={handleSendAnother}
        />
        <StatsSection />
        <FeaturesSection />
        <HowItWorksSection />
        <UseCasesSection />
        <TrustSection />
        <CTABanner isLoggedIn={isLoggedIn} />
      </main>

      <LandingFooter />
    </div>
  );
}