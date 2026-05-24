// ─── Brevo transport ──────────────────────────────────────────────────────────
// Brevo sends over HTTPS — 300 emails/day free (resets midnight UTC).
//
// Setup:
//   1. Sign up at https://app.brevo.com
//   2. SMTP & API → API Keys → Generate a new API key
//   3. Senders & IP → Senders → add and verify your sender email
//   4. Add to .env:  BREVO_API_KEY=xkeysib-xxxxxxxxxxxx
//                    BREVO_FROM=SweepUSDC <no-reply@yourdomain.com>

function _parseSender(from: string): { name: string; email: string } {
  const m = from.match(/^(.+?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: "SweepUSDC", email: from };
}

// ─── Per-email cooldown ───────────────────────────────────────────────────────
// Prevents the same address from receiving more than one email every 2 minutes,
// regardless of which endpoint triggered it. Stops rotating-IP bot floods cold.
const _emailCooldowns = new Map<string, number>();
const EMAIL_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

function _isOnCooldown(email: string): boolean {
  const last = _emailCooldowns.get(email);
  return !!last && Date.now() - last < EMAIL_COOLDOWN_MS;
}

function _setCooldown(email: string): void {
  _emailCooldowns.set(email, Date.now());
  // Prune stale entries to avoid unbounded growth
  if (_emailCooldowns.size > 1000) {
    const cutoff = Date.now() - EMAIL_COOLDOWN_MS;
    for (const [k, v] of _emailCooldowns) {
      if (v < cutoff) _emailCooldowns.delete(k);
    }
  }
}

// Shim that matches the nodemailer sendMail interface used throughout this file
function getTransporter() {
  const key = process.env.BREVO_API_KEY;
  if (!key) return null;
  return {
    sendMail: async (opts: { from?: string; to: string; subject: string; html: string }) => {
      const recipient = opts.to.toLowerCase();
      if (_isOnCooldown(recipient)) {
        console.log(`[email] Cooldown suppressed send to ${recipient}`);
        return { id: "cooldown-suppressed" };
      }
      _setCooldown(recipient);
      const sender = _parseSender(opts.from ?? FROM);
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method:  "POST",
        headers: { "api-key": key, "Content-Type": "application/json" },
        body:    JSON.stringify({
          sender,
          to:          [{ email: opts.to }],
          subject:     opts.subject,
          htmlContent: opts.html,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Brevo API error ${res.status}: ${body}`);
      }
      return res.json();
    },
  };
}

const FROM = process.env.BREVO_FROM ?? process.env.RESEND_FROM ?? process.env.SMTP_FROM ?? "SweepUSDC <no-reply@usdcsend.app>";

export async function verifySmtp(): Promise<void> {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    console.warn("\n⚠️  BREVO_API_KEY not set — emails will NOT be delivered.");
    console.warn("   1. Sign up at https://app.brevo.com (free — 300 emails/day)");
    console.warn("   2. SMTP & API → API Keys → Generate a new API key");
    console.warn("   3. Add BREVO_API_KEY=xkeysib-xxx and BREVO_FROM=You <you@domain.com> to .env\n");
    return;
  }
  console.info(`✅  Brevo ready — sending from "${FROM}"`);
}

export async function sendRecurringSuccessEmail(
  to: string,
  amount: string,
  recipientEmail: string,
  newBalance: string,
  nextRunAt: Date,
): Promise<void> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
          </div>
          <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#fff;border-radius:20px;padding:40px 36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <!-- Status badge -->
          <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dcfce7;margin-bottom:20px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#16a34a;display:inline-block;"></span>
            <span style="font-size:12px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:0.5px;">Transfer Successful</span>
          </div>

          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Recurring transfer sent</p>
          <p style="margin:0 0 28px;color:#64748b;font-size:15px;line-height:1.6;">
            Your scheduled transfer was processed successfully.
          </p>

          <!-- Amount block -->
          <div style="background:#f1f5f9;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <span style="color:#64748b;font-size:13px;">Amount sent</span>
              <span style="font-size:20px;font-weight:800;color:#0f172a;">$${parseFloat(amount).toFixed(2)} USD</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <span style="color:#64748b;font-size:13px;">Recipient</span>
              <span style="font-size:13px;font-weight:600;color:#1e293b;">${recipientEmail}</span>
            </div>
            <div style="height:1px;background:#e2e8f0;margin:10px 0;"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <span style="color:#64748b;font-size:13px;">New balance</span>
              <span style="font-size:13px;font-weight:600;color:#1e293b;">$${parseFloat(newBalance).toFixed(2)} USD</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#64748b;font-size:13px;">Next transfer</span>
              <span style="font-size:13px;font-weight:600;color:#1e293b;">${nextRunAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
            </div>
          </div>

          <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
            The recipient will be notified and can claim the funds from their SweepUSDC account.<br>
            You can manage or cancel your recurring transfers from your dashboard.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
          </div>
          <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#fff;border-radius:20px;padding:40px 36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <!-- Status badge -->
          <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#fef3c7;margin-bottom:20px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#d97706;display:inline-block;"></span>
            <span style="font-size:12px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:0.5px;">Transfer Skipped</span>
          </div>

          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Insufficient balance</p>
          <p style="margin:0 0 28px;color:#64748b;font-size:15px;line-height:1.6;">
            Your recurring transfer was skipped because your balance is too low. We'll try again at the next scheduled interval.
          </p>

          <!-- Amount block -->
          <div style="background:#fef9f0;border:1px solid #fde68a;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <span style="color:#92400e;font-size:13px;">Required amount</span>
              <span style="font-size:20px;font-weight:800;color:#0f172a;">$${parseFloat(amount).toFixed(2)} USD</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <span style="color:#92400e;font-size:13px;">Your balance</span>
              <span style="font-size:13px;font-weight:600;color:#dc2626;">$${parseFloat(currentBalance).toFixed(2)} USD</span>
            </div>
            <div style="height:1px;background:#fde68a;margin:10px 0;"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <span style="color:#92400e;font-size:13px;">Recipient</span>
              <span style="font-size:13px;font-weight:600;color:#1e293b;">${recipientEmail}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#92400e;font-size:13px;">Next attempt</span>
              <span style="font-size:13px;font-weight:600;color:#1e293b;">${nextRunAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
            </div>
          </div>

          <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
            To ensure future transfers succeed, please top up your balance before ${nextRunAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.<br>
            You can also cancel this recurring transfer from your dashboard if you no longer need it.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

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

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
          </div>
          <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#fff;border-radius:20px;padding:40px 36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">
            ${type === "register" ? "Verify your email" : "Your sign-in code"}
          </p>
          <p style="margin:0 0 32px;color:#64748b;font-size:15px;line-height:1.6;">
            Use the code below to ${action}. It expires in <strong>10 minutes</strong>.
          </p>

          <!-- OTP code -->
          <div style="background:#f1f5f9;border-radius:14px;padding:24px;text-align:center;margin-bottom:32px;">
            <span style="font-family:'Courier New',monospace;font-size:40px;font-weight:800;letter-spacing:12px;color:#1e293b;">${code}</span>
          </div>

          <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
            If you didn't request this, you can safely ignore this email.<br>
            Never share this code with anyone.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">
            &copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
          </div>
          <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
        </td></tr>
        <tr><td style="background:#fff;border-radius:20px;padding:40px 36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Confirm your email address</p>
          <p style="margin:0 0 32px;color:#64748b;font-size:15px;line-height:1.6;">
            Click the button below to verify your email and activate your account.
            This link expires in <strong>72 hours</strong>.
          </p>
          <div style="text-align:center;margin-bottom:32px;">
            <a href="${verificationUrl}"
               style="display:inline-block;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:12px;text-decoration:none;">
              Verify my email
            </a>
          </div>
          <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
            Or copy this link into your browser:<br>
            <a href="${verificationUrl}" style="color:#2563eb;word-break:break-all;">${verificationUrl}</a>
          </p>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:13px;">
            If you didn't create an account, you can safely ignore this email.
          </p>
        </td></tr>
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
          </div>
          <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
        </td></tr>
        <tr><td style="background:#fff;border-radius:20px;padding:40px 36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#fef9c3;margin-bottom:20px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#ca8a04;display:inline-block;"></span>
            <span style="font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;">Security Alert</span>
          </div>
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Reset your password</p>
          <p style="margin:0 0 32px;color:#64748b;font-size:15px;line-height:1.6;">
            We received a request to reset the password on your SweepUSDC account.
            Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.
          </p>
          <div style="text-align:center;margin-bottom:32px;">
            <a href="${resetUrl}"
               style="display:inline-block;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:12px;text-decoration:none;">
              Reset my password
            </a>
          </div>
          <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
            Or copy this link into your browser:<br>
            <a href="${resetUrl}" style="color:#2563eb;word-break:break-all;">${resetUrl}</a>
          </p>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:13px;">
            If you did not request a password reset, you can safely ignore this email.
            Your password will not change unless you click the link above.
          </p>
        </td></tr>
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
};

export async function sendSecurityOtpEmail(to: string, code: string, actionType: string): Promise<void> {
  const meta = SECURITY_ACTION_LABELS[actionType] ?? {
    subject: "Security verification code",
    heading: "Verification required",
    desc: "to complete this action",
  };

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
          </div>
          <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#fff;border-radius:20px;padding:40px 36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <!-- Security badge -->
          <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#ede9fe;margin-bottom:20px;">
            <span style="font-size:12px;">🔒</span>
            <span style="font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:0.5px;">Security Action</span>
          </div>

          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">${meta.heading}</p>
          <p style="margin:0 0 32px;color:#64748b;font-size:15px;line-height:1.6;">
            Use the code below ${meta.desc}. It expires in <strong>10 minutes</strong>.
          </p>

          <!-- OTP code -->
          <div style="background:#f1f5f9;border-radius:14px;padding:24px;text-align:center;margin-bottom:32px;">
            <span style="font-family:'Courier New',monospace;font-size:40px;font-weight:800;letter-spacing:12px;color:#1e293b;">${code}</span>
          </div>

          <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;">
              <strong>⚠ Security notice:</strong> If you did not initiate this action, your account may be at risk. Do not share this code with anyone — SweepUSDC will never ask for it.
            </p>
          </div>

          <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
            This code was requested for your SweepUSDC account.<br>
            If you didn't request this, you can safely ignore this email.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Always log the OTP to server console as a fallback (visible in server logs)
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  SECURITY OTP for ${to}  [${actionType}]`);
  console.log(`  Code: ${code}  (expires in 10 minutes)`);
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
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
          </div>
          <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
        </td></tr>
        <tr><td style="background:#fff;border-radius:20px;padding:40px 36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dbeafe;margin-bottom:20px;">
            <span style="font-size:12px;">💳</span>
            <span style="font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.5px;">Subscription</span>
          </div>
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Confirm your identity</p>
          <p style="margin:0 0 32px;color:#64748b;font-size:15px;line-height:1.6;">
            Enter this code to generate your subscription confirmation code. It expires in <strong>10 minutes</strong>.
          </p>
          <div style="background:#f1f5f9;border-radius:14px;padding:24px;text-align:center;margin-bottom:32px;">
            <span style="font-family:'Courier New',monospace;font-size:40px;font-weight:800;letter-spacing:12px;color:#1e293b;">${code}</span>
          </div>
          <p style="margin:0;color:#94a3b8;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  SUBSCRIPTION OTP for ${to}`);
  console.log(`  Code: ${code}  (expires in 10 minutes)`);
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
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
          </div>
          <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
        </td></tr>
        <tr><td style="background:#fff;border-radius:20px;padding:40px 36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dcfce7;margin-bottom:20px;">
            <span style="font-size:12px;">✅</span>
            <span style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.5px;">Confirmation Code Ready</span>
          </div>
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Your subscription code</p>
          <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">
            Enter this code on the subscription page to activate your <strong>${planTitle}</strong> plan
            (<strong>$${amount} / ${interval}</strong>).
          </p>
          <div style="background:#f1f5f9;border-radius:14px;padding:28px;text-align:center;margin-bottom:28px;">
            <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Confirmation Code</p>
            <span style="font-family:'Courier New',monospace;font-size:36px;font-weight:800;letter-spacing:8px;color:#1e293b;">${confirmationCode}</span>
          </div>
          <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;">
              ⚠ This code expires in <strong>7 days</strong> and is single-use.
              Do not share it — it authorizes a payment from your account.
            </p>
          </div>
          <p style="margin:0;color:#94a3b8;font-size:13px;">If you didn't request this, contact support immediately.</p>
        </td></tr>
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0f172a;">✅ Subscription payment successful</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">${planTitle}</p>
        <div style="background:#f1f5f9;border-radius:12px;padding:20px;margin-bottom:20px;">
          <p style="margin:0;font-size:28px;font-weight:800;color:#1e293b;">$${amount} <span style="font-size:14px;font-weight:500;color:#64748b;">/ ${interval}</span></p>
        </div>
        <p style="margin:0;color:#64748b;font-size:14px;">Next billing date: <strong>${nextDate}</strong></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#dc2626;">⚠ Subscription payment failed</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;">${planTitle} — $${amount}</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;margin-bottom:20px;">
          <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.6;">
            We couldn't charge your account (insufficient balance).
            ${retriesLeft > 0 ? `We'll retry automatically. <strong>${retriesLeft} attempt${retriesLeft !== 1 ? "s" : ""} remaining.</strong>` : "All retry attempts exhausted — your subscription has been cancelled."}
          </p>
        </div>
        <p style="margin:0;color:#64748b;font-size:14px;">Please top up your balance to avoid cancellation.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dcfce7;margin-bottom:20px;">
          <span style="font-size:12px;">🎉</span>
          <span style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.5px;">New Subscriber</span>
        </div>
        <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">You have a new subscriber!</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
          <strong>${subscriberEmail}</strong> just subscribed to <strong>${planTitle}</strong> on the <strong>${interval}</strong> plan.
        </p>
        <div style="background:#f1f5f9;border-radius:12px;padding:16px;margin-bottom:20px;">
          <p style="margin:0;color:#64748b;font-size:14px;">You now have <strong style="color:#0f172a;">${activeCount} active subscriber${activeCount !== 1 ? "s" : ""}</strong>.</p>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;">Log in to your dashboard to view subscriber details.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dcfce7;margin-bottom:20px;">
          <span style="font-size:12px;">✅</span>
          <span style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.5px;">Payment Received</span>
        </div>
        <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Subscription renewed</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
          <strong>${subscriberEmail}</strong>'s <strong>${interval}</strong> subscription to <strong>${planTitle}</strong> has renewed.
        </p>
        <div style="background:#f1f5f9;border-radius:12px;padding:16px;">
          <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">$${parseFloat(amount).toFixed(2)} received</p>
        </div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `Renewal received — ${planTitle}`, html }).catch(() => {});
}

export async function sendCreatorPaymentFailedEmail(
  to: string,
  subscriberEmail: string,
  planTitle: string,
): Promise<void> {
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#fef3c7;margin-bottom:20px;">
          <span style="font-size:12px;">⚠</span>
          <span style="font-size:12px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:0.5px;">Payment Failed</span>
        </div>
        <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Subscriber payment failed</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
          Payment failed for <strong>${subscriberEmail}</strong>'s subscription to <strong>${planTitle}</strong>.
          The system will retry daily for up to 7 days.
        </p>
        <p style="margin:0;color:#94a3b8;font-size:13px;">No action is needed from you. If retries are exhausted, the subscription will be cancelled automatically.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#f1f5f9;margin-bottom:20px;">
          <span style="font-size:12px;">❌</span>
          <span style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Subscription Cancelled</span>
        </div>
        <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Subscription cancelled</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
          <strong>${subscriberEmail}</strong>'s subscription to <strong>${planTitle}</strong> has been cancelled.
          Reason: <strong>${reason}</strong>.
        </p>
        <div style="background:#f1f5f9;border-radius:12px;padding:16px;">
          <p style="margin:0;color:#64748b;font-size:14px;">You now have <strong style="color:#0f172a;">${activeCount} active subscriber${activeCount !== 1 ? "s" : ""}</strong>.</p>
        </div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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

  const accentColor = isTrialing ? "#7c3aed" : "#1D9E75";
  const badgeBg     = isTrialing ? "#ede9fe"  : "#E1F5EE";
  const badgeColor  = isTrialing ? "#5b21b6"  : "#085041";
  const badgeLabel  = isTrialing ? "Free Trial Started" : "Subscription Active";

  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
        </div>
        <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
      </td></tr>
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:99px;background:${badgeBg};margin-bottom:20px;">
          <span style="width:7px;height:7px;border-radius:50%;background:${accentColor};display:inline-block;"></span>
          <span style="font-size:12px;font-weight:700;color:${badgeColor};text-transform:uppercase;letter-spacing:0.5px;">${badgeLabel}</span>
        </div>
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">
          ${isTrialing ? "Your free trial is active!" : "Subscription confirmed!"}
        </p>
        <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">
          ${isTrialing
            ? `Your free trial for <strong>${planTitle}</strong> has started. Your first payment will be due when the trial ends.`
            : `You're now subscribed to <strong>${planTitle}</strong>.`}
        </p>
        <div style="background:#f1f5f9;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Plan</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">${planTitle}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Amount</span>
            <span style="font-size:16px;font-weight:800;color:#0f172a;">$${parseFloat(amount).toFixed(2)} / ${interval}</span>
          </div>
          <div style="height:1px;background:#e2e8f0;margin:10px 0;"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#64748b;font-size:13px;">${isTrialing ? "First billing date" : "Next billing date"}</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">${dateStr}</span>
          </div>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
          You can view or cancel this subscription anytime from your dashboard.
        </p>
      </td></tr>
      <tr><td style="padding:24px 0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: isTrialing ? `Free trial started — ${planTitle}` : `Subscription confirmed — ${planTitle}`, html }).catch(() => {});
}

// ─── Subscriber: cancellation confirmation ─────────────────────────────────────

export async function sendSubscriptionCancelledEmail(
  to: string,
  planTitle: string,
): Promise<void> {
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
        </div>
        <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
      </td></tr>
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:99px;background:#f1f5f9;margin-bottom:20px;">
          <span style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Subscription Cancelled</span>
        </div>
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Subscription cancelled</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">
          Your subscription to <strong>${planTitle}</strong> has been cancelled. You won't be charged again.
        </p>
        <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
          If you cancelled by mistake, you can re-subscribe anytime from the subscription page.
        </p>
      </td></tr>
      <tr><td style="padding:24px 0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
        </div>
        <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
      </td></tr>
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:99px;background:#ede9fe;margin-bottom:20px;">
          <span style="font-size:12px;font-weight:700;color:#5b21b6;text-transform:uppercase;letter-spacing:0.5px;">Trial Ending Soon</span>
        </div>
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Your free trial ends in 3 days</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">
          Your free trial for <strong>${planTitle}</strong> ends on <strong>${endDateStr}</strong>.
          Make sure your account has sufficient balance to continue.
        </p>
        <div style="background:#f1f5f9;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Plan</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">${planTitle}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Amount due</span>
            <span style="font-size:16px;font-weight:800;color:#0f172a;">$${parseFloat(amount).toFixed(2)} / ${interval}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#64748b;font-size:13px;">First billing</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">${endDateStr}</span>
          </div>
        </div>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:12px;padding:16px;margin-bottom:24px;">
          <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;">
            If your balance is insufficient on <strong>${endDateStr}</strong>, your subscription will enter a grace period and we'll retry for up to 7 days before cancelling.
          </p>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
          Top up your balance from the dashboard to ensure uninterrupted access.<br>
          You can also cancel before the trial ends if you no longer wish to continue.
        </p>
      </td></tr>
      <tr><td style="padding:24px 0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
        </div>
        <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
      </td></tr>
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dcfce7;margin-bottom:20px;">
          <span style="width:8px;height:8px;border-radius:50%;background:#16a34a;display:inline-block;"></span>
          <span style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.5px;">Transfer Sent</span>
        </div>
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Money sent successfully</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">Your transfer has been processed.</p>
        <div style="background:#f1f5f9;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Amount sent</span>
            <span style="font-size:20px;font-weight:800;color:#0f172a;">$${parseFloat(amount).toFixed(2)} USD</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">To</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">${recipientEmail}</span>
          </div>
          <div style="height:1px;background:#e2e8f0;margin:10px 0;"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#64748b;font-size:13px;">Remaining balance</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">$${parseFloat(newBalance).toFixed(2)} USD</span>
          </div>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;">If you didn't authorize this transfer, contact support immediately.</p>
      </td></tr>
      <tr><td style="padding:24px 0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
        </div>
        <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
      </td></tr>
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dbeafe;margin-bottom:20px;">
          <span style="width:8px;height:8px;border-radius:50%;background:#2563eb;display:inline-block;"></span>
          <span style="font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.5px;">Funds Received</span>
        </div>
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">You've received money!</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">A transfer has been credited to your account.</p>
        <div style="background:#f1f5f9;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Amount received</span>
            <span style="font-size:20px;font-weight:800;color:#16a34a;">+$${parseFloat(amount).toFixed(2)} USD</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">From</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">${senderEmail}</span>
          </div>
          <div style="height:1px;background:#e2e8f0;margin:10px 0;"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#64748b;font-size:13px;">New balance</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">$${parseFloat(newBalance).toFixed(2)} USD</span>
          </div>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;">Funds are available immediately in your SweepUSDC balance.</p>
      </td></tr>
      <tr><td style="padding:24px 0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
        </div>
        <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
      </td></tr>
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dcfce7;margin-bottom:20px;">
          <span style="width:8px;height:8px;border-radius:50%;background:#16a34a;display:inline-block;"></span>
          <span style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.5px;">Funds Claimed</span>
        </div>
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Pending funds claimed</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">
          You've successfully claimed ${claimedCount} pending transfer${claimedCount !== 1 ? "s" : ""}.
        </p>
        <div style="background:#f1f5f9;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#64748b;font-size:13px;">Total claimed</span>
            <span style="font-size:20px;font-weight:800;color:#16a34a;">+$${parseFloat(totalAmount).toFixed(2)} USD</span>
          </div>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;">These funds are now available in your SweepUSDC balance.</p>
      </td></tr>
      <tr><td style="padding:24px 0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
        </div>
        <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
      </td></tr>
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dcfce7;margin-bottom:20px;">
          <span style="width:8px;height:8px;border-radius:50%;background:#16a34a;display:inline-block;"></span>
          <span style="font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.5px;">Deposit Confirmed</span>
        </div>
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Your deposit has arrived</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">
          ${isCrypto ? "Your USDC deposit has been confirmed on-chain and credited to your account." : "Your wire transfer has been received and credited to your account."}
        </p>
        <div style="background:#f1f5f9;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Amount credited</span>
            <span style="font-size:20px;font-weight:800;color:#16a34a;">+$${parseFloat(amount).toFixed(2)} USD</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Type</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">${isCrypto ? "Crypto (USDC)" : "Bank Wire"}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#64748b;font-size:13px;">Source</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">${source}</span>
          </div>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;">Your balance has been updated and is available for use immediately.</p>
      </td></tr>
      <tr><td style="padding:24px 0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
        </div>
        <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
      </td></tr>
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dbeafe;margin-bottom:20px;">
          <span style="width:8px;height:8px;border-radius:50%;background:#2563eb;display:inline-block;"></span>
          <span style="font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.5px;">Withdrawal Processed</span>
        </div>
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">USDC withdrawal confirmed</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">Your USDC has been sent to the destination wallet.</p>
        <div style="background:#f1f5f9;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Amount withdrawn</span>
            <span style="font-size:20px;font-weight:800;color:#0f172a;">$${parseFloat(amount).toFixed(2)} USDC</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Network fee</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">$${parseFloat(fee).toFixed(2)}</span>
          </div>
          <div style="height:1px;background:#e2e8f0;margin:10px 0;"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#64748b;font-size:13px;">To wallet</span>
            <span style="font-size:12px;font-weight:600;color:#1e293b;font-family:'Courier New',monospace;word-break:break-all;">${destination}</span>
          </div>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;">If you didn't authorize this withdrawal, contact support immediately.</p>
      </td></tr>
      <tr><td style="padding:24px 0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
          <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
        </div>
        <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#0f172a;">SweepUSDC</p>
      </td></tr>
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dbeafe;margin-bottom:20px;">
          <span style="width:8px;height:8px;border-radius:50%;background:#2563eb;display:inline-block;"></span>
          <span style="font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.5px;">Wire Initiated</span>
        </div>
        <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Wire transfer initiated</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:15px;line-height:1.6;">Your withdrawal is on its way. Wire transfers typically arrive within 1–3 business days.</p>
        <div style="background:#f1f5f9;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Amount</span>
            <span style="font-size:20px;font-weight:800;color:#0f172a;">$${parseFloat(amount).toFixed(2)} USD</span>
          </div>
          <div style="height:1px;background:#e2e8f0;margin:10px 0;"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="color:#64748b;font-size:13px;">Destination</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">${destination}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#64748b;font-size:13px;">Estimated arrival</span>
            <span style="font-size:13px;font-weight:600;color:#1e293b;">1–3 business days</span>
          </div>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;">If you didn't authorize this withdrawal, contact support immediately.</p>
      </td></tr>
      <tr><td style="padding:24px 0;text-align:center;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">&copy; ${new Date().getFullYear()} SweepUSDC. All rights reserved.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email] Fiat withdrawal: $${amount} wire to ${destination} for ${to}`);
    return;
  }
  transporter.sendMail({ from: FROM, to, subject: `$${parseFloat(amount).toFixed(2)} wire transfer initiated`, html }).catch(() => {});
}

export async function sendPassportCreatedEmail(to: string): Promise<void> {
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#dbeafe;margin-bottom:20px;">
          <span style="font-size:12px;">🪪</span>
          <span style="font-size:12px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.5px;">Subscription Passport</span>
        </div>
        <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Your Subscription Passport is ready</p>
        <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.6;">
          You've been issued a Subscription Passport. Next time you subscribe to a plan on SweepUSDC,
          you can activate in one click — no confirmation code needed.
        </p>
        <div style="background:#f1f5f9;border-radius:12px;padding:16px;margin-bottom:20px;">
          <p style="margin:0;color:#64748b;font-size:14px;"><strong>What this means:</strong></p>
          <ul style="margin:8px 0 0;padding-left:20px;color:#64748b;font-size:14px;line-height:1.8;">
            <li>Instant subscription activation on future plans</li>
            <li>Your identity is already verified</li>
            <li>You can revoke your passport anytime from your dashboard</li>
          </ul>
        </div>
        <p style="margin:0;color:#94a3b8;font-size:13px;">If you didn't expect this, log in and review your account settings.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

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
  const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
      <tr><td style="background:#fff;border-radius:20px;padding:36px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:#ede9fe;margin-bottom:20px;">
          <span style="font-size:12px;">⏳</span>
          <span style="font-size:12px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:0.5px;">Trial Ending Soon</span>
        </div>
        <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Trial ending in 3 days</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:14px;line-height:1.6;">
          <strong>${subscriberEmail}</strong>'s free trial for <strong>${planTitle}</strong> ends in 3 days.
          First billing will be attempted on <strong>${endDateStr}</strong>.
        </p>
        <p style="margin:0;color:#94a3b8;font-size:13px;">If their account has sufficient balance, billing will proceed automatically.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const transporter = getTransporter();
  if (!transporter) return;
  transporter.sendMail({ from: FROM, to, subject: `Trial ending soon — ${planTitle}`, html }).catch(() => {});
}

// ─── Developer: password reset ─────────────────────────────────────────────────

export async function sendDevPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#060912;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">

        <tr><td align="center" style="padding-bottom:28px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-1px;">S</span>
          </div>
          <p style="margin:8px 0 0;font-weight:700;font-size:18px;color:#fff;">Sweep Developer Portal</p>
        </td></tr>

        <tr><td style="background:#0f1623;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:40px 36px;">
          <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;background:rgba(79,70,229,0.15);border:1px solid rgba(79,70,229,0.3);margin-bottom:20px;">
            <span style="font-size:12px;">🔑</span>
            <span style="font-size:12px;font-weight:700;color:#818cf8;text-transform:uppercase;letter-spacing:0.5px;">Password Reset</span>
          </div>

          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#fff;">Reset your password</p>
          <p style="margin:0 0 32px;color:#94a3b8;font-size:15px;line-height:1.6;">
            We received a request to reset the password for your developer account.
            Click the button below to set a new password. This link expires in <strong style="color:#e2e8f0;">30 minutes</strong>.
          </p>

          <div style="text-align:center;margin-bottom:32px;">
            <a href="${resetUrl}"
               style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:12px;text-decoration:none;">
              Reset my password
            </a>
          </div>

          <p style="margin:0 0 24px;color:#64748b;font-size:13px;line-height:1.6;">
            Or copy this link into your browser:<br>
            <a href="${resetUrl}" style="color:#818cf8;word-break:break-all;">${resetUrl}</a>
          </p>

          <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:16px;">
            <p style="margin:0;color:#fca5a5;font-size:13px;line-height:1.6;">
              <strong>⚠ If you did not request this,</strong> you can safely ignore this email.
              Your password will not change unless you click the link above.
            </p>
          </div>
        </td></tr>

        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;color:#334155;font-size:12px;">&copy; ${new Date().getFullYear()} Sweep. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
