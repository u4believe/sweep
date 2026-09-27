import { useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";
import { cn, secretInputProps, secretTextProps } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { authHeaders } from "@/lib/wallet";
import { useAuthConfig } from "@/components/auth/google-sign-in";
import { CopyIcon } from "@/components/sweep/ui";
import { SPAM_HINT } from "@/lib/auth-session";

// v5 Settings: Security (transaction password, authorization key, two-factor) and
// Account (profile, login password, session, delete) as grouped lists. Every
// change opens its own step page; the API calls are the /api/security flows.

export interface SecurityStatus {
  hasTransactionPassword?: boolean;
  hasPak?: boolean;
  pakCopied?: boolean;
  pakPreview?: string | null;
  pakCanRegenerate?: boolean;
  nextPakAllowedAt?: string | null;
  twoFactorEnabled?: boolean;
}

type View =
  | "list"
  | "txn-set"
  | "txn-change-pak" | "txn-change-otp" | "txn-change-2fa"
  | "pak-otp" | "pak-reveal"
  | "login-pak" | "login-otp"
  | "tfa-setup" | "tfa-off"
  | "delete-pak" | "delete-otp";

const card  = "bg-white border border-(--sw-line) rounded-[20px] overflow-hidden";
const field = "h-[52px] w-full min-w-0 rounded-[14px] border border-(--sw-field-line) bg-white px-4 text-[15px] font-medium text-(--sw-ink) outline-none placeholder:text-[#9aa4b5] focus:border-(--sw-blue) focus:shadow-[0_0_0_4px_rgb(17_40_245/.1)] transition disabled:opacity-60";
const label = "text-[13px] font-bold text-(--sw-label)";
const primaryBtn = "h-[52px] w-full rounded-2xl bg-(--sw-blue) text-white text-[15px] font-bold hover:bg-(--sw-blue-hover) disabled:bg-[#c5ccd8] disabled:cursor-not-allowed flex items-center justify-center gap-2 transition";
const dangerBtn  = "h-[52px] w-full rounded-2xl bg-[#b42318] text-white text-[15px] font-bold hover:bg-[#912018] disabled:bg-[#c5ccd8] disabled:cursor-not-allowed flex items-center justify-center gap-2 transition";
const linkBtn    = "text-[13px] font-bold text-(--sw-blue) hover:text-(--sw-blue-hover) disabled:text-(--sw-faint) disabled:cursor-not-allowed whitespace-nowrap";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function SettingsSection({ security, account, onUpdated, onLogout, securityOnly }: {
  security: SecurityStatus;
  account?: { name: string; email: string; circleWalletAddress?: string | null };
  onUpdated: () => void;
  onLogout?: () => void;
  /** Setup wizard: just the Security group. */
  securityOnly?: boolean;
}) {
  const { data: authConfig } = useAuthConfig();
  const [view,    setView]    = useState<View>("list");
  const [otp,     setOtp]     = useState("");
  const [totp,    setTotp]    = useState("");
  const [pak,     setPak]     = useState("");
  const [pwd,     setPwd]     = useState("");
  const [pwd2,    setPwd2]    = useState("");
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [notice,  setNotice]  = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [usePak,  setUsePak]  = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [tfa, setTfa] = useState<{ secret: string; qr: string } | null>(null);

  const reset = () => {
    setOtp(""); setTotp(""); setPak(""); setPwd(""); setPwd2(""); setError(null); setNotice(null);
    setCodeSent(false); setUsePak(false); setTfa(null);
  };
  const open  = (v: View) => { reset(); setSuccess(null); setView(v); };
  const done  = (msg: string) => { reset(); setSuccess(msg); setView("list"); onUpdated(); };

  const api = async (path: string, body?: object) => {
    const res  = await fetch(`${API_BASE}/api/security${path}`, {
      method: "POST", headers: authHeaders(true), ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message ?? "Request failed");
    return json;
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e: any) { setError(e?.message ?? "Something went wrong"); } finally { setBusy(false); }
  };
  const sentNotice = () => setNotice("We emailed you a 6-digit code.");
  const pwdMismatch = !!pwd2 && pwd !== pwd2;

  // ── Handlers (same /api/security flows as before) ─────────────────────────
  const setTxnPwd = () => run(async () => {
    await api("/txn-password/set", { password: pwd });
    done("Transaction password set.");
  });
  const txnChangeRequest = () => run(async () => {
    await api("/change-txn-password/request-otp", { pak: pak.trim() });
    sentNotice(); setView("txn-change-otp");
  });
  const txnChangeConfirm = () => run(async () => {
    await api("/change-txn-password/confirm", { pak: pak.trim(), newPassword: pwd, otp });
    done("Transaction password changed.");
  });
  const txn2faRequest = () => run(async () => {
    await api("/change-txn-password/request-otp");
    sentNotice(); setCodeSent(true);
  });
  const txn2faConfirm = () => run(async () => {
    try { await api("/change-txn-password/confirm", { newPassword: pwd, otp, totp }); } catch (e) { setTotp(""); throw e; }
    done("Transaction password changed.");
  });

  const pakCreate = () => run(async () => {
    const data = await api("/pak/generate-first");
    reset(); setRevealed(data.pak); setKeyCopied(false); setView("pak-reveal");
  });
  const pakRegenRequest = () => run(async () => {
    await api("/pak/request-otp");
    reset(); sentNotice(); setView("pak-otp");
  });
  const pakRegenConfirm = () => run(async () => {
    const data = await api("/pak/generate", { otp });
    reset(); setRevealed(data.pak); setKeyCopied(false); setView("pak-reveal");
  });
  const pakSaved = () => run(async () => {
    await api("/pak/confirm-copied");
    setRevealed(null);
    done("Authorization key saved. Keep it somewhere safe — it can't be shown again.");
  });
  const pakConfirmOnly = () => run(async () => {
    await api("/pak/confirm-copied");
    done("Authorization key marked as saved.");
  });

  const loginRequest = () => run(async () => {
    await api("/change-login-password/request-otp", { pak: pak.trim() });
    sentNotice(); setView("login-otp");
  });
  const loginConfirm = () => run(async () => {
    await api("/change-login-password/confirm", { pak: pak.trim(), newPassword: pwd, otp });
    done("Login password changed.");
  });

  const tfaStart = () => run(async () => {
    const data = await api("/2fa/setup");
    const qr = await QRCode.toDataURL(data.otpauthUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" });
    reset(); setSuccess(null); setTfa({ secret: data.secret, qr }); setView("tfa-setup");
  });
  const tfaEnable = () => run(async () => {
    try { await api("/2fa/enable", { code: totp }); } catch (e) { setTotp(""); throw e; }
    done("Two-factor authentication is on.");
  });
  const tfaOffStart = () => run(async () => {
    await api("/2fa/disable/request-otp");
    reset(); setSuccess(null); sentNotice(); setView("tfa-off");
  });
  const tfaOff = () => run(async () => {
    try { await api("/2fa/disable", { otp, ...(usePak ? { pak: pak.trim() } : { totp }) }); } catch (e) { setTotp(""); throw e; }
    done("Two-factor authentication is off.");
  });

  const deleteRequest = () => run(async () => {
    await api("/delete-account/request-otp", { pak: pak.trim() });
    sentNotice(); setView("delete-otp");
  });
  const deleteConfirm = () => run(async () => {
    await api("/delete-account/confirm", { pak: pak.trim(), otp });
    localStorage.removeItem("token");
    try { sessionStorage.clear(); } catch { /* storage unavailable */ }
    window.location.replace("/");
  });

  const resend = (path: string, body?: object) => run(async () => { await api(path, body); setOtp(""); sentNotice(); });

  // ── Step pages ─────────────────────────────────────────────────────────────
  if (view !== "list") {
    const back = () => { reset(); setRevealed(null); setView("list"); };
    const errorBox = error && <p role="alert" className="rounded-2xl bg-[#fef3f2] text-[#b42318] px-4 py-3 text-sm font-medium">{error}</p>;
    const noticeBox = notice && !error && (
      <div className="flex flex-col gap-1">
        <p role="status" className="rounded-2xl bg-[#ecfdf3] text-[#067647] px-4 py-3 text-sm font-medium">{notice}</p>
        <p className="text-xs text-(--sw-muted) px-1">{SPAM_HINT}</p>
      </div>
    );
    const newPwd = (min: number, what: string) => (
      <>
        <SecretField id="set-new" label={`New ${what}`} value={pwd} onChange={setPwd} placeholder={`At least ${min} characters`} />
        <div className="flex flex-col gap-1">
          <SecretField id="set-new2" label="Confirm" value={pwd2} onChange={setPwd2} placeholder="Type it again" invalid={pwdMismatch} />
          <span className="text-xs font-semibold text-[#b42318] min-h-4">{pwdMismatch ? "Passwords don't match" : ""}</span>
        </div>
      </>
    );
    const pwdOk = (min: number) => pwd.length >= min && pwd === pwd2;
    const keyField = (hint?: string) => (
      <div className="flex flex-col gap-2">
        <label htmlFor="set-pak" className={label}>Authorization key</label>
        <input id="set-pak" {...secretTextProps} value={pak} onChange={(e) => setPak(e.target.value)} placeholder="Your 40-character key"
          className={cn(field, "font-mono text-sm tracking-wide")} />
        {hint && <p className="text-xs text-(--sw-muted)">{hint}</p>}
      </div>
    );

    return (
      <div className="flex flex-col gap-5 max-w-[560px] w-full">
        <button type="button" onClick={back} className="self-start text-sm font-bold text-(--sw-muted) hover:text-(--sw-ink)">← Settings</button>
        <div className={cn(card, "p-5 sm:p-7 flex flex-col gap-[18px]")}>
          {view === "txn-set" && (
            <>
              <StepTitle title="Set a transaction password" sub="A second password, separate from login. You'll enter it to authorize every send." />
              {errorBox}
              {newPwd(6, "transaction password")}
              <button type="button" onClick={setTxnPwd} disabled={busy || !pwdOk(6)} className={primaryBtn}>{busy ? <Spin /> : "Save password"}</button>
            </>
          )}

          {view === "txn-change-pak" && (
            <>
              <StepTitle step="Step 1 of 2" title="Change transaction password" sub="Confirm with your authorization key, then an email code." />
              {errorBox}
              {keyField()}
              {newPwd(6, "transaction password")}
              <button type="button" onClick={txnChangeRequest} disabled={busy || !pak.trim() || !pwdOk(6)} className={primaryBtn}>{busy ? <Spin /> : "Continue"}</button>
            </>
          )}
          {view === "txn-change-otp" && (
            <>
              <StepTitle step="Step 2 of 2" title="Change transaction password" sub="Enter the code we emailed you." />
              {noticeBox}{errorBox}
              <CodeField id="set-otp" label="Email code" value={otp} onChange={setOtp} />
              <button type="button" onClick={txnChangeConfirm} disabled={busy || otp.length < 6} className={primaryBtn}>{busy ? <Spin /> : "Change password"}</button>
              <ResendLink onClick={() => resend("/change-txn-password/request-otp", { pak: pak.trim() })} busy={busy} />
            </>
          )}
          {view === "txn-change-2fa" && (
            <>
              <StepTitle step={codeSent ? "Step 2 of 2" : "Step 1 of 2"} title="Change transaction password"
                sub={codeSent ? "Enter the code we emailed you and one from your authenticator app." : "Choose a new password. We'll email you a code to confirm."} />
              {noticeBox}{errorBox}
              {!codeSent ? (
                <>
                  {newPwd(6, "transaction password")}
                  <button type="button" onClick={txn2faRequest} disabled={busy || !pwdOk(6)} className={primaryBtn}>{busy ? <Spin /> : "Send email code"}</button>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <CodeField id="set-otp" label="Email code" value={otp} onChange={setOtp} />
                    <CodeField id="set-totp" label="Authenticator code" value={totp} onChange={setTotp} />
                  </div>
                  <button type="button" onClick={txn2faConfirm} disabled={busy || otp.length < 6 || totp.length < 6} className={primaryBtn}>{busy ? <Spin /> : "Change password"}</button>
                  <ResendLink onClick={() => resend("/change-txn-password/request-otp")} busy={busy} />
                </>
              )}
            </>
          )}

          {view === "pak-otp" && (
            <>
              <StepTitle title="Replace your authorization key" sub="Enter the code we emailed you. Your current key stops working as soon as the new one is created." />
              {noticeBox}{errorBox}
              <CodeField id="set-otp" label="Email code" value={otp} onChange={setOtp} />
              <button type="button" onClick={pakRegenConfirm} disabled={busy || otp.length < 6} className={primaryBtn}>{busy ? <Spin /> : "Create new key"}</button>
              <ResendLink onClick={() => resend("/pak/request-otp")} busy={busy} />
            </>
          )}
          {view === "pak-reveal" && revealed && (
            <>
              <StepTitle title="Save your authorization key" sub="Copy it somewhere safe. It's shown only once and can't be recovered." />
              {errorBox}
              <div className="bg-(--sw-navy) rounded-[18px] p-5 flex flex-col gap-3.5">
                <span className="text-[17px] font-bold tracking-[0.08em] leading-relaxed break-all text-(--sw-sky) select-all">{revealed}</span>
                <button type="button" onClick={() => { navigator.clipboard?.writeText(revealed).catch(() => {}); setKeyCopied(true); }}
                  className="h-11 rounded-xl bg-white text-(--sw-navy) text-sm font-bold">{keyCopied ? "Copied" : "Copy key"}</button>
              </div>
              <button type="button" onClick={pakSaved} disabled={busy || !keyCopied} className={primaryBtn}>{busy ? <Spin /> : "I've saved my key"}</button>
              {!keyCopied && <p className="text-xs text-(--sw-muted) text-center -mt-2">Copy the key first.</p>}
            </>
          )}

          {view === "login-pak" && (
            <>
              <StepTitle step="Step 1 of 2" title="Change login password" sub="Confirm with your authorization key, then an email code." />
              {errorBox}
              {keyField()}
              {newPwd(8, "login password")}
              <button type="button" onClick={loginRequest} disabled={busy || !pak.trim() || !pwdOk(8)} className={primaryBtn}>{busy ? <Spin /> : "Continue"}</button>
            </>
          )}
          {view === "login-otp" && (
            <>
              <StepTitle step="Step 2 of 2" title="Change login password" sub="Enter the code we emailed you." />
              {noticeBox}{errorBox}
              <CodeField id="set-otp" label="Email code" value={otp} onChange={setOtp} />
              <button type="button" onClick={loginConfirm} disabled={busy || otp.length < 6} className={primaryBtn}>{busy ? <Spin /> : "Change password"}</button>
              <ResendLink onClick={() => resend("/change-login-password/request-otp", { pak: pak.trim() })} busy={busy} />
            </>
          )}

          {view === "tfa-setup" && tfa && (
            <>
              <StepTitle title="Turn on two-factor" sub="Use Google Authenticator, Authy, 1Password or any authenticator app." />
              {errorBox}
              <ol className="flex flex-col gap-4">
                <SetupStep n={1}>Open your authenticator app and add a new account.</SetupStep>
                <SetupStep n={2}>
                  <span>Scan this QR code:</span>
                  <img src={tfa.qr} alt="QR code for your authenticator app" width={176} height={176} className="mt-2 rounded-xl border border-(--sw-line) bg-white p-2" />
                  <span className="block text-xs text-(--sw-muted) mt-2">Can't scan it? Enter this key instead:</span>
                  <span className="mt-1 flex items-center gap-1 rounded-xl bg-(--sw-bg) pl-3 pr-1 py-1.5">
                    <code className="flex-1 min-w-0 text-[13px] font-semibold tracking-wide break-all">{tfa.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                    <CopyIcon text={tfa.secret} label="Copy setup key" />
                  </span>
                </SetupStep>
                <SetupStep n={3}><CodeField id="set-totp" label="Enter the 6-digit code it shows" value={totp} onChange={setTotp} /></SetupStep>
              </ol>
              <button type="button" onClick={tfaEnable} disabled={busy || totp.length < 6} className={primaryBtn}>{busy ? <Spin /> : "Turn on two-factor"}</button>
            </>
          )}
          {view === "tfa-off" && (
            <>
              <StepTitle title="Turn off two-factor" sub="Confirm with the code we emailed you and your authenticator app." />
              {noticeBox}{errorBox}
              <CodeField id="set-otp" label="Email code" value={otp} onChange={setOtp} />
              {usePak ? keyField() : <CodeField id="set-totp" label="Authenticator code" value={totp} onChange={setTotp} />}
              {security.hasPak && (
                <button type="button" onClick={() => { setUsePak(!usePak); setError(null); }} className={cn(linkBtn, "self-start")}>
                  {usePak ? "Use my authenticator app instead" : "Lost your phone? Use your authorization key"}
                </button>
              )}
              <button type="button" onClick={tfaOff} disabled={busy || otp.length < 6 || (usePak ? !pak.trim() : totp.length < 6)} className={primaryBtn}>
                {busy ? <Spin /> : "Turn off two-factor"}
              </button>
              <ResendLink onClick={() => resend("/2fa/disable/request-otp")} busy={busy} />
            </>
          )}

          {view === "delete-pak" && (
            <>
              <StepTitle step="Step 1 of 2" title="Delete your account" sub="This is permanent. Your balance, history, wallets and settings are erased." danger />
              <p className="rounded-2xl bg-[#fef3f2] text-[#b42318] px-4 py-3 text-sm font-medium">Withdraw any money you want to keep before deleting your account.</p>
              {errorBox}
              {keyField("Your key proves this request came from you.")}
              <button type="button" onClick={deleteRequest} disabled={busy || !pak.trim()} className={dangerBtn}>{busy ? <Spin /> : "Continue"}</button>
            </>
          )}
          {view === "delete-otp" && (
            <>
              <StepTitle step="Step 2 of 2" title="Delete your account" sub="Enter the code we emailed you to permanently delete your account." danger />
              {noticeBox}{errorBox}
              <CodeField id="set-otp" label="Email code" value={otp} onChange={setOtp} />
              <button type="button" onClick={deleteConfirm} disabled={busy || otp.length < 6} className={dangerBtn}>{busy ? <Spin /> : "Delete my account"}</button>
              <ResendLink onClick={() => resend("/delete-account/request-otp", { pak: pak.trim() })} busy={busy} />
            </>
          )}
        </div>
      </div>
    );
  }

  // ── List ───────────────────────────────────────────────────────────────────
  const noPak = !security.hasPak;
  const totpUnavailable = authConfig?.totpAvailable === false;

  const securityGroup = (
    <Group title="SECURITY">
      <Row title="Transaction password" sub={security.hasTransactionPassword ? "Required for every send" : "Not set — sends aren't protected"}
        badge={security.hasTransactionPassword ? { text: "Set", tone: "ok" } : { text: "Not set", tone: "warn" }}
        action={security.hasTransactionPassword
          ? <button type="button" className={linkBtn} disabled={!security.twoFactorEnabled && noPak}
              title={!security.twoFactorEnabled && noPak ? "Create your authorization key first" : undefined}
              onClick={() => open(security.twoFactorEnabled ? "txn-change-2fa" : "txn-change-pak")}>Change</button>
          : <button type="button" className={linkBtn} onClick={() => open("txn-set")}>Set</button>} />
      <Row title="Authorization key"
        sub={security.hasPak ? <span className="font-mono tracking-wide break-all">{security.pakPreview ?? "Created"}</span> : "Needed to change passwords or delete your account"}
        badge={security.hasPak ? (security.pakCopied ? { text: "Saved", tone: "ok" } : { text: "Not confirmed", tone: "warn" }) : { text: "None", tone: "muted" }}
        action={noPak
          ? <button type="button" className={linkBtn} disabled={busy} onClick={pakCreate}>Create</button>
          : security.pakCanRegenerate
            ? <button type="button" className={linkBtn} disabled={busy} onClick={pakRegenRequest}>Replace</button>
            : null}
        footer={<>
          {security.hasPak && !security.pakCopied && (
            <p className="text-[13px] text-[#b54708]">You haven't confirmed saving this key. <button type="button" onClick={pakConfirmOnly} className="font-bold underline">I've saved it</button></p>
          )}
          {security.hasPak && !security.pakCanRegenerate && security.nextPakAllowedAt && (
            <p className="text-xs text-(--sw-faint)">Can be replaced after {fmtDate(security.nextPakAllowedAt)}</p>
          )}
        </>} />
      <Row title="Two-factor authentication"
        sub={security.twoFactorEnabled ? "Authenticator code on sign-in, password changes and new plans" : totpUnavailable ? "Not available right now" : "Add an authenticator-app code when you sign in"}
        action={totpUnavailable && !security.twoFactorEnabled ? null
          : <Switch on={!!security.twoFactorEnabled} busy={busy} label="Two-factor authentication"
              onToggle={() => (security.twoFactorEnabled ? tfaOffStart() : tfaStart())} />} />
    </Group>
  );

  const accountGroup = account && (
    <Group title="ACCOUNT">
      <Row title="Name" sub={account.name} />
      <Row title="Email · payment ID" sub={account.email} action={<CopyIcon text={account.email} label="Copy payment ID" />} />
      {account.circleWalletAddress && (
        <Row title="Circle wallet" sub={<span className="font-mono break-all">{account.circleWalletAddress}</span>}
          action={<CopyIcon text={account.circleWalletAddress} label="Copy wallet address" />} />
      )}
      <Row title="Login password" sub={noPak ? "Create your authorization key first" : "Confirmed with your key and an email code"}
        action={<button type="button" className={linkBtn} disabled={noPak} onClick={() => open("login-pak")}>Change</button>} />
      {onLogout && <Row title="Session" action={<button type="button" onClick={onLogout} className="text-[13px] font-bold text-[#b42318] hover:underline">Log out</button>} />}
      <Row title="Delete account" titleClass="text-[#b42318]" sub={noPak ? "Create your authorization key first" : "Permanently erases your account"}
        action={<button type="button" className="text-[13px] font-bold text-[#b42318] hover:underline disabled:text-(--sw-faint) disabled:no-underline disabled:cursor-not-allowed"
          disabled={noPak} onClick={() => open("delete-pak")}>Delete</button>} />
    </Group>
  );

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {success && (
        <p role="status" className="rounded-2xl bg-[#ecfdf3] text-[#067647] px-4 py-3 text-sm font-semibold flex items-center justify-between gap-3">
          {success}<button type="button" onClick={() => setSuccess(null)} className="text-xs font-bold opacity-70 hover:opacity-100">Dismiss</button>
        </p>
      )}
      {error && <p role="alert" className="rounded-2xl bg-[#fef3f2] text-[#b42318] px-4 py-3 text-sm font-medium">{error}</p>}
      <div className={cn("grid grid-cols-1 gap-5 items-start", !securityOnly && account && "xl:grid-cols-2")}>
        {securityGroup}
        {!securityOnly && accountGroup}
      </div>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 min-w-0">
      <h3 className="text-xs font-bold tracking-[0.06em] text-(--sw-muted) px-1">{title}</h3>
      <div className={cn(card, "divide-y divide-[#f0f2f6]")}>{children}</div>
    </section>
  );
}

type Tone = "ok" | "warn" | "muted";
const TONE: Record<Tone, string> = { ok: "text-[#067647] bg-[#ecfdf3]", warn: "text-[#b54708] bg-[#fffaeb]", muted: "text-[#475467] bg-[#f2f4f7]" };

function Row({ title, sub, badge, action, footer, titleClass }: {
  title: string; sub?: ReactNode; badge?: { text: string; tone: Tone }; action?: ReactNode; footer?: ReactNode; titleClass?: string;
}) {
  return (
    <div className="px-[18px] sm:px-5 py-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="flex flex-col flex-1 min-w-0 gap-0.5">
          <span className={cn("font-bold text-[15px]", titleClass)}>{title}</span>
          {sub && <span className="text-[13px] text-(--sw-muted) min-w-0">{sub}</span>}
        </span>
        {badge && <span className={cn("text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0", TONE[badge.tone])}>{badge.text}</span>}
        {action && <span className="shrink-0 flex items-center">{action}</span>}
      </div>
      {footer}
    </div>
  );
}

function Switch({ on, onToggle, busy, label: aria }: { on: boolean; onToggle: () => void; busy?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={aria} onClick={onToggle} disabled={busy}
      className={cn("relative w-12 h-7 rounded-full transition-colors disabled:opacity-60", on ? "bg-(--sw-blue)" : "bg-[#d0d5dd]")}>
      <span className={cn("absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow transition-[left]", on ? "left-[23px]" : "left-[3px]")} />
    </button>
  );
}

function StepTitle({ title, sub, step, danger }: { title: string; sub?: string; step?: string; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      {step && <span className="text-xs font-bold tracking-[0.06em] text-(--sw-faint) uppercase">{step}</span>}
      <h2 className={cn("font-extrabold text-[24px] tracking-[-0.03em] leading-tight", danger && "text-[#b42318]")}>{title}</h2>
      {sub && <p className="text-sm text-(--sw-muted) leading-relaxed">{sub}</p>}
    </div>
  );
}

function SecretField({ id, label: text, value, onChange, placeholder, invalid }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={label}>{text}</label>
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} {...secretInputProps} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder} className={cn(field, "pr-16", invalid && "border-[#f04438] focus:border-[#f04438]")} />
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide" : "Show"}
          className="absolute inset-y-0 right-0 px-3.5 text-[13px] font-bold text-(--sw-blue)">{show ? "Hide" : "Show"}</button>
      </div>
    </div>
  );
}

function CodeField({ id, label: text, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={label}>{text}</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code"
        className={cn(field, "text-center text-xl font-extrabold tracking-[0.35em] placeholder:text-[15px] placeholder:font-medium placeholder:tracking-normal")} />
    </div>
  );
}

function SetupStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-(--sw-tint) text-(--sw-blue) grid place-items-center text-xs font-extrabold shrink-0">{n}</span>
      <div className="flex-1 min-w-0 text-sm text-(--sw-label)">{children}</div>
    </li>
  );
}

function ResendLink({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <p className="text-sm text-(--sw-muted) text-center">
      Didn't get it? <button type="button" onClick={onClick} disabled={busy} className={linkBtn}>Resend code</button>
    </p>
  );
}

function Spin() { return <Loader2 className="w-5 h-5 animate-spin" />; }

