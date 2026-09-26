import type { ReactNode } from "react";
import { Link } from "wouter";
import { CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// v4 auth layout shared by log in, sign up and forgot password: a brand-blue panel
// with a white form sheet — stacked on phones, split screen on desktop.

export const authField =
  "h-[54px] w-full rounded-[14px] border border-(--sw-field-line) bg-(--sw-bg) px-4 text-[15px] font-medium text-(--sw-ink) outline-none placeholder:text-[#9aa4b5] focus:border-(--sw-blue) focus:bg-white transition-colors disabled:opacity-60";

export const authPrimary =
  "h-14 w-full rounded-2xl bg-(--sw-blue) text-white text-base font-bold flex items-center justify-center gap-2 hover:bg-(--sw-blue-hover) active:scale-[.98] transition disabled:bg-[#c5ccd8] disabled:cursor-not-allowed disabled:active:scale-100";

/** Classes that restyle <TotpInput> to match authField. */
export const authCodeField =
  "h-[54px] rounded-[14px] border border-(--sw-field-line) bg-(--sw-bg) focus:border-(--sw-blue) focus:bg-white focus:ring-0";

export function AuthShell({
  children,
  kicker = "TESTNET · POWERED BY CIRCLE",
  headline = "Send dollars to any email.",
  sub = "No wallet, no seed phrase, no gas. Backed 1:1 by USDC.",
}: {
  children: ReactNode;
  kicker?: string;
  headline?: string;
  sub?: string;
}) {
  return (
    <div className="sweep-ui min-h-[100dvh] flex flex-col lg:grid lg:grid-cols-2">
      <section aria-label="Sweep" className="relative flex-1 lg:flex-none bg-(--sw-blue) text-white px-6 sm:px-10 lg:px-14 pt-10 pb-12 lg:py-12 flex flex-col justify-between gap-12 overflow-hidden min-h-[300px]">
        <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute -right-16 -bottom-24 w-[420px] opacity-[.07] pointer-events-none hidden lg:block" />
        <Link href="/landing" className="relative flex items-center gap-2.5 self-start" aria-label="Sweep home">
          <img src="/sweep-mark-white.svg" alt="" className="w-6" />
          <span className="font-extrabold text-xl tracking-[-0.02em]">Sweep</span>
        </Link>
        <div className="relative flex flex-col gap-3 max-w-[520px]">
          <span className="text-xs font-semibold tracking-[0.04em] opacity-80">{kicker}</span>
          <h2 className="font-extrabold text-[42px] lg:text-[64px] leading-[1.04] tracking-[-0.035em]">{headline}</h2>
          <p className="text-[15px] lg:text-lg leading-relaxed opacity-85 max-w-[340px] lg:max-w-[420px]">{sub}</p>
        </div>
      </section>

      <main className="relative -mt-5 lg:mt-0 bg-white rounded-t-3xl lg:rounded-none px-5 sm:px-10 pt-6 pb-8 lg:px-14 lg:py-12 flex flex-col lg:justify-center">
        <div className="w-full max-w-[460px] mx-auto flex flex-col gap-3">{children}</div>
      </main>
    </div>
  );
}

/** Field style for the night layout: white fields on the light form panel. */
export const nightField =
  "h-[54px] w-full rounded-[14px] border border-(--sw-field-line) bg-white px-4 text-[15px] font-medium text-(--sw-ink) outline-none placeholder:text-[#9aa4b5] focus:border-(--sw-blue) focus:shadow-[0_0_0_4px_rgb(17_40_245/.1)] transition disabled:opacity-60";

/**
 * v5 log-in layout: a navy panel (faint grid, blue glow) with the pitch and a sample
 * "Swept" receipt, beside a light form panel. Stacked on phones.
 */
export function NightAuthShell({ children, footer, hero }: {
  children: ReactNode;
  footer?: ReactNode;
  /** Replaces the default log-in pitch in the navy panel. */
  hero?: ReactNode;
}) {
  return (
    <div className="sweep-ui min-h-[100dvh] grid grid-cols-1 lg:grid-cols-2">
      <section aria-label="Sweep" className="relative overflow-hidden bg-(--sw-navy) text-white px-6 sm:px-12 pt-9 pb-10 lg:py-9 flex flex-col justify-between gap-10 lg:min-h-[100dvh]">
        <div aria-hidden className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgb(255_255_255/.045)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/.045)_1px,transparent_1px)] bg-[size:56px_56px]" />
        <div aria-hidden className="absolute -left-[200px] -bottom-[300px] w-[900px] h-[700px] pointer-events-none bg-[radial-gradient(closest-side,rgb(17_40_245/.5),transparent)]" />
        <Link href="/landing" className="relative flex items-center gap-2.5 self-start" aria-label="Sweep home">
          <img src="/sweep-mark-white.svg" alt="" className="w-[22px]" />
          <span className="font-extrabold text-xl tracking-[-0.02em]">Sweep</span>
        </Link>
        {hero ?? (
          <div className="relative flex flex-col gap-[18px] max-w-[480px]">
            <h2 className="font-extrabold text-[40px] sm:text-[48px] lg:text-[clamp(40px,4.6vw,64px)] leading-none tracking-[-0.05em]">Money that moves like email.</h2>
            <p className="text-[17px] leading-[1.55] text-(--sw-on-navy)">
              Log in to send by payment ID, withdraw USDC to eight networks, and manage recurring payments.
            </p>
            <div aria-hidden className="mt-2.5 bg-white text-(--sw-ink) rounded-[18px] px-4 py-3.5 flex items-center gap-3 max-w-[320px]">
              <span className="w-10 h-10 rounded-xl bg-(--sw-blue) grid place-items-center shrink-0">
                <img src="/sweep-mark-white.svg" alt="" className="w-[15px]" />
              </span>
              <span className="flex flex-col min-w-0">
                <span className="font-extrabold text-[15px]">Swept. $25.00</span>
                <span className="text-xs text-(--sw-muted) truncate">to tunde@example.com · now</span>
              </span>
            </div>
          </div>
        )}
        <span className="relative text-[13px] text-(--sw-faint)">Testnet · USDC by Circle · Gas sponsored</span>
      </section>

      <main className="bg-(--sw-bg) flex items-center justify-center px-5 sm:px-7 py-10 lg:py-12">
        <div className="w-full max-w-[400px] flex flex-col gap-[22px]">
          {children}
          {footer && <p className="text-xs text-(--sw-faint) text-center border-t border-(--sw-line) pt-[18px]">{footer}</p>}
        </div>
      </main>
    </div>
  );
}

export function NightTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-extrabold text-[32px] tracking-[-0.04em] leading-tight">{title}</h1>
      {sub && <p className="text-[15px] text-(--sw-muted) leading-normal">{sub}</p>}
    </div>
  );
}

export function AuthTitle({ children }: { children: ReactNode }) {
  return <h1 className="font-extrabold text-2xl tracking-[-0.02em]">{children}</h1>;
}

export function AuthNotice({ tone, children }: { tone: "ok" | "warn" | "bad"; children: ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"}
      className={cn("flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium",
        tone === "ok" ? "bg-[#ecfdf3] text-[#067647]" : tone === "warn" ? "bg-[#fffaeb] text-[#b54708]" : "bg-[#fef3f2] text-[#b42318]")}>
      {tone === "ok" ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <Info className="w-4 h-4 shrink-0 mt-0.5" />}
      <span>{children}</span>
    </div>
  );
}

export function AuthError({ message }: { message: string }) {
  if (!message) return null;
  return <div role="alert" className="rounded-2xl bg-[#fef3f2] text-[#b42318] px-4 py-3 text-sm font-medium">{message}</div>;
}

export function AuthBackLink({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  const cls = "self-center text-sm font-semibold text-(--sw-muted) hover:text-(--sw-ink)";
  return href
    ? <Link href={href} className={cls}>{children}</Link>
    : <button type="button" onClick={onClick} className={cls}>{children}</button>;
}
