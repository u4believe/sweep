// ─── Sweep email kit (Email system v2) ───────────────────────────────────────
// Building blocks for every transactional email: a 560px white card on a light
// canvas, Plus Jakarta Sans → Arial, one primary action. Table-based with inline
// styles so it renders the same in Gmail, Apple Mail and Outlook (no flex/grid,
// no SVG). Every dynamic string goes through esc() unless noted as raw HTML.

export const APP_URL = (process.env.FRONTEND_URL ?? process.env.APP_URL ?? "https://sweepusdc-testnet.xyz").replace(/\/$/, "");
const ASSET = (name: string) => `${APP_URL}/email/${name}`;

const FONT  = "'Plus Jakarta Sans',Arial,Helvetica,sans-serif";
const INK   = "#0b1220";
const BODY  = "#475467";
const MUTED = "#667085";
const FAINT = "#98a2b3";
const BLUE  = "#1128F5";
const LINE  = "#eceff4";

/** Escape text for HTML. */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const usd = (v: string | number) =>
  `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const longDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

/** A short reference like SW-3K8P-20 for receipts (display only). */
export function ref(): string {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (n: number) => Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join("");
  return `SW-${pick(4)}-${pick(2)}`;
}

// ── Blocks (each returns an HTML string for the card body) ───────────────────

const bodyText = `font-family:${FONT};font-size:15px;line-height:1.65;color:${BODY};`;

export const title = (text: string) =>
  `<h1 class="sw-h1" style="margin:0;font-family:${FONT};font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.035em;color:${INK};">${esc(text)}</h1>`;

/** Paragraph — `html` is raw so callers can use strong(); escape values with esc(). */
export const para = (html: string) => `<p style="margin:0;${bodyText}">${html}</p>`;

export const strong = (text: string) => `<strong style="color:${INK};font-weight:700;">${esc(text)}</strong>`;

export const small = (html: string) =>
  `<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">${html}</p>`;

export const link = (label: string, href: string) =>
  `<a href="${esc(href)}" style="color:${BLUE};font-weight:700;text-decoration:none;">${esc(label)}</a>`;

export const kicker = (text: string, color = BLUE) =>
  `<p style="margin:0;font-family:${FONT};font-size:13px;font-weight:800;letter-spacing:0.06em;color:${color};">${esc(text)}</p>`;

/** Big amount with optional kicker and line under it (receipt header). */
export const bigAmount = (opts: { kicker?: string; amount: string; sub?: string }) => `
${opts.kicker ? kicker(opts.kicker) : ""}
<p class="sw-amt" style="margin:${opts.kicker ? "8px" : "0"} 0 0;font-family:${FONT};font-size:52px;line-height:1;font-weight:800;letter-spacing:-0.05em;color:${INK};">${esc(opts.amount)}</p>
${opts.sub ? `<p style="margin:10px 0 0;${bodyText}">${esc(opts.sub)}</p>` : ""}`;

/** Six (or any number of) boxed code characters. */
export function codeBoxes(code: string): string {
  const chars = code.split("");
  const cells = chars.map((ch) => `
    <td width="${Math.floor(100 / chars.length)}%" style="padding:0 4px;">
      <div style="height:64px;line-height:64px;border-radius:12px;background:#f5f7ff;border:1px solid #d6dbfd;text-align:center;font-family:${FONT};font-size:30px;font-weight:800;color:${BLUE};">${esc(ch)}</div>
    </td>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -4px;"><tr>${cells}</tr></table>`;
}

/** Long or case-sensitive codes: one wide box. */
export const codeBlock = (code: string) =>
  `<div style="border-radius:14px;background:#f5f7ff;border:1px solid #d6dbfd;padding:18px 20px;text-align:center;font-family:'Courier New',monospace;font-size:28px;font-weight:700;letter-spacing:0.18em;color:${BLUE};">${esc(code)}</div>`;

/** Grey key/value box (device, plan details…). */
export function infoBox(rows: Array<[string, string]>): string {
  const trs = rows.map(([k, v]) => `
    <tr>
      <td style="padding:4px 20px 4px 0;font-family:${FONT};font-size:13px;font-weight:600;color:${FAINT};white-space:nowrap;vertical-align:top;">${esc(k)}</td>
      <td style="padding:4px 0;font-family:${FONT};font-size:13px;font-weight:600;color:${INK};word-break:break-word;">${esc(v)}</td>
    </tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fb;border-radius:12px;"><tr><td style="padding:12px 18px;">
    <table role="presentation" cellpadding="0" cellspacing="0">${trs}</table></td></tr></table>`;
}

/** Bordered stat boxes side by side (New balance / Reference, Due / Balance / Next retry). */
export function stats(cells: Array<{ label: string; value: string; color?: string }>): string {
  const tds = cells.map((c, i) => `
    <td width="${Math.floor(100 / cells.length)}%" style="padding:16px 18px;${i ? `border-left:1px solid ${LINE};` : ""}vertical-align:top;">
      <p style="margin:0;font-family:${FONT};font-size:12px;font-weight:600;color:${FAINT};">${esc(c.label)}</p>
      <p style="margin:4px 0 0;font-family:${FONT};font-size:18px;font-weight:800;color:${c.color ?? INK};word-break:break-word;">${esc(c.value)}</p>
    </td>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:14px;border-collapse:separate;"><tr>${tds}</tr></table>`;
}

/** Receipt rows; the last row can be the bold total. */
export function rows(items: Array<{ k: string; v: string; ok?: boolean; mono?: boolean }>, total?: { k: string; v: string }): string {
  const trs = items.map((r) => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #f0f2f6;font-family:${FONT};font-size:14px;color:${MUTED};vertical-align:top;white-space:nowrap;">${esc(r.k)}</td>
      <td align="right" style="padding:14px 0 14px 16px;border-bottom:1px solid #f0f2f6;font-family:${r.mono ? "'Courier New',monospace" : FONT};font-size:${r.mono ? "13px" : "14px"};font-weight:700;color:${r.ok ? "#067647" : INK};word-break:break-all;">${esc(r.v)}</td>
    </tr>`).join("");
  const tot = total ? `
    <tr>
      <td style="padding:16px 0 0;font-family:${FONT};font-size:16px;font-weight:800;color:${INK};">${esc(total.k)}</td>
      <td align="right" style="padding:16px 0 0;font-family:${FONT};font-size:16px;font-weight:800;color:${INK};">${esc(total.v)}</td>
    </tr>` : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};">${trs}${tot}</table>`;
}

/** Authorized → Sent → Delivered progress bar. */
export function steps(labels: Array<{ label: string; sub?: string; done?: boolean }>): string {
  const tds = labels.map((s, i) => `
    <td width="${Math.floor(100 / labels.length)}%" style="padding:0 ${i < labels.length - 1 ? "6px" : "0"} 0 0;vertical-align:top;">
      <div style="height:4px;line-height:4px;font-size:0;border-radius:99px;background:${s.done === false ? "#e3e7ee" : i === labels.length - 1 ? "#12b76a" : BLUE};">&nbsp;</div>
      <p style="margin:8px 0 0;font-family:${FONT};font-size:12px;font-weight:700;color:${INK};">${esc(s.label)}</p>
      ${s.sub ? `<p style="margin:2px 0 0;font-family:${FONT};font-size:12px;color:${FAINT};">${esc(s.sub)}</p>` : ""}
    </td>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tds}</tr></table>`;
}

/** Initial avatar + heading + sub line (plan / subscriber header). */
export function avatarHeader(opts: { initial: string; heading: string; sub?: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:16px;">
      <div style="width:56px;height:56px;line-height:56px;border-radius:16px;background:#dfe4ff;text-align:center;font-family:${FONT};font-size:22px;font-weight:800;color:${BLUE};">${esc(opts.initial.charAt(0).toUpperCase())}</div>
    </td>
    <td style="vertical-align:middle;">
      <p style="margin:0;font-family:${FONT};font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-0.03em;color:${INK};">${esc(opts.heading)}</p>
      ${opts.sub ? `<p style="margin:4px 0 0;font-family:${FONT};font-size:14px;color:${MUTED};">${esc(opts.sub)}</p>` : ""}
    </td></tr></table>`;
}

/** Tinted highlight box with a value on the right (trial started · $0.00). */
export function callout(opts: { title: string; sub?: string; value?: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7ff;border:1px solid #d6dbfd;border-radius:14px;border-collapse:separate;"><tr>
    <td style="padding:18px;vertical-align:middle;">
      <p style="margin:0;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};">${esc(opts.title)}</p>
      ${opts.sub ? `<p style="margin:4px 0 0;font-family:${FONT};font-size:13px;color:${BODY};">${esc(opts.sub)}</p>` : ""}
    </td>
    ${opts.value ? `<td align="right" style="padding:18px;vertical-align:middle;font-family:${FONT};font-size:26px;font-weight:800;letter-spacing:-0.03em;color:${BLUE};white-space:nowrap;">${esc(opts.value)}</td>` : ""}
  </tr></table>`;
}

export function checklist(items: string[], heading = "WHAT'S INCLUDED"): string {
  const trs = items.map((t) => `
    <tr>
      <td style="padding:6px 12px 6px 0;vertical-align:top;width:20px;">
        <div style="width:20px;height:20px;line-height:20px;border-radius:10px;background:${BLUE};text-align:center;font-family:Arial,sans-serif;font-size:11px;font-weight:800;color:#ffffff;">&#10003;</div>
      </td>
      <td style="padding:6px 0;font-family:${FONT};font-size:15px;color:#344054;">${esc(t)}</td>
    </tr>`).join("");
  return `${heading ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.07em;color:${FAINT};">${esc(heading)}</p>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0">${trs}</table>`;
}

/** Numbered next steps (welcome). */
export function numbered(items: Array<{ title: string; sub: string }>): string {
  return items.map((it, i) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${i ? "border-top:1px solid #f0f2f6;" : ""}"><tr>
      <td style="padding:14px 16px 14px 0;width:24px;vertical-align:top;font-family:${FONT};font-size:14px;font-weight:800;color:${BLUE};">${String(i + 1).padStart(2, "0")}</td>
      <td style="padding:14px 0;vertical-align:top;">
        <p style="margin:0;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};">${esc(it.title)}</p>
        <p style="margin:2px 0 0;font-family:${FONT};font-size:13px;color:${MUTED};">${esc(it.sub)}</p>
      </td></tr></table>`).join("");
}

/** Buttons: first is primary; they wrap as whole buttons on narrow screens. */
export function buttons(btns: Array<{ label: string; href: string }>): string {
  return `<div style="font-size:0;line-height:0;">${btns.map((b, i) => `<a href="${esc(b.href)}" style="display:inline-block;margin:0 10px 10px 0;padding:15px ${i ? "22px" : "26px"};border-radius:14px;${i
    ? `border:1px solid #e3e7ee;background:#ffffff;color:#344054;`
    : `background:${BLUE};color:#ffffff;border:1px solid ${BLUE};`}font-family:${FONT};font-size:15px;font-weight:700;line-height:20px;white-space:nowrap;text-decoration:none;">${esc(b.label)}</a>`).join("")}</div>`;
}

export const badge = (text: string, tone: "warn" | "ok" | "info" = "warn") => {
  const c = tone === "warn" ? ["#fffaeb", "#b54708", "#fedf89"] : tone === "ok" ? ["#ecfdf3", "#067647", "#abefc6"] : ["#eef1ff", BLUE, "#d6dbfd"];
  return `<span style="display:inline-block;padding:4px 10px;border-radius:99px;background:${c[0]};border:1px solid ${c[2]};font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:0.06em;color:${c[1]};">${esc(text)}</span>`;
};

// ── Heroes ────────────────────────────────────────────────────────────────────

const markRow = (mark: "blue" | "white", color: string, label: string, labelColor: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;">
      <img src="${ASSET(`sweep-mark-${mark}.png`)}" width="16" height="16" alt="" style="display:inline-block;vertical-align:middle;border:0;" />
      <span style="font-family:${FONT};font-size:16px;font-weight:800;color:${color};vertical-align:middle;padding-left:6px;">Sweep</span>
    </td>
    <td align="right" style="vertical-align:middle;font-family:${FONT};font-size:12px;font-weight:600;color:${labelColor};">${label}</td>
  </tr></table>`;

/** Blue "money in" hero: optional person, big +amount, optional note chip. */
export function blueHero(opts: { label: string; amount: string; person?: { name: string; sub?: string }; note?: string }): string {
  const person = opts.person ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:40px;"><tr>
      <td style="vertical-align:middle;padding-right:12px;">
        <div style="width:44px;height:44px;line-height:44px;border-radius:22px;background:#ffffff;text-align:center;font-family:${FONT};font-size:17px;font-weight:800;color:${BLUE};">${esc(opts.person.name.charAt(0).toUpperCase())}</div>
      </td>
      <td style="vertical-align:middle;">
        <p style="margin:0;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;">${esc(opts.person.name)}</p>
        ${opts.person.sub ? `<p style="margin:0;font-family:${FONT};font-size:13px;color:#c9d0fd;">${esc(opts.person.sub)}</p>` : ""}
      </td></tr></table>` : "";
  return `<tr><td class="sw-pad" style="background:${BLUE};padding:28px 36px 40px;">
    ${markRow("white", "#ffffff", esc(opts.label), "#c9d0fd")}
    ${person}
    <p class="sw-amt" style="margin:${person ? "20px" : "40px"} 0 0;font-family:${FONT};font-size:64px;line-height:1;font-weight:800;letter-spacing:-0.055em;color:#ffffff;">${esc(opts.amount)}</p>
    ${opts.note ? `<p style="margin:16px 0 0;"><span style="display:inline-block;background:#3a4ef7;border-radius:12px;padding:10px 14px;font-family:${FONT};font-size:14px;color:#ffffff;">${esc(opts.note)}</span></p>` : ""}
  </td></tr>`;
}

/** Dark navy hero (welcome / big moments). */
export function darkHero(opts: { heading: string; chipLabel?: string; chipValue?: string }): string {
  return `<tr><td class="sw-pad" style="background:#070b1a;padding:28px 36px 36px;">
    ${markRow("white", "#ffffff", "", FAINT)}
    <p style="margin:48px 0 0;font-family:${FONT};font-size:44px;line-height:1.05;font-weight:800;letter-spacing:-0.05em;color:#ffffff;">${esc(opts.heading)}</p>
    ${opts.chipValue ? `<p style="margin:18px 0 0;"><span style="display:inline-block;border:1px solid #243049;border-radius:10px;padding:8px 12px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.06em;color:${FAINT};">${esc(opts.chipLabel ?? "")}&nbsp;&nbsp;<span style="font-size:14px;letter-spacing:0;color:#ffffff;">${esc(opts.chipValue)}</span></span></p>` : ""}
  </td></tr>`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * Wrap blocks into a full email.
 *  - label:    top-right of the white header ("Security", "Receipt #…", badge()) — trusted HTML
 *  - hero:     optional blueHero()/darkHero() row replacing the white header
 *  - blocks:   body sections, stacked with even spacing
 *  - footer:   raw HTML lines for the grey footer (use esc() for values)
 */
export function emailPage(opts: {
  preheader: string;
  label?: string;
  hero?: string;
  blocks: string[];
  footer?: string[];
  links?: Array<{ label: string; href: string }>;
}): string {
  // label is trusted HTML set in code (plain text or badge()), never user input
  const header = opts.hero ?? `<tr><td class="sw-pad" style="padding:28px 36px 0;">${markRow("blue", INK, opts.label ?? "", FAINT)}</td></tr>`;
  const gap = 22;
  const blocks = opts.blocks.filter(Boolean).map((b, i) => `<div style="${i ? `margin-top:${gap}px;` : ""}">${b}</div>`).join("");
  const links = (opts.links ?? [{ label: "Open Sweep", href: APP_URL }, { label: "Help center", href: `${APP_URL}/docs` }])
    .map((l) => `<a href="${esc(l.href)}" style="color:${MUTED};text-decoration:none;">${esc(l.label)}</a>`).join(" &middot; ");
  const footer = [...(opts.footer ?? []), links].filter(Boolean).join("<br>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <title>Sweep</title>
  <!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet"><!--<![endif]-->
  <style>@media (max-width:600px){.sw-pad{padding-left:22px!important;padding-right:22px!important}.sw-amt{font-size:44px!important}.sw-h1{font-size:26px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f6f7fa;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fa;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:16px;border-collapse:separate;overflow:hidden;">
        ${header}
        <tr><td class="sw-pad" style="padding:${opts.hero ? "32px" : "40px"} 36px 36px;">${blocks}</td></tr>
        <tr><td class="sw-pad" style="padding:22px 36px;border-top:1px solid #f0f2f6;font-family:${FONT};font-size:12px;line-height:1.7;color:${FAINT};">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export const SECURITY_FOOTER = "Sweep will never ask for your code, password or authorization key.";
