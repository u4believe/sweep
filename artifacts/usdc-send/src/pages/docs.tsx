import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight, ChevronDown, Menu, X,
  Copy, Check, ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Section definitions ───────────────────────────────────────────────────────

const SECTIONS = [
  {
    id: "introduction",
    label: "Introduction",
    children: [],
  },
  {
    id: "getting-started",
    label: "Getting Started",
    children: [
      { id: "account-creation",       label: "Account Creation" },
      { id: "email-verification",     label: "Email Verification" },
      { id: "two-factor-auth",        label: "Two-Factor Authentication" },
    ],
  },
  {
    id: "core-features",
    label: "Core Features",
    children: [
      { id: "dashboard",              label: "Dashboard Overview" },
      { id: "fund-account",           label: "Fund Your Account" },
      { id: "send-usd",               label: "Send USD" },
      { id: "send-usdc",              label: "Send USDC On-Chain" },
      { id: "withdraw",               label: "Withdraw" },
      { id: "recurring-transfers",    label: "Recurring Transfers" },
      { id: "transaction-history",    label: "Transaction History" },
    ],
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    children: [
      { id: "creating-plans",         label: "Creating Plans" },
      { id: "managing-subscriptions", label: "Managing Subscriptions" },
      { id: "sweep-passport",         label: "Sweep Passport" },
      { id: "billing-lifecycle",      label: "Billing Lifecycle" },
    ],
  },
  {
    id: "architecture",
    label: "Architecture",
    children: [
      { id: "tech-stack",             label: "Tech Stack" },
      { id: "chain-integrations",     label: "Chain Integrations" },
      { id: "circle-integration",     label: "Circle Integration" },
      { id: "email-system",           label: "Email System" },
      { id: "deployment",             label: "Deployment" },
    ],
  },
  {
    id: "security",
    label: "Security",
    children: [
      { id: "auth-model",             label: "Auth Model" },
      { id: "rate-limiting",          label: "Rate Limiting" },
      { id: "threat-monitoring",      label: "Threat Monitoring" },
      { id: "idempotency",            label: "Idempotency" },
    ],
  },
  {
    id: "api-reference",
    label: "API Reference",
    children: [
      { id: "ref-auth",               label: "Auth Endpoints" },
      { id: "ref-user",               label: "User Endpoints" },
      { id: "ref-escrow",             label: "Escrow / Send" },
      { id: "ref-deposit",            label: "Deposit" },
      { id: "ref-withdraw",           label: "Withdraw" },
      { id: "ref-recurring",          label: "Recurring" },
      { id: "ref-subscriptions",      label: "Subscriptions" },
    ],
  },
];

// ── Small helpers ─────────────────────────────────────────────────────────────

function CodeBlock({ children, language = "bash" }: { children: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group my-4 rounded-xl overflow-hidden border border-white/10">
      <div className="flex items-center justify-between px-4 py-2 bg-[#0d1117] border-b border-white/10">
        <span className="text-[11px] font-mono text-white/40 uppercase tracking-widest">{language}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/70 transition-colors"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="bg-[#0d1117] text-[#e6edf3] text-sm p-4 overflow-x-auto font-mono leading-relaxed">
        <code>{children.trim()}</code>
      </pre>
    </div>
  );
}

function Badge({ children, color = "blue" }: { children: string; color?: "blue"|"green"|"amber"|"red"|"purple"|"gray" }) {
  const colors = {
    blue:   "bg-blue-100 text-blue-700 border-blue-200",
    green:  "bg-emerald-100 text-emerald-700 border-emerald-200",
    amber:  "bg-amber-100 text-amber-700 border-amber-200",
    red:    "bg-red-100 text-red-700 border-red-200",
    purple: "bg-violet-100 text-violet-700 border-violet-200",
    gray:   "bg-gray-100 text-gray-600 border-gray-200",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border font-mono", colors[color])}>
      {children}
    </span>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET:    "bg-blue-100 text-blue-700",
    POST:   "bg-emerald-100 text-emerald-700",
    DELETE: "bg-red-100 text-red-700",
    PATCH:  "bg-amber-100 text-amber-700",
    PUT:    "bg-violet-100 text-violet-700",
  };
  return (
    <span className={cn("inline-block px-2 py-0.5 rounded text-[11px] font-bold font-mono", colors[method] ?? "bg-gray-100 text-gray-600")}>
      {method}
    </span>
  );
}

function Endpoint({ method, path, description, auth = true }: { method: string; path: string; description: string; auth?: boolean }) {
  return (
    <div className="my-3 p-4 rounded-xl border border-border bg-secondary/30">
      <div className="flex items-center flex-wrap gap-2 mb-1.5">
        <MethodBadge method={method} />
        <code className="text-sm font-mono text-foreground">{path}</code>
        {auth && <Badge color="gray">auth required</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 mb-16">
      <h2 className="text-2xl font-bold text-foreground mb-6 pb-3 border-b border-border">{title}</h2>
      {children}
    </section>
  );
}

function SubSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 mb-10">
      <h3 className="text-lg font-semibold text-foreground mb-3">{title}</h3>
      {children}
    </div>
  );
}

function InfoBox({ title, children, type = "info" }: { title?: string; children: React.ReactNode; type?: "info"|"warning"|"tip" }) {
  const styles = {
    info:    "bg-blue-50 border-blue-200 text-blue-900",
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    tip:     "bg-emerald-50 border-emerald-200 text-emerald-900",
  };
  return (
    <div className={cn("my-4 p-4 rounded-xl border text-sm leading-relaxed", styles[type])}>
      {title && <p className="font-semibold mb-1">{title}</p>}
      {children}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function DocsSidebar({ activeId, onNavigate }: { activeId: string; onNavigate: (id: string) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    Object.fromEntries(SECTIONS.map((s) => [s.id, true]))
  );

  return (
    <nav className="space-y-1">
      {SECTIONS.map((section) => {
        const isParentActive = activeId === section.id || section.children.some((c) => c.id === activeId);
        return (
          <div key={section.id}>
            <div className="flex items-center">
              <button
                onClick={() => { onNavigate(section.id); }}
                className={cn(
                  "flex-1 text-left px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                  isParentActive
                    ? "text-primary bg-primary/8"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                )}
              >
                {section.label}
              </button>
              {section.children.length > 0 && (
                <button
                  onClick={() => setExpanded((e) => ({ ...e, [section.id]: !e[section.id] }))}
                  className="p-1 text-muted-foreground hover:text-foreground"
                >
                  {expanded[section.id]
                    ? <ChevronDown className="w-3.5 h-3.5" />
                    : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
            <AnimatePresence initial={false}>
              {section.children.length > 0 && expanded[section.id] && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden ml-2 pl-3 border-l border-border mt-0.5 mb-1 space-y-0.5"
                >
                  {section.children.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => onNavigate(child.id)}
                      className={cn(
                        "w-full text-left px-2 py-1 rounded-md text-[13px] transition-colors",
                        activeId === child.id
                          ? "text-primary font-medium bg-primary/8"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                      )}
                    >
                      {child.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </nav>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Docs() {
  const [activeId, setActiveId]       = useState("introduction");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Intersection observer to highlight active section
  useEffect(() => {
    const allIds = SECTIONS.flatMap((s) => [s.id, ...s.children.map((c) => c.id)]);
    const elements = allIds.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const navigate = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMobileSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-background">

      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur border-b border-border h-14 flex items-center px-4 sm:px-6 gap-4">
        <Link href={`${BASE}/landing`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0">
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Back to home</span>
        </Link>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <img src="/Sweep_logo_exact.svg" alt="Sweep" className="h-7 w-auto" />
          <span className="font-bold text-foreground">Docs</span>
          <Badge color="blue">v1.0</Badge>
        </div>
        <div className="flex-1" />
        {/* Mobile sidebar toggle */}
        <button
          onClick={() => setMobileSidebarOpen((v) => !v)}
          className="lg:hidden p-2 rounded-lg text-muted-foreground hover:bg-secondary/60"
        >
          {mobileSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <Link href={`${BASE}/register`} className="hidden sm:flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors">
          Get started <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </header>

      <div className="flex pt-14">

        {/* Desktop sidebar */}
        <aside className="hidden lg:block fixed left-0 top-14 w-64 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-border bg-white/95 px-4 py-6">
          <DocsSidebar activeId={activeId} onNavigate={navigate} />
        </aside>

        {/* Mobile sidebar overlay */}
        <AnimatePresence>
          {mobileSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/40 lg:hidden"
                onClick={() => setMobileSidebarOpen(false)}
              />
              <motion.aside
                initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
                transition={{ type: "tween", duration: 0.2 }}
                className="fixed left-0 top-14 w-72 h-[calc(100vh-3.5rem)] z-50 overflow-y-auto bg-white border-r border-border px-4 py-6 lg:hidden"
              >
                <DocsSidebar activeId={activeId} onNavigate={navigate} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main content */}
        <main ref={contentRef} className="flex-1 lg:ml-64 min-w-0">
          <div className="max-w-3xl mx-auto px-4 sm:px-8 py-12">

            {/* ── Introduction ── */}
            <Section id="introduction" title="Introduction">
              <p className="text-muted-foreground leading-relaxed mb-4">
                <strong className="text-foreground">Sweep</strong> is a full-stack USDC payment infrastructure platform
                built for developers and end-users. It enables USD-denominated transfers across multiple testnet
                networks — including <strong className="text-foreground">Arc Testnet</strong>,{" "}
                <strong className="text-foreground">Base Sepolia</strong>, Arbitrum Sepolia, Optimism Sepolia,
                Polygon Amoy, Avalanche Fuji, and Solana Devnet — with cross-chain settlement powered by
                Circle's Gateway.
              </p>
              <div className="grid sm:grid-cols-2 gap-4 my-6">
                {[
                  { label: "User Platform",  desc: "Send, receive, and manage USDC from a dashboard" },
                  { label: "Subscriptions",  desc: "Create and bill recurring plans on-chain" },
                ].map((card) => (
                  <div key={card.label} className="p-4 rounded-xl border border-border bg-secondary/30">
                    <p className="font-semibold text-foreground text-sm mb-1">{card.label}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{card.desc}</p>
                  </div>
                ))}
              </div>
              <InfoBox title="Testnet notice" type="warning">
                All transactions on Sweep currently run on testnet networks (Arc Testnet, Base Sepolia,
                Arbitrum Sepolia, Optimism Sepolia, Polygon Amoy, Avalanche Fuji, and Solana Devnet).
                USDC balances are not real funds. This is intended for development and demonstration purposes.
              </InfoBox>
            </Section>

            {/* ── Getting Started ── */}
            <Section id="getting-started" title="Getting Started">

              <SubSection id="account-creation" title="Account Creation">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Navigate to <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">/register</code> and
                  fill in your full name, email address, and a password (minimum 8 characters). On submission,
                  the server:
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground mb-4 ml-2">
                  <li>Hashes your password with <strong className="text-foreground">bcrypt</strong> (10 rounds)</li>
                  <li>Creates your user record in PostgreSQL</li>
                  <li>Provisions <strong className="text-foreground">Circle Developer Controlled Wallets</strong> across the supported EVM networks and Solana</li>
                  <li>Sends an email verification link via <strong className="text-foreground">Resend</strong></li>
                </ol>
                <CodeBlock language="json">{`POST /api/auth/register
{
  "name": "Alice Johnson",
  "email": "alice@example.com",
  "password": "securepass123"
}`}</CodeBlock>
              </SubSection>

              <SubSection id="email-verification" title="Email Verification">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  After registration, a signed JWT link is emailed to you. Clicking it calls
                  <code className="bg-secondary px-1.5 py-0.5 rounded text-xs mx-1">GET /api/auth/verify-email?token=...</code>
                  which marks your account as verified and redirects to{" "}
                  <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">/login?verified=true</code>.
                </p>
                <InfoBox type="tip" title="Resend verification">
                  If you didn't receive the email, the dashboard displays an "Email Verification Pending"
                  banner with a <strong>Resend</strong> button that calls{" "}
                  <code className="text-xs">POST /api/auth/resend-verification</code>.
                </InfoBox>
              </SubSection>

              <SubSection id="two-factor-auth" title="Two-Factor Authentication">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Every login is two-step. After entering email and password, a <strong className="text-foreground">6-digit OTP</strong> is
                  emailed to you (valid for 10 minutes). You must enter this code before a JWT session token is issued.
                </p>
                <CodeBlock language="typescript">{`// Step 1 — credentials
POST /api/auth/login
{ "email": "alice@example.com", "password": "securepass123" }
→ { "userId": 42 }

// Step 2 — OTP verification
POST /api/auth/verify-otp
{ "userId": 42, "code": "847291", "type": "login" }
→ { "token": "eyJhbGci..." }`}</CodeBlock>
                <p className="text-sm text-muted-foreground">
                  The returned <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">token</code> is a
                  JWT stored in <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">localStorage</code> and
                  sent as <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">Authorization: Bearer &lt;token&gt;</code> on
                  all subsequent requests.
                </p>
              </SubSection>
            </Section>

            {/* ── Core Features ── */}
            <Section id="core-features" title="Core Features">

              <SubSection id="dashboard" title="Dashboard Overview">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  The dashboard is a single-page React application powered by Wouter for routing. It shows:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground mb-4 ml-2">
                  <li>Available USDC balance (pulled from the database)</li>
                  <li>Pending and completed transaction history</li>
                  <li>Deposit addresses for every supported network</li>
                  <li>Quick-access cards for every feature</li>
                </ul>
              </SubSection>

              <SubSection id="fund-account" title="Fund Your Account">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Each user gets dedicated on-chain deposit addresses managed by Circle's Developer
                  Controlled Wallets (DCW): a single EVM address shared across all supported EVM networks,
                  plus a separate Solana address. Funds sent to these addresses are detected by background
                  indexer workers and credited to your balance.
                </p>
                <div className="grid sm:grid-cols-2 gap-3 my-4 text-sm">
                  <div className="p-3 rounded-xl border border-border bg-secondary/30">
                    <p className="font-semibold text-foreground mb-1">EVM networks</p>
                    <p className="text-muted-foreground text-xs">Arc Testnet, Base Sepolia, Arbitrum Sepolia, Optimism Sepolia, Polygon Amoy, and Avalanche Fuji — all served by one shared EVM address. Deposits are indexed per chain and swept to the platform treasury.</p>
                  </div>
                  <div className="p-3 rounded-xl border border-border bg-secondary/30">
                    <p className="font-semibold text-foreground mb-1">Solana Devnet</p>
                    <p className="text-muted-foreground text-xs">A dedicated Solana deposit address. SPL USDC deposits are indexed and swept to the platform treasury.</p>
                  </div>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed mb-3">
                  Supported deposit networks: Arc Testnet, Base Sepolia, Arbitrum Sepolia, Optimism Sepolia,
                  Polygon Amoy, Avalanche Fuji, and Solana Devnet.
                </p>
                <InfoBox type="info" title="Idempotency">
                  Deposits are deduplicated using the on-chain transaction hash. A unique constraint on
                  <code className="text-xs mx-1">deposits.tx_hash</code> combined with an{" "}
                  <code className="text-xs">INSERT ... ON CONFLICT DO NOTHING</code> pattern prevents
                  double-credits even under concurrent indexer runs.
                </InfoBox>
              </SubSection>

              <SubSection id="send-usd" title="Send USD (Platform Transfer)">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Platform transfers move USDC between Sweep users off-chain — instantly, with zero gas. The
                  sender's <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">claimedBalance</code> is
                  debited and the recipient's is credited in a single database transaction with row-level locking
                  (<code className="bg-secondary px-1.5 py-0.5 rounded text-xs">.for("update")</code>) to prevent races.
                </p>
                <CodeBlock language="json">{`POST /api/escrow/send/platform
Authorization: Bearer <token>
{
  "recipientEmail": "bob@example.com",
  "amount": "25.00",
  "memo": "Dinner split"
}`}</CodeBlock>
              </SubSection>

              <SubSection id="send-usdc" title="Send USDC On-Chain">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  For on-chain transfers, Sweep initiates a Circle DCW transfer from the platform treasury
                  to the recipient's specified wallet address. This creates an on-chain transaction on Arc Testnet.
                </p>
                <CodeBlock language="json">{`POST /api/escrow/send/platform
{
  "recipientWallet": "0xAbc123...",
  "amount": "10.00",
  "network": "arc-testnet"
}`}</CodeBlock>
              </SubSection>

              <SubSection id="withdraw" title="Withdraw">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Withdrawal moves USDC from the platform treasury to an external wallet address on-chain.
                  The user's balance is debited first, then the transfer is settled. If the treasury already
                  holds enough USDC on the destination chain, a direct Circle DCW transfer is used; otherwise
                  the <strong className="text-foreground">Circle Gateway</strong> Forwarding Service performs the
                  cross-chain transfer to the destination network.
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  If you've set a <strong className="text-foreground">transaction password</strong>, it is
                  required to authorize each withdrawal. Supported withdrawal networks: Arc Testnet, Base Sepolia,
                  Arbitrum Sepolia, Optimism Sepolia, Polygon Amoy, Avalanche Fuji, Unichain Sepolia, and
                  Solana Devnet.
                </p>
                <CodeBlock language="json">{`POST /api/withdraw/crypto
Authorization: Bearer <token>
{
  "amount": "50.00",
  "walletAddress": "0xYourWallet...",
  "chainKey": "ARC-TESTNET",
  "transactionPassword": "your-txn-password"
}`}</CodeBlock>
              </SubSection>

              <SubSection id="recurring-transfers" title="Recurring Transfers">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Users can schedule automatic recurring payments to any Sweep user on a daily, weekly, or
                  monthly cadence. A background worker runs every 5 minutes and fires any due transfers.
                </p>
                <CodeBlock language="json">{`POST /api/recurring
Authorization: Bearer <token>
{
  "recipientEmail": "landlord@example.com",
  "amount": "500.00",
  "interval": "monthly",
  "startDate": "2025-06-01"
}`}</CodeBlock>
              </SubSection>

              <SubSection id="transaction-history" title="Transaction History">
                <p className="text-muted-foreground text-sm leading-relaxed">
                  <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">GET /api/user/history</code> returns
                  a unified ledger of all deposits, escrow sends/receives, withdrawals, and recurring transfers.
                  The dashboard renders this with filterable tabs and links to block explorers for on-chain
                  transactions (Arc Testnet, Base Sepolia, Arbitrum Sepolia, Optimism Sepolia, Polygon Amoy,
                  Avalanche Fuji, Unichain Sepolia, and Solana Devnet).
                </p>
              </SubSection>
            </Section>

            {/* ── Subscriptions ── */}
            <Section id="subscriptions" title="Subscriptions">

              <SubSection id="creating-plans" title="Creating Plans">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Any Sweep user can become a merchant by creating subscription plans. Plans define the
                  billing amount, currency, interval, and optional trial period. Plans are addressable
                  by your <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">merchantId</code>.
                </p>
                <CodeBlock language="json">{`POST /api/subscriptions/plans
Authorization: Bearer <token>
{
  "name": "Pro Plan",
  "description": "Full feature access",
  "amount": "9.99",
  "currency": "USDC",
  "interval": "monthly",
  "trialDays": 7
}`}</CodeBlock>
              </SubSection>

              <SubSection id="managing-subscriptions" title="Managing Subscriptions">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Subscribers can view their active plans, cancel at any time, or upgrade/downgrade.
                  Merchants see a list of all subscribers per plan. The billing worker debits subscribers
                  and credits merchants automatically on each renewal date.
                </p>
                <div className="space-y-1">
                  <Endpoint method="GET"  path="/api/subscriptions/my"           description="List all your active subscriptions" />
                  <Endpoint method="GET"  path="/api/subscriptions/plans"        description="Browse available plans from all merchants" />
                  <Endpoint method="DELETE" path="/api/subscriptions/:id"        description="Cancel a subscription" />
                  <Endpoint method="GET"  path="/api/subscriptions/plans/:id/subscribers" description="Merchant: list subscribers on a plan" />
                </div>
              </SubSection>

              <SubSection id="sweep-passport" title="Sweep Passport">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  The <strong className="text-foreground">Sweep Passport</strong> is a cross-merchant
                  subscription layer. A user purchases a Passport once and can use it to access any
                  merchant that accepts Passport authentication — verified via a signed JWT issued by the platform.
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Merchants verify Passport tokens using the{" "}
                  <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">GET /v1/passport/verify</code>{" "}
                  endpoint or via a confirmation-code OTP flow.
                </p>
                <CodeBlock language="typescript">{`// Merchant backend — verify a Passport token
GET /v1/passport/verify
Authorization: Bearer <passport_token>

// Response
{
  "valid": true,
  "userId": 42,
  "expiresAt": "2025-12-31T00:00:00.000Z"
}`}</CodeBlock>
              </SubSection>

              <SubSection id="billing-lifecycle" title="Billing Lifecycle">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  The subscription billing worker runs every <strong className="text-foreground">5 minutes</strong>.
                  For each active subscription past its next billing date it:
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground mb-4 ml-2">
                  <li>Opens a database transaction with row-level locks on both subscriber and merchant</li>
                  <li>Checks the subscriber has sufficient balance</li>
                  <li>Debits the subscriber and credits the merchant atomically</li>
                  <li>Inserts an escrow record for auditing</li>
                  <li>Advances <code className="text-xs">nextBillingDate</code> by one interval</li>
                  <li>Fires a webhook event to the merchant's endpoint</li>
                </ol>
                <InfoBox type="info" title="Trial periods">
                  During a trial period the subscription status is <Badge color="amber">trialing</Badge>.
                  No charge is made until the trial expires, at which point the worker transitions the
                  status to <Badge color="green">active</Badge> and bills immediately.
                </InfoBox>
              </SubSection>
            </Section>

            {/* ── Architecture ── */}
            <Section id="architecture" title="Architecture">

              <SubSection id="tech-stack" title="Tech Stack">
                <div className="grid sm:grid-cols-2 gap-3 my-2">
                  {[
                    { layer: "Frontend",   tech: "React 18, Vite, TypeScript, Wouter, TanStack Query, Tailwind CSS, Framer Motion" },
                    { layer: "Backend",    tech: "Node.js, Express 5, TypeScript, Zod, Pino (structured logging)" },
                    { layer: "Database",   tech: "PostgreSQL (Supabase), Drizzle ORM, drizzle-kit migrations" },
                    { layer: "Monorepo",   tech: "pnpm workspaces — @workspace/api-server, @workspace/usdc-send, @workspace/db, @workspace/api-client-react" },
                    { layer: "Email",      tech: "Resend SDK (HTTPS REST, no SMTP)" },
                    { layer: "Deployment", tech: "Railway (API server via Dockerfile), Vercel (frontend SPA)" },
                  ].map((row) => (
                    <div key={row.layer} className="p-3 rounded-xl border border-border bg-secondary/30">
                      <p className="font-semibold text-foreground text-sm mb-0.5">{row.layer}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{row.tech}</p>
                    </div>
                  ))}
                </div>
              </SubSection>

              <SubSection id="chain-integrations" title="Chain Integrations">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Indexer workers run continuously, polling each supported network for new USDC transfers
                  to user deposit addresses:
                </p>
                <CodeBlock language="typescript">{`// Simplified indexer loop
while (true) {
  const txs = await circle.listTransactions({ walletId, after: cursor });
  for (const tx of txs) {
    await handleDeposit(userId, tx.amount, tx.txHash, tx.toAddress);
  }
  cursor = latestBlock;
  await sleep(POLL_INTERVAL_MS);
}`}</CodeBlock>
                <p className="text-sm text-muted-foreground mt-3">
                  Deposits follow a three-step path on every supported network — no cross-chain bridging is
                  involved. First the user's deposit is swept to the platform treasury wallet on that same chain.
                  Then the treasury approves and calls{" "}
                  <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">depositFor()</code> on the Circle
                  Gateway contract, moving the USDC into the chain-agnostic Gateway Unified Balance. Cross-chain
                  withdrawals are later settled from that Unified Balance through the Gateway Forwarding Service.
                </p>
              </SubSection>

              <SubSection id="circle-integration" title="Circle Integration">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Sweep uses Circle's <strong className="text-foreground">Developer Controlled Wallets (DCW)</strong> API to:
                </p>
                <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground mb-3 ml-2">
                  <li>Provision per-user deposit wallets on account creation across the supported EVM networks and Solana</li>
                  <li>Initiate USDC transfers from the platform treasury to external addresses</li>
                  <li>Query wallet balances and transaction history</li>
                  <li>Sweep deposits to the treasury, fund the Gateway Unified Balance via <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">depositFor()</code>, and settle cross-chain withdrawals through the Gateway Forwarding Service</li>
                </ul>
                <InfoBox type="info">
                  Circle's Gas Station feature is enabled — users do not need to hold native gas tokens.
                  Gas fees are covered by the platform.
                </InfoBox>
              </SubSection>

              <SubSection id="email-system" title="Email System">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  All transactional emails (verification links, OTP codes, password resets) are sent via
                  the <strong className="text-foreground">Resend</strong> SDK. Resend uses HTTPS (port 443)
                  rather than SMTP, making it compatible with restricted cloud environments like Railway
                  and WSL2 where ports 25/465/587 are commonly blocked.
                </p>
                <CodeBlock language="typescript">{`import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: process.env.RESEND_FROM,   // "Sweep <no-reply@yourdomain.com>"
  to: user.email,
  subject: "Your verification code",
  html: buildOtpEmailHtml(code),
});`}</CodeBlock>
              </SubSection>

              <SubSection id="deployment" title="Deployment">
                <div className="grid sm:grid-cols-2 gap-3 my-3">
                  <div className="p-4 rounded-xl border border-border bg-secondary/30">
                    <p className="font-semibold text-foreground text-sm mb-2">Backend — Railway</p>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>• Built with a custom <code>Dockerfile</code> at monorepo root</li>
                      <li>• pnpm installs all workspace packages before building</li>
                      <li>• <code>NODE_ENV=production</code>, secrets via Railway Variables</li>
                      <li>• Auto-deploys on push to <code>main</code></li>
                    </ul>
                  </div>
                  <div className="p-4 rounded-xl border border-border bg-secondary/30">
                    <p className="font-semibold text-foreground text-sm mb-2">Frontend — Vercel</p>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>• Build command: <code>pnpm --filter @workspace/usdc-send build</code></li>
                      <li>• Output: <code>artifacts/usdc-send/dist/public</code></li>
                      <li>• <code>VITE_API_URL</code> baked in at build time</li>
                      <li>• SPA rewrites via <code>vercel.json</code></li>
                    </ul>
                  </div>
                </div>
              </SubSection>
            </Section>

            {/* ── Security ── */}
            <Section id="security" title="Security">

              <SubSection id="auth-model" title="Auth Model">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  User sessions use short-lived JWTs signed with <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">JWT_SECRET</code>.
                  All passwords are hashed with bcrypt (10 rounds). OTP codes expire after 10 minutes
                  and are single-use.
                </p>
                <p className="text-sm text-muted-foreground">
                  A background OTP cleanup worker runs every 24 hours to purge expired and used codes
                  from the database.
                </p>
              </SubSection>

              <SubSection id="rate-limiting" title="Rate Limiting">
                <p className="text-muted-foreground text-sm leading-relaxed">
                  All sensitive endpoints use <strong className="text-foreground">express-rate-limit v8</strong> with
                  the <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">ipKeyGenerator</code> helper for
                  proper IPv6 normalisation. Limits are enforced per-IP and per-user where applicable.
                  Exceeding a limit returns <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">429 Too Many Requests</code>.
                </p>
              </SubSection>

              <SubSection id="threat-monitoring" title="Threat Monitoring">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  An in-process threat monitor middleware scores every IP address. Violation events and
                  their weights:
                </p>
                <div className="space-y-1.5 text-sm my-3">
                  {[
                    ["401 Unauthorized",  "+1", "Failed authentication attempt"],
                    ["403 Forbidden",     "+1", "Accessing protected resource without permission"],
                    ["429 Too Many Req.", "+2", "Hitting a rate limit"],
                    ["API 404",           "+1", "Probing non-existent endpoints"],
                    [">80 req/min",       "+1", "Unusually high request rate"],
                  ].map(([event, weight, desc]) => (
                    <div key={event} className="flex items-center gap-3 p-2.5 rounded-lg border border-border bg-secondary/20">
                      <code className="text-xs font-mono text-muted-foreground w-36 shrink-0">{event}</code>
                      <Badge color={weight === "+2" ? "red" : "amber"}>{weight}</Badge>
                      <span className="text-muted-foreground text-xs">{desc}</span>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  When an IP accumulates 5 violations within a 10-minute window it is blocked with
                  escalating durations: <strong className="text-foreground">1 min → 15 min → 2 hr → 24 hr</strong>.
                  Localhost addresses are never blocked. Admins can view and unblock IPs via
                  <code className="bg-secondary px-1.5 py-0.5 rounded text-xs mx-1">GET /api/admin/blocked-ips</code>.
                </p>
              </SubSection>

              <SubSection id="idempotency" title="Idempotency">
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Critical financial operations are protected against double-execution:
                </p>
                <ul className="list-disc list-inside space-y-1.5 text-sm text-muted-foreground ml-2">
                  <li><strong className="text-foreground">Deposits</strong> — unique constraint on <code className="text-xs">deposits.tx_hash</code> + <code className="text-xs">INSERT ... ON CONFLICT DO NOTHING</code> inside a transaction</li>
                  <li><strong className="text-foreground">Subscription billing</strong> — row-level locking (<code className="text-xs">.for("update")</code>) on both subscriber and merchant within a <code className="text-xs">db.transaction()</code></li>
                  <li><strong className="text-foreground">Platform transfers</strong> — atomic balance check and debit inside a transaction to prevent overdrafts</li>
                  <li><strong className="text-foreground">Passport activation</strong> — transaction cancels old subscription before creating the new one</li>
                </ul>
              </SubSection>
            </Section>

            {/* ── API Reference ── */}
            <Section id="api-reference" title="API Reference">
              <InfoBox type="info">
                All endpoints below require <code className="text-xs">Authorization: Bearer &lt;token&gt;</code> unless
                marked <Badge color="gray">public</Badge>. Tokens come from the login OTP flow.
              </InfoBox>

              <SubSection id="ref-auth" title="Auth Endpoints">
                <Endpoint method="POST" path="/api/auth/register"           description="Register a new user account" auth={false} />
                <Endpoint method="GET"  path="/api/auth/verify-email"       description="Verify email from link (token in query)" auth={false} />
                <Endpoint method="POST" path="/api/auth/login"              description="Submit credentials, receive userId for OTP step" auth={false} />
                <Endpoint method="POST" path="/api/auth/verify-otp"         description="Verify OTP code, receive session JWT" auth={false} />
                <Endpoint method="POST" path="/api/auth/resend-otp"         description="Resend login OTP code" auth={false} />
                <Endpoint method="POST" path="/api/auth/resend-verification" description="Resend email verification link" />
                <Endpoint method="GET"  path="/api/auth/me"                 description="Get current user profile" />
              </SubSection>

              <SubSection id="ref-user" title="User Endpoints">
                <Endpoint method="GET"  path="/api/user/history"  description="Fetch full transaction history" />
                <Endpoint method="GET"  path="/api/user/balance"  description="Fetch current USDC balance" />
              </SubSection>

              <SubSection id="ref-escrow" title="Escrow / Send">
                <Endpoint method="GET"  path="/api/escrow/lookup-recipient" description="Look up a Sweep user by email" />
                <Endpoint method="POST" path="/api/escrow/send/platform"    description="Send USDC to another Sweep user (off-chain)" />
              </SubSection>

              <SubSection id="ref-deposit" title="Deposit">
                <Endpoint method="GET"  path="/api/deposit/addresses"       description="Get your on-chain deposit addresses" />
              </SubSection>

              <SubSection id="ref-withdraw" title="Withdraw">
                <Endpoint method="POST" path="/api/withdraw/crypto"          description="Withdraw USDC to an external wallet on a supported network" />
                <Endpoint method="POST" path="/api/withdraw/fiat"            description="Withdraw to a bank account via Circle wire payout" />
              </SubSection>

              <SubSection id="ref-recurring" title="Recurring">
                <Endpoint method="GET"    path="/api/recurring"             description="List your recurring transfers" />
                <Endpoint method="POST"   path="/api/recurring"             description="Create a recurring transfer" />
                <Endpoint method="DELETE" path="/api/recurring/:id"         description="Cancel a recurring transfer" />
              </SubSection>

              <SubSection id="ref-subscriptions" title="Subscriptions">
                <Endpoint method="GET"    path="/api/subscriptions/my"                                description="List your subscriptions as a subscriber" />
                <Endpoint method="GET"    path="/api/subscriptions/plans"                             description="Browse all public subscription plans" />
                <Endpoint method="POST"   path="/api/subscriptions/plans"                             description="Create a new subscription plan" />
                <Endpoint method="DELETE" path="/api/subscriptions/:id"                               description="Cancel a subscription" />
                <Endpoint method="GET"    path="/api/subscriptions/passport"                          description="Get your Sweep Passport details" />
                <Endpoint method="DELETE" path="/api/subscriptions/passport"                          description="Cancel your Sweep Passport" />
                <Endpoint method="GET"    path="/api/subscriptions/merchant/:merchantId"              description="Subscribe to a merchant's plan" />
                <Endpoint method="POST"   path="/api/subscriptions/confirmation-code/request-otp"    description="Request a confirmation OTP" />
                <Endpoint method="POST"   path="/api/subscriptions/confirmation-code/generate"       description="Exchange OTP for a confirmation code" />
              </SubSection>

            </Section>

            {/* Footer */}
            <div className="border-t border-border pt-8 mt-8 text-xs text-muted-foreground">
              <span>Sweep Docs — v1.0</span>
            </div>
          </div>
        </main>

      </div>
    </div>
  );
}