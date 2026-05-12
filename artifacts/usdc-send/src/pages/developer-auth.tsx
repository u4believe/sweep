import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, AlertCircle, Eye, EyeOff, CheckCircle2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function DeveloperAuth() {
  const [, navigate]     = useLocation();
  const [mode, setMode]  = useState<"login" | "register" | "forgot" | "reset">("login");
  const [loading, setLoading] = useState(false);
  const [err, setErr]    = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [resetToken, setResetToken] = useState("");

  // Registration-only saved keys (shown once)
  const [savedKeys, setSavedKeys] = useState<{ live: string; test: string } | null>(null);

  const [form, setForm] = useState({
    email: "", password: "", name: "", paymentEmail: "", newPassword: "",
  });

  // Detect reset token in URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (t) {
      setResetToken(t);
      setMode("reset");
    }
  }, []);

  function field(key: keyof typeof form) {
    return {
      value:    form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  function switchMode(next: "login" | "register" | "forgot") {
    setMode(next);
    setErr(null);
    setSuccess(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === "forgot") {
        const res = await fetch("/api/developer/forgot-password", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ email: form.email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message ?? "Something went wrong");
        setSuccess(data.message);
        setLoading(false);
        return;
      }

      if (mode === "reset") {
        const res = await fetch("/api/developer/reset-password", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ token: resetToken, newPassword: form.newPassword }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message ?? "Something went wrong");
        setSuccess(data.message);
        setLoading(false);
        return;
      }

      const body = mode === "login"
        ? { email: form.email, password: form.password }
        : { email: form.email, password: form.password, name: form.name, paymentEmail: form.paymentEmail };

      const res = await fetch(`/api/developer/${mode}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Something went wrong");

      localStorage.setItem("dev_token", data.token);

      if (mode === "register" && data.apiKeys) {
        setSavedKeys(data.apiKeys);
        setLoading(false);
        return;
      }

      navigate(`${BASE}/developer/dashboard`);
    } catch (e: any) {
      setErr(e.message);
    }
    setLoading(false);
  }

  // ── Save API keys screen ───────────────────────────────────────────────────

  if (savedKeys) {
    return (
      <div className="min-h-screen bg-[#060912] flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md space-y-6"
        >
          <div className="text-center space-y-2">
            <img src={`${BASE}/Sweep_logo_exact.svg`} alt="Sweep" className="h-10 mx-auto brightness-0 invert" />
            <h1 className="text-xl font-black text-white">Save your API keys</h1>
            <p className="text-white/50 text-sm">These are shown once and cannot be retrieved again.</p>
          </div>

          <div className="space-y-3">
            {[
              { label: "Live key", key: savedKeys.live, color: "emerald" },
              { label: "Test key", key: savedKeys.test, color: "amber" },
            ].map(({ label, key, color }) => (
              <div key={label} className={`p-4 rounded-xl bg-${color}-500/10 border border-${color}-500/20 space-y-2`}>
                <p className={`text-xs font-bold text-${color}-400`}>{label}</p>
                <code className="text-xs font-mono text-white/80 break-all block">{key}</code>
                <button
                  onClick={() => navigator.clipboard.writeText(key)}
                  className={`text-xs text-${color}-400 hover:underline`}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate(`${BASE}/developer/dashboard`)}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors"
          >
            I've saved my keys — Go to Dashboard
          </button>
        </motion.div>
      </div>
    );
  }

  // ── Shared card shell ──────────────────────────────────────────────────────

  const headings: Record<typeof mode, string> = {
    login:    "Developer login",
    register: "Create developer account",
    forgot:   "Reset your password",
    reset:    "Set a new password",
  };

  return (
    <div className="min-h-screen bg-[#060912] flex items-center justify-center px-4">
      <motion.div
        key={mode}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-6"
      >
        <div className="text-center space-y-2">
          <Link href={`${BASE}/developer`} className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/70 text-sm mb-2 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to portal
          </Link>
          <img src={`${BASE}/Sweep_logo_exact.svg`} alt="Sweep" className="h-10 mx-auto brightness-0 invert" />
          <h1 className="text-xl font-black text-white">{headings[mode]}</h1>
        </div>

        {/* ── Success state ── */}
        {success ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              <p className="text-sm text-emerald-300 leading-relaxed">{success}</p>
            </div>
            {mode === "reset" ? (
              <button
                onClick={() => { setSuccess(null); switchMode("login"); }}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors"
              >
                Go to login
              </button>
            ) : (
              <p className="text-center text-sm text-white/40">
                <button onClick={() => switchMode("login")} className="text-indigo-400 hover:underline">
                  Back to login
                </button>
              </p>
            )}
          </div>
        ) : (

        /* ── Form ── */
        <form onSubmit={submit} className="space-y-3">

          {/* Register-only fields */}
          {mode === "register" && (
            <input
              type="text"
              placeholder="Full name"
              required
              className="w-full px-4 py-3 rounded-xl bg-white/8 border border-white/15 text-white placeholder-white/35 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              {...field("name")}
            />
          )}

          {/* Email — shown on login, register, forgot */}
          {mode !== "reset" && (
            <input
              type="email"
              placeholder="Email address"
              required
              className="w-full px-4 py-3 rounded-xl bg-white/8 border border-white/15 text-white placeholder-white/35 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              {...field("email")}
            />
          )}

          {mode === "register" && (
            <input
              type="email"
              placeholder="Payout email (where you receive payments)"
              required
              className="w-full px-4 py-3 rounded-xl bg-white/8 border border-white/15 text-white placeholder-white/35 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              {...field("paymentEmail")}
            />
          )}

          {/* Password — login & register */}
          {(mode === "login" || mode === "register") && (
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                placeholder={mode === "register" ? "Password (min 8 chars)" : "Password"}
                required
                minLength={mode === "register" ? 8 : undefined}
                className="w-full px-4 py-3 rounded-xl bg-white/8 border border-white/15 text-white placeholder-white/35 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 pr-10"
                {...field("password")}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          )}

          {/* Forgot password link — only in login mode */}
          {mode === "login" && (
            <div className="text-right">
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="text-xs text-white/40 hover:text-indigo-400 transition-colors"
              >
                Forgot password?
              </button>
            </div>
          )}

          {/* New password — reset mode */}
          {mode === "reset" && (
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                placeholder="New password (min 8 chars)"
                required
                minLength={8}
                className="w-full px-4 py-3 rounded-xl bg-white/8 border border-white/15 text-white placeholder-white/35 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 pr-10"
                {...field("newPassword")}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          )}

          {err && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> {err}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === "login"    && "Sign in"}
            {mode === "register" && "Create account"}
            {mode === "forgot"   && "Send reset link"}
            {mode === "reset"    && "Set new password"}
          </button>
        </form>
        )}

        {/* ── Footer links ── */}
        {!success && (
          <p className="text-center text-sm text-white/40">
            {mode === "login" && (
              <>Don't have an account?{" "}
                <button onClick={() => switchMode("register")} className="text-indigo-400 hover:underline">Register</button>
              </>
            )}
            {mode === "register" && (
              <>Already registered?{" "}
                <button onClick={() => switchMode("login")} className="text-indigo-400 hover:underline">Sign in</button>
              </>
            )}
            {(mode === "forgot" || mode === "reset") && (
              <>Remembered it?{" "}
                <button onClick={() => switchMode("login")} className="text-indigo-400 hover:underline">Back to login</button>
              </>
            )}
          </p>
        )}
      </motion.div>
    </div>
  );
}