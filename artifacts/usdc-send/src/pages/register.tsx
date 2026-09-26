import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { TurnstileWidget } from "@/components/TurnstileWidget";

import { API_BASE } from "@/lib/api";
import { finishSignIn, TWO_FACTOR_CHALLENGE_KEY } from "@/lib/auth-session";
import { GoogleSignInButton, useAuthConfig, type GoogleAuthResult } from "@/components/auth/google-sign-in";
import { AuthBackLink, AuthError, AuthNotice, NightAuthShell, NightTitle, authPrimary, nightField } from "@/components/auth/auth-shell";
import { cn } from "@/lib/utils";

type Step = "form" | "check-email";

// Steps 3–4 run in the app's setup wizard after the first log in.
const STEPS: Array<[string, string]> = [
  ["Create account", "Name, email, password"],
  ["Verify email", "Link sent to your inbox"],
  ["Transaction password", "Authorizes every send"],
  ["Authorization key", "Your recovery key"],
];

const label = "text-[13px] font-bold text-(--sw-label)";

/** 0–4: length, a number, a symbol, and length 12+ or mixed case. */
function passwordScore(pwd: string) {
  if (!pwd) return 0;
  return [pwd.length >= 8, /\d/.test(pwd), /[^A-Za-z0-9]/.test(pwd), pwd.length >= 12 || (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd))]
    .filter(Boolean).length;
}
const STRENGTH_COLOR = ["#f04438", "#f79009", "#1128f5", "#067647"];
const STRENGTH_LABEL = ["Too weak", "Weak", "Fair", "Good", "Strong"];

function StepRail({ current }: { current: number }) {
  return (
    <div className="relative flex flex-col gap-3.5 max-w-[440px]">
      <h2 className="font-extrabold text-[36px] sm:text-[44px] lg:text-[clamp(36px,4vw,54px)] leading-[1.02] tracking-[-0.045em]">Open your account in a minute.</h2>
      <p className="text-base leading-[1.55] text-(--sw-on-navy)">Your email becomes your payment ID. No wallet, no seed phrase.</p>
      <ol className="mt-[18px] border-l border-(--sw-navy-chip-line) hidden sm:flex flex-col">
        {STEPS.map(([t, d], i) => {
          const done = i < current, cur = i === current;
          return (
            <li key={t} className="flex items-center gap-3.5 py-2.5 -ml-3.5" aria-current={cur ? "step" : undefined}>
              <span className={cn("w-7 h-7 rounded-full grid place-items-center text-xs font-extrabold border shrink-0",
                done ? "bg-(--sw-blue) border-(--sw-blue) text-white" : cur ? "bg-white border-white text-(--sw-navy)" : "bg-(--sw-navy) border-[#334064] text-(--sw-faint)")}>
                {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className="flex flex-col">
                <span className={cn("font-bold text-[15px]", done || cur ? "text-white" : "text-(--sw-faint)")}>{t}</span>
                <span className="text-xs text-(--sw-faint)">{d}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Register() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const googleEnabled = !!useAuthConfig().data?.googleClientId;
  const [step, setStep]           = useState<Step>("form");
  const [sentEmail, setSentEmail] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError]         = useState("");
  const [resent, setResent]       = useState(false);
  const [cfToken, setCfToken]     = useState("");

  const [name,         setName]         = useState("");
  // Prefilled when arriving from the landing page's "Get started" box (?email=…)
  const [email,        setEmail]        = useState(() => new URLSearchParams(window.location.search).get("email") ?? "");
  const [password,     setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed,       setAgreed]       = useState(false);

  const score = passwordScore(password);
  const stepIndex = step === "form" ? 0 : 1;

  const handleRegister = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!name || !email || !password) { setError("All fields are required."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (!agreed) { setError("Please confirm you understand Sweep is on testnet."); return; }
    setError("");
    setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: email.toLowerCase().trim(), password, cfToken }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Registration failed");
      setSentEmail(json.email ?? email.toLowerCase().trim());
      setStep("check-email");
      toast.success(`Verification email sent to ${json.email ?? email.toLowerCase().trim()}`, { style: { fontWeight: "bold", color: "#16a34a" } });
    } catch (err: any) {
      setError(err.message ?? "Failed to create account. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setResent(false);
    setIsPending(true);
    try {
      await fetch(`${API_BASE}/api/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sentEmail }),
      });
      setResent(true);
      toast.success(`Verification email resent to ${sentEmail}`, { style: { fontWeight: "bold", color: "#16a34a" } });
    } catch {
      setError("Failed to resend. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  const handleGoogle = (r: GoogleAuthResult) => {
    if (r.kind === "session") { finishSignIn(r.token, queryClient); return; }
    // Existing account with authenticator 2FA — finish on the login page.
    try { sessionStorage.setItem(TWO_FACTOR_CHALLENGE_KEY, r.challenge); } catch { /* storage unavailable */ }
    setLocation("/login");
  };

  return (
    <NightAuthShell hero={<StepRail current={stepIndex} />}>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-[13px] font-bold text-(--sw-muted)">
          <span>Step {stepIndex + 1} of {STEPS.length}</span>
          {step === "check-email" && (
            <button type="button" onClick={() => { setStep("form"); setError(""); setResent(false); }} className="hover:text-(--sw-ink)">← Back</button>
          )}
        </div>
        <div className="h-1 rounded-full bg-(--sw-field-line) overflow-hidden" aria-hidden>
          <div className="h-full bg-(--sw-blue) transition-[width] duration-300" style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      {step === "form" ? (
        <>
          <NightTitle title="Create your account" sub={
            <>Already have one? <Link href="/login" className="font-bold text-(--sw-blue) hover:text-(--sw-blue-hover)">Log in</Link></>
          } />
          <AuthError message={error} />
          <form onSubmit={handleRegister} className="flex flex-col gap-[18px]" noValidate>
            <div className="flex flex-col gap-2">
              <label htmlFor="reg-name" className={label}>Full name</label>
              <input id="reg-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Ada Okafor" autoComplete="name" required className={nightField} />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="reg-email" className={label}>Email · this becomes your payment ID</label>
              <input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="email" inputMode="email" autoCapitalize="none" required className={nightField} />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="reg-password" className={label}>Password</label>
              <div className="relative">
                <input id="reg-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters" autoComplete="new-password" required minLength={8} aria-describedby="reg-strength"
                  className={cn(nightField, "pr-16")} />
                <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 px-3.5 text-[13px] font-bold text-(--sw-blue) hover:text-(--sw-blue-hover)">
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="h-1 rounded-full" style={{ background: i < score ? STRENGTH_COLOR[score - 1] : "#e3e7ee" }} />
                ))}
              </div>
              <span id="reg-strength" className="text-xs text-(--sw-muted)">
                {password ? STRENGTH_LABEL[score] : "Use 8+ characters with a number and a symbol"}
              </span>
            </div>
            <button type="button" role="checkbox" aria-checked={agreed} onClick={() => setAgreed(!agreed)}
              className="flex gap-2.5 items-start text-left text-[13px] text-[#475467] leading-normal">
              <span className={cn("w-5 h-5 rounded-md border-[1.5px] grid place-items-center shrink-0 mt-px text-white",
                agreed ? "bg-(--sw-blue) border-(--sw-blue)" : "bg-white border-[#d0d5dd]")}>
                {agreed && <Check className="w-3 h-3" strokeWidth={3} />}
              </span>
              <span>I understand Sweep is running on testnet, so balances are test USDC with no real-world value.</span>
            </button>
            <TurnstileWidget onVerify={setCfToken} onExpire={() => setCfToken("")} />
            <button type="submit" disabled={isPending || !agreed} className={cn(authPrimary, "disabled:bg-[#c5ccd8]")}>
              {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue"}
            </button>
          </form>
          {googleEnabled && (
            <>
              <div className="flex items-center gap-3 text-xs font-semibold text-(--sw-faint) -my-1" aria-hidden>
                <span className="h-px flex-1 bg-(--sw-field-line)" /> or <span className="h-px flex-1 bg-(--sw-field-line)" />
              </div>
              <GoogleSignInButton text="signup_with" onResult={handleGoogle} onError={setError} />
            </>
          )}
        </>
      ) : (
        <>
          <span className="w-12 h-12 rounded-2xl bg-(--sw-tint) text-(--sw-blue) grid place-items-center"><Mail className="w-6 h-6" /></span>
          <NightTitle title="Verify your email" sub={
            <>We sent a verification link to <strong className="text-(--sw-ink)">{sentEmail}</strong>. Open it to activate your account, then log in to finish setup.</>
          } />
          <AuthError message={error} />
          {resent && <AuthNotice tone="ok">A new verification link has been sent.</AuthNotice>}
          <Link href="/login" className={authPrimary}>I've verified — log in</Link>
          <button type="button" onClick={handleResend} disabled={isPending}
            className="self-center flex items-center gap-1.5 text-sm font-bold text-(--sw-blue) disabled:opacity-50">
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Didn't get it? Resend link
          </button>
          <AuthBackLink onClick={() => { setStep("form"); setError(""); setResent(false); }}>Use a different email</AuthBackLink>
        </>
      )}
    </NightAuthShell>
  );
}
