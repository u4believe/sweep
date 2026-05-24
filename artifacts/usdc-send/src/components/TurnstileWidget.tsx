import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render:  (container: HTMLElement, params: Record<string, unknown>) => string;
      reset:   (widgetId: string) => void;
      remove:  (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

interface Props {
  onVerify:  (token: string) => void;
  onExpire?: () => void;
  onError?:  () => void;
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export function TurnstileWidget({ onVerify, onExpire, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId     = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return; // not configured — skip in dev

    function render() {
      if (!containerRef.current || widgetId.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey:           SITE_KEY,
        callback:          onVerify,
        "expired-callback": onExpire,
        "error-callback":   onError,
        theme:             "light",
        size:              "normal",
      });
    }

    const scriptId = "cf-turnstile-script";
    if (!document.getElementById(scriptId)) {
      window.onTurnstileLoad = render;
      const script   = document.createElement("script");
      script.id      = scriptId;
      script.src     = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      script.async   = true;
      script.defer   = true;
      document.head.appendChild(script);
    } else {
      render();
    }

    return () => {
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, []);  // intentionally stable — callbacks are closures updated by parent re-renders

  if (!SITE_KEY) return null;
  return <div ref={containerRef} className="flex justify-center mt-1" />;
}
