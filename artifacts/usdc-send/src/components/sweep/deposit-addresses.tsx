import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WITHDRAWAL_CHAINS } from "@/lib/wallet";
import { Card, Chip, OutlineButton, PrimaryButton, Segmented, useCopy } from "./ui";

// Deposit networks in display order — Unichain is withdrawal-only.
const DEPOSIT_KEYS = ["ARC-TESTNET", "BASE-SEPOLIA", "ARB-SEPOLIA", "OP-SEPOLIA", "MATIC-AMOY", "AVAX-FUJI", "SOL-DEVNET"];

export const chainLabel = (key: string) => WITHDRAWAL_CHAINS.find((c) => c.key === key)?.label ?? key;

/** "Add money" body: Crypto (per-network deposit address) / Bank (coming soon).
 *  `inset` renders the address panel grey, for use on a white surface such as a dialog. */
export function AddMoney({ addresses, inset = false }: { addresses: Record<string, string>; inset?: boolean }) {
  const [method,   setMethod]   = useState<"crypto" | "bank">("crypto");
  const [chainKey, setChainKey] = useState<string | null>(null);
  const available = DEPOSIT_KEYS.filter((k) => addresses[k]);
  const active    = chainKey && addresses[chainKey] ? chainKey : available[0];
  const label     = active ? chainLabel(active) : "";
  const address   = active ? addresses[active] : undefined;
  const { copied, copy } = useCopy(2000);

  return (
    <div className="space-y-3">
      <Segmented<"crypto" | "bank"> value={method} onChange={setMethod}
        options={[{ value: "crypto", label: "Crypto" }, { value: "bank", label: "Bank" }]} />
      {method === "bank" ? (
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
              { k: "Send only", v: `USDC on ${label}` },
              { k: "Credited",  v: "After confirmation" },
              { k: "Gas",       v: "Sponsored", ok: true },
            ].map((r, i) => (
              <div key={r.k} className={cn("flex justify-between py-3 text-sm", i < 2 && "border-b border-[#f0f2f6]")}>
                <span className="text-(--sw-muted)">{r.k}</span>
                <span className={cn("font-bold", r.ok && "text-[#067647]")}>{r.v}</span>
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
