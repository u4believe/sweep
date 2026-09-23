import { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { AuthBackLink, AuthError, AuthShell, AuthTitle, authField, authPrimary } from "@/components/auth/auth-shell";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { API_BASE } from "@/lib/api";

export default function ForgotPassword() {
  const [email, setEmail]         = useState("");
  const [isPending, setIsPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]         = useState("");
  const [cfToken, setCfToken]     = useState("");

  const handleSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!email) { setError("Please enter your email address."); return; }
    setError("");
    setIsPending(true);
    try {
      await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.toLowerCase().trim(), cfToken }),
      });
      setSubmitted(true);
      toast.success(`Password reset link sent to ${email.toLowerCase().trim()}`, { style: { fontWeight: "bold", color: "#16a34a" } });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AuthShell headline="Locked out? We'll get you back in." sub="We'll email you a secure link to choose a new password.">
      {submitted ? (
        <>
          <span className="w-12 h-12 rounded-2xl bg-[#ecfdf3] text-[#067647] grid place-items-center"><CheckCircle2 className="w-6 h-6" /></span>
          <AuthTitle>Check your inbox</AuthTitle>
          <p className="text-sm text-(--sw-muted) leading-relaxed">
            If <span className="font-bold text-(--sw-ink)">{email.toLowerCase().trim()}</span> is registered and verified, you'll receive a
            password reset link shortly. The link expires in <span className="font-bold text-(--sw-ink)">1 hour</span>.
          </p>
          <p className="text-sm text-(--sw-muted)">Didn't get it? Check your spam folder, or try again.</p>
          <button type="button" onClick={() => { setSubmitted(false); setEmail(""); }}
            className="h-14 w-full rounded-2xl border border-[#c9d0fd] text-(--sw-blue) text-base font-bold hover:bg-(--sw-tint)">
            Try again
          </button>
          <AuthBackLink href="/login">← Back to log in</AuthBackLink>
        </>
      ) : (
        <>
          <AuthTitle>Forgot password?</AuthTitle>
          <p className="text-sm text-(--sw-muted)">Enter your email and we'll send you a reset link.</p>
          <AuthError message={error} />
          <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
            <label htmlFor="forgot-email" className="sr-only">Email address</label>
            <input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="email" inputMode="email" autoCapitalize="none" required autoFocus className={authField} />
            <TurnstileWidget onVerify={setCfToken} onExpire={() => setCfToken("")} />
            <button type="submit" disabled={isPending} className={authPrimary}>
              {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send reset link"}
            </button>
          </form>
          <p className="text-xs text-(--sw-muted) leading-relaxed pt-1">
            Signed up with Google? You can use this to add a password to your account too.
          </p>
          <AuthBackLink href="/login">← Back to log in</AuthBackLink>
        </>
      )}
    </AuthShell>
  );
}
