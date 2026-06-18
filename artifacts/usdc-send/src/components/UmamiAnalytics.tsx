import { useEffect } from "react";

/**
 * Loads the self-hosted Umami web-analytics tracker.
 *
 * Stays inert unless VITE_UMAMI_SRC and VITE_UMAMI_WEBSITE_ID are both set, so
 * local dev and preview builds don't pollute your stats.
 *
 * ── First-party mode (recommended — dodges ad-blockers) ──────────────────────
 * Proxy Umami through your own domain with the /stats rewrite in vercel.json,
 * then point the tracker at the first-party path:
 *   VITE_UMAMI_SRC=/stats/script.js
 *   VITE_UMAMI_WEBSITE_ID=<id from Umami → Settings → Websites>
 * Events are auto-sent first-party to "<your-origin>/stats". Override that base
 * with VITE_UMAMI_HOST_URL only if your proxy path differs from /stats.
 *
 * ── Direct mode (simpler, but ad-blockable) ──────────────────────────────────
 *   VITE_UMAMI_SRC=https://<umami-host>/script.js   (leave HOST_URL unset)
 */
export function UmamiAnalytics() {
  const src = import.meta.env.VITE_UMAMI_SRC as string | undefined;
  const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;
  const hostUrl = import.meta.env.VITE_UMAMI_HOST_URL as string | undefined;

  useEffect(() => {
    if (!src || !websiteId) return;
    // Don't inject twice (StrictMode remounts, client-side nav, etc.)
    if (document.querySelector(`script[data-website-id="${websiteId}"]`)) return;

    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.setAttribute("data-website-id", websiteId);

    // When Umami is proxied first-party under /stats, the tracker would
    // otherwise post events to the page-origin root (/api/send), which the SPA
    // rewrite swallows. Point it at the proxy base so events stay first-party.
    // Default to "<origin>/stats" so the domain need not be baked in at build.
    if (hostUrl) {
      script.setAttribute("data-host-url", hostUrl);
    } else if (src.startsWith("/stats")) {
      script.setAttribute("data-host-url", `${window.location.origin}/stats`);
    }

    document.head.appendChild(script);
  }, [src, websiteId, hostUrl]);

  return null;
}

export default UmamiAnalytics;
