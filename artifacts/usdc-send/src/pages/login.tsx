import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, ArrowRight, Loader2, Send, ShieldCheck, RefreshCw, Info, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { AppLayout } from "@/components/layout";

import { API_BASE } from "@/lib/api";

type Step = "credentials" | "otp" | "unverified";

export default function Login() {
  const queryClient = useQueryClient();

  const [step, setStep]               = useState<Step>("credentials");
  const [userId, setUserId]           = useState<number | null>(null);
  const [sentEmail, setSentEmail]     = useState("");
  const [isPending, setIsPending]     = useState(false);
  const [error, setError]             = useState("");
  const [resentVerification, setResentVerification] = useState(false);

  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const verifiedParam = searchParams.get("verified");
  const errorParam   = searchParams.get("error");

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const otpRefs       = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    }
  }, [step]);

  const handleCredentials = async (e: React.FormEvent) => {
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
      setSentEmail(email.toLowerCase().trim());
      setStep("otp");
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

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join("");
    if (code.length < 6) { setError("Please enter the full 6-digit code."); return; }
    setError("");
    setIsPending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code, type: "login" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Verification failed");
      localStorage.setItem("token", json.token);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next
        ? (import.meta.env.BASE_URL || "").replace(/\/$/, "") + next
        : import.meta.env.BASE_URL || "/";
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
    } catch (err: any) {
      setError(err.message ?? "Failed to resend code.");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <AppLayout>
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="orb orb-blue w-[600px] h-[600px] top-[-200px] right-[-100px]" />
        <div className="orb orb-cyan w-[400px] h-[400px] bottom-[-100px] left-[-100px]" />
      </div>

      <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md">

          {/* Logo */}
          <div className="flex justify-center mb-8">
            <Link href="/landing">
              <motion.div
                animate={{ y: [0, -4, 0] }}
                transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
              >
                <img src="/Sweep_logo_exact.svg" alt="Sweep" className="h-10 w-auto cursor-pointer" />
              </motion.div>
            </Link>
          </div>

          {/* Step panels — no AnimatePresence to avoid blank-screen transition bug */}
          {step === "credentials" ? (
            <motion.div
              key="credentials"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              {verifiedParam === "true" && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
                  className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Email verified! You can now sign in.</span>
                </motion.div>
              )}
              {errorParam === "link-expired" && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
                  className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Your verification link has expired. Log in below and we'll send you a new one.</span>
                </motion.div>
              )}
              <div className="text-center mb-8">
                <h1 className="text-3xl font-display font-bold">Welcome back</h1>
                <p className="text-muted-foreground mt-2">Log in to claim and manage your USD.</p>
              </div>

              <div className="glass-panel p-8 rounded-3xl">
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-6 p-4 rounded-xl bg-destructive/10 text-destructive text-sm font-medium border border-destructive/20 overflow-hidden"
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleCredentials} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Email</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-muted-foreground">
                        <Mail className="w-5 h-5" />
                      </div>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none"
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-foreground">Password</label>
                      <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">Forgot password?</Link>
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-muted-foreground">
                        <Lock className="w-5 h-5" />
                      </div>
                      <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        required
                      />
                    </div>
                  </div>

                  <motion.button
                    type="submit"
                    disabled={isPending}
                    whileHover={!isPending ? { scale: 1.02, y: -1 } : {}}
                    whileTap={!isPending ? { scale: 0.98 } : {}}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white bg-primary hover:shadow-lg hover:shadow-primary/30 transition-shadow disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isPending
                      ? <Loader2 className="w-5 h-5 animate-spin" />
                      : <><span>Log In</span> <ArrowRight className="w-5 h-5" /></>
                    }
                  </motion.button>
                </form>

                <div className="mt-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Don't have an account?{" "}
                    <Link href="/register" className="font-semibold text-primary hover:underline">Sign up</Link>
                  </p>
                </div>
              </div>
            </motion.div>
          ) : step === "unverified" ? (
            <motion.div
              key="unverified"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="text-center mb-8">
                <h1 className="text-3xl font-display font-bold">Verify your email</h1>
                <p className="text-muted-foreground mt-2">
                  We need to verify{" "}
                  <span className="font-semibold text-foreground">{sentEmail}</span>{" "}
                  before you can log in.
                </p>
              </div>

              <div className="glass-panel p-8 rounded-3xl">
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 mb-6">
                  <Info className="w-4 h-4 shrink-0" />
                  <p className="text-sm">Check your inbox for a verification link. It's valid for 72 hours.</p>
                </div>

                <AnimatePresence>
                  {resentVerification && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-medium overflow-hidden"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>Verification email resent! Check your inbox.</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-4">
                  <motion.button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={isPending}
                    whileHover={!isPending ? { scale: 1.02, y: -1 } : {}}
                    whileTap={!isPending ? { scale: 0.98 } : {}}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white bg-primary hover:shadow-lg hover:shadow-primary/30 transition-shadow disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isPending
                      ? <Loader2 className="w-5 h-5 animate-spin" />
                      : <><Send className="w-5 h-5" /><span>Resend Verification Email</span></>
                    }
                  </motion.button>
                  <button
                    type="button"
                    onClick={() => { setStep("credentials"); setError(""); }}
                    className="block mx-auto text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ← Back to login
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="otp"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="text-center mb-8">
                <h1 className="text-3xl font-display font-bold">Check your email</h1>
                <p className="text-muted-foreground mt-2">
                  We sent a 6-digit code to{" "}
                  <span className="font-semibold text-foreground">{sentEmail}</span>
                </p>
              </div>

              <div className="glass-panel p-8 rounded-3xl">
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-primary/5 border border-primary/10 mb-7">
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-sm text-muted-foreground">Enter the code to confirm it's you</p>
                </div>

                {/* Dev-mode hint when SMTP isn't configured */}

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-6 p-4 rounded-xl bg-destructive/10 text-destructive text-sm font-medium border border-destructive/20 overflow-hidden"
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleVerifyOtp} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-4 text-center">
                      Verification Code
                    </label>
                    <div className="flex items-center justify-center gap-2" onPaste={handleOtpPaste}>
                      {otp.map((digit, i) => (
                        <input
                          key={i}
                          ref={el => { otpRefs.current[i] = el; }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={digit}
                          onChange={e => handleOtpChange(i, e.target.value)}
                          onKeyDown={e => handleOtpKeyDown(i, e)}
                          className={cn(
                            "w-11 h-14 text-center text-xl font-bold rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none",
                            digit && "border-primary/60",
                          )}
                        />
                      ))}
                    </div>
                  </div>

                  <motion.button
                    type="submit"
                    disabled={isPending || otp.join("").length < 6}
                    whileHover={!isPending ? { scale: 1.02, y: -1 } : {}}
                    whileTap={!isPending ? { scale: 0.98 } : {}}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white bg-primary hover:shadow-lg hover:shadow-primary/30 transition-shadow disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isPending
                      ? <Loader2 className="w-5 h-5 animate-spin" />
                      : <><span>Verify &amp; Sign In</span> <ShieldCheck className="w-5 h-5" /></>
                    }
                  </motion.button>
                </form>

                <div className="mt-6 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">Didn't receive it?</p>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isPending}
                    className="flex items-center gap-1.5 mx-auto text-sm font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Resend code
                  </button>
                  <button
                    type="button"
                    onClick={() => { setStep("credentials"); setError(""); setOtp(["", "", "", "", "", ""]); }}
                    className="block mx-auto text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ← Back to login
                  </button>
                </div>
              </div>
            </motion.div>
          )}

        </div>
      </div>
    </AppLayout>
  );
}
