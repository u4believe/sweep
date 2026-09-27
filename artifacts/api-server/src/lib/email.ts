// ─── Email transport ──────────────────────────────────────────────────────────
// Provider priority with automatic fallback:
//   1. Resend API — RESEND_API_KEY set
//   2. Brevo API  — BREVO_API_KEY set
//   3. SMTP       — SMTP_HOST + SMTP_USER + SMTP_PASS set
//   4. Console    — none set → emails printed to stdout (dev/CI only)
//
// All configured providers are tried in order. If one fails (e.g. daily limit
// exhausted, auth error, service outage) the next is attempted automatically.

import nodemailer from "nodemailer";
import { OTP_TTL_MINUTES } from "./otp.js";
import { APP_URL, SECURITY_FOOTER, avatarHeader, badge, bigAmount, blueHero, buttons, callout, checklist, codeBlock, codeBoxes, darkHero, emailPage, esc, infoBox, link, longDate, numbered, para, ref, rows, small, stats, steps, strong, title, usd } from "./emailLayout.js";

type MailOpts = { from?: string; to: string; subject: string; html: string };

function _parseSender(from: string): { name: string; email: string } {
  const m = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: "SweepUSDC", email: from };
}

// ─── Per-email cooldown ───────────────────────────────────────────────────────
const _emailTimestamps = new Map<string, number[]>();
const EMAIL_WINDOW_MS      = 60 * 1000;
const EMAIL_MAX_PER_WINDOW = 4;

function _isOnCooldown(email: string): boolean {
  const now  = Date.now();
  const hits = (_emailTimestamps.get(email) ?? []).filter(t => now - t < EMAIL_WINDOW_MS);
  return hits.length >= EMAIL_MAX_PER_WINDOW;
}

function _setCooldown(email: string): void {
  const now  = Date.now();
  const hits = (_emailTimestamps.get(email) ?? []).filter(t => now - t < EMAIL_WINDOW_MS);
  hits.push(now);
  _emailTimestamps.set(email, hits);
  if (_emailTimestamps.size > 1000) {
    for (const [k, v] of _emailTimestamps) {
      if (v.every(t => now - t >= EMAIL_WINDOW_MS)) _emailTimestamps.delete(k);
    }
  }
}

const FROM = process.env.BREVO_FROM ?? process.env.RESEND_FROM ?? process.env.SMTP_FROM ?? "SweepUSDC <no-reply@usdcsend.app>";

// ─── Brevo daily quota cache ──────────────────────────────────────────────────
// Brevo accepts emails (returns 200 + messageId) even when the daily limit is
// exhausted, then silently drops them. We pre-check remaining credits and throw
// before sending so the fallback chain (Resend → SMTP) can take over.
let _brevoQuota: { remaining: number; at: number } | null = null;

async function _getBrevoRemaining(apiKey: string): Promise<number> {
  const now = Date.now();
  if (_brevoQuota && now - _brevoQuota.at < 5 * 60 * 1000) return _brevoQuota.remaining;
  try {
    const r = await fetch("https://api.brevo.com/v3/account", {
      headers: { "api-key": apiKey },
    });
    if (!r.ok) return Infinity;
    const d = await r.json() as any;
    const plan = (d.plan as any[] ?? []).find((p: any) => p.creditsType === "sendingLimit");
    const remaining = plan?.remainingCredits ?? (plan ? (plan.credits ?? 0) - (plan.userCredits ?? 0) : Infinity);
    _brevoQuota = { remaining, at: now };
    return remaining;
  } catch {
    return Infinity;
  }
}

// ─── Individual provider send functions ───────────────────────────────────────

async function _sendViaBrevo(opts: MailOpts, apiKey: string): Promise<void> {
  const remaining = await _getBrevoRemaining(apiKey);
  if (remaining <= 0) throw new Error("Brevo daily sending limit exhausted");

  const sender = _parseSender(opts.from ?? FROM);
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method:  "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body:    JSON.stringify({
      sender,
      to:          [{ email: opts.to }],
      subject:     opts.subject,
      htmlContent: opts.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo ${res.status}: ${body}`);
  }
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (json.messageId) console.info(`[email] Brevo messageId: ${json.messageId}`);
  if (_brevoQuota) _brevoQuota.remaining = Math.max(0, _brevoQuota.remaining - 1);
}

async function _sendViaResend(opts: MailOpts, apiKey: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ from: opts.from ?? FROM, to: [opts.to], subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

// ─── Transporter with automatic provider fallback ────────────────────────────
// Builds an ordered list of every configured provider and tries each in turn.
// A provider failure logs a warning and the next provider is attempted.
function getTransporter() {
  const brevoKey  = process.env.BREVO_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const smtpHost  = process.env.SMTP_HOST;
  const smtpUser  = process.env.SMTP_USER;
  const smtpPass  = process.env.SMTP_PASS;

  type Provider = { name: string; send: (opts: MailOpts) => Promise<void> };
  const providers: Provider[] = [];

  if (resendKey) {
    providers.push({ name: "Resend", send: (opts) => _sendViaResend(opts, resendKey) });
  }

  if (brevoKey) {
    providers.push({ name: "Brevo", send: (opts) => _sendViaBrevo(opts, brevoKey) });
  }

  if (smtpHost && smtpUser && smtpPass) {
    const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
    const nm   = nodemailer.createTransport({
      host: smtpHost, port, secure: port === 465,
      auth: { user: smtpUser, pass: smtpPass },
      family: 4,
    } as any);
    providers.push({
      name: "SMTP",
      send: (opts) => nm.sendMail({ from: opts.from ?? FROM, to: opts.to, subject: opts.subject, html: opts.html }) as any,
    });
  }

  if (providers.length === 0) return null;

  return {
    sendMail: async (opts: MailOpts) => {
      const recipient = opts.to.toLowerCase();
      if (_isOnCooldown(recipient)) {
        console.log(`[email] Cooldown suppressed send to ${recipient}`);
        return;
      }
      _setCooldown(recipient);

      let lastError: unknown;
      for (const provider of providers) {
        try {
          await provider.send(opts);
          if (providers.length > 1) {
            console.info(`[email] Sent via ${provider.name} to ${recipient}`);
          }
          return;
        } catch (err: any) {
          lastError = err;
          console.warn(`[email] ${provider.name} failed — ${err?.message ?? err}${providers.indexOf(provider) < providers.length - 1 ? " — trying next provider" : ""}`);
        }
      }
      throw lastError;
    },
  };
}

export async function verifySmtp(): Promise<void> {
  const active: string[] = [];

  if (process.env.RESEND_API_KEY) active.push("Resend");

  if (process.env.BREVO_API_KEY) active.push("Brevo");

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
    active.push(`SMTP (${process.env.SMTP_USER} via ${process.env.SMTP_HOST}:${port})`);
    const nm = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      family: 4,
    } as any);
    Promise.race([
      nm.verify(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out after 8 s")), 8_000)),
    ])
      .then(() => console.info(`✅  SMTP connection verified — ${process.env.SMTP_USER}`))
      .catch((err: any) => console.error(`❌  SMTP connection failed: ${err.message}`));
  }

  if (active.length === 0) {
    console.warn("\n⚠️  No email transport configured — emails will NOT be delivered.");
    console.warn("   Set BREVO_API_KEY, RESEND_API_KEY, or SMTP_HOST + SMTP_USER + SMTP_PASS\n");
    return;
  }

  const chain = active.join(" → ");
  console.info(`✅  Email providers ready: ${chain} — sending from "${FROM}"`);
  if (active.length > 1) {
    console.info(`   Fallback enabled: if a provider fails, the next in chain is tried automatically.`);
  }
}

export async function sendRecurringSuccessEmail(
  to: string,
  amount: string,
  recipientEmail: string,
  newBalance: string,
  nextRunAt: Date,
): Promise<void> {
  const html = emailPage({
    preheader: `${usd(amount)} sent to ${recipientEmail} on schedule`,
    label: "Recurring transfer",
    blocks: [
      bigAmount({ kicker: "SWEPT.", amount: usd(amount), sub: `to ${recipientEmail}` }),
      rows([
        { k: "Method", v: "Recurring email transfer" },
        { k: "Amount", v: usd(amount) },
        { k: "Fee", v: "Free", ok: true },
        { k: "New balance", v: usd(newBalance) },
      ], { k: "Next transfer", v: longDate(nextRunAt) }),
      buttons([{ label: "Manage schedules", href: APP_URL }]),
      small(`Don't recognise this schedule? ${link("Review it in Sweep", APP_URL)} and cancel it.`),
    ],
    footer: ["Keep this receipt for your records."],
  });

  const transporter = getTransporter();

  if (!transporter) {
    console.log(`\n──────────────────────────────────────────────`);
    console.log(`  RECURRING TRANSFER SUCCESS for ${to}`);
    console.log(`  Sent $${amount} to ${recipientEmail} | New balance: $${newBalance}`);
    console.log(`  Next run: ${nextRunAt.toISOString()}`);
    console.log(`  (Configure SMTP_HOST/SMTP_USER/SMTP_PASS to send real emails)`);
    console.log(`──────────────────────────────────────────────\n`);
    return;
  }

  transporter.sendMail({
    from: FROM,
    to,
    subject: `Recurring transfer of $${parseFloat(amount).toFixed(2)} sent to ${recipientEmail}`,
    html,
  }).catch(() => {});
}

export async function sendRecurringFailureEmail(
  to: string,
  amount: string,
  recipientEmail: string,
  currentBalance: string,
  nextRunAt: Date,
): Promise<void> {
  const html = emailPage({
    preheader: `Your ${usd(amount)} transfer to ${recipientEmail} was skipped — balance too low`,
    label: badge("ACTION NEEDED"),
    blocks: [
      title(`Your transfer to ${recipientEmail} was skipped`),
      stats([
        { label: "Scheduled", value: usd(amount) },
        { label: "Balance", value: usd(currentBalance), color: "#b54708" },
        { label: "Next try", value: nextRunAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) },
      ]),
      para(`Add at least ${strong(usd(Math.max(0, parseFloat(amount) - parseFloat(currentBalance))))} before the next run and it will go through automatically.`),
      buttons([{ label: "Add money", href: APP_URL }, { label: "Manage schedules", href: APP_URL }]),
    ],
  });

  const transporter = getTransporter();

  if (!transporter) {
    console.log(`\n──────────────────────────────────────────────`);
    console.log(`  RECURRING TRANSFER SKIPPED for ${to}`);
    console.log(`  Needed $${amount} but only have $${currentBalance} | Recipient: ${recipientEmail}`);
    console.log(`  Next attempt: ${nextRunAt.toISOString()}`);
    console.log(`  (Configure SMTP_HOST/SMTP_USER/SMTP_PASS to send real emails)`);
    console.log(`──────────────────────────────────────────────\n`);
    return;
  }

  transporter.sendMail({
    from: FROM,
    to,
    subject: `Recurring transfer to ${recipientEmail} was skipped — insufficient balance`,
    html,
  }).catch(() => {});
}

export async function sendOtpEmail(to: string, code: string, type: "register" | "login"): Promise<void> {
  const subject = type === "register"
    ? "Verify your SweepUSDC account"
    : "Your SweepUSDC sign-in code";

  const action = type === "register" ? "create your account" : "sign in";

  const html = emailPage({
    preheader: `${code} is your Sweep ${type === "register" ? "verification" : "sign-in"} code`,
    label: "Security",
    blocks: [
      title(type === "register" ? "Verify your email" : "Confirm it's you"),
      para(`Use this code to ${esc(action)}. It expires in ${strong(`${OTP_TTL_MINUTES} minutes`)} and can only be used once.`),
      codeBoxes(code),
      small(type === "register"
        ? "Didn't create a Sweep account? You can ignore this email."
        : `Didn't request this? ${link("Secure your account", APP_URL)} — someone may know your password.`),
    ],
    footer: [SECURITY_FOOTER],
  });

  // Always log OTP — visible in server output if SMTP fails or isn't configured
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  OTP CODE for ${to}`);
  console.log(`  Code: ${code}  (type: ${type})`);
  console.log(`──────────────────────────────────────────────\n`);

  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[otp-email] SMTP not configured — code for ${to} was logged above but NOT emailed.`);
    return;
  }

  // Await the send so any auth/connection error is visible immediately in the logs.
  // We still don't throw — SMTP failure must never block the sign-in API response.
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
    console.info(`[otp-email] ✅ Sent to ${to}`);
  } catch (err: any) {
    console.error(`\n❌ [otp-email] FAILED to send to ${to}`);
    console.error(`   Error : ${err?.message ?? err}`);
    console.error(`   Code  : ${err?.code ?? "unknown"}`);
    if (err?.message?.includes("Invalid login") || err?.message?.includes("Username and Password") || err?.code === "EAUTH") {
      console.error("   👉  Gmail auth rejected. Regenerate your App Password at:");
      console.error("       https://myaccount.google.com/apppasswords\n");
    } else {
      console.error(`   👉  Check SMTP_HOST / SMTP_PORT / network connectivity.\n`);
    }
  }
}

export async function sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
  const html = emailPage({
    preheader: "Confirm your email to activate your Sweep account",
    label: "Security",
    blocks: [
      title("Confirm your email"),
      para(`Tap the button to verify your email and activate your account. The link expires in ${strong("72 hours")}.`),
      buttons([{ label: "Verify email", href: verificationUrl }]),
      small(`Button not working? Paste this link into your browser:<br><span style="word-break:break-all;color:#98a2b3;">${esc(verificationUrl)}</span>`),
      small("Didn't create a Sweep account? You can ignore this email."),
    ],
    footer: [SECURITY_FOOTER],
  });

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`\n──────────────────────────────────────────────`);
    console.log(`  EMAIL VERIFICATION LINK for ${to}`);
    console.log(`  URL: ${verificationUrl}`);
    console.log(`──────────────────────────────────────────────\n`);
    return;
  }

  transporter.sendMail({
    from: FROM,
    to,
    subject: "Verify your SweepUSDC account",
    html,
  }).catch((err: any) => {
    console.error(`[verify-email] Failed to send to ${to}: ${err?.message}`);
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const html = emailPage({
    preheader: "Reset your Sweep password — link expires in 1 hour",
    label: "Security",
    blocks: [
      title("Reset your password"),
      para(`We got a request to reset your Sweep password. The link expires in ${strong("1 hour")}.`),
      buttons([{ label: "Choose a new password", href: resetUrl }]),
      small(`Button not working? Paste this link into your browser:<br><span style="word-break:break-all;color:#98a2b3;">${esc(resetUrl)}</span>`),
      small("Didn't ask for this? Ignore this email — your password won't change."),
    ],
    footer: [SECURITY_FOOTER],
  });

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`\n──────────────────────────────────────────────`);
    console.log(`  PASSWORD RESET LINK for ${to}`);
    console.log(`  URL: ${resetUrl}`);
    console.log(`──────────────────────────────────────────────\n`);
    return;
  }

  transporter.sendMail({
    from: FROM,
    to,
    subject: "Reset your SweepUSDC password",
    html,
  }).catch((err: any) => {
    console.error(`[password-reset-email] Failed to send to ${to}: ${err?.message}`);
  });
}

const SECURITY_ACTION_LABELS: Record<string, { subject: string; heading: string; desc: string }> = {
  "txn-pwd":     { subject: "Set your transaction password",         heading: "Set transaction password", desc: "to set your transaction password" },
  "pak-gen":     { subject: "Generate your Personal Authorization Key", heading: "Generate PAK",          desc: "to generate your Personal Authorization Key (PAK)" },
  "chg-login":   { subject: "Change your sign-in password",          heading: "Change sign-in password",  desc: "to change your sign-in password" },
  "chg-txn-pwd": { subject: "Change your transaction password",      heading: "Change transaction password", desc: "to change your transaction password" },
  "del-account": { subject: "Confirm account deletion — SweepUSDC",  heading: "Delete your account",         desc: "to permanently delete your account" },
  "disable-2fa": { subject: "Turn off two-factor authentication",   heading: "Turn off 2FA",                desc: "to turn off authenticator-app two-factor authentication" },
  "plan-create": { subject: "Confirm your new subscription plan",    heading: "Publish your plan",           desc: "to publish your new subscription plan" },
  "pwd-reset":   { subject: "Reset your Sweep password",             heading: "Reset your password",         desc: "to reset your login password" },
};

export async function sendSecurityOtpEmail(to: string, code: string, actionType: string): Promise<void> {
  const meta = SECURITY_ACTION_LABELS[actionType] ?? {
    subject: "Security verification code",
    heading: "Verification required",
    desc: "to complete this action",
  };

  const html = emailPage({
    preheader: `${code} is your Sweep security code`,
    label: "Security",
    blocks: [
      title(meta.heading),
      para(`Use this code ${esc(meta.desc)}. It expires in ${strong(`${OTP_TTL_MINUTES} minutes`)} and can only be used once.`),
      codeBoxes(code),
      small(`Didn't start this? ${link("Secure your account", APP_URL)} — your account may be at risk. Never share this code.`),
    ],
    footer: [SECURITY_FOOTER],
  });

  // Always log the OTP to server console as a fallback (visible in server logs)
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  SECURITY OTP for ${to}  [${actionType}]`);
  console.log(`  Code: ${code}  (expires in ${OTP_TTL_MINUTES} minutes)`);
  console.log(`──────────────────────────────────────────────\n`);

  const transporter = getTransporter();
  if (!transporter) return;

  try {
    await transporter.sendMail({ from: FROM, to, subject: meta.subject, html });
    console.info(`[security-otp-email] ✅ Sent [${actionType}] to ${to}`);
  } catch (err: any) {
    console.error(`[security-otp-email] ❌ FAILED [${actionType}] to ${to}: ${err?.message}`);
    console.error(`[security-otp-email]    Resend error:`, JSON.stringify(err));
  }
}

// ─── Subscription: OTP email ───────────────────────────────────────────────────

export async function sendSubscriptionOtpEmail(to: string, code: string): Promise<void> {
  const html = emailPage({
    preheader: `${code} is your Sweep subscription code`,
    label: "Security",
    blocks: [
      title("Confirm it's you"),
      para(`Enter this code to continue your subscription. It expires in ${strong(`${OTP_TTL_MINUTES} minutes`)}.`),
      codeBoxes(code),
      small("Didn't request this? You can ignore this email."),
    ],
    footer: [SECURITY_FOOTER],
  });

  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  SUBSCRIPTION OTP for ${to}`);
  console.log(`  Code: ${code}  (expires in ${OTP_TTL_MINUTES} minutes)`);
  console.log(`──────────────────────────────────────────────\n`);

  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[sub-otp-email] SMTP not configured — code for ${to} was logged above but NOT emailed.`);
    return;
  }

  try {
    await transporter.sendMail({ from: FROM, to, subject: "Your subscription verification code", html });
    console.info(`[sub-otp-email] ✅ Sent to ${to}`);
  } catch (err: any) {
    console.error(`\n❌ [sub-otp-email] FAILED to send to ${to}`);
    console.error(`   Error : ${err?.message ?? err}`);
    console.error(`   Code  : ${err?.code ?? "unknown"}`);
    if (err?.code === "EAUTH" || err?.message?.includes("Invalid login") || err?.message?.includes("Username and Password")) {
      console.error("   👉  Gmail auth rejected. Regenerate your App Password at:");
      console.error("       https://myaccount.google.com/apppasswords\n");
    } else {
      console.error(`   👉  Check SMTP_HOST / SMTP_PORT / network connectivity.\n`);
    }
  }
}

// ─── Subscription: confirmation code delivery ──────────────────────────────────

export async function sendSubscriptionConfirmationCodeEmail(
  to: string,
  confirmationCode: string,
  planTitle: string,
  interval: string,
  amount: string,
): Promise<void> {
  const html = emailPage({
    preheader: `Your confirmation code for ${planTitle}`,
    label: "Subscriptions",
    blocks: [
      title("Your subscription code"),
      para(`Enter this code on the subscription page to activate ${strong(planTitle)} (${esc(usd(amount))} / ${esc(interval)}).`),
      codeBlock(confirmationCode),
      small("The code is case-sensitive, single-use and expires in 7 days."),
    ],
    footer: [SECURITY_FOOTER],
  });

  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  SUBSCRIPTION CONFIRMATION CODE for ${to}`);
  console.log(`  Plan: ${planTitle} | ${interval} | $${amount}`);
  console.log(`  Code: ${confirmationCode}  (expires in 7 days)`);
  console.log(`══════════════════════════════════════════════\n`);

  const transporter = getTransporter();
  if (!transporter) return;

  transporter.sendMail({ from: FROM, to, subject: `Your confirmation code for ${planTitle}`, html }).catch((err: any) => {
    console.error(`[sub-code-email] Failed to send to ${to}: ${err?.message}`);
  });
}

// ─── Subscription: billing notification emails ─────────────────────────────────

export async function sendSubscriptionBillingSuccessEmail(
  to: string,
  planTitle: string,
  amount: string,
  interval: string,
  nextBillingAt: Date,
): Promise<void> {
  const nextDate = nextBillingAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const html = emailPage({
    preheader: `${usd(amount)} paid for ${planTitle}`,
    label: "Subscriptions",
    blocks: [
      bigAmount({ kicker: "PAID.", amount: usd(amount), sub: `for ${planTitle}` }),
      rows([
        { k: "Plan", v: `${planTitle} · ${interval}` },
        { k: "Paid from", v: "Sweep balance" },
      ], { k: "Next charge", v: nextDate }),
      buttons([{ label: "Manage subscription", href: APP_URL }]),
    ],
    footer: ["Keep this receipt for your records."],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `Payment confirmed — ${planTitle}`, html }).catch(() => {});
}

export async function sendSubscriptionBillingFailureEmail(
  to: string,
  planTitle: string,
  amount: string,
  retryCount: number,
): Promise<void> {
  const retriesLeft = 7 - retryCount;
  const html = emailPage({
    preheader: `Your ${planTitle} payment didn't go through`,
    label: badge("ACTION NEEDED"),
    blocks: [
      title(`Your ${planTitle} payment didn't go through`),
      stats([
        { label: "Due", value: usd(amount) },
        { label: "Attempts left", value: String(Math.max(0, retriesLeft)), color: retriesLeft > 0 ? undefined : "#b42318" },
      ]),
      para(retriesLeft > 0
        ? `Your balance was too low. We'll retry once a day — add money before then to keep your subscription.`
        : `All retry attempts are used, so the subscription has been cancelled. You can resubscribe any time.`),
      buttons([{ label: "Add money", href: APP_URL }, { label: "Manage subscription", href: APP_URL }]),
    ],
    footer: [`Attempt ${retryCount} of 7.`],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `Action required — ${planTitle} payment failed`, html }).catch(() => {});
}

// ─── Creator notifications ─────────────────────────────────────────────────────

export async function sendCreatorNewSubscriberEmail(
  to: string,
  subscriberEmail: string,
  planTitle: string,
  interval: string,
  activeCount: number,
): Promise<void> {
  const html = emailPage({
    preheader: `${subscriberEmail} subscribed to ${planTitle}`,
    label: "Your plans",
    blocks: [
      avatarHeader({ initial: subscriberEmail, heading: "New subscriber", sub: `${subscriberEmail} · ${interval}` }),
      callout({ title: planTitle, sub: "Active subscribers", value: String(activeCount) }),
      buttons([{ label: "View your plans", href: APP_URL }]),
    ],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `New subscriber — ${planTitle}`, html }).catch(() => {});
}

export async function sendCreatorRenewalEmail(
  to: string,
  subscriberEmail: string,
  planTitle: string,
  amount: string,
  interval: string,
): Promise<void> {
  const html = emailPage({
    preheader: `${usd(amount)} renewal from ${subscriberEmail}`,
    hero: blueHero({ label: "Renewal received", amount: `+${usd(amount)}`, person: { name: subscriberEmail }, note: `${planTitle} · ${interval}` }),
    blocks: [
      para("It's already in your balance."),
      buttons([{ label: "Open Sweep", href: APP_URL }]),
    ],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `Renewal received — ${planTitle}`, html }).catch(() => {});
}

export async function sendCreatorPaymentFailedEmail(
  to: string,
  subscriberEmail: string,
  planTitle: string,
): Promise<void> {
  const html = emailPage({
    preheader: `A payment for ${planTitle} failed`,
    label: badge("HEADS UP", "info"),
    blocks: [
      title("A subscriber's payment failed"),
      infoBox([["Subscriber", subscriberEmail], ["Plan", planTitle]]),
      para("Nothing to do on your side. We retry daily; if every retry fails, the subscription is cancelled automatically."),
    ],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `Payment failed — ${planTitle}`, html }).catch(() => {});
}

export async function sendCreatorCancelledEmail(
  to: string,
  subscriberEmail: string,
  planTitle: string,
  reason: string,
  activeCount: number,
): Promise<void> {
  const html = emailPage({
    preheader: `${subscriberEmail} cancelled ${planTitle}`,
    label: "Your plans",
    blocks: [
      title("Subscription cancelled"),
      rows([
        { k: "Subscriber", v: subscriberEmail },
        { k: "Plan", v: planTitle },
        { k: "Reason", v: reason },
      ], { k: "Active subscribers", v: String(activeCount) }),
      buttons([{ label: "View your plans", href: APP_URL }]),
    ],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `Subscription cancelled — ${planTitle}`, html }).catch(() => {});
}

// ─── Subscriber: activation success ───────────────────────────────────────────

export async function sendSubscriptionActivatedEmail(
  to: string,
  planTitle: string,
  amount: string,
  interval: string,
  isTrialing: boolean,
  nextBillingAt?: Date,
  trialEndsAt?: Date,
): Promise<void> {
  const dateStr = isTrialing && trialEndsAt
    ? trialEndsAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : nextBillingAt?.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) ?? "—";


  const html = emailPage({
    preheader: isTrialing ? `Your free trial for ${planTitle} has started` : `You're subscribed to ${planTitle}`,
    label: "Subscriptions",
    blocks: [
      avatarHeader({ initial: planTitle, heading: isTrialing ? "Free trial started" : "You're subscribed", sub: `${planTitle} · ${usd(amount)} / ${interval}` }),
      isTrialing
        ? callout({ title: "Free trial active", sub: `First charge of ${usd(amount)} on ${dateStr}`, value: usd(0) })
        : callout({ title: "Paid today", sub: `Renews on ${dateStr}`, value: usd(amount) }),
      buttons([{ label: "Manage subscription", href: APP_URL }]),
    ],
    footer: [isTrialing ? `Cancel before ${dateStr} and you won't be charged.` : "Paid from your Sweep balance. Cancel anytime."],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: isTrialing ? `Free trial started — ${planTitle}` : `Subscription confirmed — ${planTitle}`, html }).catch(() => {});
}

// ─── Subscriber: cancellation confirmation ─────────────────────────────────────

export async function sendSubscriptionCancelledEmail(
  to: string,
  planTitle: string,
): Promise<void> {
  const html = emailPage({
    preheader: `Your ${planTitle} subscription is cancelled`,
    label: "Subscriptions",
    blocks: [
      title("Subscription cancelled"),
      para(`Your subscription to ${strong(planTitle)} is cancelled. You won't be charged again.`),
      buttons([{ label: "Open Sweep", href: APP_URL }]),
    ],
    footer: ["Changed your mind? Resubscribe from Subscriptions in Sweep."],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `Subscription cancelled — ${planTitle}`, html }).catch(() => {});
}

// ─── Subscriber: trial ending soon ────────────────────────────────────────────

export async function sendSubscriptionTrialEndingSoonEmail(
  to: string,
  planTitle: string,
  amount: string,
  interval: string,
  trialEndsAt: Date,
): Promise<void> {
  const endDateStr = trialEndsAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const html = emailPage({
    preheader: `Your free trial for ${planTitle} ends in 3 days`,
    label: badge("TRIAL ENDING", "info"),
    blocks: [
      title("Your free trial ends in 3 days"),
      stats([
        { label: "First charge", value: usd(amount) },
        { label: "On", value: endDateStr },
      ]),
      para(`Keep at least ${strong(usd(amount))} in your balance for ${strong(planTitle)} (${esc(interval)}). If it's too low, we retry daily for up to 7 days before cancelling.`),
      buttons([{ label: "Add money", href: APP_URL }, { label: "Manage subscription", href: APP_URL }]),
    ],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `Your free trial for ${planTitle} ends in 3 days`, html }).catch(() => {});
}

// ─── Transaction: transfer sent ───────────────────────────────────────────────

export async function sendTransferSentEmail(
  to: string,
  recipientEmail: string,
  amount: string,
  newBalance: string,
): Promise<void> {
  const receiptRef = ref();
  const html = emailPage({
    preheader: `Receipt: ${usd(amount)} to ${recipientEmail}`,
    label: `Receipt #${receiptRef}`,
    blocks: [
      bigAmount({ kicker: "SWEPT.", amount: usd(amount), sub: `to ${recipientEmail}` }),
      steps([{ label: "Authorized" }, { label: "Sent" }, { label: "Delivered" }]),
      rows([
        { k: "Method", v: "Email transfer" },
        { k: "Amount", v: usd(amount) },
        { k: "Fee", v: "Free", ok: true },
        { k: "New balance", v: usd(newBalance) },
      ], { k: "Total", v: usd(amount) }),
      small(`Don't recognise this? ${link("Secure your account", APP_URL)} and change your passwords.`),
    ],
    footer: [`Keep this receipt for your records. ${esc(longDate(new Date()))}`],
  });

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] Transfer sent: $${amount} from ${to} to ${recipientEmail}`);
    return;
  }
  transporter.sendMail({ from: FROM, to, subject: `You sent $${parseFloat(amount).toFixed(2)} to ${recipientEmail}`, html }).catch(() => {});
}

// ─── Transaction: transfer received ───────────────────────────────────────────

export async function sendTransferReceivedEmail(
  to: string,
  senderEmail: string,
  amount: string,
  newBalance: string,
): Promise<void> {
  const html = emailPage({
    preheader: `${senderEmail} sent you ${usd(amount)}`,
    hero: blueHero({ label: "Payment received", amount: `+${usd(amount)}`, person: { name: senderEmail } }),
    blocks: [
      para("It's already in your balance — nothing to claim."),
      stats([{ label: "New balance", value: usd(newBalance) }, { label: "Reference", value: ref() }]),
      buttons([{ label: "Open Sweep", href: APP_URL }]),
    ],
    footer: [`You got this because ${esc(to)} is a Sweep payment ID.`],
  });

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] Transfer received: $${amount} to ${to} from ${senderEmail}`);
    return;
  }
  transporter.sendMail({ from: FROM, to, subject: `You received $${parseFloat(amount).toFixed(2)} from ${senderEmail}`, html }).catch(() => {});
}

// ─── Transaction: escrow claimed ───────────────────────────────────────────────

export async function sendEscrowClaimedEmail(
  to: string,
  totalAmount: string,
  claimedCount: number,
): Promise<void> {
  const html = emailPage({
    preheader: `${usd(totalAmount)} in pending transfers is now in your balance`,
    hero: blueHero({ label: "Pending funds claimed", amount: `+${usd(totalAmount)}`, note: `${claimedCount} transfer${claimedCount !== 1 ? "s" : ""} waiting for you` }),
    blocks: [
      para("Money people sent you before you joined is now in your balance."),
      buttons([{ label: "Open Sweep", href: APP_URL }]),
    ],
    footer: [`You got this because ${esc(to)} is a Sweep payment ID.`],
  });

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] Escrow claimed: $${totalAmount} (${claimedCount} transfers) to ${to}`);
    return;
  }
  transporter.sendMail({ from: FROM, to, subject: `$${parseFloat(totalAmount).toFixed(2)} in pending funds claimed`, html }).catch(() => {});
}

// ─── Transaction: deposit confirmed ───────────────────────────────────────────

export async function sendDepositConfirmedEmail(
  to: string,
  amount: string,
  type: "bank" | "crypto",
  source: string,
): Promise<void> {
  const isCrypto = type === "crypto";
  const html = emailPage({
    preheader: `${usd(amount)} deposit is in your balance`,
    hero: blueHero({ label: "Deposit received", amount: `+${usd(amount)}`, note: isCrypto ? `USDC · ${source}` : `Wire · ${source}` }),
    blocks: [
      para(isCrypto
        ? "Your USDC deposit is confirmed on-chain and ready to send."
        : "Your wire transfer has arrived and is ready to send."),
      stats([{ label: "Method", value: isCrypto ? "USDC deposit" : "Wire transfer" }, { label: "Reference", value: ref() }]),
      buttons([{ label: "Open Sweep", href: APP_URL }]),
    ],
  });

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] Deposit confirmed: $${amount} (${type}) to ${to} from ${source}`);
    return;
  }
  transporter.sendMail({ from: FROM, to, subject: `$${parseFloat(amount).toFixed(2)} deposit credited to your account`, html }).catch(() => {});
}

// ─── Transaction: crypto withdrawal ───────────────────────────────────────────

export async function sendWithdrawalCryptoEmail(
  to: string,
  amount: string,
  fee: string,
  destination: string,
): Promise<void> {
  const receiptRef = ref();
  const html = emailPage({
    preheader: `${usd(amount)} USDC is on its way to your wallet`,
    label: `Receipt #${receiptRef}`,
    blocks: [
      bigAmount({ kicker: "WITHDRAWN.", amount: `${parseFloat(amount).toFixed(2)} USDC`, sub: "to your wallet" }),
      rows([
        { k: "Destination", v: destination, mono: true },
        { k: "Amount", v: `${parseFloat(amount).toFixed(2)} USDC` },
        { k: "Network fee", v: usd(fee) },
      ]),
      small(`Don't recognise this? ${link("Secure your account", APP_URL)} straight away.`),
    ],
    footer: ["Keep this receipt for your records."],
  });

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] Crypto withdrawal: $${amount} USDC to ${destination} (fee: $${fee}) for ${to}`);
    return;
  }
  transporter.sendMail({ from: FROM, to, subject: `$${parseFloat(amount).toFixed(2)} USDC withdrawal confirmed`, html }).catch(() => {});
}

// ─── Transaction: fiat withdrawal ─────────────────────────────────────────────

export async function sendWithdrawalFiatEmail(
  to: string,
  amount: string,
  destination: string,
): Promise<void> {
  const receiptRef = ref();
  const html = emailPage({
    preheader: `${usd(amount)} wire transfer is on its way`,
    label: `Receipt #${receiptRef}`,
    blocks: [
      bigAmount({ kicker: "WIRE SENT.", amount: usd(amount), sub: "Usually arrives in 1–3 business days" }),
      rows([
        { k: "Destination", v: destination },
        { k: "Amount", v: usd(amount) },
      ]),
      small(`Don't recognise this? ${link("Secure your account", APP_URL)} straight away.`),
    ],
    footer: ["Keep this receipt for your records."],
  });

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] Fiat withdrawal: $${amount} wire to ${destination} for ${to}`);
    return;
  }
  transporter.sendMail({ from: FROM, to, subject: `$${parseFloat(amount).toFixed(2)} wire transfer initiated`, html }).catch(() => {});
}

export async function sendPassportCreatedEmail(to: string): Promise<void> {
  const html = emailPage({
    preheader: "Your Sweep Subscription Passport is ready",
    label: "Subscriptions",
    blocks: [
      title("Your Subscription Passport is ready"),
      para("Your identity is verified, so partner checkouts can activate your subscriptions in one step."),
      checklist(["Faster checkout with partner merchants", "Your identity is already verified", "Revoke it anytime from Subscriptions"], "WHAT THIS MEANS"),
      small(`Didn't expect this? ${link("Review your account", APP_URL)}.`),
    ],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: "Your Subscription Passport is ready", html }).catch(() => {});
}

export async function sendCreatorTrialEndingSoonEmail(
  to: string,
  subscriberEmail: string,
  planTitle: string,
  trialEndDate: Date,
): Promise<void> {
  const endDateStr = trialEndDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const html = emailPage({
    preheader: `A free trial for ${planTitle} ends in 3 days`,
    label: "Your plans",
    blocks: [
      title("A trial ends in 3 days"),
      rows([
        { k: "Subscriber", v: subscriberEmail },
        { k: "Plan", v: planTitle },
      ], { k: "First charge", v: endDateStr }),
      para("If their balance covers it, billing happens automatically."),
    ],
  });

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `Trial ending soon — ${planTitle}`, html }).catch(() => {});
}

// ─── Developer: password reset ─────────────────────────────────────────────────

export async function sendDevPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const html = emailPage({
    preheader: "Reset your Sweep Developer Portal password",
    label: "Developer portal",
    blocks: [
      title("Reset your password"),
      para(`We got a request to reset your developer account password. The link expires in ${strong("30 minutes")}.`),
      buttons([{ label: "Choose a new password", href: resetUrl }]),
      small(`Button not working? Paste this link into your browser:<br><span style="word-break:break-all;color:#98a2b3;">${esc(resetUrl)}</span>`),
      small("Didn't ask for this? Ignore this email — your password won't change."),
    ],
    footer: [SECURITY_FOOTER],
  });

  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  DEV PASSWORD RESET for ${to}`);
  console.log(`  URL: ${resetUrl}`);
  console.log(`──────────────────────────────────────────────\n`);

  const transporter = getTransporter();
  if (!transporter) return;

  transporter.sendMail({
    from: FROM,
    to,
    subject: "Reset your Sweep Developer Portal password",
    html,
  }).catch((err: any) => {
    console.error(`[dev-reset-email] Failed to send to ${to}: ${err?.message}`);
  });
}

// ─── Welcome (sent once, when an account is first verified) ───────────────────
export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const firstName = (name || "").trim().split(/\s+/)[0] || "there";
  const html = emailPage({
    preheader: "Your email is now your Sweep payment ID. Here's how to get started.",
    hero: darkHero({ heading: `You're in, ${firstName}.`, chipLabel: "PAYMENT ID", chipValue: to }),
    blocks: [
      numbered([
        { title: "Add money", sub: "Deposit USDC from Arc, Base, Solana and more." },
        { title: "Send to any email", sub: "Free and instant, with gas sponsored." },
        { title: "Finish your security setup", sub: "Your transaction password approves every send; keep your authorization key somewhere safe." },
      ]),
      buttons([{ label: "Add money", href: APP_URL }]),
    ],
    footer: ["Testnet preview — balances have no real-world value."],
  });

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] Welcome email for ${to}`);
    return;
  }
  transporter.sendMail({ from: FROM, to, subject: `Welcome to Sweep, ${firstName}`, html }).catch(() => {});
}
