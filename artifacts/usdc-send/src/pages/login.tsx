import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, ShieldCheck, RefreshCw, Info, CheckCircle2, Eye, EyeOff, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import { API_BASE } from "@/lib/api";
import { finishSignIn, TWO_FACTOR_CHALLENGE_KEY } from "@/lib/auth-session";
import { GoogleSignInButton, type GoogleAuthResult } from "@/components/auth/google-sign-in";
import { TotpInput } from "@/components/auth/totp-input";

type Step = "credentials" | "otp" | "unverified" | "google-2fa";

const readStoredChallenge = () => {
  try { return sessionStorage.getItem(TWO_FACTOR_CHALLENGE_KEY); } catch { return null; }
};

export default function Login() {
  const queryClient = useQueryClient();

  const [challenge, setChallenge]     = useState<string | null>(readStoredChallenge);
  const [step, setStep]               = useState<Step>(() => (challenge ? "google-2fa" : "credentials"));
  // Accounts with authenticator 2FA enter the app code alongside the email code.
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [totp, setTotp]               = useState("");
  const [userId, setUserId]           = useState<number | null>(null);
  const [sentEmail, setSentEmail]     = useState("");
  const [isPending, setIsPending]     = useState(false);
  const [error, setError]             = useState("");
  const [resentVerification, setResentVerification] = useState(false);

  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const verifiedParam = searchParams.get("verified");
  const errorParam   = searchParams.get("error");

  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const otpRefs       = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    }
  }, [step]);

  const backToCredentials = (message = "") => {
    setStep("credentials");
    setError(message);
    setOtp(["", "", "", "", "", ""]);
    setTotp("");
    setChallenge(null);
    try { sessionStorage.removeItem(TWO_FACTOR_CHALLENGE_KEY); } catch { /* storage unavailable */ }
  };

  const handleGoogleResult = (r: GoogleAuthResult) => {
    if (r.kind === "session") { finishSignIn(r.token, queryClient); return; }
    setChallenge(r.challenge);
    setTotp("");
    setError("");
    setStep("google-2fa");
  };

  const handleGoogle2fa = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (totp.length < 6) { setError("Enter the 6-digit code from your authenticator app."); return; }
    setError("");
    setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/2fa/verify-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge, code: totp }),
      });
      const json = await res.json();
      if (json.code === "CHALLENGE_INVALID") { backToCredentials(json.message ?? "Please sign in again."); return; }
      if (!res.ok) throw new Error(json.message ?? "Verification failed");
      finishSignIn(json.token, queryClient);
    } catch (err: any) {
      setTotp("");
      setError(err.message ?? "Incorrect code. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  const handleCredentials = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!email || !password) { setError("Email and password are required."); return; }
    setError("");
    setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.toLowerCase().trim(), password }),
      });
      const json = await res.json();
      if (res.status === 403 && json.code === "EMAIL_NOT_VERIFIED") {
        setSentEmail(email.toLowerCase().trim());
        setStep("unverified");
        return;
      }
      if (!res.ok) throw new Error(json.message ?? "Login failed");
      setUserId(json.userId);
      setRequiresTotp(!!json.requiresTotp);
      setTotp("");
      setSentEmail(email.toLowerCase().trim());
      setStep("otp");
      toast.success(`Verification code sent to ${email.toLowerCase().trim()}`, { style: { fontWeight: "bold", color: "#16a34a" } });
    } catch (err: any) {
      setError(err.message ?? "Failed to log in. Please check your credentials.");
    } finally {
      setIsPending(false);
    }
  };

  const handleOtpChange = (i: number, val: string) => {
    if (!/^\d?$/.test(val)) return;
    const next = [...otp];
    next[i] = val;
    setOtp(next);
    if (val && i < 5) otpRefs.current[i + 1]?.focus();
  };

  const handleOtpKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
    if (e.key === "ArrowLeft"  && i > 0) otpRefs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < 5) otpRefs.current[i + 1]?.focus();
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    const next = [...text.split(""), ...Array(6).fill("")].slice(0, 6);
    setOtp(next);
    otpRefs.current[Math.min(text.length, 5)]?.focus();
  };

  const handleVerifyOtp = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    const code = otp.join("");
    if (code.length < 6) { setError("Please enter the full 6-digit code."); return; }
    if (requiresTotp && totp.length < 6) { setError("Enter the 6-digit code from your authenticator app."); return; }
    setError("");
    setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code, type: "login", ...(requiresTotp ? { totp } : {}) }),
      });
      const json = await res.json();
      if (json.code === "TOTP_REQUIRED") setRequiresTotp(true);
      if (json.code === "TOTP_INVALID") setTotp("");
      if (!res.ok) throw new Error(json.message ?? "Verification failed");
      finishSignIn(json.token, queryClient);
    } catch (err: any) {
      setError(err.message ?? "Incorrect code. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  const handleResendVerification = async () => {
    setIsPending(true);
    setResentVerification(false);
    try {
      await fetch(`${API_BASE}/api/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sentEmail }),
      });
      setResentVerification(true);
      toast.success(`Verification email sent to ${sentEmail}`, { style: { fontWeight: "bold", color: "#16a34a" } });
    } finally {
      setIsPending(false);
    }
  };

  const handleResend = async () => {
    if (!userId) return;
    setError("");
    setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/resend-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, type: "login" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to resend");
      setOtp(["", "", "", "", "", ""]);
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
      toast.success("A new verification code has been sent to your email", { style: { fontWeight: "bold", color: "#16a34a" } });
    } catch (err: any) {
      setError(err.message ?? "Failed to resend code.");
    } finally {
      setIsPending(false);
    }
  };

  // Messages for the redirects from the email-verification link (/api/auth/verify-email).
  const notice =
    verifiedParam === "true"    ? { tone: "ok",   text: "Email verified! You can now log in." } :
    verifiedParam === "already" ? { tone: "ok",   text: "Your email is already verified — log in below." } :
    errorParam === "link-expired"  ? { tone: "warn", text: "Your verification link has expired. Log in below and we'll send you a new one." } :
    errorParam === "invalid-token" ? { tone: "warn", text: "That verification link isn't valid. Log in below and we'll send you a new one." } :
    errorParam === "missing-token" ? { tone: "warn", text: "That verification link is incomplete. Log in below and we'll send you a new one." } :
    errorParam === "server-error"  ? { tone: "bad",  text: "We couldn't verify your email just now. Please try the link again." } :
    null;

  const field = "h-[54px] w-full rounded-[14px] border border-(--sw-field-line) bg-(--sw-bg) px-4 text-[15px] font-medium text-(--sw-ink) outline-none placeholder:text-[#9aa4b5] focus:border-(--sw-blue) focus:bg-white transition-colors disabled:opacity-60";
  const primary = "h-14 w-full rounded-2xl bg-(--sw-blue) text-white text-base font-bold flex items-center justify-center gap-2 hover:bg-(--sw-blue-hover) active:scale-[.98] transition disabled:bg-[#c5ccd8] disabled:cursor-not-allowed disabled:active:scale-100";
  const totpField = "h-[54px] rounded-[14px] border border-(--sw-field-line) bg-(--sw-bg) focus:border-(--sw-blue) focus:bg-white focus:ring-0";
  const back = (
    <button type="button" onClick={() => backToCredentials()}
      className="self-center text-sm font-semibold text-(--sw-muted) hover:text-(--sw-ink)">
      ← Back to log in
    </button>
  );
  const errorBox = error ? (
    <div role="alert" className="rounded-2xl bg-[#fef3f2] text-[#b42318] px-4 py-3 text-sm font-medium">{error}</div>
  ) : null;

  return (
    <div className="sweep-ui min-h-[100dvh] flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(480px,560px)]">
      {/* Brand panel — full-height on desktop, the top of the screen on phones */}
      <section aria-label="Sweep" className="relative flex-1 lg:flex-none bg-(--sw-blue) text-white px-6 sm:px-10 lg:px-14 pt-10 pb-12 lg:py-12 flex flex-col justify-between gap-12 overflow-hidden min-h-[300px]">
        <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute -right-16 -bottom-24 w-[420px] opacity-[.07] pointer-events-none hidden lg:block" />
        <Link href="/landing" className="relative flex items-center gap-2.5 self-start" aria-label="Sweep home">
          <img src="/sweep-mark-white.svg" alt="" className="w-6" />
          <span className="font-extrabold text-xl tracking-[-0.02em]">Sweep</span>
        </Link>
        <div className="relative flex flex-col gap-3 max-w-[520px]">
          <span className="text-xs font-semibold tracking-[0.04em] opacity-80">TESTNET · POWERED BY CIRCLE</span>
          <h2 className="font-extrabold text-[42px] lg:text-[64px] leading-[1.04] tracking-[-0.035em]">Send dollars to any email.</h2>
          <p className="text-[15px] lg:text-lg leading-relaxed opacity-85 max-w-[340px] lg:max-w-[420px]">No wallet, no seed phrase, no gas. Backed 1:1 by USDC.</p>
        </div>
      </section>

      {/* Form sheet — rises over the brand panel on phones, its own column on desktop */}
      <main className="relative -mt-5 lg:mt-0 bg-white rounded-t-3xl lg:rounded-none px-5 sm:px-10 pt-6 pb-8 lg:px-14 lg:py-12 flex flex-col lg:justify-center">
        <div className="w-full max-w-[420px] mx-auto flex flex-col gap-3">

          {step === "credentials" && (
            <>
              <h1 className="font-extrabold text-2xl tracking-[-0.02em] mb-1">Log in</h1>
              {notice && (
                <div className={cn("flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium",
                  notice.tone === "ok" ? "bg-[#ecfdf3] text-[#067647]" : notice.tone === "warn" ? "bg-[#fffaeb] text-[#b54708]" : "bg-[#fef3f2] text-[#b42318]")}>
                  {notice.tone === "ok" ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <Info className="w-4 h-4 shrink-0 mt-0.5" />}
                  <span>{notice.text}</span>
                </div>
              )}
              {errorBox}
              <GoogleSignInButton text="signin_with" onResult={handleGoogleResult} onError={setError} />
              <form onSubmit={handleCredentials} className="flex flex-col gap-3" noValidate>
                <label htmlFor="login-email" className="sr-only">Email</label>
                <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email" inputMode="email" autoCapitalize="none" required className={field} />
                <label htmlFor="login-password" className="sr-only">Password</label>
                <div className="relative">
                  <input id="login-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password" autoComplete="current-password" required className={cn(field, "pr-12")} />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 px-4 flex items-center text-(--sw-muted) hover:text-(--sw-ink)">
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <button type="submit" disabled={isPending} className={primary}>
                  {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Log in"}
                </button>
              </form>
              <div className="flex justify-between text-sm font-semibold px-1 pt-1">
                <Link href="/register" className="text-(--sw-blue) hover:text-(--sw-blue-hover)">Create account</Link>
                <Link href="/forgot-password" className="text-(--sw-muted) hover:text-(--sw-ink)">Forgot password?</Link>
              </div>
            </>
          )}

          {step === "unverified" && (
            <>
              <h1 className="font-extrabold text-2xl tracking-[-0.02em]">Verify your email</h1>
              <p className="text-sm text-(--sw-muted) leading-relaxed">
                We need to verify <span className="font-bold text-(--sw-ink)">{sentEmail}</span> before you can log in. Check your inbox for a verification link — it's valid for 72 hours.
              </p>
              {resentVerification && (
                <div className="flex items-start gap-2.5 rounded-2xl bg-[#ecfdf3] text-[#067647] px-4 py-3 text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> <span>Verification email resent — check your inbox.</span>
                </div>
              )}
              <button type="button" onClick={handleResendVerification} disabled={isPending} className={cn(primary, "mt-2")}>
                {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Send className="w-5 h-5" /> Resend verification email</>}
              </button>
              {back}
            </>
          )}

          {step === "otp" && (
            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-3">
              <h1 className="font-extrabold text-2xl tracking-[-0.02em]">Check your email</h1>
              <p className="text-sm text-(--sw-muted)">
                We sent a 6-digit code to <span className="font-bold text-(--sw-ink)">{sentEmail}</span>
              </p>
              {errorBox}
              <fieldset className="mt-1">
                <legend className="text-[13px] font-bold text-(--sw-label) mb-2">Email code</legend>
                <div className="grid grid-cols-6 gap-2" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { otpRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      autoComplete={i === 0 ? "one-time-code" : "off"}
                      maxLength={1}
                      value={digit}
                      aria-label={`Digit ${i + 1}`}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      className={cn("h-14 w-full min-w-0 text-center text-xl font-extrabold rounded-[14px] border bg-(--sw-bg) outline-none transition-colors focus:border-(--sw-blue) focus:bg-white",
                        digit ? "border-(--sw-blue)" : "border-(--sw-field-line)")}
                    />
                  ))}
                </div>
              </fieldset>
              {requiresTotp && (
                <div className="mt-1">
                  <label htmlFor="login-totp" className="flex items-center gap-1.5 text-[13px] font-bold text-(--sw-label) mb-2">
                    <Smartphone className="w-4 h-4 text-(--sw-blue)" /> Authenticator app code
                  </label>
                  <TotpInput id="login-totp" value={totp} onChange={setTotp} disabled={isPending} className={totpField} />
                  <p className="text-xs text-(--sw-muted) mt-2">Open your authenticator app and enter the current code for Sweep.</p>
                </div>
              )}
              <button type="submit" disabled={isPending || otp.join("").length < 6 || (requiresTotp && totp.length < 6)} className={cn(primary, "mt-2")}>
                {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ShieldCheck className="w-5 h-5" /> Verify &amp; log in</>}
              </button>
              <button type="button" onClick={handleResend} disabled={isPending}
                className="self-center flex items-center gap-1.5 text-sm font-semibold text-(--sw-blue) disabled:opacity-50">
                <RefreshCw className="w-3.5 h-3.5" /> Resend email code
              </button>
              {back}
            </form>
          )}

          {step === "google-2fa" && (
            <form onSubmit={handleGoogle2fa} className="flex flex-col gap-3">
              <h1 className="font-extrabold text-2xl tracking-[-0.02em]">Two-factor authentication</h1>
              <p className="text-sm text-(--sw-muted)">Enter the 6-digit code from your authenticator app to finish signing in with Google.</p>
              {errorBox}
              <label htmlFor="google-totp" className="flex items-center gap-1.5 text-[13px] font-bold text-(--sw-label) mt-1">
                <Smartphone className="w-4 h-4 text-(--sw-blue)" /> Authenticator app code
              </label>
              <TotpInput id="google-totp" value={totp} onChange={setTotp} disabled={isPending} className={totpField} />
              <button type="submit" disabled={isPending || totp.length < 6} className={cn(primary, "mt-2")}>
                {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ShieldCheck className="w-5 h-5" /> Verify &amp; log in</>}
              </button>
              {back}
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
