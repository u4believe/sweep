import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/api";

// Google Identity Services — renders Google's own button. Hidden entirely until
// the server has a GOOGLE_CLIENT_ID configured.

declare global {
  interface Window {
    google?: { accounts: { id: {
      initialize: (opts: Record<string, unknown>) => void;
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
    } } };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";
let gsiLoading: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gsiLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gsiLoading = null; reject(new Error("Couldn't load Google sign-in")); };
    document.head.appendChild(s);
  });
  return gsiLoading;
}

export type GoogleAuthResult =
  | { kind: "session"; token: string; isNewUser: boolean }
  | { kind: "two-factor"; challenge: string };

export function useAuthConfig() {
  return useQuery({
    queryKey: ["/api/auth/config"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/auth/config`);
      if (!res.ok) return { googleClientId: null as string | null, totpAvailable: false };
      return res.json() as Promise<{ googleClientId: string | null; totpAvailable: boolean }>;
    },
  });
}

/** Exchanges a Google credential for a Sweep session (or a 2FA challenge). */
async function exchangeCredential(credential: string): Promise<GoogleAuthResult> {
  const res = await fetch(`${API_BASE}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? "Google sign-in failed");
  if (json.requiresTotp) return { kind: "two-factor", challenge: json.challenge };
  return { kind: "session", token: json.token, isNewUser: !!json.isNewUser };
}

export function GoogleSignInButton({ text = "continue_with", onResult, onError }: {
  text?: "signin_with" | "signup_with" | "continue_with";
  onResult: (r: GoogleAuthResult) => void;
  onError: (message: string) => void;
}) {
  const { data: config } = useAuthConfig();
  const clientId = config?.googleClientId;
  const holder = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  // Keep the latest callbacks without re-initialising Google on every render.
  const cb = useRef({ onResult, onError });
  cb.current = { onResult, onError };

  useEffect(() => {
    if (!clientId || !holder.current) return;
    let cancelled = false;
    loadGsi().then(() => {
      if (cancelled || !holder.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: "popup",
        callback: async ({ credential }: { credential: string }) => {
          setBusy(true);
          try { cb.current.onResult(await exchangeCredential(credential)); }
          catch (e: any) { cb.current.onError(e?.message ?? "Google sign-in failed"); }
          finally { setBusy(false); }
        },
      });
      window.google.accounts.id.renderButton(holder.current, {
        type: "standard", theme: "outline", size: "large", shape: "pill", text,
        width: Math.min(holder.current.offsetWidth || 360, 400),
      });
    }).catch((e) => cb.current.onError(e.message));
    return () => { cancelled = true; };
  }, [clientId, text]);

  if (!clientId) return null;
  return (
    <div className="space-y-4">
      <div className="relative">
        <div ref={holder} className="flex justify-center min-h-[44px]" />
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-white/80 rounded-full">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or use your email <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
