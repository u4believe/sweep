import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { Checkout, type PlanInfo } from "@/components/subscriptions/checkout";

// Hosted checkout for a plan's link / QR code: /subscribe/:merchantId
export default function SubscribePage() {
  const { merchantId = "" } = useParams<{ merchantId: string }>();
  const [plan,  setPlan]  = useState<PlanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!merchantId) return;
    setPlan(null); setError(null);
    fetch(`${API_BASE}/api/subscriptions/merchant/${encodeURIComponent(merchantId)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message ?? "Plan not found");
        setPlan(json);
      })
      .catch((e: any) => setError(e?.message ?? "Could not load plan"));
  }, [merchantId]);

  if (plan) return <Checkout merchantId={merchantId} plan={plan} variant="page" />;

  return (
    <div className="sweep-ui min-h-[100dvh] grid place-items-center px-5">
      {error ? (
        <div className="max-w-sm text-center flex flex-col items-center gap-3">
          <img src="/sweep-mark-blue.svg" alt="" className="w-7" />
          <h1 className="font-extrabold text-2xl tracking-[-0.03em]">Checkout not found</h1>
          <p className="text-[15px] text-(--sw-muted)">{error}. Check the link or Merchant ID with the creator.</p>
          <Link href="/" className="mt-2 h-12 px-6 rounded-2xl bg-(--sw-blue) text-white font-bold grid place-items-center">Go to Sweep</Link>
        </div>
      ) : (
        <span className="flex items-center gap-2.5 text-sm text-(--sw-muted)"><Loader2 className="w-5 h-5 animate-spin" /> Loading checkout…</span>
      )}
    </div>
  );
}
