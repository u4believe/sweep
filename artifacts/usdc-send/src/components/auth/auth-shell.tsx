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
