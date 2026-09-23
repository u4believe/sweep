import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Loader2, RefreshCw, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { TurnstileWidget } from "@/components/TurnstileWidget";

import { API_BASE } from "@/lib/api";
import { finishSignIn, TWO_FACTOR_CHALLENGE_KEY } from "@/lib/auth-session";
import { GoogleSignInButton, type GoogleAuthResult } from "@/components/auth/google-sign-in";
import { AuthBackLink, AuthError, AuthNotice, AuthShell, AuthTitle, authField, authPrimary } from "@/components/auth/auth-shell";
import { cn } from "@/lib/utils";

type Step = "form" | "check-email";

export default function Register() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
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

  const handleRegister = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!name || !email || !password) { setError("All fields are required."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
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
    <AuthShell headline="Your email is your payment ID." sub="Open a free account in a minute. No wallet, no seed phrase, no gas.">
      {step === "form" ? (
        <>
          <AuthTitle>Create account</AuthTitle>
          <AuthError message={error} />
          <GoogleSignInButton text="signup_with" onResult={handleGoogle} onError={setError} />
          <form onSubmit={handleRegister} className="flex flex-col gap-3" noValidate>
            <label htmlFor="reg-name" className="sr-only">Full name</label>
            <input id="reg-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Full name" autoComplete="name" required className={authField} />
            <label htmlFor="reg-email" className="sr-only">Email</label>
            <input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="email" inputMode="email" autoCapitalize="none" required className={authField} />
            <label htmlFor="reg-password" className="sr-only">Password</label>
            <div className="relative">
              <input id="reg-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (8+ characters)" autoComplete="new-password" required minLength={8} className={cn(authField, "pr-12")} />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 px-4 flex items-center text-(--sw-muted) hover:text-(--sw-ink)">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <TurnstileWidget onVerify={setCfToken} onExpire={() => setCfToken("")} />
            <button type="submit" disabled={isPending} className={authPrimary}>
              {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Create account"}
            </button>
          </form>
          <p className="text-sm text-(--sw-muted) text-center pt-1">
            Already have an account? <Link href="/login" className="font-semibold text-(--sw-blue) hover:text-(--sw-blue-hover)">Log in</Link>
          </p>
        </>
      ) : (
        <>
          <span className="w-12 h-12 rounded-2xl bg-(--sw-tint) text-(--sw-blue) grid place-items-center"><Mail className="w-6 h-6" /></span>
          <AuthTitle>Check your inbox</AuthTitle>
          <p className="text-sm text-(--sw-muted) leading-relaxed">
            We've sent a verification link to <span className="font-bold text-(--sw-ink)">{sentEmail}</span>. Click it to activate your account, then log in.
          </p>
          <AuthError message={error} />
          {resent && <AuthNotice tone="ok">A new verification link has been sent.</AuthNotice>}
          <p className="text-sm text-(--sw-muted)">Didn't get it? Check your spam folder or resend it.</p>
          <button type="button" onClick={handleResend} disabled={isPending} className={authPrimary}>
            {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <><RefreshCw className="w-5 h-5" /> Resend verification email</>}
          </button>
          <Link href="/login" className="h-14 w-full rounded-2xl border border-[#c9d0fd] text-(--sw-blue) text-base font-bold grid place-items-center hover:bg-(--sw-tint)">
            Already verified? Log in
          </Link>
          <AuthBackLink onClick={() => { setStep("form"); setError(""); setResent(false); }}>← Use a different email</AuthBackLink>
        </>
      )}
    </AuthShell>
  );
}
