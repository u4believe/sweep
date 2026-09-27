import { useState } from "react";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { API_BASE } from "@/lib/api";
import { SPAM_HINT, codeAlreadySentMessage } from "@/lib/auth-session";
import { AuthError, NightAuthShell, NightTitle, authPrimary, nightField } from "@/components/auth/auth-shell";
import { cn, secretInputProps, secretTextProps } from "@/lib/utils";

// Forgot password: email → email code (+ authenticator code when 2FA is on) → new
// password. "Try another method" swaps the codes for the authorization key, for
// people who've lost access to their email or authenticator app.

type Step = "email" | "codes" | "key" | "password" | "done";

const label   = "text-[13px] font-bold text-(--sw-label)";
const primary = cn(authPrimary, "disabled:bg-[#c5ccd8]");
const codeCls = cn(nightField, "text-center text-xl font-extrabold tracking-[0.35em] placeholder:text-[15px] placeholder:font-medium placeholder:tracking-normal");

const post = async (path: string, body: object) => {
  const res  = await fetch(`${API_BASE}/api/auth${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { res, json };
};

export default function ForgotPassword() {
  const [step,    setStep]    = useState<Step>("email");
  const [email,   setEmail]   = useState(() => new URLSearchParams(window.location.search).get("email") ?? "");
  const [cfToken, setCfToken] = useState("");
  const [otp,     setOtp]     = useState("");
  const [totp,    setTotp]    = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [pak,     setPak]     = useState("");
  const [token,   setToken]   = useState("");
  const [pwd,     setPwd]     = useState("");
  const [pwd2,    setPwd2]    = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState("");
  const [notice,  setNotice]  = useState("");

  const addr = email.toLowerCase().trim();
  const go = (s: Step) => { setError(""); setNotice(""); setStep(s); };

  const requestCode = async (e?: { preventDefault(): void }) => {
    e?.preventDefault();
    if (!addr) { setError("Enter your email address."); return; }
    setBusy(true); setError("");
    try {
      const { res, json } = await post("/forgot-password", { email: addr, cfToken });
      if (!res.ok) throw new Error(json.message ?? "Something went wrong. Please try again.");
      if (step === "email") { setOtp(""); setTotp(""); go("codes"); }
      setNotice(`If ${addr} has a Sweep account, we've sent it a 6-digit code.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyCodes = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (otp.length < 6) return;
    setBusy(true); setError("");
    try {
      const { res, json } = await post("/reset-password/verify", { email: addr, otp, ...(totp ? { totp } : {}) });
      if (!res.ok) {
        if (json.code === "TOTP_REQUIRED") { setNeedTotp(true); throw new Error("This account uses two-factor authentication. Enter the code from your authenticator app too."); }
        if (json.code === "TOTP_INVALID") setTotp("");
        else if (res.status === 429 && json.retryAfterSec) throw new Error(codeAlreadySentMessage(json.retryAfterSec));
        else setOtp("");
        throw new Error(json.message ?? "That didn't work. Please try again.");
      }
      setToken(json.resetToken);
      go("password");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyKey = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!pak.trim()) return;
    setBusy(true); setError("");
    try {
      const { res, json } = await post("/reset-password/verify-pak", { email: addr, pak: pak.trim() });
      if (!res.ok) throw new Error(json.message ?? "That key didn't work.");
      setToken(json.resetToken); setPak("");
      go("password");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const mismatch = !!pwd2 && pwd !== pwd2;
  const savePassword = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (pwd.length < 8 || pwd !== pwd2) return;
    setBusy(true); setError("");
    try {
      const { res, json } = await post("/reset-password", { token, password: pwd });
      if (!res.ok) throw new Error(json.message ?? "Couldn't update your password.");
      setPwd(""); setPwd2(""); setToken("");
      go("done");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const backToLogin = <p className="text-sm text-(--sw-muted) text-center">Remembered it? <Link href="/login" className="font-bold text-(--sw-blue)">Log in</Link></p>;

  return (
    <NightAuthShell footer="Protected by email OTP, two-factor and your authorization key.">
      {step === "email" && (
        <form onSubmit={requestCode} className="flex flex-col gap-[18px]" noValidate>
          <NightTitle title="Reset your password" sub="Enter the email you sign in with. We'll send you a 6-digit code." />
          <AuthError message={error} />
          <div className="flex flex-col gap-2">
            <label htmlFor="fp-email" className={label}>Email</label>
            <input id="fp-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              autoComplete="email" inputMode="email" autoCapitalize="none" autoFocus className={nightField} />
          </div>
          <TurnstileWidget onVerify={setCfToken} onExpire={() => setCfToken("")} />
          <button type="submit" disabled={busy || !addr} className={primary}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send code"}</button>
          {backToLogin}
        </form>
      )}

      {step === "codes" && (
        <form onSubmit={verifyCodes} className="flex flex-col gap-[18px]">
          <NightTitle title="Confirm it's you" sub={<>Enter the code sent to <strong className="text-(--sw-ink)">{addr}</strong>, and your authenticator code if you use two-factor.</>} />
          {notice && !error && <p role="status" className="rounded-2xl bg-[#ecfdf3] text-[#067647] px-4 py-3 text-sm font-medium">{notice}</p>}
          <AuthError message={error} />
          <div className="flex flex-col gap-2">
            <label htmlFor="fp-otp" className={label}>Email code</label>
            <input id="fp-otp" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" autoFocus className={codeCls} />
            <span className="text-xs text-(--sw-muted)">{SPAM_HINT}</span>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="fp-totp" className={label}>Authenticator app code</label>
            <input id="fp-totp" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" placeholder={needTotp ? "Required for this account" : "Only if you use two-factor"}
              className={cn(codeCls, needTotp && !totp && "border-[#f79009]")} />
            <button type="button" onClick={() => go("key")} className="self-start text-[13px] font-bold text-(--sw-blue) hover:text-(--sw-blue-hover)">
              Try another method
            </button>
          </div>
          <button type="submit" disabled={busy || otp.length < 6 || (needTotp && totp.length < 6)} className={primary}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue"}
          </button>
          <p className="text-sm text-(--sw-muted) text-center">
            Didn't get it? <button type="button" onClick={() => requestCode()} disabled={busy} className="font-bold text-(--sw-blue) disabled:opacity-50">Resend code</button>
          </p>
        </form>
      )}

      {step === "key" && (
        <form onSubmit={verifyKey} className="flex flex-col gap-[18px]">
          <NightTitle title="Use your authorization key" sub="Lost access to your email or authenticator app? Your 40-character key proves the account is yours." />
          <AuthError message={error} />
          <div className="flex flex-col gap-2">
            <label htmlFor="fp-pak" className={label}>Authorization key</label>
            <input id="fp-pak" {...secretTextProps} value={pak} onChange={(e) => setPak(e.target.value)} placeholder="Your 40-character key" autoFocus
              className={cn(nightField, "font-mono text-sm tracking-wide")} />
          </div>
          <button type="submit" disabled={busy || !pak.trim()} className={primary}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue"}</button>
          <button type="button" onClick={() => go("codes")} className="self-center text-[13px] font-bold text-(--sw-blue)">Use email codes instead</button>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={savePassword} className="flex flex-col gap-[18px]">
          <NightTitle title="Choose a new password" sub="You'll use it to log in from now on." />
          <AuthError message={error} />
          <div className="flex flex-col gap-2">
            <label htmlFor="fp-new" className={label}>New password</label>
            <div className="relative">
              <input id="fp-new" type={showPwd ? "text" : "password"} {...secretInputProps} value={pwd} onChange={(e) => setPwd(e.target.value)}
                placeholder="At least 8 characters" autoFocus className={cn(nightField, "pr-16")} />
              <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute inset-y-0 right-0 px-3.5 text-[13px] font-bold text-(--sw-blue)">
                {showPwd ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="fp-new2" className={cn(label, "mb-1")}>Confirm</label>
            <input id="fp-new2" type={showPwd ? "text" : "password"} {...secretInputProps} value={pwd2} onChange={(e) => setPwd2(e.target.value)}
              placeholder="Type it again" className={cn(nightField, mismatch && "border-[#f04438] focus:border-[#f04438]")} />
            <span className="text-xs font-semibold text-[#b42318] min-h-4">{mismatch ? "Passwords don't match" : ""}</span>
          </div>
          <button type="submit" disabled={busy || pwd.length < 8 || pwd !== pwd2} className={primary}>{busy ? <Loader2 className="w-5 h-5 animate-spin" /> : "Update password"}</button>
          <p className="text-xs text-(--sw-muted) text-center">This step expires 10 minutes after you confirmed it's you.</p>
        </form>
      )}

      {step === "done" && (
        <div className="flex flex-col gap-[18px]">
          <NightTitle title="Password updated" sub="Log in with your new password." />
          <Link href={`/login`} className={primary}>Log in</Link>
        </div>
      )}
    </NightAuthShell>
  );
}
