import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence, useMotionValue, animate } from "framer-motion";
import {
  DollarSign,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Building2,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  ArrowRight,
  Send,
  Mail,
  Repeat,
  CreditCard,
  Banknote,
  Trash2,
  CalendarDays,
  Plus,
  X,
  KeyRound,
  Lock,
  LockKeyhole,
  Eye,
  EyeOff,
  RefreshCw,
  PlusCircle,
  QrCode,
  Landmark,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Menu,
  Home,
  Users,
  XCircle,
  ShieldOff,
  Search,
  Zap,
  Star,
  GripVertical,
  Tag,
  List,
  Layers,
} from "lucide-react";
import {
  useGetCurrentUser,
  useGetUserBalance,
  useWithdrawCrypto,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { cn, formatCurrency } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { AppLayout, Navbar } from "@/components/layout";
import { fadeUp, scaleIn, staggerContainer, fadeIn } from "@/lib/motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
// Block explorer URLs — keys are substrings matched against the network field
const EXPLORER_BASE: Array<{ match: string; url: string }> = [
  { match: "base sepolia",       url: "https://sepolia.basescan.org/tx/" },
  { match: "ethereum sepolia",   url: "https://sepolia.etherscan.io/tx/" },
  { match: "polygon amoy",       url: "https://amoy.polygonscan.com/tx/" },
  { match: "arc",                url: "https://testnet.arcscan.app/tx/" },
  { match: "arb-sepolia",        url: "https://sepolia.arbiscan.io/tx/" },
  { match: "arbitrum sepolia",   url: "https://sepolia.arbiscan.io/tx/" },
  { match: "avax-fuji",          url: "https://testnet.snowtrace.io/tx/" },
  { match: "avalanche fuji",     url: "https://testnet.snowtrace.io/tx/" },
];

// Only show explorer links for real on-chain hashes (0x + 64 hex chars).
// Circle transaction IDs are UUIDs and synthetic bsync-* hashes are not real hashes.
const isOnChainHash = (h: string) => /^0x[0-9a-fA-F]{64}$/.test(h);

function getExplorerUrl(network: string, txHash: string): string | null {
  if (!txHash || !isOnChainHash(txHash)) return null;
  const lower = network.toLowerCase();
  const entry = EXPLORER_BASE.find((e) => lower.includes(e.match));
  return entry ? entry.url + txHash : null;
}

interface UnifiedTx {
  id: string;
  category: "deposit" | "withdrawal" | "escrow";
  currency: "USDC" | "USD";
  direction: "in" | "out";
  amount: string;
  status: string;
  network: string;
  txHash: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  description: string;
  createdAt: string;
  completedAt: string | null;
}

interface FullBalance {
  onChainUsdcBalance: string;
  onChainLastUpdated: string | null;
  claimedBalance: string;
  pendingBalance: string;
  usdBalance: string;
  usdEquivalent: string;
}

// ─── Animated counter ─────────────────────────────────────────────────────────

function AnimatedAmount({ value }: { value: string }) {
  const numVal = parseFloat(value) || 0;
  const count = useMotionValue(0);
  const displayRef = useRef<HTMLSpanElement>(null);
  const prevVal = useRef(0);

  useEffect(() => {
    const from = prevVal.current;
    prevVal.current = numVal;
    const controls = animate(count, numVal, {
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1],
      from,
      onUpdate(v) {
        if (displayRef.current) {
          displayRef.current.textContent = `$${v.toFixed(2)}`;
        }
      },
    });
    return controls.stop;
  }, [numVal]);

  return <span ref={displayRef}>$0.00</span>;
}

// ─── Small utilities ──────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1 rounded hover:bg-secondary transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
    </button>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      className="flex items-start gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive mt-3 overflow-hidden"
    >
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </motion.div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

type ActivePage = "dashboard" | "send-usd" | "send-usdc" | "fund" | "recurring" | "subscription-create" | "subscription-pay" | "subscription-my" | "security";

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  collapsed: boolean;
  badge?: number;
}

function SidebarItem({ icon, label, active, onClick, collapsed, badge }: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
        active
          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        collapsed && "justify-center px-2",
      )}
    >
      <span className="shrink-0 w-5 h-5 flex items-center justify-center">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badge != null && badge > 0 && (
        <span className="ml-auto text-[10px] font-bold bg-primary/20 text-primary rounded-full px-1.5 py-0.5 leading-none">{badge}</span>
      )}
    </button>
  );
}

interface SendMenuProps {
  activePage: ActivePage;
  onNavigate: (p: ActivePage) => void;
  collapsed: boolean;
}

function SendSubMenu({ activePage, onNavigate, collapsed }: SendMenuProps) {
  const [open, setOpen] = useState(activePage === "send-usd" || activePage === "send-usdc");

  useEffect(() => {
    if (activePage === "send-usd" || activePage === "send-usdc") setOpen(true);
  }, [activePage]);

  const isSendActive = activePage === "send-usd" || activePage === "send-usdc";

  if (collapsed) {
    return (
      <>
        <SidebarItem icon={<Send className="w-4 h-4" />} label="Send USD" active={activePage === "send-usd"} onClick={() => onNavigate("send-usd")} collapsed />
        <SidebarItem icon={<ArrowUpRight className="w-4 h-4" />} label="Send USDC" active={activePage === "send-usdc"} onClick={() => onNavigate("send-usdc")} collapsed />
      </>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
          isSendActive ? "text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        <span className="shrink-0 w-5 h-5 flex items-center justify-center">
          <Send className="w-4 h-4" />
        </span>
        <span className="truncate flex-1 text-left">Sweep</span>
        <ChevronDown className={cn("w-4 h-4 transition-transform shrink-0", open && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="send-sub"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
              <SidebarItem icon={<Mail className="w-4 h-4" />} label="Send USD" active={activePage === "send-usd"} onClick={() => onNavigate("send-usd")} collapsed={false} />
              <SidebarItem icon={<ArrowUpRight className="w-4 h-4" />} label="Send USDC" active={activePage === "send-usdc"} onClick={() => onNavigate("send-usdc")} collapsed={false} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PaymentSubMenu({ activePage, onNavigate, collapsed }: SendMenuProps) {
  const isPaymentActive = activePage === "recurring";
  const [open, setOpen] = useState(isPaymentActive);

  useEffect(() => {
    if (isPaymentActive) setOpen(true);
  }, [activePage]);

  if (collapsed) {
    return (
      <SidebarItem icon={<Repeat className="w-4 h-4" />} label="Recurring" active={activePage === "recurring"} onClick={() => onNavigate("recurring")} collapsed />
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
          isPaymentActive ? "text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        <span className="shrink-0 w-5 h-5 flex items-center justify-center">
          <Banknote className="w-4 h-4" />
        </span>
        <span className="truncate flex-1 text-left">Payment</span>
        <ChevronDown className={cn("w-4 h-4 transition-transform shrink-0", open && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="payment-sub"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
              <SidebarItem icon={<Repeat className="w-4 h-4" />} label="Recurring" active={activePage === "recurring"} onClick={() => onNavigate("recurring")} collapsed={false} />

              {/* P2P — coming soon */}
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground/50 cursor-not-allowed select-none">
                <span className="shrink-0 w-5 h-5 flex items-center justify-center">
                  <ArrowUpRight className="w-4 h-4" />
                </span>
                <span className="truncate flex-1">P2P</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 border border-amber-200 shrink-0">Soon</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SubscriptionSubMenu({ activePage, onNavigate, collapsed }: SendMenuProps) {
  const isSubscriptionActive = activePage === "subscription-create" || activePage === "subscription-pay" || activePage === "subscription-my";
  const [open, setOpen] = useState(isSubscriptionActive);

  useEffect(() => {
    if (isSubscriptionActive) setOpen(true);
  }, [activePage]);

  if (collapsed) {
    return (
      <>
        <SidebarItem icon={<Plus className="w-4 h-4" />}         label="Create Subscription" active={activePage === "subscription-create"} onClick={() => onNavigate("subscription-create")} collapsed />
        <SidebarItem icon={<ArrowUpRight className="w-4 h-4" />} label="Pay Subscription"    active={activePage === "subscription-pay"}    onClick={() => onNavigate("subscription-pay")}    collapsed />
        <SidebarItem icon={<Users className="w-4 h-4" />}        label="My Subscriptions"   active={activePage === "subscription-my"}     onClick={() => onNavigate("subscription-my")}     collapsed />
      </>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
          isSubscriptionActive ? "text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        <span className="shrink-0 w-5 h-5 flex items-center justify-center">
          <CreditCard className="w-4 h-4" />
        </span>
        <span className="truncate flex-1 text-left">Subscription</span>
        <ChevronDown className={cn("w-4 h-4 transition-transform shrink-0", open && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="subscription-sub"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="ml-4 mt-1 space-y-0.5 border-l border-border pl-3">
              <SidebarItem icon={<Plus className="w-4 h-4" />}         label="Create Subscription" active={activePage === "subscription-create"} onClick={() => onNavigate("subscription-create")} collapsed={false} />
              <SidebarItem icon={<ArrowUpRight className="w-4 h-4" />} label="Pay Subscription"    active={activePage === "subscription-pay"}    onClick={() => onNavigate("subscription-pay")}    collapsed={false} />
              <SidebarItem icon={<Users className="w-4 h-4" />}        label="My Subscriptions"   active={activePage === "subscription-my"}     onClick={() => onNavigate("subscription-my")}     collapsed={false} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface DashSidebarProps {
  activePage: ActivePage;
  onNavigate: (p: ActivePage) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  user: any;
}

function DashSidebar({ activePage, onNavigate, collapsed, onToggleCollapse, mobileOpen, user }: DashSidebarProps) {
  const [, setLocation] = useLocation();

  const handleLogout = () => {
    localStorage.removeItem("token");
    setLocation("/login");
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <SidebarItem
          icon={<Home className="w-4 h-4" />}
          label="Home"
          active={false}
          onClick={() => setLocation("/landing")}
          collapsed={collapsed}
        />
        <SendSubMenu activePage={activePage} onNavigate={onNavigate} collapsed={collapsed} />

        <SidebarItem
          icon={<PlusCircle className="w-4 h-4" />}
          label="Fund"
          active={activePage === "fund"}
          onClick={() => onNavigate("fund")}
          collapsed={collapsed}
        />

        <PaymentSubMenu activePage={activePage} onNavigate={onNavigate} collapsed={collapsed} />

        <SubscriptionSubMenu activePage={activePage} onNavigate={onNavigate} collapsed={collapsed} />

        <SidebarItem
          icon={<LockKeyhole className="w-4 h-4" />}
          label="Security"
          active={activePage === "security"}
          onClick={() => onNavigate("security")}
          collapsed={collapsed}
        />
      </nav>

      {/* User + logout */}
      <div className={cn("border-t border-border p-2 space-y-1", collapsed && "px-1")}>
        {!collapsed && (
          <div className="px-3 py-2">
            <p className="text-xs font-semibold text-foreground truncate">{user?.name ?? "User"}</p>
            <p className="text-[11px] text-muted-foreground truncate">{user?.email ?? ""}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          title={collapsed ? "Log out" : undefined}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all",
            collapsed && "justify-center px-2",
          )}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col fixed left-0 top-28 h-[calc(100vh-7rem)] bg-white/95 backdrop-blur border-r border-border z-30 transition-all duration-300 w-60",
          collapsed && "translate-x-[-100%]",
        )}
      >
        {sidebarContent}
      </aside>

      {/* Toggle tab — always visible, slides with the sidebar edge */}
      <button
        onClick={onToggleCollapse}
        className={cn(
          "hidden lg:flex fixed top-[calc(50%+3.5rem)] -translate-y-1/2 z-40 items-center justify-center bg-white border border-l-0 border-border rounded-r-xl w-6 h-12 shadow-md hover:bg-secondary transition-all duration-300",
          collapsed ? "left-0" : "left-60",
        )}
        title={collapsed ? "Show sidebar" : "Hide sidebar"}
      >
        {collapsed
          ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          : <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
        }
      </button>

      {/* Mobile drawer */}
      <aside
        className={cn(
          "lg:hidden fixed left-0 top-0 h-screen w-72 bg-white z-50 flex flex-col border-r border-border shadow-2xl transition-transform duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="pt-28 flex flex-col flex-1 overflow-hidden">
          {sidebarContent}
        </div>
      </aside>
    </>
  );
}

// ─── Email Verification Pending overlay ───────────────────────────────────────

function EmailVerificationPending({ email }: { email: string }) {
  const [resent, setResent] = useState(false);
  const [sending, setSending] = useState(false);
  const resend = async () => {
    setSending(true);
    try {
      await fetch(`${API_BASE}/api/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/80 p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-border p-10 text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center">
            <Mail className="w-8 h-8 text-violet-600" />
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Verify your email</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            We sent a verification link to <strong className="text-foreground">{email}</strong>.
            Please click the link to activate your account.
          </p>
        </div>
        <div className="space-y-3">
          {resent && <p className="text-sm text-green-600 font-medium">A new verification link has been sent.</p>}
          <button onClick={resend} disabled={sending}
            className="w-full py-3 rounded-xl bg-primary text-white font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RefreshCw className="w-4 h-4" /> Resend verification email</>}
          </button>
          <button onClick={() => { localStorage.removeItem("token"); window.location.href = "/login"; }}
            className="w-full py-3 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Account Setup Wizard overlay ─────────────────────────────────────────────

function AccountSetupWizard({ user, onComplete }: { user: any; onComplete: () => void }) {
  const needsPak = !user.hasPak;
  const needsTxnPwd = !user.hasTransactionPassword;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50/80 p-4">
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-8 py-6 text-white">
          <h2 className="text-2xl font-bold">Complete your account setup</h2>
          <p className="text-violet-200 text-sm mt-1">
            Before you can use the platform, you need to secure your account.
          </p>
          <div className="flex items-center gap-3 mt-4">
            <div className={`flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full ${!needsPak ? 'bg-white/20 line-through opacity-60' : 'bg-white text-violet-700'}`}>
              <span className="w-5 h-5 rounded-full bg-violet-600 text-white text-xs flex items-center justify-center font-bold">1</span>
              Personal Authorization Key
            </div>
            <div className={`flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full ${!needsTxnPwd ? 'bg-white/20 line-through opacity-60' : 'bg-white/10 text-white'}`}>
              <span className="w-5 h-5 rounded-full bg-white/20 text-white text-xs flex items-center justify-center font-bold">2</span>
              Transaction Password
            </div>
          </div>
        </div>
        {/* Body */}
        <div className="p-8">
          <SecurityTab user={user} onSecurityUpdated={onComplete} />
        </div>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [activePage,       setActivePage]       = useState<ActivePage>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen,       setMobileOpen]       = useState(false);
  const [fundMethod,       setFundMethod]       = useState<"crypto" | "bank">("crypto");

  const { data: user, isLoading: isUserLoading, isError: isUserError } =
    useGetCurrentUser({ query: { retry: false } as any });
  const { data: balance, refetch: refetchBalance } =
    useGetUserBalance({ query: { enabled: !!user, refetchInterval: 5_000, refetchOnWindowFocus: true } as any });
  const bal = balance as FullBalance | undefined;

  // Unified transaction history (deposits + withdrawals + escrow)
  const { data: txHistory, error: txHistoryError, isError: isTxHistoryError, isLoading: isTxHistoryLoading } = useQuery({
    queryKey: ["/api/user/history"],
    enabled: !!user,
    staleTime: 0,                   // always consider data stale — refetch eagerly
    refetchInterval: 5_000,         // poll every 5 s (matches indexer cadence)
    refetchOnWindowFocus: true,     // refresh instantly when user switches back to tab
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/user/history`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`${res.status}: ${(body as any).message ?? res.statusText}`);
      }
      const data = await res.json() as { transactions: UnifiedTx[]; total: number };
      return data;
    },
  });

  const [selectedTx, setSelectedTx] = useState<UnifiedTx | null>(null);

  const invalidateHistory = () => queryClient.invalidateQueries({ queryKey: ["/api/user/history"] });

  const withdrawCryptoMutation = useWithdrawCrypto({
    mutation: {
      onSuccess: () => {
        refetchBalance();
        invalidateHistory();
      },
    },
  });

  useEffect(() => {
    if (!isUserLoading && isUserError) setLocation("/login");
  }, [isUserLoading, isUserError, setLocation]);

  // Reset to account overview when the header "Dashboard" link is clicked
  useEffect(() => {
    const handler = () => setActivePage("dashboard");
    window.addEventListener("nav:dashboard-overview", handler);
    return () => window.removeEventListener("nav:dashboard-overview", handler);
  }, []);

  if (isUserLoading || !user) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-7rem)]">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          >
            <Loader2 className="w-10 h-10 text-primary" />
          </motion.div>
        </div>
      </AppLayout>
    );
  }

  if (user && !(user as any).emailVerified) {
    return <EmailVerificationPending email={user.email} />;
  }

  if (user && (user as any).emailVerified && (!user.hasPak || !(user as any).hasTransactionPassword)) {
    return <AccountSetupWizard user={user} onComplete={() => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] })} />;
  }

  const circleWallet = (user as any)?.circleWalletAddress as string | undefined;

  return (
    <div className="min-h-screen bg-background">
      {/* Background orbs */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="orb orb-blue w-[500px] h-[500px] top-[-100px] right-[-100px] opacity-60" />
        <div className="orb orb-violet w-[400px] h-[400px] bottom-0 left-[-100px] opacity-40" />
      </div>

      <Navbar />

      <div className="flex pt-28 min-h-screen">
        {/* Mobile overlay */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <DashSidebar
          activePage={activePage}
          onNavigate={(page) => { setActivePage(page); setMobileOpen(false); }}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          mobileOpen={mobileOpen}
          user={user as any}
        />

        {/* Main content — offset by sidebar width */}
        <main className={cn(
          "flex-1 overflow-y-auto transition-all duration-300",
          sidebarCollapsed ? "lg:ml-0" : "lg:ml-60",
        )}>
          {/* Mobile top bar */}
          <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-white/80 backdrop-blur border-b border-border lg:hidden">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-xl bg-white border border-border shadow-sm"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="font-semibold text-foreground text-sm">
              {activePage === "dashboard"          ? "Dashboard"           :
               activePage === "send-usd"           ? "Send USD"            :
               activePage === "send-usdc"          ? "Send USDC"           :
               activePage === "fund"               ? "Fund"                :
               activePage === "recurring"          ? "Recurring"           :
               activePage === "subscription-create" ? "Create Subscription" :
               activePage === "subscription-pay"   ? "Pay Subscription"    :
               activePage === "subscription-my"    ? "My Subscriptions"    : "Security"}
            </span>
          </div>

          <AnimatePresence mode="wait">

            {/* ── DASHBOARD PAGE ─────────────────────────────────────────── */}
            {activePage === "dashboard" && (
              <motion.div
                key="page-dashboard"
                variants={staggerContainer(0.08, 0)}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6"
              >
                {/* Page header */}
                <motion.div variants={fadeUp} className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold font-display text-foreground">
                      Welcome back, {user.name.split(" ")[0]} 👋
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Here's your account overview</p>
                  </div>
                </motion.div>

                {/* Balance cards */}
                <div className="grid md:grid-cols-2 gap-5">
                  <motion.div
                    variants={fadeUp}
                    whileHover={{ y: -4, transition: { type: "spring", stiffness: 400, damping: 20 } }}
                    className="glass-panel p-6 rounded-3xl bg-gradient-to-br from-primary to-accent text-white border-none relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 w-48 h-48 bg-white/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/4 pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-40 h-40 bg-white/5 rounded-full blur-2xl translate-y-1/2 -translate-x-1/4 pointer-events-none" />
                    <div className="flex items-center gap-2 mb-4 text-white/80 text-sm font-medium">
                      <DollarSign className="w-4 h-4" /> USD Balance
                    </div>
                    <div className="text-4xl lg:text-5xl font-display font-bold tracking-tight mb-1">
                      {bal ? <AnimatedAmount value={bal.usdBalance} /> : "$0.00"}
                    </div>
                    <div className="text-white/70 text-xs mb-5">Backed 1:1 by USDC · stablecoin</div>
                    <div className="space-y-2 border-t border-white/20 pt-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/70 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-300 inline-block" /> On-chain escrow
                        </span>
                        <span className="font-semibold tabular-nums text-sm">{bal ? formatCurrency(bal.onChainUsdcBalance) : "$0.00"}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/70 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-300 inline-block" /> Credited balance
                        </span>
                        <span className="font-semibold tabular-nums text-sm">{bal ? formatCurrency(bal.claimedBalance) : "$0.00"}</span>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div
                    variants={fadeUp}
                    whileHover={{ y: -4, transition: { type: "spring", stiffness: 400, damping: 20 } }}
                    className="glass-panel p-6 rounded-3xl relative overflow-hidden"
                  >
                    <div className="flex items-center gap-2 mb-4 text-muted-foreground text-sm font-medium">
                      <ArrowUpRight className="w-4 h-4" /> Recent Transfers
                    </div>
                    <div className="text-4xl lg:text-5xl font-display font-bold text-foreground tracking-tight mb-1">
                      {bal ? <AnimatedAmount value={bal.claimedBalance} /> : "$0.00"}
                    </div>
                    <div className="text-muted-foreground text-xs">Available to send or withdraw</div>
                  </motion.div>
                </div>

                {/* Deposit address strip */}
                {circleWallet && (
                  <motion.div variants={fadeUp}
                    className="glass-panel p-4 rounded-2xl flex items-center justify-between gap-4 bg-gradient-to-r from-violet-50/80 to-blue-50/80 border border-violet-100"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shrink-0 shadow-lg shadow-violet-200">
                        <ShieldCheck className="w-4 h-4 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-violet-700 mb-0.5 flex items-center gap-1.5">
                          Deposit Address
                          <span className="px-1.5 py-0.5 rounded-full bg-violet-100 text-[10px] font-bold text-violet-600">Circle Wallet</span>
                        </p>
                        <p className="font-mono text-xs text-muted-foreground truncate">{circleWallet}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <CopyButton text={circleWallet} />
                      <a href={`https://sepolia.basescan.org/address/${circleWallet}`} target="_blank" rel="noopener noreferrer"
                        className="p-1 rounded hover:bg-secondary transition-colors" title="View on Base Sepolia explorer"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                      </a>
                    </div>
                  </motion.div>
                )}

                {/* Transaction history */}
                <motion.div variants={fadeUp} className="bg-white/80 backdrop-blur rounded-3xl shadow-sm border border-border overflow-hidden">
                  <div className="px-6 py-5 border-b border-border/60 flex items-center justify-between">
                    <h2 className="font-bold text-foreground flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" /> Transaction History
                    </h2>
                    {txHistory?.total ? (
                      <span className="text-xs text-muted-foreground">{txHistory.total} total</span>
                    ) : null}
                  </div>
                  <div className="p-4">
                    {isTxHistoryError ? (
                      <motion.div variants={scaleIn} className="text-center py-16 text-red-500">
                        <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-60" />
                        <p className="text-sm font-medium">Failed to load transactions</p>
                        <p className="text-xs mt-1 opacity-70">{(txHistoryError as Error)?.message ?? "Unknown error"}</p>
                      </motion.div>
                    ) : isTxHistoryLoading || !txHistory ? (
                      <motion.div variants={scaleIn} className="text-center py-16 text-muted-foreground">
                        <Loader2 className="w-8 h-8 mx-auto mb-3 opacity-40 animate-spin" />
                        <p className="text-sm">Loading transactions…</p>
                      </motion.div>
                    ) : !txHistory.transactions?.length ? (
                      <motion.div variants={scaleIn} className="text-center py-16 text-muted-foreground">
                        <Clock className="w-10 h-10 mx-auto mb-3 opacity-20" />
                        <p className="text-sm">No transactions yet</p>
                        <p className="text-xs mt-1 opacity-60">Your activity will appear here</p>
                      </motion.div>
                    ) : (
                      <motion.div variants={staggerContainer(0.06)} className="space-y-2">
                        {txHistory.transactions.map((tx) => {
                          const isIn = tx.direction === "in";
                          const isCrypto = tx.currency === "USDC";
                          const statusColor =
                            tx.status === "completed" || tx.status === "claimed"
                              ? "text-green-600"
                              : tx.status === "pending" || tx.status === "pending_transfer"
                              ? "text-amber-600"
                              : "text-muted-foreground";
                          const explorerUrl = getExplorerUrl(tx.network, tx.txHash ?? "");
                          const label = isCrypto
                            ? isIn ? `Received USDC` : `Sent USDC`
                            : isIn ? `Received USD` : `Sent USD`;
                          return (
                            <motion.div
                              key={tx.id}
                              variants={fadeUp}
                              whileHover={{ x: 3, transition: { type: "spring", stiffness: 400, damping: 20 } }}
                              className="flex items-center justify-between p-4 rounded-2xl border border-border/50 hover:bg-secondary/20 transition-colors gap-4 cursor-pointer"
                              onClick={() => setSelectedTx(selectedTx?.id === tx.id ? null : tx)}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                                  isIn ? "bg-green-100 text-green-600" : "bg-blue-100 text-blue-600")}>
                                  {isIn ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="font-semibold text-foreground text-sm">{label}</p>
                                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">{tx.category === "withdrawal" && isCrypto ? "Arc Testnet" : tx.network}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
                                    <span>{format(new Date(tx.createdAt), "MMM d, yyyy · h:mm a")}</span>
                                    <span className={cn("font-medium capitalize", statusColor)}>{tx.status.replace(/_/g, " ")}</span>
                                  </p>
                                  {/* Expanded detail row */}
                                  <AnimatePresence>
                                    {selectedTx?.id === tx.id && (
                                      <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto" }}
                                        exit={{ opacity: 0, height: 0 }}
                                        className="overflow-hidden"
                                      >
                                        <div className="mt-2 space-y-1 text-xs text-muted-foreground border-t border-border/40 pt-2">
                                          {tx.fromAddress && (
                                            <div className="flex items-start gap-1.5">
                                              <span className="shrink-0 font-medium text-foreground">From:</span>
                                              <span className="break-all font-mono">{tx.fromAddress}</span>
                                            </div>
                                          )}
                                          {tx.toAddress && (
                                            <div className="flex items-start gap-1.5">
                                              <span className="shrink-0 font-medium text-foreground">To:</span>
                                              <span className="break-all font-mono">{tx.toAddress}</span>
                                            </div>
                                          )}
                                          {!tx.fromAddress && !tx.toAddress && isCrypto && tx.direction === "in" && (
                                            <div className="flex items-start gap-1.5">
                                              <span className="shrink-0 font-medium text-foreground">Network:</span>
                                              <span>{tx.network}</span>
                                            </div>
                                          )}
                                          {tx.txHash && isOnChainHash(tx.txHash) && (
                                            <div className="flex items-center gap-1.5">
                                              <span className="shrink-0 font-medium text-foreground">Tx Hash:</span>
                                              <span className="font-mono">{tx.txHash.slice(0, 10)}…{tx.txHash.slice(-8)}</span>
                                              <CopyButton text={tx.txHash} />
                                            </div>
                                          )}
                                          {explorerUrl && !(tx.category === "withdrawal" && isCrypto) && (
                                            <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                                              className="flex items-center gap-1 text-primary hover:underline mt-1"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              View on explorer <ExternalLink className="w-3 h-3" />
                                            </a>
                                          )}
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              </div>
                              <div className="flex flex-col items-end shrink-0 gap-1">
                                <p className={cn("font-bold tabular-nums", isIn ? "text-green-600" : "text-foreground")}>
                                  {isIn ? "+" : "-"}{isCrypto ? `$${parseFloat(tx.amount).toFixed(2)} USDC` : formatCurrency(tx.amount)}
                                </p>
                                <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", selectedTx?.id === tx.id && "rotate-180")} />
                              </div>
                            </motion.div>
                          );
                        })}
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* ── NON-DASHBOARD PAGES ─────────────────────────────────────── */}
            {activePage !== "dashboard" && (
              <motion.div
                key={`page-${activePage}`}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
                transition={{ duration: 0.25 }}
                className={cn(
                  "px-4 sm:px-6 py-8 space-y-6",
                  (activePage === "subscription-my" || activePage === "subscription-create") ? "w-full" : "max-w-3xl mx-auto",
                )}
              >
                {/* Page header */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      onClick={() => setActivePage("dashboard")}
                      className="p-2 rounded-xl border border-border bg-white hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shrink-0"
                      title="Back to Dashboard"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="min-w-0">
                      <h1 className="text-xl font-bold font-display text-foreground truncate">
                        {activePage === "send-usd"            ? "Send USD"             :
                         activePage === "send-usdc"           ? "Send USDC"            :
                         activePage === "fund"                ? "Add Funds"             :
                         activePage === "recurring"           ? "Recurring"             :
                         activePage === "subscription-create" ? "Create Subscription"   :
                         activePage === "subscription-pay"   ? "Pay Subscription"      :
                         activePage === "subscription-my"    ? "Subscription Dashboard" : "Security"}
                      </h1>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {activePage === "send-usd"            ? "Transfer USD to any email address"          :
                         activePage === "send-usdc"           ? "Withdraw USDC to an external wallet"        :
                         activePage === "fund"                ? "Deposit USDC or fund via bank"              :
                         activePage === "recurring"           ? "Manage your scheduled transfers"            :
                         activePage === "subscription-create" ? "Set up a new subscription plan"             :
                         activePage === "subscription-pay"   ? "Pay an existing subscription"               :
                         activePage === "subscription-my"    ? "Manage your subscriptions and passport"      :
                                                               "Transaction password & authorization key"}
                      </p>
                    </div>
                  </div>

                  {/* Balance — always visible on non-dashboard tabs */}
                  <p className="text-base font-bold text-foreground tabular-nums shrink-0">
                    {bal ? formatCurrency(bal.claimedBalance) : "$0.00"}
                  </p>
                </div>

                {/* Page card — subscription-create manages its own layout */}
                <div className={cn(
                  "overflow-hidden",
                  activePage !== "subscription-create" && "bg-white/90 backdrop-blur rounded-3xl shadow-sm border border-border",
                )}>
                  <div className={
                    activePage === "subscription-create" ? "" :
                    activePage === "subscription-my"     ? "p-4 lg:p-6" :
                                                           "p-6 lg:p-8"
                  }>
                    <AnimatePresence mode="wait">

                      {activePage === "send-usd" && (
                        <motion.div key="send-usd" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
                          <DashboardSendForm onSuccess={() => setActivePage("dashboard")} hasTransactionPassword={(user as any).hasTransactionPassword} refetchBalance={refetchBalance} invalidateHistory={invalidateHistory} />
                        </motion.div>
                      )}

                      {activePage === "send-usdc" && (
                        <motion.div key="send-usdc" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
                          <CryptoWithdrawalForm mutation={withdrawCryptoMutation} maxAmount={balance?.claimedBalance || "0"} circleWalletAddress={circleWallet} hasTransactionPassword={(user as any).hasTransactionPassword} />
                        </motion.div>
                      )}

                      {activePage === "fund" && (
                        <motion.div key="fund" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
                          <div className="flex gap-2 p-1 bg-secondary rounded-xl mb-8">
                            {(["crypto", "bank"] as const).map((method) => (
                              <button key={method} onClick={() => method === "crypto" && setFundMethod(method)}
                                disabled={method === "bank"}
                                className={cn("flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all relative",
                                method === "bank" && "opacity-50 cursor-not-allowed",
                                  fundMethod === method ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
                              >
                                {fundMethod === method && (
                                  <motion.div layoutId="fund-tab-bg" className="absolute inset-0 bg-white rounded-lg shadow-sm"
                                    transition={{ type: "spring", stiffness: 400, damping: 30 }} />
                                )}
                                <span className="relative z-10 flex items-center gap-2">
                                  {method === "crypto" ? (
                                    <><QrCode className="w-4 h-4" /> Fund with Crypto</>
                                  ) : (
                                    <>
                                      <Landmark className="w-4 h-4" /> Direct Bank Deposit
                                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold leading-none border border-amber-200">
                                        Coming Soon
                                      </span>
                                    </>
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                          <AnimatePresence mode="wait">
                            {fundMethod === "crypto" ? (
                              <motion.div key="fund-crypto" variants={scaleIn} initial="hidden" animate="show" exit="hidden">
                                <CryptoDepositPanel />
                              </motion.div>
                            ) : (
                              <motion.div key="fund-bank" variants={scaleIn} initial="hidden" animate="show" exit="hidden">
                                <div className="flex flex-col items-center justify-center py-12 px-6 rounded-2xl bg-amber-50 border border-amber-200 text-center space-y-3">
                                  <Landmark className="w-8 h-8 text-amber-400" />
                                  <p className="font-semibold text-amber-800">Direct Bank Deposit — Coming Soon</p>
                                  <p className="text-sm text-amber-700">Bank deposit via wire transfer is not yet available. Use the <strong>Fund with Crypto</strong> tab to deposit USDC.</p>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )}

                      {activePage === "recurring" && (
                        <motion.div key="recurring" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
                          <RecurringTransferTab userEmail={user.email} availableBalance={parseFloat(balance?.claimedBalance ?? "0")} hasTransactionPassword={(user as any).hasTransactionPassword} />
                        </motion.div>
                      )}

                      {activePage === "subscription-create" && (
                        <motion.div key="subscription-create" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
                          <CreateSubscriptionTab user={user} />
                        </motion.div>
                      )}

                      {activePage === "subscription-pay" && (
                        <motion.div key="subscription-pay" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
                          <PaySubscriptionTab user={user} />
                        </motion.div>
                      )}

                      {activePage === "subscription-my" && (
                        <motion.div key="subscription-my" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
                          <MySubscriptionsTab user={user as any} />
                        </motion.div>
                      )}

                      {activePage === "security" && (
                        <motion.div key="security" variants={fadeIn} initial="hidden" animate="show" exit="hidden">
                          <SecurityTab user={user as any} onSecurityUpdated={() => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] })} />
                        </motion.div>
                      )}

                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// ─── Withdrawal sub-forms ─────────────────────────────────────────────────────

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const WITHDRAWAL_FEE = 0.10;

function CryptoWithdrawalForm({ mutation, maxAmount, circleWalletAddress, hasTransactionPassword }: { mutation: any; maxAmount: string; circleWalletAddress?: string; hasTransactionPassword?: boolean }) {
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [txnPwd,     setTxnPwd]     = useState("");

  const schema = z.object({
    walletAddress: z.string().regex(EVM_RE, "Invalid EVM address — must be 0x followed by 40 hex characters"),
    amount: z
      .string()
      .refine((v) => Number(v) > 0, "Amount must be positive")
      .refine(
        (v) => Number(v) + WITHDRAWAL_FEE <= Number(maxAmount),
        `Insufficient balance — you need amount + $${WITHDRAWAL_FEE.toFixed(2)} fee`,
      ),
  });

  const { register, handleSubmit, formState: { errors }, reset, setValue, watch } = useForm({ resolver: zodResolver(schema) });
  const watchedAddr   = watch("walletAddress", "");
  const watchedAmount = watch("amount", "");
  const addrValid     = EVM_RE.test(watchedAddr ?? "");
  const addrDirty     = (watchedAddr ?? "").length > 0;
  const parsedAmount  = parseFloat(watchedAmount) || 0;
  const totalAmount   = parsedAmount > 0 ? parsedAmount + WITHDRAWAL_FEE : 0;

  const onSubmit = async (data: any) => {
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await mutation.mutateAsync({ data: { ...data, ...(hasTransactionPassword && txnPwd ? { transactionPassword: txnPwd } : {}) } });
      setSuccessMsg(`Withdrawal of ${formatCurrency(data.amount)} USD initiated.`);
      setTxnPwd("");
      reset();
    } catch (e: any) {
      setErrorMsg(e?.message || "Withdrawal failed. Please try again.");
    }
  };

  return (
    <motion.form
      onSubmit={handleSubmit(onSubmit)}
      variants={staggerContainer(0.08)}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      <AnimatePresence>
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm overflow-hidden"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {successMsg}
          </motion.div>
        )}
        {errorMsg && <InlineError message={errorMsg} />}
      </AnimatePresence>

      <motion.div variants={fadeUp}>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-foreground">Destination Wallet Address</label>
          {circleWalletAddress && (
            <button
              type="button"
              onClick={() => setValue("walletAddress", circleWalletAddress, { shouldValidate: true })}
              className="text-xs font-semibold text-violet-600 hover:text-violet-700 flex items-center gap-1 transition-colors"
            >
              <ShieldCheck className="w-3 h-3" />
              Use my Circle wallet
            </button>
          )}
        </div>
        <input
          {...register("walletAddress")}
          placeholder="0x…"
          className={cn(
            "w-full px-4 py-3 rounded-xl bg-white border-2 border-border focus:ring-4 outline-none transition-all font-mono text-sm",
            errors.walletAddress
              ? "border-destructive focus:border-destructive focus:ring-destructive/10"
              : addrDirty && addrValid
              ? "border-green-400 focus:border-green-500 focus:ring-green-100"
              : addrDirty
              ? "border-amber-400 focus:border-amber-500 focus:ring-amber-100"
              : "focus:border-primary focus:ring-primary/10",
          )}
        />
        <AnimatePresence>
          {errors.walletAddress ? (
            <motion.p key="err" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-destructive text-sm mt-1.5 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{errors.walletAddress.message as string}
            </motion.p>
          ) : addrDirty && addrValid ? (
            <motion.p key="ok" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-green-600 text-sm mt-1.5 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Valid EVM address
            </motion.p>
          ) : addrDirty ? (
            <motion.p key="bad" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-amber-600 text-sm mt-1.5 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Not a valid EVM address — must start with 0x and be 42 characters total
            </motion.p>
          ) : null}
        </AnimatePresence>
      </motion.div>

      <motion.div variants={fadeUp}>
        <label className="block text-sm font-medium text-foreground mb-2">
          Amount <span className="text-muted-foreground font-normal">(max {formatCurrency(maxAmount)})</span>
        </label>
        <div className="relative">
          <span className="absolute left-4 inset-y-0 flex items-center text-muted-foreground">$</span>
          <input
            {...register("amount")}
            placeholder="10.00"
            type="number"
            step="0.01"
            className="w-full pl-8 pr-16 py-3 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all"
          />
          <span className="absolute right-4 inset-y-0 flex items-center text-muted-foreground text-sm">USD</span>
        </div>
        {errors.amount && <p className="text-destructive text-sm mt-1">{errors.amount.message as string}</p>}
      </motion.div>

      {/* Network notice */}
      <motion.div variants={fadeUp} className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-xs">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>Withdrawals are sent on the <strong>ARC Testnet</strong> network only.</span>
      </motion.div>

      {/* Fee breakdown */}
      <motion.div variants={fadeUp} className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 space-y-1.5 text-sm">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Amount to receive</span>
          <span className="font-medium text-foreground">{parsedAmount > 0 ? `$${parsedAmount.toFixed(2)}` : "—"} USDC</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Transaction fee</span>
          <span className="font-medium text-amber-700">${WITHDRAWAL_FEE.toFixed(2)} USDC</span>
        </div>
        <div className="border-t border-amber-200 pt-1.5 flex items-center justify-between font-semibold text-foreground">
          <span>Total deducted</span>
          <span>{totalAmount > 0 ? `$${totalAmount.toFixed(2)}` : "—"} USDC</span>
        </div>
      </motion.div>

      {hasTransactionPassword && (
        <motion.div variants={fadeUp}>
          <label className="block text-sm font-medium text-foreground mb-2">
            Transaction Password
          </label>
          <input
            type="password"
            value={txnPwd}
            onChange={(e) => setTxnPwd(e.target.value)}
            disabled={mutation.isPending}
            placeholder="Your transaction password"
            className="w-full px-4 py-3 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all"
          />
        </motion.div>
      )}

      <motion.div variants={fadeUp}>
        <motion.button
          type="submit"
          disabled={mutation.isPending}
          whileHover={!mutation.isPending ? { scale: 1.02, y: -1 } : {}}
          whileTap={!mutation.isPending ? { scale: 0.98 } : {}}
          className="w-full bg-primary text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-primary/25 transition-shadow disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {mutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Withdraw to Wallet"}
        </motion.button>
      </motion.div>
    </motion.form>
  );
}

// ─── Dashboard Send Form ──────────────────────────────────────────────────────

const dashSendSchema = z.object({
  recipientEmail: z.string().email("Please enter a valid email address"),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, "Must be a positive number")
    .refine((v) => Number(v) >= 0.01, "Minimum is $0.01 USD"),
});

type DashSendValues = z.infer<typeof dashSendSchema>;

type RecipientPreview = { registered: boolean; name: string | null; email: string };

function DashboardSendForm({ onSuccess, hasTransactionPassword, refetchBalance, invalidateHistory }: { onSuccess: () => void; hasTransactionPassword?: boolean; refetchBalance: () => void; invalidateHistory: () => void }) {
  const { data: balance } = useGetUserBalance({ query: { refetchInterval: 5_000 } as any });
  const [isSending,    setIsSending]    = useState(false);
  const [isLooking,    setIsLooking]    = useState(false);
  const [formError,    setFormError]    = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState("");
  const [successAmount, setSuccessAmount] = useState("");
  const [successName,  setSuccessName]  = useState("");
  const [didSucceed,   setDidSucceed]   = useState(false);
  const [txnPwd,       setTxnPwd]       = useState("");
  const [preview,      setPreview]      = useState<RecipientPreview | null>(null);
  const [pendingData,  setPendingData]  = useState<DashSendValues | null>(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<DashSendValues>({
    resolver: zodResolver(dashSendSchema),
  });

  const availableBalance = parseFloat(balance?.claimedBalance ?? "0");

  // Step 1 — validate locally, look up recipient, show confirmation screen
  const onReview = async (data: DashSendValues) => {
    setFormError(null);
    const numAmount = parseFloat(data.amount);
    if (numAmount > availableBalance) {
      setFormError(`Insufficient balance. You have $${availableBalance.toFixed(2)} USD available.`);
      return;
    }
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
      setPreview(json as RecipientPreview);
    } catch (err: any) {
      setFormError(err?.message ?? "Could not look up recipient. Please try again.");
    } finally {
      setIsLooking(false);
    }
  };

  // Step 2 — user confirmed; execute the transfer
  const onConfirm = async () => {
    if (!pendingData || !preview) return;
    setFormError(null);
    setIsSending(true);
    try {
      const jwt = localStorage.getItem("token");
      const sendHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (jwt) sendHeaders["Authorization"] = `Bearer ${jwt}`;
      const res = await fetch(`${API_BASE}/api/escrow/send/platform`, {
        method: "POST",
        headers: sendHeaders,
        body: JSON.stringify({
          recipientEmail: pendingData.recipientEmail.toLowerCase().trim(),
          amount: pendingData.amount,
          ...(hasTransactionPassword && txnPwd ? { transactionPassword: txnPwd } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to send payment");
      setTxnPwd("");
      setSuccessEmail(pendingData.recipientEmail.toLowerCase().trim());
      setSuccessAmount(pendingData.amount);
      setSuccessName(preview.name ?? "");
      setPreview(null);
      setPendingData(null);
      setDidSucceed(true);
      refetchBalance();
      invalidateHistory();
    } catch (err: any) {
      setFormError(err?.message ?? "Failed to send payment. Please try again.");
      setPreview(null);
    } finally {
      setIsSending(false);
    }
  };

  const handleReset = () => {
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
    <AnimatePresence mode="wait">
      {/* ── Success state ── */}
      {didSucceed ? (
        <motion.div
          key="success"
          variants={scaleIn}
          initial="hidden"
          animate="show"
          exit="hidden"
          className="text-center py-10"
        >
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
            className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg shadow-green-500/20"
          >
            <CheckCircle2 className="w-10 h-10" />
          </motion.div>

          <motion.div variants={staggerContainer(0.08)} initial="hidden" animate="show">
            <motion.h3 variants={fadeUp} className="text-2xl font-bold mb-1">Payment Sent!</motion.h3>
            <motion.p variants={fadeUp} className="text-muted-foreground text-sm mb-2">
              <span className="font-semibold text-foreground">${successAmount} USD</span> sent to{" "}
              <span className="font-semibold text-foreground">{successName || successEmail}</span>
              {successName && <span className="text-muted-foreground"> ({successEmail})</span>}.
              Their balance has been credited instantly.
            </motion.p>
            <motion.div variants={fadeUp} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-50 text-violet-700 text-xs font-medium border border-violet-200 mb-6">
              <ShieldCheck className="w-3.5 h-3.5" />
              Sent from your platform balance — no wallet needed
            </motion.div>

            <motion.div variants={fadeUp} className="flex items-center justify-center gap-3">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleReset}
                className="px-5 py-2.5 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors"
              >
                Send Another
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onSuccess}
                className="px-5 py-2.5 rounded-xl bg-primary text-white font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
              >
                <Clock className="w-4 h-4" /> View History
              </motion.button>
            </motion.div>
          </motion.div>
        </motion.div>
      ) : preview ? (
        /* ── Confirmation screen ── */
        <motion.div key="confirm" variants={staggerContainer(0.07, 0)} initial="hidden" animate="show" exit="hidden">
          <motion.div variants={fadeUp} className="mb-6">
            <button
              type="button"
              onClick={() => { setPreview(null); setFormError(null); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <h3 className="text-xl font-bold font-display">Confirm Transfer</h3>
            <p className="text-sm text-muted-foreground mt-0.5">Please review the details before sending</p>
          </motion.div>

          {/* Recipient card */}
          <motion.div variants={fadeUp} className="rounded-2xl border border-border bg-secondary/40 overflow-hidden mb-4">
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
                      <CheckCircle2 className="w-3 h-3" /> Verified Sweep user
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 mt-1">
                      <AlertCircle className="w-3 h-3" /> Not yet on Sweep — funds held until they join
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Amount</span>
              <span className="text-2xl font-bold text-foreground tabular-nums">
                ${parseFloat(pendingData!.amount).toFixed(2)}{" "}
                <span className="text-base font-medium text-muted-foreground">USD</span>
              </span>
            </div>
          </motion.div>

          {/* Transaction password on confirm screen */}
          {hasTransactionPassword && (
            <motion.div variants={fadeUp} className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-2">
                <Lock className="w-4 h-4 inline mr-1.5 opacity-60" />
                Transaction Password
              </label>
              <input
                type="password"
                value={txnPwd}
                onChange={(e) => setTxnPwd(e.target.value)}
                disabled={isSending}
                placeholder="Your transaction password"
                className="w-full px-4 py-3 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none disabled:opacity-60"
              />
            </motion.div>
          )}

          {/* Error */}
          <AnimatePresence>
            {formError && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-3 px-4 py-3 mb-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive overflow-hidden"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{formError}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div variants={fadeUp}>
            <motion.button
              type="button"
              onClick={onConfirm}
              disabled={isSending}
              whileHover={!isSending ? { scale: 1.02, y: -1 } : {}}
              whileTap={!isSending ? { scale: 0.98 } : {}}
              className="w-full relative group flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold text-white overflow-hidden bg-primary disabled:opacity-70 disabled:cursor-not-allowed transition-shadow hover:shadow-xl hover:shadow-primary/30"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-primary to-accent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
              <span className="relative z-10 flex items-center gap-2">
                {isSending
                  ? <><Loader2 className="w-5 h-5 animate-spin" />Sending…</>
                  : <><ShieldCheck className="w-5 h-5" />Confirm &amp; Send<ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>
                }
              </span>
            </motion.button>
          </motion.div>
        </motion.div>

      ) : (
        /* ── Form state ── */
        <motion.div key="form" variants={staggerContainer(0.08, 0)} initial="hidden" animate="show" exit="hidden">
          {/* Header */}
          <motion.div variants={fadeUp} className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold font-display">Send USD</h3>
                <p className="text-sm text-muted-foreground mt-0.5">Send USD instantly to any email address</p>
              </div>
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 text-violet-700 rounded-full text-xs font-semibold border border-violet-200"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                No wallet needed
              </motion.div>
            </div>
          </motion.div>

          {/* Available balance callout */}
          <motion.div variants={fadeUp} className="flex items-center justify-between px-4 py-3 rounded-xl bg-secondary/60 border border-border mb-5">
            <span className="text-sm text-muted-foreground">Available balance</span>
            <span className="font-bold text-foreground tabular-nums">{formatCurrency(balance?.claimedBalance ?? "0")}</span>
          </motion.div>

          {/* Error message */}
          <AnimatePresence>
            {formError && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -6 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-start gap-3 px-4 py-3 mb-5 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive overflow-hidden"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{formError}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit(onReview)} className="space-y-5">
            {/* Recipient email */}
            <motion.div variants={fadeUp}>
              <label className="block text-sm font-medium text-foreground mb-2">
                <Mail className="w-4 h-4 inline mr-1.5 opacity-60" />
                Recipient Email
              </label>
              <input
                {...register("recipientEmail")}
                disabled={isLooking}
                type="email"
                autoComplete="off"
                placeholder="satoshi@example.com"
                className={cn(
                  "w-full px-4 py-3 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none disabled:opacity-60",
                  errors.recipientEmail && "border-destructive focus:border-destructive focus:ring-destructive/10",
                )}
              />
              <AnimatePresence>
                {errors.recipientEmail && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 text-sm text-destructive">
                    {errors.recipientEmail.message}
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Amount */}
            <motion.div variants={fadeUp}>
              <label className="block text-sm font-medium text-foreground mb-2">
                Amount (USD)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <span className="text-muted-foreground font-medium">$</span>
                </div>
                <input
                  {...register("amount")}
                  disabled={isLooking}
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="100.00"
                  className={cn(
                    "w-full pl-8 pr-16 py-3 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none font-medium disabled:opacity-60",
                    errors.amount && "border-destructive focus:border-destructive focus:ring-destructive/10",
                  )}
                />
                <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
                  <span className="text-muted-foreground font-medium text-sm">USD</span>
                </div>
              </div>
              <AnimatePresence>
                {errors.amount && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 text-sm text-destructive">
                    {errors.amount.message}
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Info note */}
            <motion.div variants={fadeUp} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/10 text-sm text-muted-foreground">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <span>Funds are deducted from your balance and credited to the recipient instantly.</span>
            </motion.div>

            {/* Review button */}
            <motion.div variants={fadeUp}>
              <motion.button
                type="submit"
                disabled={isLooking}
                whileHover={!isLooking ? { scale: 1.02, y: -1 } : {}}
                whileTap={!isLooking ? { scale: 0.98 } : {}}
                className="w-full relative group flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold text-white overflow-hidden bg-primary disabled:opacity-70 disabled:cursor-not-allowed transition-shadow hover:shadow-xl hover:shadow-primary/30"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-primary to-accent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                <span className="relative z-10 flex items-center gap-2">
                  {isLooking
                    ? <><Loader2 className="w-5 h-5 animate-spin" />Looking up recipient…</>
                    : <><Send className="w-5 h-5" />Review Transfer<ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></>
                  }
                </span>
              </motion.button>
            </motion.div>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Recurring Transfers Tab ──────────────────────────────────────────────────

interface RecurringTransfer {
  id: number;
  recipientEmail: string;
  amount: string;
  interval: "hourly" | "daily" | "weekly" | "monthly";
  nextRunAt: string;
  endDate: string | null;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
}

const recurringSchema = z.object({
  recipientEmail: z.string().email("Please enter a valid email address"),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine((v) => !isNaN(Number(v)) && Number(v) > 0, "Must be a positive number")
    .refine((v) => Number(v) >= 0.01, "Minimum is $0.01 USD"),
  interval: z.enum(["hourly", "daily", "weekly", "monthly"]),
  startHour: z.number().int().min(0).max(23).optional(),
  startDayOfWeek: z.number().int().min(0).max(6).optional(),
  startDayOfMonth: z.number().int().min(1).max(31).optional(),
  endDate: z.string().optional(),
});

type RecurringValues = z.infer<typeof recurringSchema>;

function RecurringTransferTab({ userEmail, availableBalance, hasTransactionPassword }: { userEmail: string; availableBalance: number; hasTransactionPassword?: boolean }) {
  const [transfers, setTransfers]   = useState<RecurringTransfer[]>([]);
  const [isLoading, setIsLoading]   = useState(true);
  const [showForm,  setShowForm]    = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [formError, setFormError]   = useState<string | null>(null);
  const [txnPwd,    setTxnPwd]      = useState("");
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<RecurringValues>({
    resolver: zodResolver(recurringSchema),
    defaultValues: { interval: "monthly", startHour: 9, startDayOfWeek: 1, startDayOfMonth: 1 },
  });
  const selectedInterval = watch("interval");

  const authHeaders = () => {
    const jwt = localStorage.getItem("token");
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (jwt) h["Authorization"] = `Bearer ${jwt}`;
    return h;
  };

  const fetchTransfers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/recurring`, { headers: authHeaders() });
      if (res.ok) setTransfers(await res.json());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchTransfers(); }, []);

  const onSubmit = async (data: RecurringValues) => {
    setFormError(null);
    if (parseFloat(data.amount) > availableBalance) {
      setFormError(`Insufficient balance. You have $${availableBalance.toFixed(2)} USD available.`);
      return;
    }
    if (data.recipientEmail.toLowerCase().trim() === userEmail.toLowerCase()) {
      setFormError("You cannot schedule transfers to yourself.");
      return;
    }
    setIsSubmitting(true);
    try {
      const body: Record<string, any> = {
        recipientEmail: data.recipientEmail.toLowerCase().trim(),
        amount: data.amount,
        interval: data.interval,
      };
      if (data.interval !== "hourly" && data.startHour !== undefined) body["startHour"] = data.startHour;
      if (data.interval === "weekly" && data.startDayOfWeek !== undefined) body["startDayOfWeek"] = data.startDayOfWeek;
      if (data.interval === "monthly" && data.startDayOfMonth !== undefined) body["startDayOfMonth"] = data.startDayOfMonth;
      if (data.endDate) body["endDate"] = new Date(data.endDate).toISOString();
      if (hasTransactionPassword && txnPwd) body["transactionPassword"] = txnPwd;
      const res = await fetch(`${API_BASE}/api/recurring`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to create recurring transfer");
      setFormSuccess(json.message);
      setTxnPwd("");
      reset();
      setShowForm(false);
      fetchTransfers();
    } catch (err: any) {
      setFormError(err?.message ?? "Failed to create. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async (id: number) => {
    setCancellingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/recurring/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.ok) fetchTransfers();
    } finally {
      setCancellingId(null);
    }
  };

  const activeTransfers    = transfers.filter((t) => t.status === "active");
  const inactiveTransfers  = transfers.filter((t) => t.status !== "active");

  const intervalLabel: Record<string, string> = { hourly: "Hourly", daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
  const statusColor: Record<string, string> = {
    active:    "bg-green-100 text-green-700",
    completed: "bg-secondary text-muted-foreground",
    cancelled: "bg-red-50 text-red-500",
  };

  return (
    <motion.div variants={staggerContainer(0.08, 0)} initial="hidden" animate="show" className="space-y-6">
      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold font-display">Recurring Transfers</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Automate payments at regular intervals</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => { setShowForm((v) => !v); setFormError(null); setFormSuccess(null); }}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
            showForm
              ? "bg-secondary text-muted-foreground hover:bg-secondary/80"
              : "bg-primary text-white shadow-lg shadow-primary/20 hover:shadow-primary/30",
          )}
        >
          {showForm ? <><X className="w-4 h-4" />Cancel</> : <><Plus className="w-4 h-4" />New Recurring</>}
        </motion.button>
      </motion.div>

      {/* Success banner */}
      <AnimatePresence>
        {formSuccess && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm overflow-hidden"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {formSuccess}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            key="form"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-5 rounded-2xl border border-border bg-secondary/30 space-y-4">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Repeat className="w-4 h-4 text-primary" />
                Schedule a recurring transfer
              </p>

              <AnimatePresence>
                {formError && <InlineError message={formError} />}
              </AnimatePresence>

              {/* Available balance */}
              <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-white border border-border text-sm">
                <span className="text-muted-foreground">Available balance</span>
                <span className="font-bold tabular-nums">{formatCurrency(String(availableBalance))}</span>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {/* Recipient email */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    <Mail className="w-4 h-4 inline mr-1.5 opacity-60" />
                    Recipient Email
                  </label>
                  <input
                    {...register("recipientEmail")}
                    type="email"
                    placeholder="satoshi@example.com"
                    className={cn(
                      "w-full px-4 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-sm",
                      errors.recipientEmail && "border-destructive",
                    )}
                  />
                  {errors.recipientEmail && <p className="mt-1 text-xs text-destructive">{errors.recipientEmail.message}</p>}
                </div>

                {/* Amount + Interval row */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Amount (USD)</label>
                    <div className="relative">
                      <span className="absolute left-3 inset-y-0 flex items-center text-muted-foreground text-sm">$</span>
                      <input
                        {...register("amount")}
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="50.00"
                        className={cn(
                          "w-full pl-7 pr-3 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-sm",
                          errors.amount && "border-destructive",
                        )}
                      />
                    </div>
                    {errors.amount && <p className="mt-1 text-xs text-destructive">{errors.amount.message}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Frequency</label>
                    <select
                      {...register("interval")}
                      className="w-full px-3 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-sm"
                    >
                      <option value="hourly">Hourly</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>

                {/* Timing fields — conditional on interval */}
                {selectedInterval !== "hourly" && (
                  <div className="grid grid-cols-2 gap-3">
                    {/* Start hour — all non-hourly intervals */}
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Start Time (hour)</label>
                      <select
                        {...register("startHour", { valueAsNumber: true })}
                        className="w-full px-3 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-sm"
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {h === 0 ? "12:00 AM" : h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM" : `${h - 12}:00 PM`}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Day of week — weekly only */}
                    {selectedInterval === "weekly" && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Day of Week</label>
                        <select
                          {...register("startDayOfWeek", { valueAsNumber: true })}
                          className="w-full px-3 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-sm"
                        >
                          {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d, i) => (
                            <option key={i} value={i}>{d}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Day of month — monthly only */}
                    {selectedInterval === "monthly" && (
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1.5">Day of Month</label>
                        <select
                          {...register("startDayOfMonth", { valueAsNumber: true })}
                          className="w-full px-3 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-sm"
                        >
                          {Array.from({ length: 28 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>{i + 1}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* End date */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    <CalendarDays className="w-4 h-4 inline mr-1.5 opacity-60" />
                    End Date <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <input
                    {...register("endDate")}
                    type="date"
                    min={new Date(Date.now() + 86_400_000).toISOString().split("T")[0]}
                    className="w-full px-4 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-sm"
                  />
                </div>

                {/* Transaction password — shown only if user has one set */}
                {hasTransactionPassword && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">
                      <Lock className="w-4 h-4 inline mr-1.5 opacity-60" />
                      Transaction Password
                    </label>
                    <input
                      type="password"
                      value={txnPwd}
                      onChange={(e) => setTxnPwd(e.target.value)}
                      placeholder="Your transaction password"
                      className="w-full px-4 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-sm"
                    />
                  </div>
                )}

                <motion.button
                  type="submit"
                  disabled={isSubmitting}
                  whileHover={!isSubmitting ? { scale: 1.02, y: -1 } : {}}
                  whileTap={!isSubmitting ? { scale: 0.98 } : {}}
                  className="w-full bg-primary text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-primary/25 transition-shadow disabled:opacity-70 disabled:cursor-not-allowed text-sm"
                >
                  {isSubmitting
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</>
                    : <><Repeat className="w-4 h-4" />Schedule Transfer</>
                  }
                </motion.button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transfer list */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-8 h-8 animate-spin text-primary/40" />
        </div>
      ) : transfers.length === 0 ? (
        <motion.div variants={scaleIn} className="text-center py-12 text-muted-foreground">
          <Repeat className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="font-medium">No recurring transfers yet</p>
          <p className="text-sm mt-1">Create one above to automate your payments.</p>
        </motion.div>
      ) : (
        <div className="space-y-5">
          {/* Active */}
          {activeTransfers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Active</p>
              <motion.div variants={staggerContainer(0.06)} className="space-y-2">
                {activeTransfers.map((t) => (
                  <motion.div
                    key={t.id}
                    variants={fadeUp}
                    className="flex items-center justify-between p-4 rounded-2xl border border-border/50 bg-white hover:bg-secondary/10 transition-colors gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Repeat className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate">{t.recipientEmail}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] font-bold", statusColor[t.status])}>
                            {intervalLabel[t.interval]}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-border" />
                          <span>Next: {format(new Date(t.nextRunAt), "MMM d, yyyy")}</span>
                          {t.endDate && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-border" />
                              <span>Ends: {format(new Date(t.endDate), "MMM d, yyyy")}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <p className="font-bold text-foreground tabular-nums">{formatCurrency(t.amount)}</p>
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleCancel(t.id)}
                        disabled={cancellingId === t.id}
                        title="Cancel recurring transfer"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                      >
                        {cancellingId === t.id
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />
                        }
                      </motion.button>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          )}

          {/* Past */}
          {inactiveTransfers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Past</p>
              <motion.div variants={staggerContainer(0.06)} className="space-y-2">
                {inactiveTransfers.map((t) => (
                  <motion.div
                    key={t.id}
                    variants={fadeUp}
                    className="flex items-center justify-between p-4 rounded-2xl border border-border/30 bg-secondary/20 gap-4 opacity-70"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-secondary text-muted-foreground flex items-center justify-center shrink-0">
                        <Repeat className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate">{t.recipientEmail}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] font-bold", statusColor[t.status])}>
                            {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-border" />
                          <span>{intervalLabel[t.interval]}</span>
                        </p>
                      </div>
                    </div>
                    <p className="font-bold text-muted-foreground tabular-nums shrink-0">{formatCurrency(t.amount)}</p>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ─── Security Tab ─────────────────────────────────────────────────────────────

interface SecurityUser {
  hasTransactionPassword?: boolean;
  hasPak?: boolean;
  pakCopied?: boolean;
  pakPreview?: string | null;
  pakCreatedAt?: string | null;
  pakCanRegenerate?: boolean;
  nextPakAllowedAt?: string | null;
}

type SecurityView =
  | "overview"
  | "set-txn-otp"   | "set-txn-pwd"
  | "gen-pak-otp"   | "gen-pak-reveal"
  | "chg-login-pak" | "chg-login-otp"
  | "chg-txn-pak"   | "chg-txn-otp"
  | "del-acct-pak"  | "del-acct-otp";

function PasswordInput({ label, placeholder, value, onChange, disabled }: {
  label: string; placeholder?: string; value: string;
  onChange: (v: string) => void; disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "••••••••"}
          disabled={disabled}
          className="w-full px-4 py-2.5 pr-10 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-sm disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-3 inset-y-0 flex items-center text-muted-foreground hover:text-foreground transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function OtpStep({ label, otp, setOtp, onResend, onSubmit, isLoading, error, submitLabel, submitClassName }: {
  label: string; otp: string; setOtp: (v: string) => void;
  onResend: () => void; onSubmit: () => void;
  isLoading: boolean; error: string | null;
  submitLabel?: string; submitClassName?: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      {error && <InlineError message={error} />}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">6-digit verification code</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          className="w-full px-4 py-3 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none text-center text-2xl font-mono tracking-widest"
        />
      </div>
      <motion.button
        whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
        onClick={onSubmit}
        disabled={isLoading || otp.length < 6}
        className={cn("w-full font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-shadow disabled:opacity-70 text-sm",
          submitClassName ?? "bg-primary text-white hover:shadow-lg hover:shadow-primary/25")}
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
        {isLoading ? "Verifying…" : (submitLabel ?? "Verify Code")}
      </motion.button>
      <button onClick={onResend} disabled={isLoading} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1">
        Resend code
      </button>
    </div>
  );
}

function SecurityTab({ user, onSecurityUpdated }: { user: SecurityUser; onSecurityUpdated: () => void }) {
  const [view, setView] = useState<SecurityView>("overview");
  const [otp, setOtp]   = useState("");
  const [pak, setPak]   = useState("");
  const [pwd, setPwd]   = useState("");
  const [pwd2, setPwd2] = useState("");  // confirm new password
  const [revealedPak, setRevealedPak] = useState<string | null>(null);
  const [pakCopiedLocally, setPakCopiedLocally] = useState(false);
  const [isLoading, setIsLoading]   = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState<string | null>(null);

  const reset = () => { setOtp(""); setPak(""); setPwd(""); setPwd2(""); setError(null); };

  const authHeaders = () => {
    const jwt = localStorage.getItem("token");
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (jwt) h["Authorization"] = `Bearer ${jwt}`;
    return h;
  };

  const api = async (path: string, body?: object) => {
    const res = await fetch(`${API_BASE}/api/security${path}`, {
      method: "POST",
      headers: authHeaders(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message ?? "Request failed");
    return json;
  };

  const run = async (fn: () => Promise<void>) => {
    setIsLoading(true);
    setError(null);
    try { await fn(); } catch (e: any) { setError(e?.message ?? "Something went wrong"); }
    finally { setIsLoading(false); }
  };

  // ── Transaction password ─────────────────────────────────────────────────

  const requestTxnOtp = () => run(async () => {
    await api("/txn-password/request-otp");
    setView("set-txn-otp");
  });

  const confirmTxnOtp = () => run(async () => {
    if (pwd.length < 6)  { setError("Transaction password must be at least 6 characters"); return; }
    if (pwd !== pwd2)    { setError("Passwords do not match"); return; }
    await api("/txn-password/set", { otp, password: pwd });
    setSuccess("Transaction password set successfully.");
    onSecurityUpdated();
    reset(); setView("overview");
  });

  // Resend OTP for current flow
  const resendOtp = () => run(async () => {
    const pathMap: Partial<Record<SecurityView, string>> = {
      "set-txn-otp":  "/txn-password/request-otp",
      "gen-pak-otp":  "/pak/request-otp",
      "chg-login-otp": "/change-login-password/request-otp",
      "chg-txn-otp":  "/change-txn-password/request-otp",
      "del-acct-otp": "/delete-account/request-otp",
    };
    const path = pathMap[view];
    if (!path) return;
    // For PAK-gated flows, re-send needs the PAK
    if (view === "chg-login-otp" || view === "chg-txn-otp" || view === "del-acct-otp") {
      await api(path, { pak });
    } else {
      await api(path);
    }
  });

  // ── PAK generation ───────────────────────────────────────────────────────

  // First-time only: no OTP — email already verified at sign-up
  const generatePakDirect = () => run(async () => {
    const data = await api("/pak/generate-first");
    setRevealedPak(data.pak);
    setView("gen-pak-reveal");
    reset();
  });

  // Regeneration: requires OTP (existing PAK being replaced)
  const requestPakOtp = () => run(async () => {
    await api("/pak/request-otp");
    setView("gen-pak-otp");
  });

  const confirmPakOtp = () => run(async () => {
    const data = await api("/pak/generate", { otp });
    setRevealedPak(data.pak);
    setView("gen-pak-reveal");
    reset();
  });

  const copyPak = async () => {
    if (!revealedPak) return;
    await navigator.clipboard.writeText(revealedPak);
    setPakCopiedLocally(true);
  };

  const confirmPakCopied = () => run(async () => {
    await api("/pak/confirm-copied");
    setRevealedPak(null);
    setPakCopiedLocally(false);
    setSuccess("PAK saved. Keep it in a secure place — it cannot be recovered.");
    onSecurityUpdated();
    setView("overview");
  });

  // ── Change login password ────────────────────────────────────────────────

  const requestChangeLoginOtp = () => run(async () => {
    if (!pak.trim())    { setError("Please enter your PAK"); return; }
    if (pwd.length < 8) { setError("New password must be at least 8 characters"); return; }
    if (!pwd2)          { setError("Please confirm your new password"); return; }
    if (pwd !== pwd2)   { setError("Passwords do not match — please re-enter both fields"); return; }
    await api("/change-login-password/request-otp", { pak: pak.trim() });
    setView("chg-login-otp");
  });

  const confirmChangeLogin = () => run(async () => {
    if (pwd.length < 8) { setError("New password must be at least 8 characters"); return; }
    if (pwd !== pwd2)   { setError("Passwords do not match"); return; }
    await api("/change-login-password/confirm", { pak: pak.trim(), newPassword: pwd, otp });
    setSuccess("Login password changed successfully.");
    onSecurityUpdated();
    reset(); setView("overview");
  });

  // ── Change transaction password ──────────────────────────────────────────

  const requestChangeTxnOtp = () => run(async () => {
    if (!pak.trim())    { setError("Please enter your PAK"); return; }
    if (pwd.length < 6) { setError("Transaction password must be at least 6 characters"); return; }
    if (!pwd2)          { setError("Please confirm your new password"); return; }
    if (pwd !== pwd2)   { setError("Passwords do not match — please re-enter both fields"); return; }
    await api("/change-txn-password/request-otp", { pak: pak.trim() });
    setView("chg-txn-otp");
  });

  const confirmChangeTxn = () => run(async () => {
    if (pwd.length < 6) { setError("Transaction password must be at least 6 characters"); return; }
    if (pwd !== pwd2)   { setError("Passwords do not match"); return; }
    await api("/change-txn-password/confirm", { pak: pak.trim(), newPassword: pwd, otp });
    setSuccess("Transaction password changed successfully.");
    onSecurityUpdated();
    reset(); setView("overview");
  });

  // ── Delete account ───────────────────────────────────────────────────────

  const requestDeleteOtp = () => run(async () => {
    if (!pak.trim()) { setError("Please enter your PAK"); return; }
    await api("/delete-account/request-otp", { pak: pak.trim() });
    setView("del-acct-otp");
  });

  const confirmDeleteAccount = () => run(async () => {
    await api("/delete-account/confirm", { pak: pak.trim(), otp });
    // Account deleted — clear local auth state and redirect to landing page
    localStorage.removeItem("token");
    sessionStorage.clear();
    window.location.replace("/");
  });

  // ── Render ───────────────────────────────────────────────────────────────

  const backToOverview = () => { reset(); setView("overview"); };

  const panelHeader = (title: string, subtitle?: string) => (
    <div className="flex items-center gap-3 mb-6">
      <button onClick={backToOverview} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
        <X className="w-4 h-4" />
      </button>
      <div>
        <h4 className="font-bold text-foreground">{title}</h4>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );

  return (
    <motion.div variants={staggerContainer(0.08, 0)} initial="hidden" animate="show" className="space-y-6">
      {/* Page header */}
      {view === "overview" && (
        <motion.div variants={fadeUp} className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-200">
            <LockKeyhole className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold font-display">Security</h3>
            <p className="text-sm text-muted-foreground">Transaction password &amp; authorization key</p>
          </div>
        </motion.div>
      )}

      {/* Global success */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm overflow-hidden"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {success}
            <button onClick={() => setSuccess(null)} className="ml-auto text-green-600 hover:text-green-800"><X className="w-3.5 h-3.5" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── OVERVIEW ── */}
      {view === "overview" && (
        <motion.div variants={staggerContainer(0.06)} className="space-y-4">

          {/* Error display */}
          {error && (
            <motion.div variants={fadeUp} className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
            </motion.div>
          )}

          {/* PAK card */}
          <motion.div variants={fadeUp} className="p-5 rounded-2xl border border-border bg-white space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center",
                  user.hasPak ? "bg-violet-100 text-violet-600" : "bg-secondary text-muted-foreground")}>
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">Personal Authorization Key (PAK)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {user.hasPak
                      ? user.pakPreview
                        ? <>Preview: <span className="font-mono">{user.pakPreview}</span></>
                        : "Generated"
                      : "Required to change your passwords"}
                  </p>
                </div>
              </div>
              <span className={cn("px-2.5 py-1 rounded-full text-xs font-bold shrink-0",
                user.hasPak ? "bg-violet-100 text-violet-700" : "bg-secondary text-muted-foreground")}>
                {user.hasPak ? (user.pakCopied ? "Saved" : "Not confirmed") : "None"}
              </span>
            </div>

            {/* PAK not-copied warning */}
            {user.hasPak && !user.pakCopied && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>You haven't confirmed copying your PAK yet. If you've saved it, click "Confirm saved" below.</span>
              </div>
            )}

            {user.nextPakAllowedAt && (
              <p className="text-xs text-muted-foreground">
                Next regeneration allowed: {format(new Date(user.nextPakAllowedAt), "MMM d, yyyy")}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {!user.hasPak ? (
                <button onClick={generatePakDirect} disabled={isLoading}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-violet-700 transition-colors disabled:opacity-60">
                  {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                  Generate PAK
                </button>
              ) : user.pakCanRegenerate ? (
                <button onClick={requestPakOtp} disabled={isLoading}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-violet-700 transition-colors disabled:opacity-60">
                  {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                  Regenerate PAK
                </button>
              ) : null}
              {user.hasPak && !user.pakCopied && (
                <button onClick={() => run(() => api("/pak/confirm-copied").then(() => { onSecurityUpdated(); setSuccess("PAK confirmed as saved."); }))}
                  disabled={isLoading}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-semibold flex items-center gap-1.5 hover:bg-secondary/80 transition-colors disabled:opacity-60">
                  <CheckCircle2 className="w-3 h-3" /> Confirm saved
                </button>
              )}
            </div>
          </motion.div>

          {/* Transaction Password card */}
          <motion.div variants={fadeUp} className="p-5 rounded-2xl border border-border bg-white space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center",
                  user.hasTransactionPassword ? "bg-green-100 text-green-600" : "bg-amber-100 text-amber-600")}>
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-semibold text-foreground text-sm">Transaction Password</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {user.hasTransactionPassword ? "Required for all outgoing transfers" : "Not set — transactions are unprotected"}
                  </p>
                </div>
              </div>
              <span className={cn("px-2.5 py-1 rounded-full text-xs font-bold",
                user.hasTransactionPassword ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700")}>
                {user.hasTransactionPassword ? "Active" : "Not set"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {!user.hasTransactionPassword ? (
                <button onClick={requestTxnOtp} disabled={isLoading}
                  className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-primary/90 transition-colors disabled:opacity-60">
                  {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
                  Set Transaction Password
                </button>
              ) : (
                <button onClick={() => { reset(); setView("chg-txn-pak"); }} disabled={!user.hasPak}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-semibold flex items-center gap-1.5 hover:bg-secondary/80 transition-colors disabled:opacity-40"
                  title={!user.hasPak ? "Generate a PAK first to change passwords" : undefined}>
                  <RefreshCw className="w-3 h-3" /> Change
                </button>
              )}
            </div>
          </motion.div>

          {/* Change Login Password card */}
          {user.hasPak && (
            <motion.div variants={fadeUp} className="p-5 rounded-2xl border border-border bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                    <RefreshCw className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground text-sm">Change Login Password</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Requires your PAK + email OTP</p>
                  </div>
                </div>
                <button onClick={() => { reset(); setView("chg-login-pak"); }}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-semibold flex items-center gap-1.5 hover:bg-secondary/80 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Change
                </button>
              </div>
            </motion.div>
          )}

          {/* Info note when no PAK */}
          {!user.hasPak && (
            <motion.div variants={fadeUp} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-violet-50 border border-violet-100 text-sm text-violet-700">
              <KeyRound className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Generate your PAK first. It is needed to change your login or transaction password in the future.</span>
            </motion.div>
          )}

          {/* Delete Account card */}
          <motion.div variants={fadeUp} className="p-5 rounded-2xl border-2 border-red-200 bg-red-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-semibold text-red-700 text-sm">Delete Account</p>
                  <p className="text-xs text-red-500 mt-0.5">Permanently removes all your data — irreversible</p>
                </div>
              </div>
              <button onClick={() => { reset(); setView("del-acct-pak"); }} disabled={!user.hasPak}
                title={!user.hasPak ? "Generate a PAK first to delete your account" : undefined}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* ── SET TRANSACTION PASSWORD — OTP step ── */}
      {view === "set-txn-otp" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Set Transaction Password", "Enter the code sent to your email, then choose a password")}
          {error && <InlineError message={error} />}
          <OtpStep
            label="A 6-digit code was sent to your email to verify this action."
            otp={otp} setOtp={setOtp}
            onResend={() => run(() => api("/txn-password/request-otp"))}
            onSubmit={() => {
              // After OTP collected, advance to password entry
              run(async () => {
                // We verify OTP + set password together in one step
                setView("set-txn-pwd");
                setError(null);
              });
            }}
            isLoading={isLoading} error={null}
          />
        </motion.div>
      )}

      {/* ── SET TRANSACTION PASSWORD — password entry ── */}
      {view === "set-txn-pwd" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Set Transaction Password", "Choose a password for authorizing transfers")}
          {error && <InlineError message={error} />}
          <PasswordInput label="New Transaction Password (min 6 chars)" value={pwd} onChange={setPwd} disabled={isLoading} />
          <PasswordInput label="Confirm Password" value={pwd2} onChange={setPwd2} disabled={isLoading} />
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={confirmTxnOtp} disabled={isLoading}
            className="w-full bg-primary text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-primary/25 transition-shadow disabled:opacity-70 text-sm">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {isLoading ? "Setting…" : "Set Transaction Password"}
          </motion.button>
        </motion.div>
      )}

      {/* ── GENERATE PAK — OTP step ── */}
      {view === "gen-pak-otp" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Generate PAK", "Verify your identity before generating your key")}
          <OtpStep
            label="A 6-digit code was sent to your email."
            otp={otp} setOtp={setOtp}
            onResend={() => run(() => api("/pak/request-otp"))}
            onSubmit={confirmPakOtp}
            isLoading={isLoading} error={error}
          />
        </motion.div>
      )}

      {/* ── PAK REVEAL (one-time) ── */}
      {view === "gen-pak-reveal" && revealedPak && (
        <motion.div variants={fadeUp} className="space-y-5">
          {panelHeader("Your Personal Authorization Key", "This is displayed exactly once")}

          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
            <div className="flex items-center gap-2 text-amber-800 text-xs font-semibold">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Copy this key and store it somewhere safe. You cannot view it again.
            </div>
            <div className="font-mono text-sm text-amber-900 bg-white border border-amber-200 rounded-xl px-4 py-3 break-all select-all">
              {revealedPak}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={copyPak}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 font-semibold text-sm transition-all",
                pakCopiedLocally
                  ? "border-green-300 bg-green-50 text-green-700"
                  : "border-border bg-white text-foreground hover:border-primary hover:text-primary",
              )}
            >
              {pakCopiedLocally ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {pakCopiedLocally ? "Copied!" : "Copy to Clipboard"}
            </button>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={confirmPakCopied}
            disabled={isLoading}
            className={cn(
              "w-full font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all text-sm",
              pakCopiedLocally
                ? "bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-200"
                : "bg-secondary text-muted-foreground cursor-not-allowed opacity-60",
            )}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            I've saved my PAK securely
          </motion.button>
          {error && <InlineError message={error} />}
        </motion.div>
      )}

      {/* ── CHANGE LOGIN PASSWORD — PAK entry ── */}
      {view === "chg-login-pak" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Change Login Password", "Step 1 of 2 — enter your PAK")}
          {error && <InlineError message={error} />}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              <KeyRound className="w-4 h-4 inline mr-1.5 opacity-60" />
              Personal Authorization Key (PAK)
            </label>
            <input value={pak} onChange={(e) => setPak(e.target.value)}
              placeholder="Your 40-character PAK"
              className="w-full px-4 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none text-sm font-mono" />
          </div>
          <PasswordInput label="New Login Password (min 8 chars)" value={pwd} onChange={setPwd} disabled={isLoading} />
          <div>
            <PasswordInput label="Confirm New Password" value={pwd2} onChange={setPwd2} disabled={isLoading} />
            {pwd2.length > 0 && (
              <p className={cn("text-xs mt-1.5 flex items-center gap-1.5", pwd === pwd2 ? "text-green-600" : "text-destructive")}>
                {pwd === pwd2
                  ? <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Passwords match</>
                  : <><AlertCircle className="w-3.5 h-3.5 shrink-0" /> Passwords do not match</>}
              </p>
            )}
          </div>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={requestChangeLoginOtp} disabled={isLoading || !pak.trim() || (pwd2.length > 0 && pwd !== pwd2)}
            className="w-full bg-primary text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-primary/25 transition-shadow disabled:opacity-70 text-sm">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {isLoading ? "Verifying PAK…" : "Continue"}
          </motion.button>
        </motion.div>
      )}

      {/* ── CHANGE LOGIN PASSWORD — OTP step ── */}
      {view === "chg-login-otp" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Change Login Password", "Step 2 of 2 — verify your email")}
          <OtpStep
            label="A verification code was sent to your email to confirm the password change."
            otp={otp} setOtp={setOtp}
            onResend={resendOtp}
            onSubmit={confirmChangeLogin}
            isLoading={isLoading} error={error}
          />
        </motion.div>
      )}

      {/* ── CHANGE TRANSACTION PASSWORD — PAK entry ── */}
      {view === "chg-txn-pak" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Change Transaction Password", "Step 1 of 2 — enter your PAK")}
          {error && <InlineError message={error} />}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              <KeyRound className="w-4 h-4 inline mr-1.5 opacity-60" />
              Personal Authorization Key (PAK)
            </label>
            <input value={pak} onChange={(e) => setPak(e.target.value)}
              placeholder="Your 40-character PAK"
              className="w-full px-4 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none text-sm font-mono" />
          </div>
          <PasswordInput label="New Transaction Password (min 6 chars)" value={pwd} onChange={setPwd} disabled={isLoading} />
          <div>
            <PasswordInput label="Confirm New Password" value={pwd2} onChange={setPwd2} disabled={isLoading} />
            {pwd2.length > 0 && (
              <p className={cn("text-xs mt-1.5 flex items-center gap-1.5", pwd === pwd2 ? "text-green-600" : "text-destructive")}>
                {pwd === pwd2
                  ? <><CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Passwords match</>
                  : <><AlertCircle className="w-3.5 h-3.5 shrink-0" /> Passwords do not match</>}
              </p>
            )}
          </div>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={requestChangeTxnOtp} disabled={isLoading || !pak.trim() || (pwd2.length > 0 && pwd !== pwd2)}
            className="w-full bg-primary text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-primary/25 transition-shadow disabled:opacity-70 text-sm">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {isLoading ? "Verifying PAK…" : "Continue"}
          </motion.button>
        </motion.div>
      )}

      {/* ── CHANGE TRANSACTION PASSWORD — OTP step ── */}
      {view === "chg-txn-otp" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Change Transaction Password", "Step 2 of 2 — verify your email")}
          <OtpStep
            label="A verification code was sent to your email to confirm the password change."
            otp={otp} setOtp={setOtp}
            onResend={resendOtp}
            onSubmit={confirmChangeTxn}
            isLoading={isLoading} error={error}
          />
        </motion.div>
      )}

      {/* ── DELETE ACCOUNT — PAK entry ── */}
      {view === "del-acct-pak" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Delete Account", "Step 1 of 2 — authorize with your PAK")}
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>This action is permanent and cannot be undone.</strong> All your data — balance, transaction history, wallets, and settings — will be erased forever.
            </span>
          </div>
          {error && <InlineError message={error} />}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              <KeyRound className="w-4 h-4 inline mr-1.5 opacity-60" />
              Personal Authorization Key (PAK)
            </label>
            <input value={pak} onChange={(e) => setPak(e.target.value)}
              placeholder="Your 40-character PAK"
              className="w-full px-4 py-2.5 rounded-xl bg-white border-2 border-red-300 focus:border-red-500 focus:ring-4 focus:ring-red-100 outline-none text-sm font-mono" />
            <p className="text-xs text-muted-foreground mt-1.5">
              Your PAK is required to prove this request came from you — not from an admin or anyone with database access.
            </p>
          </div>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={requestDeleteOtp} disabled={isLoading || !pak.trim()}
            className="w-full bg-red-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-red-700 transition-colors disabled:opacity-70 text-sm">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            {isLoading ? "Verifying PAK…" : "Continue to confirmation"}
          </motion.button>
        </motion.div>
      )}

      {/* ── DELETE ACCOUNT — OTP step ── */}
      {view === "del-acct-otp" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Delete Account", "Step 2 of 2 — confirm via email")}
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Enter the code sent to your email to <strong>permanently delete</strong> your account. This cannot be reversed.</span>
          </div>
          <OtpStep
            label="A verification code was sent to your email. Enter it below to confirm account deletion."
            otp={otp} setOtp={setOtp}
            onResend={resendOtp}
            onSubmit={confirmDeleteAccount}
            isLoading={isLoading} error={error}
            submitLabel="Delete My Account"
            submitClassName="bg-red-600 hover:bg-red-700 text-white"
          />
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Fund with Crypto ─────────────────────────────────────────────────────────

// ─── Chain metadata for deposit UI ───────────────────────────────────────────

const CHAIN_META: Record<string, { label: string; color: string; badge: string }> = {
  "BASE-SEPOLIA":  { label: "Base Sepolia",      color: "blue",   badge: "bg-blue-100 text-blue-700 border-blue-200" },
  "ETH-SEPOLIA":   { label: "Ethereum Sepolia",  color: "indigo", badge: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  "MATIC-AMOY":    { label: "Polygon Amoy",      color: "violet", badge: "bg-violet-100 text-violet-700 border-violet-200" },
  "ARB-SEPOLIA":   { label: "Arbitrum Sepolia",  color: "sky",    badge: "bg-sky-100 text-sky-700 border-sky-200" },
  "AVAX-FUJI":     { label: "Avalanche Fuji",    color: "red",    badge: "bg-red-100 text-red-700 border-red-200" },
};

function CryptoDepositPanel() {
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [activeChain, setActiveChain] = useState<string>("BASE-SEPOLIA");

  useEffect(() => {
    const jwt = localStorage.getItem("token");
    fetch(`${API_BASE}/api/deposit/addresses`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.addresses && Object.keys(data.addresses).length > 0) {
          setAddresses(data.addresses);
          setActiveChain(Object.keys(data.addresses)[0]);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const chains = Object.keys(addresses);
  const activeAddress = addresses[activeChain] ?? "";

  return (
    <motion.div
      variants={staggerContainer(0.08)}
      initial="hidden"
      animate="show"
      className="space-y-5"
    >
      {/* Header */}
      <motion.div variants={fadeUp} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-sm">
        <QrCode className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Send <strong>USDC</strong> on any supported network below. Your balance is
          credited automatically.
        </span>
      </motion.div>

      {loading && (
        <motion.div variants={fadeUp} className="flex items-center gap-3 px-4 py-5 rounded-xl bg-secondary text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>Loading your deposit addresses…</span>
        </motion.div>
      )}

      {error && (
        <motion.div variants={fadeUp} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      {!loading && !error && chains.length > 0 && (
        <>
          {/* Chain selector tabs */}
          <motion.div variants={fadeUp} className="flex flex-wrap gap-2">
            {chains.map((chain) => {
              const meta = CHAIN_META[chain];
              const isActive = chain === activeChain;
              return (
                <button
                  key={chain}
                  onClick={() => setActiveChain(chain)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                    isActive
                      ? meta?.badge ?? "bg-gray-100 text-gray-700 border-gray-200"
                      : "bg-white text-muted-foreground border-border hover:border-foreground/30",
                  )}
                >
                  {meta?.label ?? chain}
                </button>
              );
            })}
          </motion.div>

          {/* Selected chain address */}
          <motion.div variants={fadeUp} className="p-5 rounded-2xl bg-white border-2 border-border space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">
                Your USDC deposit address
              </p>
              <span className={cn(
                "px-2 py-0.5 rounded-md text-xs font-semibold border",
                CHAIN_META[activeChain]?.badge ?? "bg-gray-100 text-gray-700 border-gray-200",
              )}>
                {CHAIN_META[activeChain]?.label ?? activeChain}
              </span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary">
              <code className="flex-1 text-xs font-mono break-all text-foreground">{activeAddress}</code>
              <CopyButton text={activeAddress} />
            </div>
            <p className="text-xs text-muted-foreground">
              Only send <strong>USDC</strong> on <strong>Base Sepolia</strong> and <strong>Arc Testnet</strong>.
              Sending other tokens or the wrong network may cause permanent loss of funds.
            </p>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200">
              <span className="text-violet-500 text-xs mt-0.5">ℹ</span>
              <p className="text-xs text-violet-700">
                <strong>Same address, all networks.</strong> Your deposit address is identical across Base Sepolia and Arc Testnet — you do not need a different address per chain.
              </p>
            </div>
          </motion.div>

        </>
      )}
    </motion.div>
  );
}

// ─── Direct Bank Deposit — Circle wire transfer ───────────────────────────────
// User is shown Circle's wire deposit instructions and their unique tracking ref.
// They send a USD wire from their bank — balance is credited when Circle receives it.
// Sandbox: a "Simulate Deposit" button calls the mock wire endpoint for testing.

interface WireInstructions {
  trackingRef: string;
  beneficiary: { name: string; address1: string; address2: string };
  beneficiaryBank: {
    name: string;
    swiftCode: string;
    routingNumber: string;
    accountNumber: string;
    currency: string;
    address: string;
    city: string;
    postalCode: string;
    country: string;
  };
}

function BankDepositForm({ onSuccess: _onSuccess }: { onSuccess: () => void }) {
  const [instructions, setInstructions] = useState<WireInstructions | null>(null);
  const [isLoading,    setIsLoading]    = useState(true);
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [mockAmount,   setMockAmount]   = useState("");
  const [mockStatus,   setMockStatus]   = useState<"idle" | "sending" | "sent">("idle");
  const [mockError,    setMockError]    = useState<string | null>(null);

  const authFetch = async (path: string, method: "GET" | "POST" = "GET", body?: object) => {
    const jwt = localStorage.getItem("token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (jwt) headers["Authorization"] = `Bearer ${jwt}`;
    const res = await fetch(`${API_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message ?? "Request failed");
    return json;
  };

  useEffect(() => {
    authFetch("/api/deposit/wire/instructions")
      .then((data) => setInstructions(data))
      .catch((e: any) => setErrorMsg(e.message || "Could not load wire instructions."))
      .finally(() => setIsLoading(false));
  }, []);

  const handleMockDeposit = async () => {
    const amt = parseFloat(mockAmount);
    if (!amt || amt <= 0) { setMockError("Enter a valid amount"); return; }
    setMockError(null);
    setMockStatus("sending");
    try {
      await authFetch("/api/deposit/wire/mock", "POST", { amount: amt.toFixed(2) });
      setMockStatus("sent");
      setMockAmount("");
    } catch (e: any) {
      setMockError(e.message || "Simulation failed");
      setMockStatus("idle");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 py-8 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading your wire deposit instructions…
      </div>
    );
  }

  if (errorMsg || !instructions) {
    return (
      <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{errorMsg ?? "Could not load instructions. Please refresh."}</span>
      </div>
    );
  }

  const { beneficiary, beneficiaryBank, trackingRef } = instructions;

  const bankRows = [
    { label: "Beneficiary Name",  value: beneficiary?.name                },
    { label: "Bank Name",         value: beneficiaryBank?.name            },
    { label: "Routing Number",    value: beneficiaryBank?.routingNumber   },
    { label: "Account Number",    value: beneficiaryBank?.accountNumber   },
    { label: "SWIFT / BIC",       value: beneficiaryBank?.swiftCode       },
    { label: "Bank Address",      value: [beneficiaryBank?.address, beneficiaryBank?.city, beneficiaryBank?.postalCode, beneficiaryBank?.country].filter(Boolean).join(", ") },
  ].filter((r) => r.value);

  return (
    <motion.div variants={staggerContainer(0.06)} initial="hidden" animate="show" className="space-y-5">

      {/* Intro */}
      <motion.div variants={fadeUp} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-sm">
        <Building2 className="w-4 h-4 shrink-0 mt-0.5" />
        <span>Send a <strong>USD wire transfer</strong> to the bank details below. Your balance is credited automatically once Circle receives the funds.</span>
      </motion.div>

      {/* Circle bank details */}
      <motion.div variants={fadeUp} className="rounded-2xl border-2 border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-border">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-600">Wire Destination</span>
          <span className="text-xs text-muted-foreground">USD · Circle / JPMorgan Chase</span>
        </div>
        {bankRows.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between px-4 py-3 border-b border-border last:border-b-0 bg-white">
            <span className="text-sm text-muted-foreground shrink-0 mr-4">{label}</span>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-foreground font-mono truncate">{value}</span>
              <CopyButton text={value!} />
            </div>
          </div>
        ))}
      </motion.div>

      {/* Tracking reference — must be included in wire memo */}
      <motion.div variants={fadeUp} className="rounded-2xl border-2 border-amber-300 overflow-hidden bg-amber-50">
        <div className="px-4 py-2.5 border-b border-amber-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-xs font-bold uppercase tracking-wide text-amber-700">Required Wire Reference</span>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="space-y-0.5">
            <p className="text-sm text-amber-800 font-semibold font-mono">{trackingRef}</p>
            <p className="text-xs text-amber-600">You <strong>must</strong> include this in the wire reference / memo field</p>
          </div>
          <CopyButton text={trackingRef} />
        </div>
      </motion.div>

      {/* Info note */}
      <motion.div variants={fadeUp} className="flex items-start gap-2 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-xs">
        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
        <span>These wire details are permanent and unique to your account. Your USD balance is credited automatically — typically within 1–2 business days of the wire being sent.</span>
      </motion.div>

      {/* Sandbox simulator */}
      <motion.div variants={fadeUp} className="rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-violet-200">
          <span className="text-xs font-bold uppercase tracking-wide text-violet-600">Sandbox — Simulate Deposit</span>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-violet-700">In sandbox mode you can simulate an incoming wire deposit. Circle processes mock deposits in batches and your balance will be credited within ~15 minutes.</p>
          {mockStatus === "sent" ? (
            <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Mock wire submitted — credit pending (up to 15 min)
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                step="0.01"
                placeholder="Amount (USD)"
                value={mockAmount}
                onChange={(e) => setMockAmount(e.target.value)}
                className="flex-1 h-9 rounded-lg border border-violet-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              <button
                type="button"
                disabled={mockStatus === "sending"}
                onClick={handleMockDeposit}
                className="h-9 px-4 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                {mockStatus === "sending" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {mockStatus === "sending" ? "Sending…" : "Simulate"}
              </button>
            </div>
          )}
          {mockError && <p className="text-xs text-red-600">{mockError}</p>}
        </div>
      </motion.div>

    </motion.div>
  );
}

// ─── Subscription Status Badge ────────────────────────────────────────────────

function SubscriptionStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:    "bg-green-100 text-green-700 border-green-200",
    trialing:  "bg-violet-100 text-violet-700 border-violet-200",
    past_due:  "bg-amber-100 text-amber-700 border-amber-200",
    cancelled: "bg-secondary text-muted-foreground border-border",
    failed:    "bg-red-100 text-red-700 border-red-200",
  };
  const label = status === "past_due" ? "Past due" : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0", styles[status] ?? styles["cancelled"])}>
      {label}
    </span>
  );
}

// ─── My Subscriptions Tab ─────────────────────────────────────────────────────

type SubStatusFilter = "all" | "active" | "trialing" | "past_due" | "cancelled";

function MySubscriptionsTab({ user }: { user: { name: string; email: string; hasTransactionPassword?: boolean } }) {
  // ── Subscriber view ──────────────────────────────────────────────────────────
  const [subscriptions,  setSubscriptions]  = useState<any[]>([]);
  const [isLoading,      setIsLoading]      = useState(true);
  const [cancellingId,   setCancellingId]   = useState<number | null>(null);
  const [cancelError,    setCancelError]    = useState<string | null>(null);

  // ── Passport ─────────────────────────────────────────────────────────────────
  const [passport,          setPassport]          = useState<{ hasPassport: boolean; status: string | null; issuedAt?: string; passportId?: string } | null>(null);
  const [isLoadingPassport, setIsLoadingPassport] = useState(true);
  const [isRevoking,        setIsRevoking]        = useState(false);
  const [revokeError,       setRevokeError]       = useState<string | null>(null);

  // ── Creator view ─────────────────────────────────────────────────────────────
  const [plans,              setPlans]              = useState<any[]>([]);
  const [isLoadingPlans,     setIsLoadingPlans]     = useState(true);
  const [expandedPlanId,     setExpandedPlanId]     = useState<number | null>(null);
  const [planSubscribers,    setPlanSubscribers]    = useState<Record<number, any[]>>({});
  const [loadingSubscribers, setLoadingSubscribers] = useState<Record<number, boolean>>({});
  const [subFilter,          setSubFilter]          = useState<Record<number, SubStatusFilter>>({});

  // ── Subscriber table search / filter ─────────────────────────────────────────
  const [tableSearch, setTableSearch] = useState("");
  const [tableFilter, setTableFilter] = useState<"all" | "active" | "trialing" | "past_due" | "ended">("all");

  const authHeaders = () => {
    const jwt = localStorage.getItem("token");
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (jwt) h["Authorization"] = `Bearer ${jwt}`;
    return h;
  };

  useEffect(() => {
    (async () => {
      try {
        const res  = await fetch(`${API_BASE}/api/subscriptions/my`, { headers: authHeaders() });
        const data = await res.json();
        if (res.ok) setSubscriptions(data.subscriptions ?? []);
      } finally { setIsLoading(false); }
    })();
    (async () => {
      try {
        const res  = await fetch(`${API_BASE}/api/subscriptions/plans`, { headers: authHeaders() });
        const data = await res.json();
        if (res.ok) setPlans(data.plans ?? []);
      } finally { setIsLoadingPlans(false); }
    })();
    (async () => {
      try {
        const res  = await fetch(`${API_BASE}/api/subscriptions/passport`, { headers: authHeaders() });
        const data = await res.json();
        if (res.ok) setPassport(data);
      } finally { setIsLoadingPassport(false); }
    })();
  }, []);

  const handleCancel = async (id: number) => {
    setCancelError(null);
    setCancellingId(id);
    try {
      const res  = await fetch(`${API_BASE}/api/subscriptions/${id}`, { method: "DELETE", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Failed to cancel");
      setSubscriptions((prev) =>
        prev.map((s) => s.id === id ? { ...s, status: "cancelled", cancelledAt: new Date().toISOString() } : s),
      );
    } catch (err: any) {
      setCancelError(err.message ?? "Failed to cancel subscription");
    } finally {
      setCancellingId(null);
    }
  };

  const togglePlanSubscribers = async (planId: number) => {
    if (expandedPlanId === planId) { setExpandedPlanId(null); return; }
    setExpandedPlanId(planId);
    if (planSubscribers[planId]) return;
    setLoadingSubscribers((prev) => ({ ...prev, [planId]: true }));
    try {
      const res  = await fetch(`${API_BASE}/api/subscriptions/plans/${planId}/subscribers`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setPlanSubscribers((prev) => ({ ...prev, [planId]: data.subscribers ?? [] }));
    } finally {
      setLoadingSubscribers((prev) => ({ ...prev, [planId]: false }));
    }
  };

  const handleRevokePassport = async () => {
    setRevokeError(null);
    setIsRevoking(true);
    try {
      const res  = await fetch(`${API_BASE}/api/subscriptions/passport`, { method: "DELETE", headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Failed to revoke passport");
      setPassport((prev) => prev ? { ...prev, status: "revoked" } : prev);
    } catch (err: any) {
      setRevokeError(err.message ?? "Failed to revoke passport");
    } finally {
      setIsRevoking(false);
    }
  };

  // Subscriber groups
  const activeSubs   = subscriptions.filter((s) => s.status === "active");
  const trialingSubs = subscriptions.filter((s) => s.status === "trialing");
  const pastDueSubs  = subscriptions.filter((s) => s.status === "past_due");

  const totalRevenue = plans.reduce((sum: number, p: any) => sum + parseFloat(p.totalRevenue ?? "0"), 0);
  const activePlanCount = plans.reduce((sum: number, p: any) => sum + (p.activeSubscriberCount ?? 0), 0);

  // Total spend = sum of amounts for all currently billed subscriptions
  const totalSpend = subscriptions
    .filter((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due")
    .reduce((sum, s) => sum + parseFloat(s.amount ?? "0"), 0);

  // Earliest upcoming billing/trial-end date
  const nextBillingInfo = (() => {
    const billing = subscriptions
      .filter((s) => (s.status === "active" || s.status === "past_due") && s.nextBillingAt)
      .sort((a: any, b: any) => new Date(a.nextBillingAt).getTime() - new Date(b.nextBillingAt).getTime())[0];
    const trialing = subscriptions
      .filter((s) => s.status === "trialing" && s.trialEndsAt)
      .sort((a: any, b: any) => new Date(a.trialEndsAt).getTime() - new Date(b.trialEndsAt).getTime())[0];
    if (!billing && !trialing) return null;
    if (!billing) return { date: trialing.trialEndsAt, label: `${trialing.planTitle} trial ends` };
    if (!trialing) return { date: billing.nextBillingAt, label: billing.planTitle };
    return new Date(trialing.trialEndsAt) < new Date(billing.nextBillingAt)
      ? { date: trialing.trialEndsAt, label: `${trialing.planTitle} trial ends` }
      : { date: billing.nextBillingAt, label: billing.planTitle };
  })();

  // Passport activations count
  const passportUsesDisplay = passport?.hasPassport
    ? subscriptions.filter((s) => s.status !== "cancelled" && s.status !== "failed").length
    : 0;

  // Filtered subscriptions for the table
  const filteredTableSubs = subscriptions.filter((sub) => {
    const q = tableSearch.toLowerCase();
    const matchesSearch = !q ||
      sub.planTitle?.toLowerCase().includes(q) ||
      sub.merchantId?.toLowerCase().includes(q);
    const matchesFilter =
      tableFilter === "all" ||
      (tableFilter === "active"    && sub.status === "active") ||
      (tableFilter === "trialing"  && sub.status === "trialing") ||
      (tableFilter === "past_due"  && sub.status === "past_due") ||
      (tableFilter === "ended"     && (sub.status === "cancelled" || sub.status === "failed"));
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="flex flex-col gap-6 w-full">

      {/* ── Passport card — standalone, credit-card size ── */}
      {isLoadingPassport ? (
        <div className="w-[380px] rounded-2xl border border-border bg-white px-5 py-4 flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking passport…
        </div>
      ) : !passport?.hasPassport ? (
        <div className="w-[380px] rounded-2xl border border-dashed border-border bg-secondary/20 px-5 py-6 flex flex-col items-center text-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white border border-border flex items-center justify-center">
            <ShieldOff className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">No passport yet</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Complete your first subscription to earn a passport.</p>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "relative rounded-2xl overflow-hidden w-[380px] shrink-0",
            passport.status === "active"    ? "bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950" :
            passport.status === "suspended" ? "bg-gradient-to-br from-slate-900 via-slate-800 to-amber-950"   :
                                              "bg-gradient-to-br from-slate-800 to-slate-900",
          )}
          style={{ aspectRatio: "85.6 / 54" }}
        >
          {/* Decorative glows */}
          <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full opacity-[0.08] bg-white pointer-events-none" />
          <div className="absolute -bottom-10 -left-6  w-36 h-36 rounded-full opacity-[0.05] bg-white pointer-events-none" />

          <div className="relative h-full px-5 pt-4 pb-4 flex flex-col justify-between">
            {/* Top row: brand label left, status badge right */}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[9px] font-bold text-white/40 uppercase tracking-[0.18em]">Subscription</p>
                <p className="text-xl font-black text-white tracking-tight leading-tight mt-0.5">PASSPORT</p>
              </div>
              <span className={cn(
                "text-[9px] font-bold px-2 py-0.5 rounded-full border mt-0.5",
                passport.status === "active"    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" :
                passport.status === "suspended" ? "bg-amber-500/20 text-amber-300 border-amber-500/30"       :
                                                  "bg-white/10 text-white/40 border-white/10",
              )}>
                {passport.status === "active" ? "ACTIVE" : passport.status === "suspended" ? "SUSPENDED" : "REVOKED"}
              </span>
            </div>

            {/* Passport ID */}
            <div>
              <p className="text-[8px] text-white/35 uppercase tracking-widest mb-1">Passport ID</p>
              <p className="text-[13px] font-mono font-bold text-white tracking-[0.15em] leading-none">
                {passport.passportId ?? "—"}
              </p>
            </div>

            {/* Bottom row: holder left, meta right */}
            <div className="border-t border-white/10 pt-2.5 flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[8px] text-white/35 uppercase tracking-widest mb-0.5">Holder</p>
                <p className="text-xs font-semibold text-white leading-tight truncate">{user.name}</p>
                <p className="text-[9px] text-white/40 truncate max-w-[140px]">{user.email}</p>
              </div>
              <div className="flex items-end gap-3 shrink-0">
                <div className="text-right">
                  <p className="text-[8px] text-white/35 uppercase tracking-widest mb-0.5">Issued</p>
                  <p className="text-[11px] font-semibold text-white/70">
                    {passport.issuedAt
                      ? new Date(passport.issuedAt).toLocaleDateString("en-US", { month: "2-digit", year: "2-digit" })
                      : "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[8px] text-white/35 uppercase tracking-widest mb-0.5">TXN Pwd</p>
                  {passport.status === "active"
                    ? <p className="text-[11px] font-semibold text-emerald-400">✓ Active</p>
                    : passport.status === "suspended"
                    ? <p className="text-[11px] font-semibold text-amber-400">Changed</p>
                    : <p className="text-[11px] text-white/30">—</p>}
                </div>
                {/* Revoke sits beside TXN Pwd — same bottom-right cluster, never overlaps status badge */}
                {passport.status === "active" && (
                  <div className="text-right">
                    {revokeError && <p className="text-[8px] text-red-400 mb-0.5">{revokeError}</p>}
                    <button
                      type="button"
                      onClick={handleRevokePassport}
                      disabled={isRevoking}
                      className="text-[9px] px-2 py-0.5 rounded border bg-white/10 text-white/40 hover:bg-white/20 disabled:opacity-50 font-medium transition border-white/10 whitespace-nowrap"
                    >
                      {isRevoking ? "Revoking…" : "Revoke"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats row — 6 equal cards ── */}
      <div className="grid grid-cols-6 gap-3">
        <div className="rounded-xl border border-border bg-white px-4 py-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Active</p>
            <Plus className="w-3 h-3 text-muted-foreground/40" />
          </div>
          <p className="text-2xl font-bold text-foreground">{activeSubs.length}</p>
          <p className="text-[11px] text-muted-foreground">subscriptions</p>
        </div>
        <div className="rounded-xl border border-border bg-white px-4 py-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Trialing</p>
            <RefreshCw className="w-3 h-3 text-muted-foreground/40" />
          </div>
          <p className="text-2xl font-bold text-foreground">{trialingSubs.length}</p>
          <p className="text-[11px] text-muted-foreground">free trial</p>
        </div>
        <div className="rounded-xl border border-border bg-white px-4 py-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Past Due</p>
            <AlertCircle className="w-3 h-3 text-muted-foreground/40" />
          </div>
          <p className="text-2xl font-bold text-foreground">{pastDueSubs.length}</p>
          <p className="text-[11px] text-muted-foreground">retrying</p>
        </div>
        <div className="rounded-xl border border-border bg-white px-4 py-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Total Spend</p>
            <DollarSign className="w-3 h-3 text-muted-foreground/40" />
          </div>
          <p className="text-2xl font-bold text-foreground">${totalSpend.toFixed(2)}</p>
          <p className="text-[11px] text-muted-foreground">across all plans</p>
        </div>
        <div className="rounded-xl border border-border bg-white px-4 py-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Next Billing</p>
            <CalendarDays className="w-3 h-3 text-muted-foreground/40" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            {nextBillingInfo
              ? new Date(nextBillingInfo.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">{nextBillingInfo?.label ?? "No upcoming billing"}</p>
        </div>
        <div className="rounded-xl border border-border bg-white px-4 py-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Passport Uses</p>
            <Zap className="w-3 h-3 text-muted-foreground/40" />
          </div>
          <p className="text-2xl font-bold text-foreground">{passportUsesDisplay}×</p>
          <p className="text-[11px] text-muted-foreground">activated via passport</p>
        </div>
      </div>

      {/* ── My Subscriptions Table ── */}
      <div className="rounded-2xl border border-border bg-white overflow-hidden w-full">
        {/* Table header */}
        <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">My Subscriptions</h2>
            <p className="text-[11px] text-muted-foreground">
              {subscriptions.length} total · {activeSubs.length} active
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search title or merchant ID..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="pl-8 pr-3 h-8 rounded-lg border border-border text-xs text-foreground bg-secondary/30 outline-none focus:ring-1 focus:ring-primary/30 w-52"
              />
            </div>
            {/* Filter tabs */}
            <div className="flex items-center gap-0.5 bg-secondary/60 rounded-lg p-0.5">
              {(["all", "active", "trialing", "past_due", "ended"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setTableFilter(f)}
                  className={cn(
                    "text-[11px] font-medium px-2.5 py-1.5 rounded-md transition",
                    tableFilter === f
                      ? "bg-white shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f === "all" ? "All" : f === "past_due" ? "Due" : f === "trialing" ? "Trial" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table body */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : filteredTableSubs.length === 0 ? (
          <p className="text-xs text-muted-foreground p-6 text-center">
            {subscriptions.length === 0 ? "No subscriptions yet." : "No subscriptions match this filter."}
          </p>
        ) : (
          <>
            {cancelError && <div className="px-5 pt-3"><InlineError message={cancelError} /></div>}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-slate-50/60">
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Subscription</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Merchant ID</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Plan</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Amount</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Status</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Next Billing</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Method</th>
                    <th className="px-4 py-3 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {filteredTableSubs.map((sub: any) => {
                    const isPassportMethod = sub.activationMethod === "passport";
                    const nextDate = sub.status === "trialing" && sub.trialEndsAt
                      ? sub.trialEndsAt
                      : sub.nextBillingAt;
                    return (
                      <tr key={sub.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/20 transition-colors">
                        <td className="px-5 py-3.5">
                          <p className="font-semibold text-foreground">{sub.planTitle}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Since {sub.startedAt
                              ? new Date(sub.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                              : "—"}
                          </p>
                        </td>
                        <td className="px-4 py-3.5">
                          <code className="text-[11px] font-mono text-muted-foreground">{sub.merchantId ?? "—"}</code>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground capitalize">{sub.planInterval}</td>
                        <td className="px-4 py-3.5 font-bold text-foreground">${parseFloat(sub.amount).toFixed(2)}</td>
                        <td className="px-4 py-3.5"><SubscriptionStatusBadge status={sub.status} /></td>
                        <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                          {nextDate
                            ? new Date(nextDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                            : "—"}
                        </td>
                        <td className="px-4 py-3.5">
                          {isPassportMethod ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md whitespace-nowrap">
                              <Zap className="w-3 h-3" /> Passport
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground bg-secondary border border-border px-2 py-0.5 rounded-md whitespace-nowrap">
                              <KeyRound className="w-3 h-3" /> Code
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          {(sub.status === "active" || sub.status === "trialing" || sub.status === "past_due") && (
                            <button
                              type="button"
                              onClick={() => handleCancel(sub.id)}
                              disabled={cancellingId === sub.id}
                              className="text-[11px] font-medium text-destructive/60 hover:text-destructive transition disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
                            >
                              {cancellingId === sub.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <XCircle className="w-3 h-3" />}
                              {cancellingId === sub.id ? "Cancelling…" : "Cancel"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── My Plans (creator) ── */}
      {(isLoadingPlans || plans.length > 0) && (
        <div className="rounded-2xl border border-border bg-white overflow-hidden w-full">
          {/* Section header */}
          <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-slate-50/80">
            <div>
              <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                My Plans
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {plans.length} plan{plans.length !== 1 ? "s" : ""} · {activePlanCount} active subscriber{activePlanCount !== 1 ? "s" : ""} · ${totalRevenue.toFixed(2)} total revenue
              </p>
            </div>
            {plans.length > 0 && (
              <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">
                {plans.length}
              </span>
            )}
          </div>

          <div className="p-5 bg-secondary/10">
            {isLoadingPlans ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-6">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading plans…
              </div>
            ) : (
              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
                {plans.map((plan: any) => {
                  const planSubscribeUrl = plan.merchantId
                    ? `${window.location.origin}${BASE}/subscribe/${plan.merchantId}`
                    : null;
                  const filter = subFilter[plan.id] ?? "all";
                  const allSubs = planSubscribers[plan.id] ?? [];
                  const filteredSubs = filter === "all" ? allSubs : allSubs.filter((s: any) => s.status === filter);
                  const intervals: { interval: string; amount: string }[] = plan.intervals ?? [];

                  return (
                    <div key={plan.id} className="rounded-xl border border-border bg-white overflow-hidden flex flex-col shadow-sm">

                      {/* Plan header */}
                      <div className="px-4 pt-4 pb-3 border-b border-border/60">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-sm font-bold text-foreground leading-tight">{plan.planTitle}</p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {plan.hasFreeTrial && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                                {plan.trialDurationDays}d free trial
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Mail className="w-3 h-3 shrink-0" />
                          <span className="truncate">{plan.paymentEmail}</span>
                        </p>
                      </div>

                      {/* Stats */}
                      <div className="grid grid-cols-3 divide-x divide-border border-b border-border/60">
                        <div className="px-3 py-3 text-center">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold mb-0.5">Revenue</p>
                          <p className="text-base font-bold text-foreground">${parseFloat(plan.totalRevenue ?? "0").toFixed(2)}</p>
                        </div>
                        <div className="px-3 py-3 text-center">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold mb-0.5">Active</p>
                          <p className="text-base font-bold text-foreground">{plan.activeSubscriberCount ?? 0}</p>
                        </div>
                        <div className="px-3 py-3 text-center">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold mb-0.5">Total</p>
                          <p className="text-base font-bold text-foreground">{allSubs.length || plan.totalSubscriberCount || "—"}</p>
                        </div>
                      </div>

                      {/* Pricing intervals */}
                      {intervals.length > 0 && (
                        <div className="px-4 py-3 border-b border-border/60 space-y-1.5">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold mb-2">Pricing</p>
                          <div className="flex flex-wrap gap-2">
                            {intervals.map((iv: any) => (
                              <div key={iv.interval} className="flex items-center gap-1.5 bg-secondary/60 border border-border rounded-lg px-2.5 py-1.5">
                                <span className="text-[10px] text-muted-foreground capitalize font-medium">{iv.interval}</span>
                                <span className="text-[10px] font-bold text-foreground">${parseFloat(iv.amount).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Merchant ID + link */}
                      <div className="px-4 py-3 border-b border-border/60 space-y-2">
                        {plan.merchantId && (
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Merchant ID</span>
                            <div className="flex items-center gap-1">
                              <code className="text-[11px] font-mono text-foreground">{plan.merchantId}</code>
                              <CopyButton text={plan.merchantId} />
                            </div>
                          </div>
                        )}
                        {planSubscribeUrl && (
                          <div className="flex items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1.5">
                            <span className="text-[10px] text-primary font-mono truncate flex-1">{planSubscribeUrl}</span>
                            <CopyButton text={planSubscribeUrl} />
                            <a href={planSubscribeUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground transition">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>

                      {/* Subscribers toggle */}
                      <button
                        type="button"
                        onClick={() => togglePlanSubscribers(plan.id)}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition"
                      >
                        <span className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5" />
                          Subscribers
                          {allSubs.length > 0 && (
                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">{allSubs.length}</span>
                          )}
                        </span>
                        {expandedPlanId === plan.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {expandedPlanId === plan.id && (
                        <div className="border-t border-border bg-secondary/20 p-3 space-y-2">
                          {loadingSubscribers[plan.id] ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                            </div>
                          ) : allSubs.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-3 text-center">No subscribers yet.</p>
                          ) : (
                            <>
                              {/* Filter tabs */}
                              <div className="flex flex-wrap gap-1.5 pb-1">
                                {(["all", "active", "trialing", "past_due", "cancelled"] as SubStatusFilter[]).map((f) => {
                                  const count = f === "all" ? allSubs.length : allSubs.filter((s: any) => s.status === f).length;
                                  if (f !== "all" && count === 0) return null;
                                  const label = f === "all" ? "All" : f === "past_due" ? "Due" : f.charAt(0).toUpperCase() + f.slice(1);
                                  return (
                                    <button
                                      key={f}
                                      type="button"
                                      onClick={() => setSubFilter((prev) => ({ ...prev, [plan.id]: f }))}
                                      className={cn(
                                        "text-[10px] font-semibold px-2 py-0.5 rounded-full border transition",
                                        filter === f
                                          ? "bg-primary text-white border-primary"
                                          : "bg-white text-muted-foreground border-border hover:border-primary/40",
                                      )}
                                    >
                                      {label} {count > 0 && `(${count})`}
                                    </button>
                                  );
                                })}
                              </div>
                              {/* Subscriber rows */}
                              {filteredSubs.length === 0 ? (
                                <p className="text-xs text-muted-foreground py-1">None with this status.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {filteredSubs.map((sub: any) => (
                                    <div key={sub.subscriptionId} className="rounded-lg bg-white border border-border px-3 py-2.5">
                                      <div className="flex items-center justify-between gap-2 mb-1.5">
                                        <div className="min-w-0">
                                          <p className="text-xs font-semibold text-foreground truncate">{sub.subscriberName}</p>
                                          <p className="text-[10px] text-muted-foreground truncate">{sub.subscriberEmail}</p>
                                        </div>
                                        <SubscriptionStatusBadge status={sub.status} />
                                      </div>
                                      <div className="grid grid-cols-3 gap-x-3 text-[10px] text-muted-foreground border-t border-border/50 pt-1.5 mt-1">
                                        <div>
                                          <p className="uppercase tracking-wide font-semibold text-[9px] mb-0.5">Plan</p>
                                          <p className="capitalize font-medium text-foreground">{sub.planInterval}</p>
                                        </div>
                                        <div>
                                          <p className="uppercase tracking-wide font-semibold text-[9px] mb-0.5">Amount</p>
                                          <p className="font-bold text-foreground">${parseFloat(sub.amount).toFixed(2)}</p>
                                        </div>
                                        <div>
                                          <p className="uppercase tracking-wide font-semibold text-[9px] mb-0.5">
                                            {sub.nextBillingAt && sub.status !== "cancelled" ? "Next Bill" : sub.cancelledAt ? "Ended" : "Since"}
                                          </p>
                                          <p className="font-medium text-foreground">
                                            {sub.nextBillingAt && sub.status !== "cancelled"
                                              ? new Date(sub.nextBillingAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                                              : sub.cancelledAt
                                              ? new Date(sub.cancelledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                                              : new Date(sub.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Create Subscription Tab ──────────────────────────────────────────────────

const PRESET_TIER_NAMES = ["Basic", "Starter", "Individual", "Pro", "Team", "Business", "Student", "Enterprise"];
const MAX_TIERS = 5;
const MAX_FEATURES = 20;

type TierDraft = {
  id:            string;
  tierName:      string;
  customName:    string;
  description:   string;
  features:      string[];
  featureInput:  string;
  isHighlighted: boolean;
  displayOrder:  number;
  intervals:     { interval: string; amount: string }[];
};

function makeTier(displayOrder: number): TierDraft {
  return {
    id:            crypto.randomUUID(),
    tierName:      PRESET_TIER_NAMES[displayOrder] ?? "",
    customName:    "",
    description:   "",
    features:      [],
    featureInput:  "",
    isHighlighted: displayOrder === 1,
    displayOrder,
    intervals:     [{ interval: "monthly", amount: "" }],
  };
}

function CreateSubscriptionTab({ user: _user }: { user: any }) {
  const [planMode,           setPlanMode]           = useState<"flat" | "tiered">("flat");
  const [planTitle,          setPlanTitle]          = useState("");
  const [paymentEmail,       setPaymentEmail]       = useState("");
  const [intervals,          setIntervals]          = useState<{ interval: string; amount: string }[]>([{ interval: "monthly", amount: "" }]);
  const [tiers,              setTiers]              = useState<TierDraft[]>([makeTier(0)]);
  const [hasFreeTrial,       setHasFreeTrial]       = useState(false);
  const [trialDurationDays,  setTrialDurationDays]  = useState("7");
  const [pak,                setPak]                = useState("");
  const [pakVisible,         setPakVisible]         = useState(false);
  const [isSubmitting,       setIsSubmitting]       = useState(false);
  const [error,              setError]              = useState<string | null>(null);
  const [result,             setResult]             = useState<any | null>(null);
  const authHeaders = () => {
    const jwt = localStorage.getItem("token");
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (jwt) h["Authorization"] = `Bearer ${jwt}`;
    return h;
  };

  // ── Flat-plan interval helpers ──────────────────────────────────────────────

  const addInterval = () => {
    const used = new Set(intervals.map((i) => i.interval));
    const next  = ["weekly", "monthly", "yearly"].find((v) => !used.has(v));
    if (next) setIntervals([...intervals, { interval: next, amount: "" }]);
  };

  const removeInterval = (idx: number) => {
    if (intervals.length === 1) return;
    setIntervals(intervals.filter((_, i) => i !== idx));
  };

  const updateInterval = (idx: number, field: "interval" | "amount", value: string) =>
    setIntervals(intervals.map((iv, i) => (i === idx ? { ...iv, [field]: value } : iv)));

  // ── Tier helpers ─────────────────────────────────────────────────────────────

  const addTier = () => {
    if (tiers.length >= MAX_TIERS) return;
    setTiers((prev) => [...prev, makeTier(prev.length)]);
  };

  const removeTier = (id: string) => {
    if (tiers.length === 1) return;
    setTiers((prev) => prev.filter((t) => t.id !== id).map((t, i) => ({ ...t, displayOrder: i })));
  };

  const updateTier = (id: string, patch: Partial<TierDraft>) =>
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const addTierInterval = (tierId: string) => {
    setTiers((prev) => prev.map((t) => {
      if (t.id !== tierId || t.intervals.length >= 3) return t;
      const used = new Set(t.intervals.map((i) => i.interval));
      const next = ["weekly", "monthly", "yearly"].find((v) => !used.has(v));
      if (!next) return t;
      return { ...t, intervals: [...t.intervals, { interval: next, amount: "" }] };
    }));
  };

  const removeTierInterval = (tierId: string, idx: number) =>
    setTiers((prev) => prev.map((t) =>
      t.id === tierId && t.intervals.length > 1
        ? { ...t, intervals: t.intervals.filter((_, i) => i !== idx) }
        : t,
    ));

  const updateTierInterval = (tierId: string, idx: number, field: "interval" | "amount", value: string) =>
    setTiers((prev) => prev.map((t) =>
      t.id === tierId
        ? { ...t, intervals: t.intervals.map((iv, i) => (i === idx ? { ...iv, [field]: value } : iv)) }
        : t,
    ));

  const addFeature = (tierId: string) => {
    setTiers((prev) => prev.map((t) => {
      if (t.id !== tierId) return t;
      const trimmed = t.featureInput.trim();
      if (!trimmed || t.features.includes(trimmed) || t.features.length >= MAX_FEATURES) return t;
      return { ...t, features: [...t.features, trimmed], featureInput: "" };
    }));
  };

  const removeFeature = (tierId: string, feature: string) =>
    setTiers((prev) => prev.map((t) =>
      t.id === tierId ? { ...t, features: t.features.filter((f) => f !== feature) } : t,
    ));

  const handleSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setIsSubmitting(true);
    try {
      const body = planMode === "tiered"
        ? {
            planTitle:         planTitle.trim(),
            paymentEmail:      paymentEmail.trim(),
            hasFreeTrial,
            trialDurationDays: hasFreeTrial ? parseInt(trialDurationDays, 10) : undefined,
            pak,
            tiers: tiers.map((t) => ({
              tierName:      t.tierName === "__custom__" ? t.customName.trim() : t.tierName,
              description:   t.description.trim() || undefined,
              features:      t.features,
              isHighlighted: t.isHighlighted,
              displayOrder:  t.displayOrder,
              intervals:     t.intervals,
            })),
          }
        : {
            planTitle:         planTitle.trim(),
            paymentEmail:      paymentEmail.trim(),
            intervals,
            hasFreeTrial,
            trialDurationDays: hasFreeTrial ? parseInt(trialDurationDays, 10) : undefined,
            pak,
          };

      const res  = await fetch(`${API_BASE}/api/subscriptions/plans`, {
        method: "POST",
        headers: authHeaders(),
        body:    JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to create plan");
      setResult(json);
      setPlanTitle(""); setPaymentEmail("");
      setIntervals([{ interval: "monthly", amount: "" }]);
      setTiers([makeTier(0)]);
      setHasFreeTrial(false); setTrialDurationDays("7"); setPak("");
    } catch (err: any) {
      setError(err.message ?? "Failed to create plan");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">

        {/* Header */}
        <div className="px-8 py-6 border-b border-border">
          <h3 className="text-lg font-bold text-foreground">New Subscription Plan</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Subscribers are billed automatically on the schedule you define.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="divide-y divide-border">

          {/* §1 Plan Details */}
          <div className="px-8 py-7 space-y-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Plan Details</p>

            <div className="space-y-1.5">
              <label htmlFor="plan-title" className="text-sm font-medium text-foreground">Plan Title</label>
              <input
                id="plan-title" name="planTitle" type="text"
                placeholder="e.g. Creator Pro…"
                autoComplete="off"
                value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} required
                className="w-full h-11 rounded-xl border border-border bg-white px-4 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="payment-email" className="text-sm font-medium text-foreground">Payment Email</label>
              <p className="text-xs text-muted-foreground">Subscription payments are sent to this address.</p>
              <input
                id="payment-email" name="paymentEmail" type="email"
                placeholder="payments@yourdomain.com"
                autoComplete="email"
                spellCheck={false}
                value={paymentEmail} onChange={(e) => setPaymentEmail(e.target.value)} required
                className="w-full h-11 rounded-xl border border-border bg-white px-4 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition"
              />
            </div>
          </div>

          {/* §2 Plan Structure */}
          <div className="px-8 py-7 space-y-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Plan Structure</p>

            {/* Mode toggle */}
            <div role="group" aria-label="Plan structure type" className="flex gap-3">
              {([
                { mode: "flat",   Icon: List,   label: "Simple",  sub: "One price for all subscribers" },
                { mode: "tiered", Icon: Layers, label: "Tiered",  sub: "Multiple tiers with different prices" },
              ] as const).map(({ mode, Icon, label, sub }) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={planMode === mode}
                  onClick={() => setPlanMode(mode)}
                  className={cn(
                    "flex-1 flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 text-left transition-all",
                    planMode === mode
                      ? "border-primary bg-primary/5"
                      : "border-border bg-slate-50/60 hover:border-primary/30 hover:bg-white",
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    planMode === mode ? "bg-primary text-white" : "bg-white border border-border text-muted-foreground",
                  )}>
                    <Icon className="w-4 h-4" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className={cn("text-sm font-semibold", planMode === mode ? "text-primary" : "text-foreground")}>{label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* ── Simple mode ── */}
            {planMode === "flat" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Billing Intervals</label>
                  {intervals.length < 3 && (
                    <button type="button" onClick={addInterval}
                      className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition">
                      <Plus className="w-3.5 h-3.5" aria-hidden /> Add Interval
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {intervals.map((iv, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50 border border-border">
                      <select
                        value={iv.interval} onChange={(e) => updateInterval(idx, "interval", e.target.value)}
                        aria-label={`Billing cadence for interval ${idx + 1}`}
                        className="h-9 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition"
                      >
                        {["weekly", "monthly", "yearly"].map((opt) => (
                          <option key={opt} value={opt} disabled={intervals.some((x, i) => i !== idx && x.interval === opt)}>
                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                          </option>
                        ))}
                      </select>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>$</span>
                        <input
                          type="number" min="0.01" step="0.01" placeholder="0.00"
                          aria-label={`Price for interval ${idx + 1}`}
                          value={iv.amount} onChange={(e) => updateInterval(idx, "amount", e.target.value)} required
                          className="w-full h-9 rounded-lg border border-border bg-white pl-7 pr-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition"
                        />
                      </div>
                      {intervals.length > 1 && (
                        <button type="button" onClick={() => removeInterval(idx)} aria-label="Remove interval"
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Tiered mode ── */}
            {planMode === "tiered" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Plan Tiers</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Each tier has its own name, features, and pricing.</p>
                  </div>
                  <button
                    type="button" onClick={addTier} disabled={tiers.length >= MAX_TIERS}
                    className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <PlusCircle className="w-4 h-4" aria-hidden />
                    Add Tier {tiers.length < MAX_TIERS ? `(${tiers.length}/${MAX_TIERS})` : "(max)"}
                  </button>
                </div>

                <div className={cn("grid gap-4", tiers.length >= 2 ? "xl:grid-cols-2" : "grid-cols-1")}>
                  {tiers.map((tier, tierIdx) => (
                    <div key={tier.id} className={cn(
                      "rounded-xl border-2 bg-white overflow-hidden transition-all",
                      tier.isHighlighted ? "border-primary/40 shadow-sm shadow-primary/10" : "border-border",
                    )}>
                      {/* Tier header */}
                      <div className={cn(
                        "flex items-center justify-between px-4 py-3 border-b",
                        tier.isHighlighted ? "bg-primary/5 border-primary/20" : "bg-slate-50 border-border",
                      )}>
                        <div className="flex items-center gap-2">
                          <GripVertical className="w-4 h-4 text-muted-foreground/30" aria-hidden />
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Tier {tierIdx + 1}</span>
                          {tier.isHighlighted && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-primary px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                              <Star className="w-2.5 h-2.5" aria-hidden /> Recommended
                            </span>
                          )}
                        </div>
                        <button
                          type="button" onClick={() => removeTier(tier.id)} disabled={tiers.length === 1}
                          aria-label={`Remove tier ${tierIdx + 1}`}
                          className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="px-4 py-4 space-y-4">
                        {/* Name */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Tier Name <span aria-hidden className="text-destructive">*</span>
                          </label>
                          <div role="group" aria-label="Preset tier names" className="flex flex-wrap gap-1.5">
                            {PRESET_TIER_NAMES.map((name) => (
                              <button key={name} type="button"
                                onClick={() => updateTier(tier.id, { tierName: name, customName: "" })}
                                aria-pressed={tier.tierName === name}
                                className={cn(
                                  "px-2.5 py-1 rounded-lg text-xs font-medium border transition-all",
                                  tier.tierName === name
                                    ? "bg-primary text-white border-primary"
                                    : "bg-white text-muted-foreground border-border hover:border-primary/50 hover:text-primary",
                                )}
                              >{name}</button>
                            ))}
                          </div>
                          <input
                            type="text" placeholder="Or type a custom name…" maxLength={50}
                            aria-label={`Custom name for tier ${tierIdx + 1}`}
                            value={tier.tierName === "__custom__" ? tier.customName : ""}
                            onChange={(e) => updateTier(tier.id, { tierName: "__custom__", customName: e.target.value })}
                            onFocus={() => { if (!PRESET_TIER_NAMES.includes(tier.tierName) && tier.tierName !== "__custom__") updateTier(tier.id, { tierName: "__custom__", customName: tier.tierName }); }}
                            className="w-full h-9 rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition placeholder:text-muted-foreground/50"
                          />
                          {(tier.tierName === "__custom__" ? !tier.customName.trim() : !tier.tierName) && (
                            <p className="text-[11px] text-destructive" role="alert">Select a preset or type a custom tier name.</p>
                          )}
                        </div>

                        {/* Description */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Description <span className="text-muted-foreground font-normal normal-case">(optional)</span>
                          </label>
                          <div className="relative">
                            <textarea rows={2} maxLength={200}
                              placeholder="Briefly describe what's included…"
                              aria-label={`Description for tier ${tierIdx + 1}`}
                              value={tier.description}
                              onChange={(e) => updateTier(tier.id, { description: e.target.value })}
                              className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition placeholder:text-muted-foreground/50"
                            />
                            <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground/40">{tier.description.length}/200</span>
                          </div>
                        </div>

                        {/* Features */}
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Features <span className="text-muted-foreground font-normal normal-case">(optional)</span>
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text" placeholder="e.g. Unlimited projects…" maxLength={60}
                              aria-label={`Add feature to tier ${tierIdx + 1}`}
                              value={tier.featureInput}
                              onChange={(e) => updateTier(tier.id, { featureInput: e.target.value })}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFeature(tier.id); } }}
                              className="flex-1 h-9 rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition"
                            />
                            <button type="button" onClick={() => addFeature(tier.id)}
                              disabled={!tier.featureInput.trim() || tier.features.length >= MAX_FEATURES}
                              className="h-9 px-4 rounded-xl bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 disabled:opacity-40 transition"
                            >Add</button>
                          </div>
                          {tier.features.length > 0 && (
                            <div role="list" aria-label={`Features for tier ${tierIdx + 1}`} className="flex flex-wrap gap-1.5 pt-1">
                              {tier.features.map((feat) => (
                                <span key={feat} role="listitem"
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary border border-border text-xs text-foreground"
                                >
                                  <Tag className="w-3 h-3 text-muted-foreground" aria-hidden />{feat}
                                  <button type="button" onClick={() => removeFeature(tier.id, feat)}
                                    aria-label={`Remove feature: ${feat}`}
                                    className="ml-0.5 text-muted-foreground hover:text-destructive transition"
                                  ><X className="w-3 h-3" /></button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Pricing */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pricing</label>
                            {tier.intervals.length < 3 && (
                              <button type="button" onClick={() => addTierInterval(tier.id)}
                                className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition">
                                <Plus className="w-3.5 h-3.5" aria-hidden /> Add Interval
                              </button>
                            )}
                          </div>
                          <div className="space-y-2">
                            {tier.intervals.map((iv, ivIdx) => (
                              <div key={ivIdx} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-border">
                                <select value={iv.interval}
                                  onChange={(e) => updateTierInterval(tier.id, ivIdx, "interval", e.target.value)}
                                  aria-label={`Billing cadence for tier ${tierIdx + 1} interval ${ivIdx + 1}`}
                                  className="h-8 rounded-lg border border-border bg-white px-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition"
                                >
                                  {["weekly", "monthly", "yearly"].map((opt) => (
                                    <option key={opt} value={opt} disabled={tier.intervals.some((x, i) => i !== ivIdx && x.interval === opt)}>
                                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                    </option>
                                  ))}
                                </select>
                                <div className="relative flex-1">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden>$</span>
                                  <input type="number" min="0.01" step="0.01" placeholder="0.00"
                                    aria-label={`Price for tier ${tierIdx + 1} interval ${ivIdx + 1}`}
                                    value={iv.amount}
                                    onChange={(e) => updateTierInterval(tier.id, ivIdx, "amount", e.target.value)}
                                    required
                                    className="w-full h-8 rounded-lg border border-border bg-white pl-6 pr-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition"
                                  />
                                </div>
                                {tier.intervals.length > 1 && (
                                  <button type="button" onClick={() => removeTierInterval(tier.id, ivIdx)} aria-label="Remove interval"
                                    className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Highlight toggle */}
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                          <input type="checkbox" checked={tier.isHighlighted}
                            onChange={(e) => updateTier(tier.id, { isHighlighted: e.target.checked })}
                            className="w-4 h-4 accent-primary rounded"
                            aria-label={`Mark tier ${tierIdx + 1} as highlighted`}
                          />
                          <span className="text-sm text-foreground">Highlight as <span className="font-medium">"Recommended"</span></span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* §3 Settings */}
          <div className="px-8 py-7 space-y-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Settings</p>

            {/* Free trial */}
            <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-slate-50/60">
              <input
                id="free-trial-toggle"
                type="checkbox" checked={hasFreeTrial}
                onChange={(e) => setHasFreeTrial(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-primary rounded shrink-0"
              />
              <div className="flex-1 min-w-0">
                <label htmlFor="free-trial-toggle" className="text-sm font-medium text-foreground cursor-pointer">
                  Offer a free trial
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">Let new subscribers try your plan before they're charged.</p>
                {hasFreeTrial && (
                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="number" min="1" value={trialDurationDays}
                      onChange={(e) => setTrialDurationDays(e.target.value)}
                      aria-label="Trial duration in days"
                      className="w-20 h-9 rounded-xl border border-border bg-white px-3 text-sm text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition"
                    />
                    <span className="text-sm text-muted-foreground">days free</span>
                  </div>
                )}
              </div>
            </div>

            {/* PAK */}
            <div className="space-y-1.5">
              <label htmlFor="pak-input" className="text-sm font-medium text-foreground">
                Personal Authorization Key
              </label>
              <p className="text-xs text-muted-foreground">Required to create or manage plans.</p>
              <div className="relative">
                <input
                  id="pak-input" name="pak"
                  type={pakVisible ? "text" : "password"} placeholder="Enter your PAK…"
                  value={pak} onChange={(e) => setPak(e.target.value)} required
                  className="w-full h-11 rounded-xl border border-border bg-white px-4 pr-11 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 transition"
                />
                <button
                  type="button" onClick={() => setPakVisible((v) => !v)}
                  aria-label={pakVisible ? "Hide PAK" : "Show PAK"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                >
                  {pakVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* §4 Actions */}
          <div className="px-8 py-6 space-y-4 bg-slate-50/60">
            {error && <InlineError message={error} />}

            {result && (() => {
              const planMerchantId = result.plan.merchantId ?? "";
              const subscribeUrl   = `${window.location.origin}${BASE}/subscribe/${planMerchantId}`;
              const embedCode      = `<a href="${subscribeUrl}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-family:sans-serif;">Subscribe to ${result.plan.planTitle}</a>`;
              const isTieredResult = Array.isArray(result.tiers) && result.tiers.length > 0;
              return (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl bg-green-50 border border-green-200 p-5 space-y-4"
                  role="status" aria-label="Plan created successfully"
                >
                  <div className="flex items-center gap-2 text-green-700 font-semibold text-sm">
                    <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden /> Plan created successfully!
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">Merchant ID</p>
                    <div className="flex items-center justify-between rounded-lg bg-white border border-green-200 px-3 py-2.5">
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Share with subscribers</p>
                        <code className="text-sm font-mono font-bold text-foreground tracking-wider" translate="no">{planMerchantId}</code>
                      </div>
                      <CopyButton text={planMerchantId} />
                    </div>
                    {!isTieredResult && Array.isArray(result.intervals) && (
                      <div className="space-y-1">
                        {result.intervals.map((iv: any) => (
                          <div key={iv.id} className="flex items-center justify-between rounded-lg bg-white/60 border border-green-100 px-3 py-1.5">
                            <span className="text-xs font-semibold capitalize text-green-700">{iv.interval}</span>
                            <span className="text-xs text-muted-foreground">${parseFloat(iv.amount).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {isTieredResult && (
                      <div className="grid sm:grid-cols-2 gap-2 mt-1">
                        {result.tiers.map(({ tier, intervals: tierIvs }: any) => (
                          <div key={tier.id} className={cn(
                            "rounded-lg border px-3 py-2.5 space-y-1.5",
                            tier.isHighlighted ? "bg-primary/5 border-primary/30" : "bg-white/60 border-green-100",
                          )}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-green-800">{tier.tierName}</span>
                              {tier.isHighlighted && (
                                <span className="text-[10px] font-bold text-primary px-1.5 py-0.5 rounded-full bg-primary/10 border border-primary/20">Recommended</span>
                              )}
                            </div>
                            {tierIvs.map((iv: any) => (
                              <div key={iv.id} className="flex items-center justify-between">
                                <span className="text-xs font-semibold capitalize text-green-700">{iv.interval}</span>
                                <span className="text-xs text-muted-foreground">${parseFloat(iv.amount).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">Subscription Page</p>
                    <div className="flex items-center gap-2 rounded-lg bg-white border border-green-200 px-3 py-2">
                      <a href={subscribeUrl} target="_blank" rel="noreferrer"
                        className="flex-1 text-xs font-mono text-primary truncate hover:underline"
                      >{subscribeUrl}</a>
                      <CopyButton text={subscribeUrl} />
                      <a href={subscribeUrl} target="_blank" rel="noreferrer"
                        aria-label="Open subscription page"
                        className="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                      ><ExternalLink className="w-3.5 h-3.5" /></a>
                    </div>
                    <p className="text-[11px] text-green-700">Share this link — subscribers visit it to activate.</p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">
                      Embed Code <span className="text-green-600 font-normal normal-case">(optional)</span>
                    </p>
                    <div className="relative rounded-lg bg-white border border-green-200 px-3 py-2">
                      <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all leading-relaxed pr-8">{embedCode}</pre>
                      <div className="absolute top-2 right-2">
                        <CopyButton text={embedCode} />
                      </div>
                    </div>
                    <p className="text-[11px] text-green-700">Paste into your website to add a subscribe button.</p>
                  </div>
                </motion.div>
              );
            })()}

            <button
              type="submit" disabled={isSubmitting}
              className="w-full h-11 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
              {isSubmitting ? "Creating…" : "Create Plan"}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

// ─── Pay Subscription Tab ─────────────────────────────────────────────────────

function PaySubscriptionTab({ user }: { user: any }) {
  const [merchantId,           setMerchantId]           = useState("");
  const [planInfo,             setPlanInfo]             = useState<any | null>(null);
  const [lookupError,          setLookupError]          = useState<string | null>(null);
  const [isLooking,            setIsLooking]            = useState(false);
  const [selectedPlanInterval, setSelectedPlanInterval] = useState("");
  const [selectedIntervalId,   setSelectedIntervalId]   = useState<number | null>(null);
  const [txPassword,           setTxPassword]           = useState("");
  const [txPasswordVisible,    setTxPasswordVisible]    = useState(false);
  const [step,                 setStep]                 = useState<"lookup" | "otp" | "done">("lookup");
  const [otp,                  setOtp]                  = useState("");
  const [isSubmitting,         setIsSubmitting]         = useState(false);
  const [stepError,            setStepError]            = useState<string | null>(null);

  const hasTransactionPassword = (user as any)?.hasTransactionPassword;

  const authHeaders = () => {
    const jwt = localStorage.getItem("token");
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (jwt) h["Authorization"] = `Bearer ${jwt}`;
    return h;
  };

  const handleLookup = async () => {
    if (!merchantId.trim()) return;
    setLookupError(null); setPlanInfo(null);
    setIsLooking(true);
    try {
      const res  = await fetch(`${API_BASE}/api/subscriptions/merchant/${encodeURIComponent(merchantId.trim())}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Merchant ID not found");
      setPlanInfo(json);
      if (json.intervals?.length === 1) {
        setSelectedPlanInterval(json.intervals[0].interval);
        setSelectedIntervalId(json.intervals[0].intervalId ?? null);
      }
    } catch (err: any) {
      setLookupError(err.message ?? "Merchant ID not found");
    } finally {
      setIsLooking(false);
    }
  };

  const handleRequestOtp = async () => {
    if (!selectedPlanInterval) return;
    setStepError(null); setIsSubmitting(true);
    try {
      const body: Record<string, any> = { merchantId: merchantId, planInterval: selectedPlanInterval };
      if (selectedIntervalId) body["intervalId"] = selectedIntervalId;
      if (hasTransactionPassword && txPassword) body["transactionPassword"] = txPassword;
      const res  = await fetch(`${API_BASE}/api/subscriptions/confirmation-code/request-otp`, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to send OTP");
      setStep("otp");
    } catch (err: any) {
      setStepError(err.message ?? "Failed to send OTP");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateCode = async () => {
    if (!otp.trim()) return;
    setStepError(null); setIsSubmitting(true);
    try {
      const res  = await fetch(`${API_BASE}/api/subscriptions/confirmation-code/generate`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ otp: otp.trim(), merchantId: merchantId, planInterval: selectedPlanInterval, ...(selectedIntervalId ? { intervalId: selectedIntervalId } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to generate code");
      setStep("done");
    } catch (err: any) {
      setStepError(err.message ?? "Failed to generate code");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setMerchantId(""); setPlanInfo(null); setLookupError(null);
    setSelectedPlanInterval(""); setSelectedIntervalId(null);
    setTxPassword(""); setOtp(""); setStep("lookup"); setStepError(null);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border-2 border-border bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-slate-50">
          <h3 className="text-sm font-bold text-foreground">Pay Subscription</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Enter the Merchant ID provided by the creator to get your confirmation code.</p>
        </div>

        <div className="px-5 py-5 space-y-4">

          {/* ── Step: lookup ── */}
          {step === "lookup" && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Merchant ID</label>
                <div className="flex gap-2">
                  <input
                    type="text" placeholder="XXXX-XXXX-XXXX"
                    value={merchantId} onChange={(e) => setMerchantId(e.target.value.toUpperCase())}
                    className="flex-1 h-10 rounded-xl border border-border bg-white px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                  />
                  <button type="button" onClick={handleLookup} disabled={isLooking || !merchantId.trim()}
                    className="h-10 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 flex items-center gap-2 transition"
                  >
                    {isLooking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Look up"}
                  </button>
                </div>
                {lookupError && <InlineError message={lookupError} />}
              </div>

              {planInfo && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  {/* Plan card */}
                  <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 space-y-1">
                    <p className="text-sm font-semibold text-foreground">{planInfo.planTitle}</p>
                    <p className="text-xs text-muted-foreground">By {planInfo.creatorName}</p>
                    {planInfo.hasFreeTrial && (
                      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                        {planInfo.trialDurationDays} day free trial
                      </span>
                    )}
                  </div>

                  {/* Interval / tier selector */}
                  {(() => {
                    const isTiered = planInfo.tiers?.length > 0;
                    const selectIv = (iv: any) => {
                      setSelectedPlanInterval(iv.interval);
                      setSelectedIntervalId(iv.intervalId ?? null);
                    };

                    if (isTiered) {
                      return (
                        <div className="space-y-3">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Choose a Plan</label>
                          {planInfo.tiers.map((tier: any) => (
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
                                {tier.features?.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {tier.features.map((f: string) => (
                                      <span key={f} className="px-2 py-0.5 rounded-full bg-secondary border border-border text-[11px] text-muted-foreground">
                                        {f}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* Tier intervals */}
                              <div className="divide-y divide-border">
                                {tier.intervals.map((iv: any) => {
                                  const isSelected = selectedIntervalId === iv.intervalId;
                                  return (
                                    <button
                                      key={iv.intervalId}
                                      type="button"
                                      onClick={() => selectIv(iv)}
                                      aria-pressed={isSelected}
                                      className={cn(
                                        "w-full flex items-center justify-between px-4 py-3 text-left transition-all",
                                        isSelected ? "bg-primary/5" : "bg-white hover:bg-slate-50",
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

                    if (planInfo.intervals.length > 1) {
                      return (
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Billing Cycle</label>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {planInfo.intervals.map((iv: any) => {
                              const isSelected = selectedIntervalId === iv.intervalId;
                              return (
                                <button key={iv.intervalId ?? iv.interval} type="button"
                                  onClick={() => selectIv(iv)}
                                  aria-pressed={isSelected}
                                  className={cn(
                                    "flex flex-col items-start rounded-xl border-2 p-3 text-left transition-all",
                                    isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                                  )}
                                >
                                  <span className="text-xs font-semibold capitalize text-foreground">{iv.interval}</span>
                                  <span className="text-sm font-bold text-primary">${parseFloat(iv.amount).toFixed(2)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })()}

                  {/* Transaction password */}
                  {hasTransactionPassword && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transaction Password</label>
                      <div className="relative">
                        <input type={txPasswordVisible ? "text" : "password"} placeholder="Enter your transaction password"
                          value={txPassword} onChange={(e) => setTxPassword(e.target.value)}
                          className="w-full h-10 rounded-xl border border-border bg-white px-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                        />
                        <button type="button" onClick={() => setTxPasswordVisible((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition">
                          {txPasswordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}

                  {stepError && <InlineError message={stepError} />}

                  <button type="button" disabled={isSubmitting || !selectedPlanInterval} onClick={handleRequestOtp}
                    className="w-full h-11 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2 transition"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    {isSubmitting ? "Sending OTP…" : "Continue"}
                  </button>
                </motion.div>
              )}
            </>
          )}

          {/* ── Step: OTP entry ── */}
          {step === "otp" && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-700 text-sm">
                <Mail className="w-4 h-4 shrink-0 mt-0.5" />
                <span>We sent a 6-digit OTP to your registered email. Enter it below to generate your confirmation code.</span>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">One-Time Password</label>
                <input type="text" inputMode="numeric" maxLength={6} placeholder="123456"
                  value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="w-full h-10 rounded-xl border border-border bg-white px-3 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/30 transition"
                />
              </div>
              {stepError && <InlineError message={stepError} />}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setStep("lookup"); setStepError(null); }}
                  className="flex-1 h-11 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition"
                >
                  Back
                </button>
                <button type="button" disabled={isSubmitting || otp.length < 6} onClick={handleGenerateCode}
                  className="flex-1 h-11 rounded-xl bg-primary text-white font-bold text-sm hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2 transition"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {isSubmitting ? "Generating…" : "Generate Code"}
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Step: success ── */}
          {step === "done" && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-6 text-center"
            >
              <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-green-600" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-foreground">Confirmation code sent!</h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Your 8-character confirmation code has been emailed to you. Visit the creator's subscription page and enter it to activate your subscription.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">The code expires in 7 days.</p>
              <button type="button" onClick={resetForm}
                className="mt-2 h-10 px-6 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition"
              >
                Pay another subscription
              </button>
            </motion.div>
          )}

        </div>
      </div>
    </div>
  );
}
