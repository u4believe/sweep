import { useEffect } from "react";

/**
 * Loads the self-hosted Umami web-analytics tracker.
 *
 * Stays inert unless BOTH env vars are set, so local dev and preview builds
 * don't pollute your stats. Configure these in Vercel after deploying Umami:
 *   VITE_UMAMI_SRC=https://<your-umami-host>/script.js
 *   VITE_UMAMI_WEBSITE_ID=<id from Umami → Settings → Websites>
 *
 * Runs alongside Vercel Analytics — remove <Analytics /> in App.tsx if you
 * want Umami to be the only tracker.
 */
export function UmamiAnalytics() {
  const src = import.meta.env.VITE_UMAMI_SRC as string | undefined;
  const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;

  useEffect(() => {
    if (!src || !websiteId) return;
    // Don't inject twice (StrictMode remounts, client-side nav, etc.)
    if (document.querySelector(`script[data-website-id="${websiteId}"]`)) return;

    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.setAttribute("data-website-id", websiteId);
    document.head.appendChild(script);
  }, [src, websiteId]);

  return null;
}

export default UmamiAnalytics;
