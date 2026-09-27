import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: string | number) {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}


/**
 * For inputs that take a secret other than the login password (transaction
 * password, authorization key). Browsers ignore autocomplete="off" on password
 * fields and fill the saved login password; "new-password" stops that, and the
 * data-* flags opt out of 1Password, LastPass and Bitwarden.
 */
export const secretInputProps = {
  autoComplete: "new-password",
  autoCorrect: "off",
  autoCapitalize: "none",
  spellCheck: false,
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

/** Same, for secrets typed into a plain text field (e.g. the 40-character key). */
export const secretTextProps = { ...secretInputProps, autoComplete: "off" } as const;
