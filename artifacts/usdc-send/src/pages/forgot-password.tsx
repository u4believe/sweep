import { useState } from "react";
import { Link } from "wouter";
import { Mail, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { AppLayout } from "@/components/layout";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { API_BASE } from "@/lib/api";

export default function ForgotPassword() {
  const [email, setEmail]         = useState("");
  const [isPending, setIsPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError]         = useState("");
  const [cfToken, setCfToken]     = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
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

          {submitted ? (
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
                <h1 className="text-2xl font-display font-bold mb-2">Check your inbox</h1>
                <p className="text-muted-foreground text-sm mb-6">
                  If <span className="font-semibold text-foreground">{email.toLowerCase().trim()}</span> is
                  registered and verified, you'll receive a password reset link shortly.
                  The link expires in <span className="font-semibold text-foreground">1 hour</span>.
                </p>
                <p className="text-xs text-muted-foreground mb-6">
                  Didn't receive it? Check your spam folder, or{" "}
                  <button
                    onClick={() => { setSubmitted(false); setEmail(""); }}
                    className="font-semibold text-primary hover:underline"
                  >
                    try again
                  </button>.
                </p>
                <Link href="/login" className="text-sm font-semibold text-primary hover:underline">
                  ← Back to login
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
                <h1 className="text-3xl font-display font-bold">Forgot password?</h1>
                <p className="text-muted-foreground mt-2">
                  Enter your email and we'll send you a reset link.
                </p>
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

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">Email address</label>
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
                        autoFocus
                      />
                    </div>
                  </div>

                  <TurnstileWidget onVerify={setCfToken} onExpire={() => setCfToken("")} />

                  <motion.button
                    type="submit"
                    disabled={isPending}
                    whileHover={!isPending ? { scale: 1.02, y: -1 } : {}}
                    whileTap={!isPending ? { scale: 0.98 } : {}}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-white bg-primary hover:shadow-lg hover:shadow-primary/30 transition-shadow disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {isPending
                      ? <Loader2 className="w-5 h-5 animate-spin" />
                      : <><span>Send Reset Link</span> <ArrowRight className="w-5 h-5" /></>
                    }
                  </motion.button>
                </form>

                <div className="mt-6 text-center">
                  <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    ← Back to login
                  </Link>
                </div>
              </div>
            </motion.div>
          )}

        </div>
      </div>
    </AppLayout>
  );
}
