import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WITHDRAWAL_CHAINS } from "@/lib/wallet";
import { depositArrival, depositCompletion } from "@/lib/transfer-times";
import { userQrUrl } from "@/lib/pay-qr";
import { Card, Chip, OutlineButton, PrimaryButton, Segmented, useCopy } from "./ui";
import { BrandedQr } from "./qr";

// Deposit networks in display order — Unichain is withdrawal-only.
const DEPOSIT_KEYS = ["ARC-TESTNET", "BASE-SEPOLIA", "ARB-SEPOLIA", "OP-SEPOLIA", "MATIC-AMOY", "AVAX-FUJI", "SOL-DEVNET"];

export const chainLabel = (key: string) => WITHDRAWAL_CHAINS.find((c) => c.key === key)?.label ?? key;

type Method = "sweep" | "crypto" | "bank";

/** "Add money" body: Sweep user (your payment QR) / Crypto (per-network deposit address) / Bank (coming soon).
 *  `inset` renders the address panel grey, for use on a white surface such as a dialog. */
export function AddMoney({ addresses, user, inset = false }: {
  addresses: Record<string, string>;
  /** Shows the "Sweep user" tab: get paid by another Sweep user scanning your code. */
  user?: { name: string; paymentId: string };
  inset?: boolean;
}) {
  const [method,   setMethod]   = useState<Method>(user ? "sweep" : "crypto");
  const [chainKey, setChainKey] = useState<string | null>(null);
  const available = DEPOSIT_KEYS.filter((k) => addresses[k]);
  const active    = chainKey && addresses[chainKey] ? chainKey : available[0];
  const label     = active ? chainLabel(active) : "";
  const address   = active ? addresses[active] : undefined;
  const { copied, copy } = useCopy(2000);
  const arrival    = active ? depositArrival(active) : null;
  const completion = active ? depositCompletion(active) : null;

  return (
    <div className="space-y-3">
      <Segmented<Method> value={method} onChange={setMethod}
        options={[...(user ? [{ value: "sweep" as const, label: "Sweep user" }] : []), { value: "crypto", label: "Crypto" }, { value: "bank", label: "Bank" }]} />
      {method === "sweep" && user ? (
        <SweepUserPanel user={user} inset={inset} />
      ) : method === "bank" ? (
        <Card className="px-5 py-6 flex flex-col gap-2.5">
          <span className="self-start text-[11px] font-bold tracking-[0.04em] text-[#93370d] bg-[#fef0c7] px-2.5 py-[5px] rounded-full">COMING SOON</span>
          <span className="font-extrabold text-[22px] leading-tight tracking-[-0.02em]">Bank wire deposits aren't live yet</span>
          <span className="text-sm text-(--sw-muted) leading-relaxed">You'll get personal wire details and Circle mints USDC when the transfer lands. Fund with crypto for now.</span>
          <OutlineButton onClick={() => setMethod("crypto")} className="mt-1.5 h-[50px] rounded-[14px]">Use crypto instead</OutlineButton>
        </Card>
      ) : !address ? (
        <Card className="px-5 py-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-(--sw-muted)" />
          <p className="text-sm text-(--sw-muted) mt-3">Loading your deposit addresses…</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {available.map((k) => (
              <Chip key={k} active={k === active} onClick={() => setChainKey(k)}>{chainLabel(k)}</Chip>
            ))}
          </div>
          <Card className={cn("px-[18px] py-5 flex flex-col gap-3", inset && "bg-(--sw-bg) border-transparent")}>
            <span className="text-[13px] font-semibold text-(--sw-muted)">Your USDC address on {label}</span>
            <span className="font-bold text-xl leading-snug tracking-[-0.01em] break-all tabular-nums">{address}</span>
            <PrimaryButton onClick={() => copy(address)}
              className={cn("h-[50px] rounded-[14px] text-[15px]", copied && "bg-[#ecfdf3] text-[#067647] hover:bg-[#ecfdf3]")}>
              {copied ? "Copied" : "Copy address"}
            </PrimaryButton>
          </Card>
          <Card className="rounded-[20px] px-[18px] py-1">
            {[
              { k: "Send only",          v: `USDC on ${label}` },
              { k: "Arrival",            v: arrival },
              { k: "Deposit completion", v: completion ?? "After confirmation" },
            ].filter((r) => r.v).map((r, i, rows) => (
              <div key={r.k} className={cn("flex justify-between gap-3 py-3 text-sm", i < rows.length - 1 && "border-b border-[#f0f2f6]")}>
                <span className="text-(--sw-muted)">{r.k}</span>
                <span className="font-bold text-right">{r.v}</span>
              </div>
            ))}
          </Card>
          <p className="text-xs text-(--sw-muted) px-1 leading-relaxed">
            Sending any other token, or USDC on a different network, can't be recovered.
            {active === "SOL-DEVNET" && " Solana uses its own address."}
          </p>
        </>
      )}
    </div>
  );
}

/** Your payment QR: another Sweep user scans it (or types your payment ID) to pay you. */
function SweepUserPanel({ user, inset }: { user: { name: string; paymentId: string }; inset: boolean }) {
  const idCopy   = useCopy(1600);
  const linkCopy = useCopy(1600);
  const link     = userQrUrl(user.paymentId);
  const share = () => {
    if (navigator.share) navigator.share({ title: "Sweep", text: `Pay me on Sweep: ${user.paymentId}`, url: link }).catch(() => {});
    else linkCopy.copy(link);
  };
  const rows = [{ k: "Arrives", v: "Instantly" }, { k: "Fee", v: "Free", ok: true }];

  return (
    <div className="space-y-3">
      <Card className={cn("px-[18px] pt-[22px] pb-[18px] flex flex-col items-center gap-4", inset && "bg-(--sw-bg) border-transparent")}>
        <span className="flex flex-col items-center gap-0.5 text-center">
          <span className="font-extrabold text-[17px] tracking-[-0.01em]">Get paid by any Sweep user</span>
          <span className="text-[13px] text-(--sw-muted)">They scan this in the Sweep app to send to you</span>
        </span>
        <BrandedQr value={link} label={`Payment QR code for ${user.paymentId}`} className="w-[220px]" />
        <span className="flex flex-col items-center gap-0.5 min-w-0 max-w-full">
          <span className="text-[11px] font-bold tracking-[0.06em] text-[#98a2b3]">PAYMENT ID</span>
          <span className="font-extrabold text-[17px] truncate max-w-full">{user.paymentId}</span>
        </span>
        <div className="w-full grid grid-cols-2 gap-2">
          <OutlineButton onClick={() => idCopy.copy(user.paymentId)} className="h-[50px] rounded-[14px] text-[15px]">
            {idCopy.copied ? "Copied" : "Copy ID"}
          </OutlineButton>
          <PrimaryButton onClick={share} className="h-[50px] rounded-[14px] text-[15px]">
            {linkCopy.copied ? "Link copied" : "Share"}
          </PrimaryButton>
        </div>
      </Card>
      <Card className="rounded-[20px] px-[18px] py-1">
        {rows.map((r, i) => (
          <div key={r.k} className={cn("flex justify-between py-3 text-sm", i < rows.length - 1 && "border-b border-[#f0f2f6]")}>
            <span className="text-(--sw-muted)">{r.k}</span>
            <span className={cn("font-bold", r.ok && "text-[#067647]")}>{r.v}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
