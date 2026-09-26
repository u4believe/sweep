import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, AlertCircle, Loader2, Copy, Check, ShieldCheck, ArrowRight, Mail, Trash2, X, KeyRound, Lock, LockKeyhole, Eye, EyeOff, RefreshCw, ShieldOff, Smartphone, LifeBuoy,
} from "lucide-react";
import {
  useGetCurrentUser,
  useGetUserBalance,
  useWithdrawCrypto,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { AppLayout } from "@/components/layout";
import { MobileDashboard } from "@/components/mobile/mobile-dashboard";
import { WebDashboard } from "@/components/desktop/web-dashboard";
import type { DashboardShellProps } from "@/components/sweep/types";
import { useMediaQuery } from "@/hooks/use-media-query";
import QRCode from "qrcode";
import { TotpInput } from "@/components/auth/totp-input";
import { useAuthConfig } from "@/components/auth/google-sign-in";
import { fadeUp, staggerContainer } from "@/lib/motion";
import type { FullBalance } from "@/lib/wallet";
import { takePayTo } from "@/lib/pay-qr";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
  // Below lg the dashboard renders the v4 mobile shell; from lg up, the web dashboard.
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  // Set when the user arrived through someone's payment QR code (/send/<payment ID>)
  const [initialPayTo] = useState(() => takePayTo());

  const { data: user, isLoading: isUserLoading, isError: isUserError } =
    useGetCurrentUser({ query: { retry: false } as any });
  const { data: balance, refetch: refetchBalance } =
    useGetUserBalance({ query: { enabled: !!user, refetchInterval: 5_000, refetchOnWindowFocus: true } as any });
  const bal = balance as FullBalance | undefined;

  // All deposit addresses (EVM + Solana), shown on the dashboard and in Add money.
  const { data: depositAddressData } = useQuery({
    queryKey: ["/api/deposit/addresses"],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/deposit/addresses`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      return res.ok ? (await res.json() as { addresses: Record<string, string> }) : { addresses: {} };
    },
  });
  const depositAddresses = depositAddressData?.addresses ?? {};

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

  if (isUserLoading || !user) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
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
  const hasTxnPwd    = (user as any).hasTransactionPassword as boolean;

  const shell: DashboardShellProps = {
    user: { name: user.name, email: user.email, hasTransactionPassword: hasTxnPwd, circleWalletAddress: circleWallet },
    balance: bal,
    depositAddresses,
    withdraw: withdrawCryptoMutation,
    initialPayTo,
    onBalanceChanged: () => { refetchBalance(); invalidateHistory(); },
    onLogout: () => {
      localStorage.removeItem("token");
      queryClient.clear();
      window.location.href = import.meta.env.BASE_URL || "/";
    },
    slots: {
      settings:   <SecurityTab user={user as any} onSecurityUpdated={() => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] })} />,
      support:    <SupportContent />,
    },
  };

  return isDesktop ? <WebDashboard {...shell} /> : <MobileDashboard {...shell} />;
}

// ─── Support ──────────────────────────────────────────────────────────────────

function SupportContent() {
  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="bg-gradient-to-br from-primary/10 to-violet-500/10 rounded-3xl p-8 text-center border border-primary/20">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <LifeBuoy className="w-7 h-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Customer Support</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
          Have a question or issue? Our support team is here to help. Reach out and we'll get back to you as soon as possible.
        </p>
      </div>

      {/* Contact card */}
      <div className="bg-white/80 backdrop-blur rounded-3xl border border-border p-6 space-y-5">
        <h3 className="font-semibold text-foreground text-sm">Contact Us</h3>

        <div className="flex items-start gap-4 p-4 rounded-2xl bg-secondary/30 border border-border/60">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground mb-0.5">Email Support</p>
            <a
              href="mailto:sweepusdc@gmail.com"
              className="text-sm text-primary hover:underline break-all"
            >
              sweepusdc@gmail.com
            </a>
            <p className="text-xs text-muted-foreground mt-1">We typically respond within 24 hours on business days.</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200">
          <p className="text-xs text-amber-800 leading-relaxed">
            <strong>Before reaching out</strong>, please include your registered email address and a clear description of the issue. For transaction-related queries, include the transaction ID if available.
          </p>
        </div>
      </div>

      {/* FAQ card */}
      <div className="bg-white/80 backdrop-blur rounded-3xl border border-border p-6 space-y-4">
        <h3 className="font-semibold text-foreground text-sm">Common Questions</h3>
        <div className="space-y-3">
          {[
            { q: "My transaction is pending for a long time", a: "On-chain transactions can take a few minutes to confirm depending on network congestion. If it's been over 30 minutes, contact support with your transaction ID." },
            { q: "I didn't receive my verification email", a: "Check your spam or junk folder first. You can also request a new verification email from the login page." },
            { q: "I forgot my transaction password", a: "You can reset your transaction password from the Security page using your Personal Authorization Key (PAK)." },
            { q: "My withdrawal was rejected", a: "Ensure your wallet address is correct and on a supported network. Minimum withdrawal amounts apply per chain." },
          ].map(({ q, a }) => (
            <div key={q} className="border-b border-border/50 last:border-0 pb-3 last:pb-0">
              <p className="text-sm font-medium text-foreground mb-1">{q}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Recurring Transfers Tab ──────────────────────────────────────────────────

interface SecurityUser {
  hasTransactionPassword?: boolean;
  hasPak?: boolean;
  pakCopied?: boolean;
  pakPreview?: string | null;
  pakCreatedAt?: string | null;
  pakCanRegenerate?: boolean;
  nextPakAllowedAt?: string | null;
  twoFactorEnabled?: boolean;
}

type SecurityView =
  | "overview"
  | "set-txn-otp"   | "set-txn-pwd"
  | "gen-pak-otp"   | "gen-pak-reveal"
  | "chg-login-pak" | "chg-login-otp"
  | "chg-txn-pak"   | "chg-txn-otp"
  | "del-acct-pak"  | "del-acct-otp"
  | "tfa-setup"     | "tfa-disable"
  | "chg-txn-2fa";

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
  // Authenticator-app 2FA
  const [totp, setTotp]             = useState("");
  const [tfaSetup, setTfaSetup]     = useState<{ secret: string; qr: string } | null>(null);
  const [usePakInstead, setUsePakInstead] = useState(false);
  const [codeSent, setCodeSent]     = useState(false);
  const { data: authConfig } = useAuthConfig();

  const reset = () => {
    setOtp(""); setPak(""); setPwd(""); setPwd2(""); setError(null);
    setTotp(""); setTfaSetup(null); setUsePakInstead(false); setCodeSent(false);
  };

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
      "chg-txn-2fa":  "/change-txn-password/request-otp",
      "tfa-disable":  "/2fa/disable/request-otp",
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

  // With 2FA on: email code + authenticator code (no PAK)
  const requestChangeTxn2fa = () => run(async () => {
    if (pwd.length < 6) { setError("Transaction password must be at least 6 characters"); return; }
    if (pwd !== pwd2)   { setError("Passwords do not match — please re-enter both fields"); return; }
    await api("/change-txn-password/request-otp");
    setCodeSent(true);
  });

  const confirmChangeTxn2fa = () => run(async () => {
    if (otp.length < 6)  { setError("Enter the 6-digit code from your email"); return; }
    if (totp.length < 6) { setError("Enter the 6-digit code from your authenticator app"); return; }
    try {
      await api("/change-txn-password/confirm", { newPassword: pwd, otp, totp });
    } catch (e) { setTotp(""); throw e; }
    setSuccess("Transaction password changed successfully.");
    onSecurityUpdated();
    reset(); setView("overview");
  });

  // ── Two-factor authentication ────────────────────────────────────────────

  const startTfaSetup = () => run(async () => {
    const data = await api("/2fa/setup");
    const qr = await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" });
    reset();
    setTfaSetup({ secret: data.secret, qr });
    setView("tfa-setup");
  });

  const enableTfa = () => run(async () => {
    if (totp.length < 6) { setError("Enter the 6-digit code shown in your authenticator app"); return; }
    try {
      await api("/2fa/enable", { code: totp });
    } catch (e) { setTotp(""); throw e; }
    setSuccess("Two-factor authentication is on. You'll need your authenticator app to sign in and to change your transaction password.");
    onSecurityUpdated();
    reset(); setView("overview");
  });

  const startTfaDisable = () => run(async () => {
    await api("/2fa/disable/request-otp");
    reset();
    setView("tfa-disable");
  });

  const confirmTfaDisable = () => run(async () => {
    if (otp.length < 6) { setError("Enter the 6-digit code from your email"); return; }
    if (usePakInstead ? !pak.trim() : totp.length < 6) {
      setError(usePakInstead ? "Enter your PAK" : "Enter the 6-digit code from your authenticator app");
      return;
    }
    try {
      await api("/2fa/disable", { otp, ...(usePakInstead ? { pak: pak.trim() } : { totp }) });
    } catch (e) { setTotp(""); throw e; }
    setSuccess("Two-factor authentication is off.");
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
            <p className="text-sm text-muted-foreground">Transaction password, authorization key &amp; two-factor</p>
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
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                  user.hasPak ? "bg-violet-100 text-violet-600" : "bg-secondary text-muted-foreground")}>
                  <KeyRound className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground text-sm">Personal Authorization Key (PAK)</p>
                  <p className="text-xs text-muted-foreground mt-0.5 break-all">
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
                <button onClick={() => { reset(); setView(user.twoFactorEnabled ? "chg-txn-2fa" : "chg-txn-pak"); }}
                  disabled={!user.twoFactorEnabled && !user.hasPak}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-semibold flex items-center gap-1.5 hover:bg-secondary/80 transition-colors disabled:opacity-40"
                  title={!user.twoFactorEnabled && !user.hasPak ? "Generate a PAK first to change passwords" : undefined}>
                  <RefreshCw className="w-3 h-3" /> Change
                </button>
              )}
            </div>
          </motion.div>

          {/* Two-factor authentication card */}
          <motion.div variants={fadeUp} className="p-5 rounded-2xl border border-border bg-white space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                  user.twoFactorEnabled ? "bg-green-100 text-green-600" : "bg-secondary text-muted-foreground")}>
                  <Smartphone className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground text-sm">Two-factor authentication</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {user.twoFactorEnabled
                      ? "Authenticator code required to sign in and to change your transaction password"
                      : "Add a code from Google Authenticator, Authy or 1Password when you sign in"}
                  </p>
                </div>
              </div>
              <span className={cn("px-2.5 py-1 rounded-full text-xs font-bold shrink-0",
                user.twoFactorEnabled ? "bg-green-100 text-green-700" : "bg-secondary text-muted-foreground")}>
                {user.twoFactorEnabled ? "On" : "Off"}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {user.twoFactorEnabled ? (
                <button onClick={startTfaDisable} disabled={isLoading}
                  className="px-3 py-1.5 rounded-lg bg-secondary text-foreground text-xs font-semibold flex items-center gap-1.5 hover:bg-secondary/80 transition-colors disabled:opacity-60">
                  {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldOff className="w-3 h-3" />} Turn off
                </button>
              ) : authConfig?.totpAvailable === false ? (
                <p className="text-xs text-muted-foreground">Authenticator 2FA isn't available right now.</p>
              ) : (
                <button onClick={startTfaSetup} disabled={isLoading}
                  className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-primary/90 transition-colors disabled:opacity-60">
                  {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Smartphone className="w-3 h-3" />} Set up
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

      {/* ── CHANGE TRANSACTION PASSWORD — with 2FA ── */}
      {view === "chg-txn-2fa" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Change Transaction Password", codeSent ? "Step 2 of 2 — email code + authenticator code" : "Step 1 of 2 — choose a new password")}
          {error && <InlineError message={error} />}
          {!codeSent ? (
            <>
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
                onClick={requestChangeTxn2fa} disabled={isLoading || pwd.length < 6 || pwd !== pwd2}
                className="w-full bg-primary text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-primary/25 transition-shadow disabled:opacity-70 text-sm">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                {isLoading ? "Sending…" : "Send email code"}
              </motion.button>
            </>
          ) : (
            <>
              <div>
                <label htmlFor="chg-txn-email-code" className="block text-sm font-medium text-foreground mb-1.5">Email code</label>
                <TotpInput id="chg-txn-email-code" value={otp} onChange={setOtp} disabled={isLoading} />
                <p className="text-xs text-muted-foreground mt-1.5">Sent to your email just now.</p>
              </div>
              <div>
                <label htmlFor="chg-txn-totp" className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-1.5">
                  <Smartphone className="w-4 h-4 opacity-60" /> Authenticator app code
                </label>
                <TotpInput id="chg-txn-totp" value={totp} onChange={setTotp} disabled={isLoading} />
              </div>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={confirmChangeTxn2fa} disabled={isLoading || otp.length < 6 || totp.length < 6}
                className="w-full bg-primary text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-primary/25 transition-shadow disabled:opacity-70 text-sm">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {isLoading ? "Changing…" : "Change Transaction Password"}
              </motion.button>
              <button onClick={resendOtp} disabled={isLoading} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1">
                Resend email code
              </button>
            </>
          )}
        </motion.div>
      )}

      {/* ── TWO-FACTOR — setup ── */}
      {view === "tfa-setup" && tfaSetup && (
        <motion.div variants={fadeUp} className="space-y-5">
          {panelHeader("Set up two-factor authentication", "Scan the code with your authenticator app")}
          <ol className="space-y-4 text-sm">
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold grid place-items-center shrink-0">1</span>
              <span className="text-muted-foreground">Open <strong className="text-foreground">Google Authenticator</strong>, <strong className="text-foreground">Authy</strong>, <strong className="text-foreground">1Password</strong> or another authenticator app and add a new account.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold grid place-items-center shrink-0">2</span>
              <div className="space-y-3 min-w-0 flex-1">
                <span className="text-muted-foreground">Scan this QR code:</span>
                <img src={tfaSetup.qr} alt="QR code for your authenticator app" width={200} height={200}
                  className="rounded-xl border border-border bg-white p-2" />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Can't scan it? Enter this key instead:</p>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary">
                    <code className="flex-1 font-mono text-xs break-all select-all">{tfaSetup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                    <CopyButton text={tfaSetup.secret} />
                  </div>
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold grid place-items-center shrink-0">3</span>
              <div className="space-y-2 min-w-0 flex-1">
                <label htmlFor="tfa-setup-code" className="text-muted-foreground">Enter the 6-digit code it shows:</label>
                <TotpInput id="tfa-setup-code" value={totp} onChange={setTotp} disabled={isLoading} />
              </div>
            </li>
          </ol>
          {error && <InlineError message={error} />}
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={enableTfa} disabled={isLoading || totp.length < 6}
            className="w-full bg-primary text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-primary/25 transition-shadow disabled:opacity-70 text-sm">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            {isLoading ? "Verifying…" : "Turn on two-factor authentication"}
          </motion.button>
        </motion.div>
      )}

      {/* ── TWO-FACTOR — turn off ── */}
      {view === "tfa-disable" && (
        <motion.div variants={fadeUp} className="space-y-4">
          {panelHeader("Turn off two-factor authentication", "Confirm with your email and your authenticator app")}
          {error && <InlineError message={error} />}
          <div>
            <label htmlFor="tfa-off-email" className="block text-sm font-medium text-foreground mb-1.5">Email code</label>
            <TotpInput id="tfa-off-email" value={otp} onChange={setOtp} disabled={isLoading} />
            <p className="text-xs text-muted-foreground mt-1.5">Sent to your email just now.</p>
          </div>
          {usePakInstead ? (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                <KeyRound className="w-4 h-4 inline mr-1.5 opacity-60" /> Personal Authorization Key (PAK)
              </label>
              <input value={pak} onChange={(e) => setPak(e.target.value)} placeholder="Your 40-character PAK"
                className="w-full px-4 py-2.5 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none text-sm font-mono" />
            </div>
          ) : (
            <div>
              <label htmlFor="tfa-off-totp" className="flex items-center gap-1.5 text-sm font-medium text-foreground mb-1.5">
                <Smartphone className="w-4 h-4 opacity-60" /> Authenticator app code
              </label>
              <TotpInput id="tfa-off-totp" value={totp} onChange={setTotp} disabled={isLoading} />
            </div>
          )}
          {user.hasPak && (
            <button onClick={() => { setUsePakInstead((v) => !v); setError(null); }}
              className="text-xs font-semibold text-primary hover:underline">
              {usePakInstead ? "Use my authenticator app instead" : "Lost your phone? Use your PAK instead"}
            </button>
          )}
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={confirmTfaDisable} disabled={isLoading}
            className="w-full bg-foreground text-background font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-shadow disabled:opacity-70 text-sm">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
            {isLoading ? "Turning off…" : "Turn off two-factor authentication"}
          </motion.button>
          <button onClick={resendOtp} disabled={isLoading} className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1">
            Resend email code
          </button>
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
