import { useState } from "react";
import { Link } from "wouter";
import { Loader2, CheckCircle2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { AuthBackLink, AuthError, AuthShell, AuthTitle, authField, authPrimary } from "@/components/auth/auth-shell";

export default function ResetPassword() {
  const token = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).get("token");

  const [password, setPassword]         = useState("");
  const [confirm, setConfirm]           = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending]       = useState(false);
  const [success, setSuccess]           = useState(false);
  const [error, setError]               = useState("");

  const handleSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (!token) { setError("Invalid or missing reset token. Please request a new link."); return; }
    setError("");
    setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Failed to reset password.");
      setSuccess(true);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AuthShell headline="Choose a new password." sub="Pick something strong you haven't used before — then you're back in.">
      {!token ? (
        <>
          <span className="w-12 h-12 rounded-2xl bg-[#fffaeb] text-[#b54708] grid place-items-center"><AlertCircle className="w-6 h-6" /></span>
          <AuthTitle>Invalid link</AuthTitle>
          <p className="text-sm text-(--sw-muted) leading-relaxed">This password reset link is invalid or has already been used.</p>
          <Link href="/forgot-password" className={authPrimary}>Request a new reset link</Link>
          <AuthBackLink href="/login">← Back to log in</AuthBackLink>
        </>
      ) : success ? (
        <>
          <span className="w-12 h-12 rounded-2xl bg-[#ecfdf3] text-[#067647] grid place-items-center"><CheckCircle2 className="w-6 h-6" /></span>
          <AuthTitle>Password updated</AuthTitle>
          <p className="text-sm text-(--sw-muted) leading-relaxed">Your password has been reset. You can now log in with your new password.</p>
          <Link href="/login" className={authPrimary}>Go to log in</Link>
        </>
      ) : (
        <>
          <AuthTitle>Set new password</AuthTitle>
          <p className="text-sm text-(--sw-muted)">Minimum 8 characters.</p>
          <AuthError message={error} />
          <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
            <label htmlFor="reset-password" className="sr-only">New password</label>
            <div className="relative">
              <input id="reset-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="New password" autoComplete="new-password" minLength={8} required autoFocus className={cn(authField, "pr-12")} />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 px-4 flex items-center text-(--sw-muted) hover:text-(--sw-ink)">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <label htmlFor="reset-confirm" className="sr-only">Confirm new password</label>
            <input id="reset-confirm" type={showPassword ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password" autoComplete="new-password" required className={authField} />
            {confirm.length > 0 && (
              <p aria-live="polite" className={cn("text-xs font-semibold flex items-center gap-1.5 px-1", password === confirm ? "text-[#067647]" : "text-[#b42318]")}>
                {password === confirm
                  ? <><CheckCircle2 className="w-3.5 h-3.5" /> Passwords match</>
                  : <><AlertCircle className="w-3.5 h-3.5" /> Passwords do not match</>}
              </p>
            )}
            <button type="submit" disabled={isPending} className={cn(authPrimary, "mt-1")}>
              {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Reset password"}
            </button>
          </form>
          <AuthBackLink href="/login">← Back to log in</AuthBackLink>
        </>
      )}
    </AuthShell>
  );
}
