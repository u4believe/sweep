import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/** Single field for a 6-digit authenticator-app code. */
export const TotpInput = forwardRef<HTMLInputElement, {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}>(function TotpInput({ id, value, onChange, disabled, className }, ref) {
  return (
    <input
      ref={ref}
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      disabled={disabled}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      placeholder="000000"
      className={cn(
        "w-full px-4 py-3 rounded-xl bg-white border-2 border-border text-center text-2xl font-bold tracking-[0.5em] tabular-nums focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none placeholder:text-muted-foreground/40 disabled:opacity-60",
        className,
      )}
    />
  );
});
