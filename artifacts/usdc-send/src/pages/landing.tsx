import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { ArrowRight, CheckCircle2, Menu, X } from "lucide-react";
import { useGetCurrentUser, useGetUserBalance } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { WITHDRAWAL_CHAINS } from "@/lib/wallet";
import { fmtUsd } from "@/components/sweep/ui";
import { LandingSend, type LandingSender } from "@/components/landing/landing-send";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

// ── Small building blocks ─────────────────────────────────────────────────────

/** Fades content up the first time it scrolls into view. */
function Reveal({ children, className, delay = 0, id }: { children: ReactNode; className?: string; delay?: number; id?: string }) {
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px 0px" }}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Small pill that names a page section ("PRODUCT", "WHO IT'S FOR"). */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="self-start text-[11px] font-extrabold tracking-[0.08em] text-(--sw-blue) bg-(--sw-tint) border border-(--sw-tint-line) px-3 py-1.5 rounded-full">
      {children}
    </span>
  );
}

function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-xs font-bold tracking-[0.06em] text-(--sw-blue)", className)}>{children}</span>;
}

function AnimatedCounter({ target, prefix = "", suffix = "", decimals = 0 }: {
  target: number; prefix?: string; suffix?: string; decimals?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setCount(target); return; }
    const steps = 50;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setCount((1 - Math.pow(1 - step / steps, 3)) * target);
      if (step >= steps) clearInterval(timer);
    }, 1800 / steps);
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

// ── Nav ───────────────────────────────────────────────────────────────────────
// Transparent over the navy hero; turns frosted white with ink text once the page scrolls.

const NAV_LINKS = [
  { label: "Product",   id: "product"   },
  { label: "Use cases", id: "use-cases" },
  { label: "Networks",  id: "networks"  },
  { label: "Security",  id: "security"  },
  { label: "FAQ",       id: "faq"       },
];

function LandingNav({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (id: string) => { scrollToId(id); setMenuOpen(false); };
  const light = scrolled; // light bar, dark text

  return (
    <header className={cn(
      "fixed top-0 inset-x-0 z-50 transition-[background-color,box-shadow,border-color] duration-300 border-b",
      light
        ? "bg-white/90 backdrop-blur-md border-(--sw-line) shadow-[0_8px_30px_-18px_rgba(11,18,32,.35)]"
        : menuOpen ? "bg-(--sw-navy) border-white/10" : "bg-transparent border-transparent",
    )}>
      <a href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:left-4 focus-visible:z-50 focus-visible:px-4 focus-visible:py-2 focus-visible:bg-white focus-visible:text-(--sw-blue) focus-visible:rounded-lg focus-visible:text-sm focus-visible:font-bold">
        Skip to main content
      </a>

      <nav aria-label="Main navigation" className="max-w-[1240px] mx-auto px-5 sm:px-7">
        <div className="flex items-center gap-8 h-[72px]">
          <Link href={`${BASE}/landing`} className="flex items-center gap-2.5 shrink-0" aria-label="Sweep home">
            <img src={light ? "/sweep-mark-blue.svg" : "/sweep-mark-white.svg"} alt="" className="w-[22px]" />
            <span className={cn("font-extrabold text-xl tracking-[-0.02em] transition-colors", light ? "text-(--sw-ink)" : "text-white")}>Sweep</span>
          </Link>

          <div className="hidden lg:flex items-center gap-1 flex-1">
            {NAV_LINKS.map((l) => (
              <button key={l.id} type="button" onClick={() => go(l.id)}
                className={cn("px-3 py-2 rounded-lg text-sm font-semibold transition-colors",
                  light ? "text-(--sw-label) hover:text-(--sw-ink) hover:bg-(--sw-bg)" : "text-(--sw-on-navy) hover:text-white")}>
                {l.label}
              </button>
            ))}
            <Link href={`${BASE}/docs`}
              className={cn("px-3 py-2 rounded-lg text-sm font-semibold transition-colors",
                light ? "text-(--sw-label) hover:text-(--sw-ink) hover:bg-(--sw-bg)" : "text-(--sw-on-navy) hover:text-white")}>
              Docs
            </Link>
          </div>

          <div className="hidden lg:flex items-center gap-2.5">
            {isLoggedIn ? (
              <Link href={`${BASE}/dashboard`}
                className={cn("h-[42px] px-[18px] rounded-xl flex items-center gap-1.5 text-sm font-bold transition-colors",
                  light ? "bg-(--sw-blue) text-white hover:bg-(--sw-blue-hover)" : "bg-white text-(--sw-navy) hover:bg-[#e0e5ff]")}>
                Dashboard <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
            ) : (
              <>
                <Link href={`${BASE}/login`}
                  className={cn("h-[42px] px-[18px] rounded-xl flex items-center text-sm font-bold transition-colors",
                    light ? "text-(--sw-ink) hover:bg-(--sw-bg)" : "text-white hover:bg-white/10")}>
                  Log in
                </Link>
                <Link href={`${BASE}/register`}
                  className={cn("h-[42px] px-[18px] rounded-xl flex items-center text-sm font-bold transition-colors",
                    light ? "bg-(--sw-blue) text-white hover:bg-(--sw-blue-hover)" : "bg-white text-(--sw-navy) hover:bg-[#e0e5ff]")}>
                  Open account
                </Link>
              </>
            )}
          </div>

          <button type="button" onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={menuOpen} aria-controls="mobile-nav"
            className={cn("lg:hidden ml-auto p-2 rounded-xl transition-colors",
              light ? "text-(--sw-ink) hover:bg-(--sw-bg)" : "text-white hover:bg-white/10")}>
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.div id="mobile-nav"
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={cn("lg:hidden overflow-hidden border-t", light ? "border-(--sw-line)" : "border-white/10")}>
              <div className="py-3 flex flex-col gap-1">
                {NAV_LINKS.map((l) => (
                  <button key={l.id} type="button" onClick={() => go(l.id)}
                    className={cn("text-left px-3 py-2.5 rounded-xl text-sm font-semibold",
                      light ? "text-(--sw-label) hover:bg-(--sw-bg)" : "text-(--sw-on-navy) hover:bg-white/10 hover:text-white")}>
                    {l.label}
                  </button>
                ))}
                <Link href={`${BASE}/docs`}
                  className={cn("px-3 py-2.5 rounded-xl text-sm font-semibold",
                    light ? "text-(--sw-label) hover:bg-(--sw-bg)" : "text-(--sw-on-navy) hover:bg-white/10 hover:text-white")}>
                  Docs
                </Link>
                <div className="pt-2 grid grid-cols-2 gap-2">
                  {isLoggedIn ? (
                    <Link href={`${BASE}/dashboard`} className="col-span-2 h-11 rounded-xl grid place-items-center text-sm font-bold bg-(--sw-blue) text-white">
                      Dashboard
                    </Link>
                  ) : (
                    <>
                      <Link href={`${BASE}/login`}
                        className={cn("h-11 rounded-xl grid place-items-center text-sm font-bold border",
                          light ? "border-(--sw-line) text-(--sw-ink)" : "border-white/25 text-white")}>
                        Log in
                      </Link>
                      <Link href={`${BASE}/register`} className="h-11 rounded-xl grid place-items-center text-sm font-bold bg-(--sw-blue) text-white">
                        Open account
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

// ── Hero ──────────────────────────────────────────────────────────────────────

const STATS = [
  { prefix: "$", target: 23.8, suffix: "K+", decimals: 1, label: "Volume transacted" },
  { prefix: "",  target: 150,  suffix: "+",  decimals: 0, label: "Signed-up users"   },
  { prefix: "",  target: 99.9, suffix: "%",  decimals: 1, label: "Uptime"            },
  { prefix: "<", target: 1,    suffix: "s",  decimals: 0, label: "Settlement time"   },
];

const PHONE_TXS = [
  { mono: "T",   av: "bg-(--sw-blue) text-white",         fs: "text-[11px]", title: "Tunde Bello",  sub: "Email · Today",     amount: "−$25.00",  in: false },
  { mono: "IN",  av: "bg-[#ecfdf3] text-[#067647]",       fs: "text-[8px]",  title: "Deposit",      sub: "Base · Yesterday",  amount: "+$200.00", in: true  },
  { mono: "ARB", av: "bg-(--sw-tint) text-(--sw-blue)",   fs: "text-[7px]",  title: "0x91a4…7c2e",  sub: "Arbitrum · Sep 18", amount: "−$40.00",  in: false },
  { mono: "K",   av: "bg-[#dfe4ff] text-(--sw-blue)",     fs: "text-[11px]", title: "Kemi Adeyemi", sub: "Email · Sep 15",    amount: "+$60.00",  in: true  },
];

function Hero({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");

  const getStarted = () => {
    const q = email.trim() ? `?email=${encodeURIComponent(email.trim())}` : "";
    setLocation(`${BASE}/register${q}`);
  };

  return (
    <section aria-label="Hero" className="relative bg-(--sw-navy) text-white overflow-hidden">
      <div aria-hidden className="absolute inset-0 pointer-events-none [background-image:linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.045)_1px,transparent_1px)] [background-size:56px_56px]" />
      <div aria-hidden className="absolute left-1/2 -top-60 w-[1100px] h-[700px] -translate-x-[30%] pointer-events-none bg-[radial-gradient(closest-side,rgba(17,40,245,.55),transparent)]" />

      <div className="relative max-w-[1240px] mx-auto px-5 sm:px-7 pt-[128px] grid lg:grid-cols-2 gap-10 items-end">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
          className="flex flex-col gap-6 pb-16 lg:pb-24">
          <button type="button" onClick={() => scrollToId("security")}
            className="self-start flex items-center gap-2.5 text-[13px] font-semibold text-(--sw-on-navy) pl-1.5 pr-3.5 py-1.5 rounded-full border border-white/15 bg-white/[.04] hover:bg-white/[.08]">
            <span className="text-[11px] font-extrabold tracking-[0.04em] text-(--sw-navy) bg-(--sw-sky) px-[9px] py-1 rounded-full">TESTNET</span>
            USDC by Circle · gas sponsored
          </button>
          <h1 className="font-extrabold text-[clamp(44px,6.4vw,88px)] leading-[.98] tracking-[-0.05em] text-balance">
            Money that moves like email.
          </h1>
          <p className="text-lg sm:text-[19px] leading-relaxed text-(--sw-on-navy) max-w-[500px] text-pretty">
            Send dollars to anyone's email, withdraw USDC to eight networks, and run recurring payments — from one balance, with zero gas. No wallet required.
          </p>

          {isLoggedIn ? (
            <div className="flex flex-wrap gap-2.5">
              <Link href={`${BASE}/dashboard`}
                className="h-14 px-6 rounded-2xl bg-white text-(--sw-navy) font-bold flex items-center gap-2 hover:bg-[#e0e5ff]">
                Go to dashboard <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
              <button type="button" onClick={() => scrollToId("send")}
                className="h-14 px-6 rounded-2xl border border-white/30 font-bold hover:bg-white/10">
                Send money
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); getStarted(); }} className="flex items-center bg-white rounded-2xl p-1.5 gap-1.5 w-full max-w-[440px]">
              <label htmlFor="hero-email" className="sr-only">Your email</label>
              <input id="hero-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email"
                autoComplete="email" className="flex-1 min-w-0 px-3 h-[46px] text-[15px] font-medium text-(--sw-ink) bg-transparent outline-none placeholder:text-[#9aa4b5]" />
              <button type="submit" className="h-[46px] px-5 rounded-xl bg-(--sw-blue) text-white text-[15px] font-bold whitespace-nowrap hover:bg-(--sw-blue-hover)">
                Get started
              </button>
            </form>
          )}
          <span className="text-[13px] text-(--sw-faint) -mt-2">Free to open · Your email becomes your payment ID</span>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 pt-4 border-t border-white/10 max-w-[560px]">
            {STATS.map((s) => (
              <div key={s.label} className="flex flex-col-reverse gap-0.5">
                <dt className="text-xs text-(--sw-faint)">{s.label}</dt>
                <dd className="font-extrabold text-2xl tracking-[-0.03em]">
                  <AnimatedCounter target={s.target} prefix={s.prefix} suffix={s.suffix} decimals={s.decimals} />
                </dd>
              </div>
            ))}
          </dl>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
          className="relative flex justify-center min-h-[520px] sm:min-h-[560px]" aria-hidden>
          <div className="w-[300px] h-[600px] rounded-[48px] bg-(--sw-ink) border-8 border-[#1c2336] shadow-[0_60px_120px_-40px_rgba(17,40,245,.6)] overflow-hidden flex flex-col -mb-[60px] relative z-[1]">
            <div className="bg-(--sw-bg) flex-1 flex flex-col px-3 py-3.5 gap-2.5 text-(--sw-ink)">
              <div className="flex justify-between items-center px-1.5 pt-1"><span className="text-[11px] font-bold">9:41</span><span className="w-[74px] h-5 bg-(--sw-ink) rounded-xl" /><span className="text-[10px] font-bold">5G</span></div>
              <div className="px-1.5"><div className="text-[10px] text-(--sw-muted)">Good morning</div><div className="font-extrabold text-sm">Ada Okafor</div></div>
              <div className="bg-(--sw-blue) text-white rounded-[18px] p-4">
                <div className="text-[10px] opacity-80">Total balance · USD</div>
                <div className="font-extrabold text-[30px] tracking-[-0.045em] mt-0.5 mb-3">$248.50</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <span className="h-8 rounded-[10px] bg-white text-(--sw-blue) text-[11px] font-bold grid place-items-center">Sweep</span>
                  <span className="h-8 rounded-[10px] border border-white/35 text-[11px] font-bold grid place-items-center">Add money</span>
                </div>
              </div>
              <div className="bg-white border border-(--sw-line) rounded-xl px-3 py-2 flex justify-between text-[10px]"><span className="text-(--sw-muted) font-semibold">Payment ID</span><span className="font-bold">ada@example.com</span></div>
              <div className="bg-white border border-(--sw-line) rounded-2xl py-1.5">
                {PHONE_TXS.map((t) => (
                  <div key={t.title} className="grid grid-cols-[30px_1fr_auto] gap-2 items-center px-3 py-[7px]">
                    <span className={cn("w-[30px] h-[30px] rounded-full grid place-items-center font-extrabold", t.av, t.fs)}>{t.mono}</span>
                    <span className="flex flex-col min-w-0"><span className="font-bold text-[11px] truncate">{t.title}</span><span className="text-[9px] text-(--sw-muted)">{t.sub}</span></span>
                    <span className={cn("font-bold text-[11px] whitespace-nowrap", t.in ? "text-[#067647]" : "text-(--sw-ink)")}>{t.amount}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="hidden sm:flex absolute right-0 xl:-right-3 -top-9 z-[2] bg-white text-(--sw-ink) rounded-[18px] px-4 py-3.5 items-center gap-3 shadow-[0_20px_50px_-20px_rgba(0,0,0,.5)] w-60">
            <span className="w-10 h-10 rounded-xl bg-(--sw-blue) grid place-items-center shrink-0"><img src="/sweep-mark-white.svg" alt="" className="w-[15px]" /></span>
            <span className="flex flex-col min-w-0"><span className="font-extrabold text-[15px]">Swept. $25.00</span><span className="text-xs text-(--sw-muted) truncate">to tunde@example.com · now</span></span>
          </div>
          <div className="hidden sm:flex absolute left-0 xl:-left-3 bottom-1.5 z-[2] bg-(--sw-navy-chip) border border-(--sw-navy-chip-line) rounded-[18px] px-4 py-3.5 flex-col gap-2 w-[210px] shadow-[0_20px_50px_-20px_rgba(0,0,0,.6)]">
            <span className="text-[11px] font-bold tracking-[0.05em] text-(--sw-faint)">WITHDRAW TO</span>
            <div className="flex flex-wrap gap-[5px]">
              <span className="text-[11px] font-bold px-[9px] py-1 rounded-full bg-(--sw-blue)">Base</span>
              <span className="text-[11px] font-bold px-[9px] py-1 rounded-full border border-[#334064]">Arc</span>
              <span className="text-[11px] font-bold px-[9px] py-1 rounded-full border border-[#334064]">Solana</span>
              <span className="text-[11px] font-bold px-[9px] py-1 rounded-full border border-[#334064]">+5</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ── Promise strip ─────────────────────────────────────────────────────────────

const PROMISES = [
  { t: "Free email transfers", d: "No fee, gas sponsored" },
  { t: "Instant delivery",     d: "Lands in their balance" },
  { t: "8 networks",           d: "Withdraw on-chain" },
  { t: "Backed 1:1 by USDC",   d: "Issued by Circle" },
];

function PromiseStrip() {
  return (
    <div className="bg-white border-b border-(--sw-line) relative">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-7 pt-9 pb-7 grid grid-cols-2 lg:grid-cols-4 gap-5">
        {PROMISES.map((p) => (
          <div key={p.t} className="flex flex-col gap-0.5 border-l-2 border-(--sw-blue) pl-3.5">
            <span className="font-extrabold text-[17px] tracking-[-0.01em]">{p.t}</span>
            <span className="text-sm text-(--sw-muted)">{p.d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Product ───────────────────────────────────────────────────────────────────

const STEPS = [
  { title: "Create your account", desc: "Sign up with your email in under a minute and set a transaction password. No crypto knowledge needed." },
  { title: "Send by email",       desc: "Enter their email and an amount. It comes off your balance in seconds — free, gas sponsored." },
  { title: "They receive it",     desc: "On Sweep already? It lands instantly. Not yet? It's held for them and credited the moment they sign up." },
];

const RECURRING_SAMPLE = [
  ["mum@example.com",   "$50.00",  "Monthly · next Oct 1"],
  ["rent@landlord.co",  "$120.00", "Weekly · next Sep 29"],
  ["payroll@studio.co", "$400.00", "Monthly · next Oct 5"],
];

const RECEIVED_SAMPLE = [
  ["Jide Musa",   "Coaching — monthly", "+$25.00"],
  ["Ife Ola",     "Design pass",        "+$12.00"],
  ["0x7c1e…a930", "Weekly check-in",    "+$8.00"],
];

function ProductSection({ isLoggedIn, sender, onSent }: { isLoggedIn: boolean; sender: LandingSender | null; onSent: () => void }) {
  const card = "rounded-[28px] p-7 sm:p-9 lg:p-10 flex flex-col gap-6";
  return (
    <section id="product" aria-labelledby="product-heading" className="bg-white border-b border-(--sw-line) scroll-mt-16">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-7 pt-24 pb-28">
        <Reveal className="flex flex-wrap items-end gap-x-10 gap-y-5 mb-14">
          <div className="flex-1 min-w-[300px] flex flex-col gap-5">
            <SectionLabel>PRODUCT</SectionLabel>
            <h2 id="product-heading" className="font-extrabold text-[clamp(34px,4.4vw,56px)] leading-[1.02] tracking-[-0.045em] text-balance">
              One balance.<br />Every way to pay.
            </h2>
          </div>
          <p className="max-w-[380px] text-base leading-relaxed text-[#475467]">
            Everything the dashboard does, on the web or in your pocket — and nothing asks for a seed phrase.
          </p>
        </Reveal>

        <div className="grid md:grid-cols-2 gap-6">
          <Reveal id="send" className={cn(card, "bg-(--sw-blue) text-white scroll-mt-24")}>
            <span className="text-xs font-bold tracking-[0.06em] opacity-80">EMAIL · USD</span>
            <span className="font-extrabold text-[28px] leading-[1.1] tracking-[-0.03em]">Pay anyone by email. They don't need a wallet.</span>
            <div className="mt-auto"><LandingSend sender={sender} onSent={onSent} /></div>
          </Reveal>

          <Reveal delay={0.05} className={cn(card, "bg-(--sw-bg)")}>
            <Kicker>HOW IT WORKS</Kicker>
            <span className="font-extrabold text-[28px] leading-[1.1] tracking-[-0.03em]">Three steps. They only need an email.</span>
            <ol className="mt-auto flex flex-col gap-5">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid grid-cols-[32px_1fr] gap-3">
                  <span className="w-8 h-8 rounded-full bg-(--sw-tint) text-(--sw-blue) grid place-items-center font-extrabold text-sm">{i + 1}</span>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-bold text-[15px]">{s.title}</span>
                    <span className="text-sm leading-relaxed text-(--sw-muted)">{s.desc}</span>
                  </span>
                </li>
              ))}
            </ol>
            {!isLoggedIn && (
              <Link href={`${BASE}/register`} className="inline-flex items-center gap-1.5 text-sm font-bold text-(--sw-blue)">
                Create free account <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
            )}
          </Reveal>

          <Reveal className={cn(card, "bg-(--sw-navy) text-white")}>
            <span className="text-xs font-bold tracking-[0.06em] text-(--sw-sky)">WALLET · USDC</span>
            <span className="font-extrabold text-[28px] leading-[1.1] tracking-[-0.03em]">Withdraw on-chain, fee shown up front.</span>
            <div className="mt-auto flex flex-col gap-2.5">
              {WITHDRAWAL_CHAINS.slice(0, 4).map((c, i) => (
                <div key={c.key} className={cn("flex justify-between items-center px-3.5 py-3 rounded-[14px] border",
                  i === 1 ? "bg-(--sw-blue) border-(--sw-blue)" : "bg-(--sw-navy-card) border-(--sw-navy-line)")}>
                  <span className="font-bold text-sm">{c.label}</span>
                  <span className={cn("text-[13px]", i === 1 ? "text-[#dfe4ff]" : "text-(--sw-faint)")}>
                    min {fmtUsd(c.minWithdrawal).replace(".00", "")} · fee {fmtUsd(c.platformFee)}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.05} className={cn(card, "bg-(--sw-bg)")}>
            <Kicker>RECURRING</Kicker>
            <span className="font-extrabold text-[28px] leading-[1.1] tracking-[-0.03em]">Rent, allowance, payroll — on autopilot.</span>
            <div className="mt-auto bg-white border border-(--sw-line) rounded-[18px] overflow-hidden">
              {RECURRING_SAMPLE.map(([to, amt, when], i) => (
                <div key={to} className={cn("grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-5 py-3.5", i > 0 && "border-t border-[#f0f2f6]")}>
                  <span className="font-bold text-sm truncate">{to}</span><span className="font-bold text-sm">{amt}</span>
                  <span className="text-xs text-(--sw-muted)">{when}</span><span className="text-xs font-bold text-[#067647] justify-self-end">Active</span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal className={cn(card, "bg-(--sw-tint) border border-(--sw-tint-line) md:col-span-2")}>
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-end h-full">
              <div className="flex flex-col gap-3.5 min-w-0">
                <Kicker>SUBSCRIPTIONS & PAYMENTS</Kicker>
                <span className="font-extrabold text-[32px] leading-[1.08] tracking-[-0.035em]">Get paid like a business.</span>
                <span className="text-[15px] leading-relaxed text-[#475467] max-w-[380px]">
                  Create weekly, monthly or yearly plans, share one merchant link, and subscribers are billed automatically — with email receipts and a live subscriber list.
                </span>
              </div>
              <div className="flex flex-col gap-2.5 min-w-0" aria-label="Example subscription payments">
                <div className="bg-(--sw-blue) text-white rounded-2xl px-4 py-3.5 flex justify-between items-center gap-3">
                  <span className="font-bold text-sm truncate">sweep/subscribe/7K2Q-M4XA-9TD3</span>
                  <span className="text-xs font-bold bg-white text-(--sw-blue) px-2.5 py-[5px] rounded-full shrink-0">Copy</span>
                </div>
                <div className="bg-white rounded-2xl overflow-hidden">
                  {RECEIVED_SAMPLE.map(([from, note, amt], i) => (
                    <div key={from} className={cn("flex justify-between px-5 py-3.5 text-sm", i > 0 && "border-t border-[#f0f2f6]")}>
                      <span className="flex flex-col"><span className="font-bold">{from}</span><span className="text-xs text-(--sw-muted)">{note}</span></span>
                      <span className="font-bold text-[#067647]">{amt}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ── Use cases ─────────────────────────────────────────────────────────────────

const USE_CASES = [
  {
    audience: "FREELANCERS & REMOTE WORKERS",
    headline: "Get paid in USDC — anywhere on Earth.",
    points: ["Share your email instead of a wallet address", "Receive payments from global clients instantly", "No exchange accounts or conversion fees", "Withdraw on-chain or hold as USDC"],
  },
  {
    audience: "MERCHANTS & CREATORS",
    headline: "Automate billing with subscription plans.",
    points: ["Create weekly, monthly, or yearly billing plans", "Customers activate with a one-time confirmation code", "Automatic recurring charges with email receipts", "Real-time dashboard of active subscribers"],
  },
  {
    audience: "BUSINESSES & TEAMS",
    headline: "Cross-border payroll without the complexity.",
    points: ["Send to multiple recipients by email", "A full history of every payment in one place", "No correspondent banks or SWIFT delays", "Recurring transfers for regular payouts"],
  },
];

function UseCasesSection() {
  return (
    <section id="use-cases" aria-labelledby="uc-heading" className="max-w-[1240px] mx-auto px-5 sm:px-7 pt-24 pb-10 scroll-mt-20">
      <Reveal className="flex flex-col gap-5 mb-12">
        <SectionLabel>WHO IT'S FOR</SectionLabel>
        <h2 id="uc-heading" className="font-extrabold text-[clamp(30px,3.6vw,44px)] leading-[1.05] tracking-[-0.04em]">Built for everyone who gets paid.</h2>
        <p className="max-w-[520px] text-base leading-relaxed text-[#475467]">The same balance, used three ways — pick the one that sounds like you.</p>
      </Reveal>
      <div className="grid md:grid-cols-3 gap-6">
        {USE_CASES.map((uc, i) => (
          <Reveal key={uc.audience} delay={i * 0.06} className="bg-white border border-(--sw-line) rounded-[24px] p-7 lg:p-8 flex flex-col gap-4">
            <Kicker>{uc.audience}</Kicker>
            <span className="font-extrabold text-[22px] leading-[1.15] tracking-[-0.02em]">{uc.headline}</span>
            <ul className="flex flex-col gap-3 mt-1">
              {uc.points.map((pt) => (
                <li key={pt} className="flex items-start gap-2.5 text-sm text-[#475467]">
                  <CheckCircle2 className="w-4 h-4 text-[#067647] shrink-0 mt-0.5" aria-hidden /> <span>{pt}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ── Networks ──────────────────────────────────────────────────────────────────

function NetworksSection() {
  return (
    <section id="networks" aria-labelledby="networks-heading" className="max-w-[1240px] mx-auto px-5 sm:px-7 pt-14 pb-24 scroll-mt-20">
      <Reveal className="bg-white border border-(--sw-line) rounded-[28px] p-[34px] grid lg:grid-cols-2 gap-9 items-center">
        <div className="flex flex-col gap-3">
          <Kicker>8 NETWORKS</Kicker>
          <h2 id="networks-heading" className="font-extrabold text-[34px] leading-[1.08] tracking-[-0.035em]">Deposit from anywhere. Withdraw anywhere.</h2>
          <p className="text-[15px] leading-relaxed text-[#475467]">
            Deposit USDC on seven networks and withdraw to eight. Every fee is shown before you send, and gas is always on us.
          </p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5">
          {WITHDRAWAL_CHAINS.map((c) => (
            <div key={c.key} className="border border-(--sw-line) rounded-2xl p-3.5 flex flex-col gap-1 bg-[#f8f9fc]">
              <span className="font-extrabold text-[15px]">{c.label}</span>
              <span className="text-xs text-(--sw-muted)">Fee {fmtUsd(c.platformFee)} · min {fmtUsd(c.minWithdrawal).replace(".00", "")}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

// ── Security ──────────────────────────────────────────────────────────────────

const TRUST_POINTS = [
  { title: "Circle-verified infrastructure", desc: "Wallets are powered by Circle's developer-controlled wallet API." },
  { title: "Verifiable deposits & withdrawals", desc: "Every deposit and withdrawal is a real USDC transaction you can check on the network's block explorer." },
  { title: "Keys secured by Circle",        desc: "Sweep never stores private keys — wallets and signing run on Circle's developer-controlled wallet infrastructure, and every balance is backed 1:1 by USDC in the Sweep treasury." },
];

function SecuritySection() {
  const lock = "bg-(--sw-navy-card) border border-(--sw-navy-line) rounded-[24px] p-[26px] flex flex-col gap-3.5";
  const tile = "w-[34px] h-[42px] rounded-[10px] bg-(--sw-navy-chip) border grid place-items-center";
  return (
    <section id="security" aria-labelledby="security-heading" className="bg-(--sw-navy) text-white scroll-mt-16">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-7 py-24">
        <Reveal className="flex flex-wrap items-end gap-5 mb-10">
          <h2 id="security-heading" className="flex-1 min-w-[300px] font-extrabold text-[clamp(34px,4.4vw,56px)] leading-[1.02] tracking-[-0.045em]">Three locks on every account.</h2>
          <p className="max-w-[380px] text-base leading-relaxed text-(--sw-on-navy)">No seed phrase to lose. Security you already understand, layered.</p>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-[18px]">
          <Reveal className={lock}>
            <div className="flex gap-2" aria-hidden>
              {Array.from({ length: 6 }).map((_, i) => <span key={i} className={cn(tile, "border-(--sw-navy-chip-line) text-xl text-(--sw-sky)")}>•</span>)}
            </div>
            <span className="font-extrabold text-xl">Transaction password</span>
            <span className="text-sm leading-relaxed text-(--sw-faint)">Separate from login, and required to authorize every single send.</span>
          </Reveal>
          <Reveal delay={0.05} className={lock}>
            <div aria-hidden className="h-[42px] rounded-[10px] bg-(--sw-navy-chip) border border-(--sw-navy-chip-line) flex items-center px-3 text-[13px] font-bold tracking-[0.08em] text-(--sw-sky) whitespace-nowrap overflow-hidden">
              SWP-8K2Q-••••-••••-••••-6WNB
            </div>
            <span className="font-extrabold text-xl">Authorization key</span>
            <span className="text-sm leading-relaxed text-(--sw-faint)">A 40-character personal key that proves it's you when you change your password or recover your account.</span>
          </Reveal>
          <Reveal delay={0.1} className={lock}>
            <div className="flex gap-2" aria-hidden>
              {["4", "8", "2", "", "", ""].map((d, i) => (
                <span key={i} className={cn(tile, "font-extrabold text-[17px]", i === 3 ? "border-(--sw-sky)" : "border-(--sw-navy-chip-line)")}>{d}</span>
              ))}
            </div>
            <span className="font-extrabold text-xl">Email OTP</span>
            <span className="text-sm leading-relaxed text-(--sw-faint)">A one-time code on login and on any change to your security settings.</span>
          </Reveal>
        </div>

        <Reveal className="mt-12 grid sm:grid-cols-3 gap-4">
          {TRUST_POINTS.map((tp) => (
            <div key={tp.title} className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
              <h3 className="text-sm font-bold mb-1.5">{tp.title}</h3>
              <p className="text-xs leading-relaxed text-(--sw-faint)">{tp.desc}</p>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

// ── FAQ ───────────────────────────────────────────────────────────────────────

const FAQS = [
  ["Is this real money?", "Not yet. Sweep is running on testnet, so balances are test USDC with no real value. Everything else works the way it will on mainnet."],
  ["Does the person I pay need a wallet?", "No. Send to any email address. If they already use Sweep it lands in their balance instantly — their email is their payment ID. If they don't, it's held for them and credited the moment they sign up with that email."],
  ["What does it cost?", "Email transfers are free. Withdrawals to a wallet carry a small flat network fee, from $0.10 on Arc to $0.40 on Solana, taken from the amount. Gas is always sponsored."],
  ["Which networks can I use?", "Withdraw to Arc, Base, Arbitrum, Optimism, Polygon, Unichain, Avalanche and Solana. Deposit on all of them except Unichain."],
  ["How do I get help?", "Email sweepusdc@gmail.com with your registered email and a description of the issue — include the transaction ID for anything payment-related. We usually reply within 24 hours on business days."],
];

function FaqSection() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" aria-labelledby="faq-heading" className="max-w-[880px] mx-auto px-5 sm:px-7 py-24 scroll-mt-16">
      <h2 id="faq-heading" className="mb-7 font-extrabold text-[clamp(32px,4vw,48px)] tracking-[-0.04em]">Questions</h2>
      <div className="bg-white border border-(--sw-line) rounded-[24px] overflow-hidden">
        {FAQS.map(([q, a], i) => {
          const isOpen = open === i;
          return (
            <div key={q} className={cn(i > 0 && "border-t border-[#f0f2f6]")}>
              <button type="button" onClick={() => setOpen(isOpen ? -1 : i)} aria-expanded={isOpen} aria-controls={`faq-${i}`}
                className="w-full flex items-center gap-4 px-[26px] py-[22px] text-left hover:bg-[#f8f9fc]">
                <span className="flex-1 font-bold text-[17px]">{q}</span>
                <span className="text-[22px] font-medium text-(--sw-blue) w-5 text-center" aria-hidden>{isOpen ? "−" : "+"}</span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div id={`faq-${i}`} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden">
                    <p className="px-[26px] pb-[22px] text-[15px] leading-relaxed text-[#475467] max-w-[680px]">{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Closing CTA ───────────────────────────────────────────────────────────────

function ClosingCta({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <section aria-labelledby="cta-heading" className="px-5 sm:px-7 pb-24">
      <Reveal className="max-w-[1240px] mx-auto bg-(--sw-blue) text-white rounded-[36px] px-8 sm:px-14 py-16 sm:py-[72px] relative overflow-hidden grid lg:grid-cols-2 gap-8 items-end">
        <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] opacity-[.07] pointer-events-none" />
        <div className="flex flex-col gap-2.5 relative">
          <span className="text-[13px] font-bold tracking-[0.06em] opacity-85">YOUR FIRST SEND IS ONE EMAIL AWAY</span>
          <h2 id="cta-heading" className="font-extrabold text-[clamp(80px,12vw,168px)] leading-[.88] tracking-[-0.06em]">Swept.</h2>
        </div>
        <div className="flex flex-col gap-3 relative items-start">
          <span className="text-[17px] leading-relaxed opacity-90 max-w-[360px]">Open an account in a minute. Your email is your payment ID from day one.</span>
          <div className="flex gap-2.5 flex-wrap">
            {isLoggedIn ? (
              <Link href={`${BASE}/dashboard`} className="h-14 px-[26px] rounded-2xl flex items-center gap-2 text-base font-bold text-(--sw-blue) bg-white hover:bg-(--sw-tint)">
                Go to dashboard <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
            ) : (
              <>
                <Link href={`${BASE}/register`} className="h-14 px-[26px] rounded-2xl flex items-center text-base font-bold text-(--sw-blue) bg-white hover:bg-(--sw-tint)">
                  Open free account
                </Link>
                <Link href={`${BASE}/login`} className="h-14 px-6 rounded-2xl flex items-center text-base font-bold border border-white/40 hover:bg-white/10">
                  Log in
                </Link>
              </>
            )}
          </div>
          <span className="text-xs opacity-60">Free to join · No credit card required · Cancel subscriptions any time</span>
        </div>
      </Reveal>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function LandingFooter() {
  const link = "text-sm text-(--sw-faint) hover:text-white transition-colors text-left";
  return (
    <footer className="bg-(--sw-navy) text-(--sw-faint)">
      <div className="max-w-[1240px] mx-auto px-5 sm:px-7 pt-12 pb-9">
        <div className="grid grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-8">
          <div className="col-span-2 lg:col-span-1 flex flex-col gap-2.5">
            <Link href={`${BASE}/landing`} className="flex items-center gap-2" aria-label="Sweep home">
              <img src="/sweep-mark-white.svg" alt="" className="w-[18px]" />
              <span className="font-extrabold text-lg text-white">Sweep</span>
            </Link>
            <p className="text-sm leading-relaxed max-w-[320px]">
              Testnet preview. Sending and receiving USDC/USD on Sweep involves no real funds — all assets in this testing phase are testnet funds. Sweep is built on Arc and Circle.
            </p>
          </div>
          <nav aria-label="Product links" className="flex flex-col gap-2.5">
            <span className="text-sm font-bold text-white">Product</span>
            <button type="button" onClick={() => scrollToId("send")} className={link}>Pay by email</button>
            <button type="button" onClick={() => scrollToId("product")} className={link}>How it works</button>
            <button type="button" onClick={() => scrollToId("use-cases")} className={link}>Use cases</button>
            <button type="button" onClick={() => scrollToId("networks")} className={link}>Networks</button>
            <button type="button" onClick={() => scrollToId("security")} className={link}>Security</button>
          </nav>
          <nav aria-label="Account links" className="flex flex-col gap-2.5">
            <span className="text-sm font-bold text-white">Account</span>
            <Link href={`${BASE}/register`} className={link}>Sign up</Link>
            <Link href={`${BASE}/login`} className={link}>Log in</Link>
            <Link href={`${BASE}/dashboard`} className={link}>Dashboard</Link>
          </nav>
          <nav aria-label="Support links" className="flex flex-col gap-2.5">
            <span className="text-sm font-bold text-white">Support</span>
            <a href="mailto:sweepusdc@gmail.com" className={link}>sweepusdc@gmail.com</a>
            <Link href={`${BASE}/docs`} className={link}>Documentation</Link>
            <button type="button" onClick={() => scrollToId("faq")} className={link}>FAQ</button>
          </nav>
          <nav aria-label="Legal links" className="flex flex-col gap-2.5">
            <span className="text-sm font-bold text-white">Legal</span>
            {["Privacy Policy", "Terms of Service", "Cookie Policy"].map((l) => (
              <span key={l} className="text-sm text-[#667085] cursor-default">{l}</span>
            ))}
          </nav>
        </div>
        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#667085]">
          <p>© {new Date().getFullYear()} <span translate="no">Sweep</span>. All rights reserved.</p>
          <p>Powered by <span translate="no">Circle</span> Developer-Controlled Wallets</p>
        </div>
      </div>
    </footer>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Landing() {
  const [hasToken] = useState(() => !!localStorage.getItem("token"));
  const { data: user } = useGetCurrentUser({ query: { enabled: hasToken, retry: false } as any });
  const { data: balance, refetch: refetchBalance } = useGetUserBalance({ query: { enabled: !!user } as any });
  const isLoggedIn = hasToken;

  const sender: LandingSender | null = user
    ? {
        email: user.email,
        hasTransactionPassword: !!(user as any).hasTransactionPassword,
        available: parseFloat(balance?.claimedBalance ?? "0") || 0,
      }
    : null;

  return (
    <div className="sweep-ui min-h-screen flex flex-col overflow-x-hidden" lang="en">
      <LandingNav isLoggedIn={isLoggedIn} />
      <main id="main-content" className="flex-1">
        <Hero isLoggedIn={isLoggedIn} />
        <PromiseStrip />
        <ProductSection isLoggedIn={isLoggedIn} sender={sender} onSent={() => refetchBalance()} />
        <UseCasesSection />
        <NetworksSection />
        <SecuritySection />
        <FaqSection />
        <ClosingCta isLoggedIn={isLoggedIn} />
      </main>
      <LandingFooter />
    </div>
  );
}
