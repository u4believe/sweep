import { useState } from "react";
import { Link } from "wouter";
import { Lock, ArrowRight, Loader2, CheckCircle2, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AppLayout } from "@/components/layout";
import { API_BASE } from "@/lib/api";

export default function ResetPassword() {
  const token = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  ).get("token");

  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [isPending, setIsPending] = useState(false);
  const [success, setSuccess]     = useState(false);
  const [error, setError]         = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
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
    <AppLayout>
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="orb orb-blue w-[600px] h-[600px] top-[-200px] right-[-100px]" />
        <div className="orb orb-cyan w-[400px] h-[400px] bottom-[-100px] left-[-100px]" />
      </div>

      <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md">

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

          {!token ? (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="glass-panel p-8 rounded-3xl text-center">
                <h1 className="text-2xl font-display font-bold mb-3">Invalid link</h1>
                <p className="text-muted-foreground text-sm mb-6">
                  This password reset link is invalid or has already been used.
                </p>
                <Link href="/forgot-password" className="text-sm font-semibold text-primary hover:underline">
                  Request a new reset link
                </Link>
              </div>
            </motion.div>
          ) : success ? (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="glass-panel p-8 rounded-3xl text-center">
                <div className="flex justify-center mb-5">
                  <div className="w-14 h-14 rounded-full bg-green-50 border border-green-200 flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7 text-green-600" />
                  </div>
                </div>
                <h1 className="text-2xl font-display font-bold mb-2">Password updated</h1>
                <p className="text-muted-foreground text-sm mb-6">
                  Your password has been reset successfully. You can now log in with your new password.
                </p>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white bg-primary hover:shadow-lg hover:shadow-primary/30 transition-shadow text-sm"
                >
                  Go to login <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div className="text-center mb-8">
                <h1 className="text-3xl font-display font-bold">Set new password</h1>
                <p className="text-muted-foreground mt-2">Choose a strong password you haven't used before.</p>
              </div>

              <div className="glass-panel p-8 rounded-3xl">
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-primary/5 border border-primary/10 mb-6">
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-sm text-muted-foreground">Minimum 8 characters</p>
                </div>

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

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">New password</label>
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
                        autoComplete="new-password"
                        minLength={8}
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Confirm new password</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-muted-foreground">
                        <Lock className="w-5 h-5" />
                      </div>
                      <input
                        type="password"
                        value={confirm}
                        onChange={e => setConfirm(e.target.value)}
                        className="w-full pl-11 pr-4 py-3 rounded-xl bg-white border-2 border-border focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none"
                        placeholder="••••••••"
                        autoComplete="new-password"
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
                      : <><span>Reset Password</span> <ArrowRight className="w-5 h-5" /></>
                    }
                  </motion.button>
                </form>
              </div>
            </motion.div>
          )}

        </div>
      </div>
    </AppLayout>
  );
}
