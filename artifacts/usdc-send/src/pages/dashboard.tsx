import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertCircle, Loader2, Copy, Check, Mail, LifeBuoy,
} from "lucide-react";
import {
  useGetCurrentUser,
  useGetUserBalance,
  useWithdrawCrypto,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api";
import { MobileDashboard } from "@/components/mobile/mobile-dashboard";
import { WebDashboard } from "@/components/desktop/web-dashboard";
import type { DashboardShellProps } from "@/components/sweep/types";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { FullBalance } from "@/lib/wallet";
import { takeOpenFund, takePayTo } from "@/lib/pay-qr";
import { cn } from "@/lib/utils";
import { SettingsSection } from "@/components/settings/settings-section";
import { forgetUnless2fa } from "@/lib/biometric";

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
  // Sign-up now verifies with an emailed code; logging in sends one.
  const relogin = () => { localStorage.removeItem("token"); window.location.href = `${BASE}/login`; };
  return (
    <div className="sweep-ui min-h-[100dvh] grid place-items-center px-5">
      <div className="w-full max-w-[420px] bg-white border border-(--sw-line) rounded-[24px] p-7 flex flex-col gap-4 text-center">
        <img src="/sweep-mark-blue.svg" alt="" className="w-7 mx-auto" />
        <h1 className="font-extrabold text-2xl tracking-[-0.03em]">Verify your email</h1>
        <p className="text-[15px] text-(--sw-muted) leading-relaxed">
          <strong className="text-(--sw-ink)">{email}</strong> isn't verified yet. Log in again and we'll email you a 6-digit code to finish.
        </p>
        <button type="button" onClick={relogin}
          className="h-[52px] rounded-2xl bg-(--sw-blue) text-white text-[15px] font-bold hover:bg-(--sw-blue-hover)">Log in to verify</button>
      </div>
    </div>
  );
}

// ─── Account Setup Wizard overlay ─────────────────────────────────────────────

function AccountSetupWizard({ user, onComplete }: { user: any; onComplete: () => void }) {
  const steps: Array<[string, boolean]> = [
    ["Transaction password", !!user.hasTransactionPassword],
    ["Authorization key", !!user.hasPak],
  ];
  return (
    <div className="sweep-ui min-h-[100dvh] flex items-start sm:items-center justify-center px-4 py-10">
      <div className="w-full max-w-[560px] flex flex-col gap-6">
        <div className="flex items-center gap-2.5">
          <img src="/sweep-mark-blue.svg" alt="" className="w-[22px]" />
          <span className="font-extrabold text-xl tracking-[-0.02em]">Sweep</span>
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-extrabold text-[32px] tracking-[-0.04em] leading-tight">Finish setting up your account</h1>
          <p className="text-[15px] text-(--sw-muted)">Secure your account before you send money. Both take under a minute.</p>
          <div className="flex flex-wrap gap-2 pt-2">
            {steps.map(([label, done]) => (
              <span key={label} className={cn("inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-bold border",
                done ? "bg-[#ecfdf3] border-[#abefc6] text-[#067647]" : "bg-white border-(--sw-field-line) text-(--sw-label)")}>
                {done ? "✓" : "•"} {label}
              </span>
            ))}
          </div>
        </div>
        <SettingsSection security={user} onUpdated={onComplete} securityOnly />
      </div>
    </div>
  );
}

/** Shown while the account loads — same background as the app, so no old UI flashes. */
function AppSplash() {
  return (
    <div className="sweep-ui min-h-[100dvh] grid place-items-center" role="status" aria-label="Loading Sweep">
      <div className="flex flex-col items-center gap-4">
        <img src="/sweep-mark-blue.svg" alt="" className="w-9 animate-pulse" />
        <Loader2 className="w-5 h-5 text-(--sw-blue) animate-spin" />
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
  const [initialFund]  = useState(() => takeOpenFund());

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

  // Face ID / fingerprint needs 2FA: without it, this device's passkey is gone server-side too.
  const twoFactorOn = (user as any)?.twoFactorEnabled;
  useEffect(() => {
    if (user) forgetUnless2fa(!!twoFactorOn);
  }, [user, twoFactorOn]);

  if (isUserLoading || !user) return <AppSplash />;

  if (user && !(user as any).emailVerified) {
    return <EmailVerificationPending email={user.email} />;
  }

  if (user && (user as any).emailVerified && (!user.hasPak || !(user as any).hasTransactionPassword)) {
    return <AccountSetupWizard user={user} onComplete={() => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] })} />;
  }

  const circleWallet = (user as any)?.circleWalletAddress as string | undefined;
  const hasTxnPwd    = (user as any).hasTransactionPassword as boolean;

  const logout = () => {
    localStorage.removeItem("token");
    queryClient.clear();
    window.location.href = import.meta.env.BASE_URL || "/";
  };

  const shell: DashboardShellProps = {
    user: { name: user.name, email: user.email, hasTransactionPassword: hasTxnPwd, circleWalletAddress: circleWallet, twoFactorEnabled: !!(user as any).twoFactorEnabled },
    balance: bal,
    depositAddresses,
    withdraw: withdrawCryptoMutation,
    initialPayTo,
    initialFund,
    onBalanceChanged: () => { refetchBalance(); invalidateHistory(); },
    onLogout: logout,
    slots: {
      settings:   <SettingsSection security={user as any} account={{ name: user.name, email: user.email, circleWalletAddress: circleWallet }}
                    onUpdated={() => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] })} onLogout={logout} />,
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

