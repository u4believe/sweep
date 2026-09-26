import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { TurnstileWidget } from "@/components/TurnstileWidget";

import { API_BASE } from "@/lib/api";
import { OPEN_FUND_KEY } from "@/lib/pay-qr";
import { finishSignIn, TWO_FACTOR_CHALLENGE_KEY, codeAlreadySentMessage, SPAM_HINT } from "@/lib/auth-session";
import { GoogleSignInButton, useAuthConfig, type GoogleAuthResult } from "@/components/auth/google-sign-in";
import { AuthError, NightAuthShell, NightTitle, authPrimary, nightField } from "@/components/auth/auth-shell";
import { cn } from "@/lib/utils";

// v5 sign-up: account → email code → transaction password → authorization key → done.
// The email code signs the user in, so steps 3–4 run with a session; anyone who
// leaves early finishes them in the dashboard's setup wizard.

type Step = "account" | "verify" | "txpwd" | "key" | "done";
const ORDER: Step[] = ["account", "verify", "txpwd", "key", "done"];

const STEPS: Array<[string, string]> = [
  ["Create account", "Name, email, password"],
  ["Verify email", "6-digit code"],
  ["Transaction password", "Authorizes every send"],
  ["Authorization key", "Proves it's you"],
];

const label = "text-[13px] font-bold text-(--sw-label)";
const primary = cn(authPrimary, "disabled:bg-[#c5ccd8]");

/** 0–4: length, a number, a symbol, and length 12+ or mixed case. */
function passwordScore(pwd: string) {
  if (!pwd) return 0;
  return [pwd.length >= 8, /\d/.test(pwd), /[^A-Za-z0-9]/.test(pwd), pwd.length >= 12 || (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd))]
    .filter(Boolean).length;
}
const STRENGTH_COLOR = ["#f04438", "#f79009", "#1128f5", "#067647"];
const STRENGTH_LABEL = ["Too weak", "Weak", "Fair", "Good", "Strong"];

const authed = (token: string) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

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

function Checkbox({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onToggle}
      className="flex gap-2.5 items-start text-left text-[13px] text-[#475467] leading-normal">
      <span className={cn("w-5 h-5 rounded-md border-[1.5px] grid place-items-center shrink-0 mt-px text-white",
        checked ? "bg-(--sw-blue) border-(--sw-blue)" : "bg-white border-[#d0d5dd]")}>
        {checked && <Check className="w-3 h-3" strokeWidth={3} />}
      </span>
      <span>{children}</span>
    </button>
  );
}

export default function Register() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const googleEnabled = !!useAuthConfig().data?.googleClientId;

  const [step,      setStep]      = useState<Step>("account");
  const [isPending, setIsPending] = useState(false);
  const [error,     setError]     = useState("");
  const [notice,    setNotice]    = useState("");
  const [codeNotice, setCodeNotice] = useState("");
  const [cfToken,   setCfToken]   = useState("");

  // Step 1
  const [name,         setName]         = useState("");
  // Prefilled when arriving from the landing page's "Get started" box (?email=…)
  const [email,        setEmail]        = useState(() => new URLSearchParams(window.location.search).get("email") ?? "");
  const [password,     setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed,       setAgreed]       = useState(false);
  // Step 2
  const [userId, setUserId] = useState<number | null>(null);
  const [code,   setCode]   = useState("");
  const [token,  setToken]  = useState("");
  // Step 3
  const [tx1, setTx1] = useState("");
  const [tx2, setTx2] = useState("");
  // Step 4
  const [pak,      setPak]      = useState("");
  const [revealed, setRevealed] = useState(false);
  const [copied,   setCopied]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  const stepIndex = Math.min(ORDER.indexOf(step), 3);
  const score = passwordScore(password);
  const sentTo = email.toLowerCase().trim();
  const firstName = name.trim().split(/\s+/)[0] || "there";

  const go = (next: Step) => { setError(""); setNotice(""); setStep(next); };

  // ── Step 1: create the account, email a code ───────────────────────────────
  const handleRegister = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!name.trim() || !email || !password) { setError("All fields are required."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (!agreed) { setError("Please confirm you understand Sweep is on testnet."); return; }
    setError(""); setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: sentTo, password, cfToken }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Registration failed");
      setUserId(json.userId);
      setCode("");
      go("verify");
      setCodeNotice(json.codeAlreadySent ? codeAlreadySentMessage(json.retryAfterSec) : "");
    } catch (err: any) {
      setError(err.message ?? "Failed to create account. Please try again.");
    } finally {
      setIsPending(false);
    }
  };

  // ── Step 2: the code verifies the email and signs the user in ──────────────
  const handleVerify = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (code.length < 6 || !userId) return;
    setError(""); setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code, type: "register" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "That code didn't work. Please try again.");
      localStorage.setItem("token", json.token);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setToken(json.token);
      go("txpwd");
    } catch (err: any) {
      setError(err.message ?? "That code didn't work. Please try again.");
      setCode("");
    } finally {
      setIsPending(false);
    }
  };

  const handleResend = async () => {
    if (!userId) return;
    setError(""); setNotice(""); setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/resend-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, type: "register" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Couldn't resend the code");
      setCode("");
      setCodeNotice("");
      setNotice(`A new code is on its way to ${sentTo}.`);
    } catch (err: any) {
      setError(err.message ?? "Couldn't resend the code");
    } finally {
      setIsPending(false);
    }
  };

  // ── Step 3: transaction password ───────────────────────────────────────────
  const txMismatch = !!tx2 && tx1 !== tx2;
  const handleTxPwd = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (tx1.length < 6 || tx1 !== tx2) return;
    setError(""); setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/security/txn-password/set`, {
        method: "POST", headers: authed(token), body: JSON.stringify({ password: tx1 }),
      });
      const json = await res.json().catch(() => ({}));
      // Already set (e.g. a retried request) — nothing more to do here
      if (!res.ok && res.status !== 409) throw new Error(json.message ?? "Couldn't save your transaction password");
      setTx1(""); setTx2("");
      go("key");
    } catch (err: any) {
      setError(err.message ?? "Couldn't save your transaction password");
    } finally {
      setIsPending(false);
    }
  };

  // ── Step 4: generate the authorization key once, on arrival ────────────────
  useEffect(() => {
    if (step !== "key" || pak || !token) return;
    let live = true;
    (async () => {
      setIsPending(true);
      try {
        const res  = await fetch(`${API_BASE}/api/security/pak/generate-first`, { method: "POST", headers: authed(token) });
        const json = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.status === 409) { go("done"); return; } // created earlier — nothing to show
        if (!res.ok) throw new Error(json.message ?? "Couldn't create your authorization key");
        setPak(json.pak);
      } catch (err: any) {
        if (live) setError(err.message ?? "Couldn't create your authorization key");
      } finally {
        if (live) setIsPending(false);
      }
    })();
    return () => { live = false; };
  }, [step, token]);

  const copyKey = () => {
    navigator.clipboard?.writeText(pak).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleFinish = async () => {
    if (!saved) return;
    setError(""); setIsPending(true);
    try {
      await fetch(`${API_BASE}/api/security/pak/confirm-copied`, { method: "POST", headers: authed(token) });
      setPak("");
      go("done");
    } catch {
      setError("Couldn't finish setup. Please try again.");
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

  const canGoBack = step === "verify";

  return (
    <NightAuthShell hero={<StepRail current={step === "done" ? 4 : stepIndex} />}>
      {step !== "done" && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-[13px] font-bold text-(--sw-muted)">
            <span>Step {stepIndex + 1} of {STEPS.length}</span>
            {canGoBack && <button type="button" onClick={() => go("account")} className="hover:text-(--sw-ink)">← Back</button>}
          </div>
          <div className="h-1 rounded-full bg-(--sw-field-line) overflow-hidden" aria-hidden>
            <div className="h-full bg-(--sw-blue) transition-[width] duration-300" style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>
      )}

      {step === "account" && (
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
            <Checkbox checked={agreed} onToggle={() => setAgreed(!agreed)}>
              I understand Sweep is running on testnet, so balances are test USDC with no real-world value.
            </Checkbox>
            <TurnstileWidget onVerify={setCfToken} onExpire={() => setCfToken("")} />
            <button type="submit" disabled={isPending || !agreed} className={primary}>
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
      )}

      {step === "verify" && (
        <form onSubmit={handleVerify} className="flex flex-col gap-[18px]">
          <NightTitle title="Verify your email" sub={<>Enter the 6-digit code sent to <strong className="text-(--sw-ink)">{sentTo}</strong>.</>} />
          <AuthError message={error} />
          {notice && <p role="status" className="rounded-2xl bg-[#ecfdf3] text-[#067647] px-4 py-3 text-sm font-medium">{notice}</p>}
          {codeNotice && <p role="status" className="rounded-2xl bg-[#fffaeb] text-[#b54708] px-4 py-3 text-sm font-medium">{codeNotice}</p>}
          <label htmlFor="reg-code" className="sr-only">Verification code</label>
          <input id="reg-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" autoFocus
            className="h-16 rounded-2xl border border-(--sw-field-line) bg-white px-5 text-center text-[28px] font-extrabold tracking-[0.5em] outline-none placeholder:text-[#c5ccd8] focus:border-(--sw-blue) focus:shadow-[0_0_0_4px_rgb(17_40_245/.1)] transition" />
          <button type="submit" disabled={isPending || code.length < 6} className={primary}>
            {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Verify email"}
          </button>
          <p className="text-sm text-(--sw-muted) text-center">
            Didn't get it?{" "}
            <button type="button" onClick={handleResend} disabled={isPending} className="font-bold text-(--sw-blue) disabled:opacity-50">Resend code</button>
          </p>
          <p className="text-xs text-(--sw-muted) text-center -mt-2">{SPAM_HINT}</p>
        </form>
      )}

      {step === "txpwd" && (
        <form onSubmit={handleTxPwd} className="flex flex-col gap-[18px]">
          <NightTitle title="Set a transaction password" sub="A second password, separate from login. You'll enter it to authorize every send." />
          <AuthError message={error} />
          <div className="flex flex-col gap-2">
            <label htmlFor="reg-tx1" className={label}>Transaction password</label>
            <input id="reg-tx1" type="password" value={tx1} onChange={(e) => setTx1(e.target.value)}
              placeholder="At least 6 characters" autoComplete="new-password" autoFocus className={nightField} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="reg-tx2" className={label}>Confirm</label>
            <input id="reg-tx2" type="password" value={tx2} onChange={(e) => setTx2(e.target.value)}
              placeholder="Type it again" autoComplete="new-password"
              className={cn(nightField, txMismatch && "border-[#f04438] focus:border-[#f04438]")} />
            <span className="text-xs font-semibold text-[#b42318] min-h-4" role="status">{txMismatch ? "Passwords don't match" : ""}</span>
          </div>
          <button type="submit" disabled={isPending || tx1.length < 6 || tx1 !== tx2} className={primary}>
            {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Save password"}
          </button>
        </form>
      )}

      {step === "key" && (
        <div className="flex flex-col gap-[18px]">
          <NightTitle title="Save your authorization key" sub="This 40-character key proves it's you when you publish plans or change your passwords. We can't show it again." />
          <AuthError message={error} />
          <div className="bg-(--sw-navy) text-white rounded-[18px] p-5 flex flex-col gap-3.5">
            {pak ? (
              <span className={cn("text-[17px] font-bold tracking-[0.08em] leading-relaxed break-all text-(--sw-sky) transition-[filter] select-all", !revealed && "blur-[6px] select-none")}
                aria-label={revealed ? "Authorization key" : "Authorization key, hidden"}>
                {pak}
              </span>
            ) : (
              <span className="flex items-center gap-2 text-sm text-(--sw-on-navy)"><Loader2 className="w-4 h-4 animate-spin" /> Creating your key…</span>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setRevealed(!revealed)} disabled={!pak}
                className="h-11 rounded-xl border border-(--sw-navy-chip-line) text-white text-sm font-bold disabled:opacity-50">
                {revealed ? "Hide" : "Reveal"}
              </button>
              <button type="button" onClick={copyKey} disabled={!pak}
                className="h-11 rounded-xl bg-white text-(--sw-navy) text-sm font-bold disabled:opacity-50">
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <Checkbox checked={saved} onToggle={() => setSaved(!saved)}>
            <span className="text-sm font-semibold text-(--sw-label)">I've stored this key somewhere safe.</span>
          </Checkbox>
          <button type="button" onClick={handleFinish} disabled={isPending || !pak || !saved} className={primary}>
            {isPending && pak ? <Loader2 className="w-5 h-5 animate-spin" /> : "Finish setup"}
          </button>
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-col gap-[18px]">
          <div className="relative overflow-hidden bg-(--sw-blue) text-white rounded-[26px] px-7 pt-9 pb-8 min-h-[240px] flex flex-col justify-end gap-1.5">
            <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] opacity-[.08] pointer-events-none" />
            <span className="relative text-xs font-bold tracking-[0.05em] opacity-85">ACCOUNT READY</span>
            <span className="relative font-extrabold text-[56px] sm:text-[64px] leading-[.95] tracking-[-0.05em]">You're in.</span>
            <span className="relative text-[15px] opacity-90">Welcome, {firstName}.</span>
          </div>
          <div className="bg-white border border-(--sw-line) rounded-2xl px-4 py-3.5 flex items-center gap-2.5">
            <span className="text-[13px] font-semibold text-(--sw-muted) whitespace-nowrap">Your payment ID</span>
            <span className="flex-1 min-w-0 text-right font-bold text-sm truncate">{sentTo}</span>
          </div>
          <button type="button" className={primary} onClick={() => {
            try { sessionStorage.setItem(OPEN_FUND_KEY, "1"); } catch { /* storage unavailable */ }
            finishSignIn(token || localStorage.getItem("token") || "", queryClient);
          }}>
            Add money to get started
          </button>
          <button type="button" onClick={() => finishSignIn(token || localStorage.getItem("token") || "", queryClient)}
            className="text-sm font-bold text-(--sw-blue) text-center">
            Go to dashboard
          </button>
        </div>
      )}
    </NightAuthShell>
  );
}
