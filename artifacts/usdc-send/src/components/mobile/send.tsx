import { useEffect } from "react";
import { Loader2, ScanLine } from "lucide-react";
import { Card, OutlineButton, PrimaryButton, ScreenHeader, Segmented, SummaryRows, fmtUsd } from "@/components/sweep/ui";
import {
  AmountInput, ErrorLine, RecipientFields, ResultRows, ReviewCard, SendHint, SentHero, TxPasswordField, UnregisteredNote,
} from "@/components/sweep/send-parts";
import { useSendFlow, type SendFlowOptions, type SendMode, type SendStep } from "@/components/sweep/use-send-flow";

export function MobileSend({ contacts, circleWallet, onDone, onStepChange, onScan, ...opts }: SendFlowOptions & {
  contacts: string[];
  circleWallet?: string;
  onDone: () => void;
  onStepChange: (step: SendStep) => void;
  onScan: () => void;
}) {
  const flow = useSendFlow(opts);

  useEffect(() => { onStepChange(flow.step); }, [flow.step]);
  // A scanned recipient still needs an amount
  useEffect(() => { if (opts.prefillTo) setTimeout(() => document.getElementById("m-amount")?.focus(), 250); }, [opts.prefillTo?.n]);

  // ── Sent ────────────────────────────────────────────────────────────────────
  if (flow.step === "sent" && flow.result) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <SentHero flow={flow} size="lg" className="flex-1 px-6 pt-16 pb-11" />
        <div className="bg-white rounded-t-3xl -mt-5 relative px-5 pt-3.5 pb-6">
          <ResultRows flow={flow} />
          <div className="grid grid-cols-2 gap-2.5 mt-4">
            <OutlineButton onClick={flow.reset} className="h-[54px]">Send again</OutlineButton>
            <PrimaryButton onClick={() => { flow.reset(); onDone(); }} className="h-[54px] text-[15px]">Done</PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  // ── Review ──────────────────────────────────────────────────────────────────
  if (flow.step === "review") {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <ScreenHeader title="Review & send" onBack={flow.backToForm} />
        <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-2 pb-4 space-y-3">
          <ReviewCard flow={flow} />
          <UnregisteredNote flow={flow} />
          {opts.hasTransactionPassword && (
            <Card className="rounded-[20px] p-4"><TxPasswordField flow={flow} id="m-txpwd" /></Card>
          )}
          {flow.error && <ErrorLine message={flow.error} />}
        </div>
        <div className="px-4 pt-2.5 pb-3">
          <PrimaryButton onClick={flow.send} disabled={flow.busy || flow.pwdMissing}>
            {flow.busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Sweeping…</> : `Sweep ${fmtUsd(flow.a)}`}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title="Send money" right={
        <button type="button" onClick={onScan}
          className="h-10 px-3.5 rounded-xl border border-(--sw-line) bg-white flex items-center gap-1.5 text-[13px] font-bold text-(--sw-blue) hover:bg-(--sw-tint)">
          <ScanLine className="w-4 h-4" /> Scan
        </button>
      } />
      <div className="px-4">
        <Segmented<SendMode> value={flow.mode} onChange={flow.setMode}
          options={[{ value: "usd", label: "Email · USD" }, { value: "usdc", label: "Wallet · USDC" }]} />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-4">
        <div className="pt-6 pb-5">
          <AmountInput flow={flow} available={opts.available} id="m-amount" />
        </div>
        <Card className="rounded-[20px] p-4 space-y-3">
          <RecipientFields flow={flow} contacts={contacts} circleWallet={circleWallet} idPrefix="m" />
          <SummaryRows rows={flow.summary} className="border-t border-[#f0f2f6] pt-1" />
        </Card>
        {flow.error && <div className="mt-3"><ErrorLine message={flow.error} /></div>}
      </div>
      <div className="px-4 pt-2.5 pb-3 space-y-1.5">
        <SendHint flow={flow} />
        <PrimaryButton onClick={flow.goReview} disabled={!!flow.err || flow.busy}>
          {flow.busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Checking recipient…</> : flow.a ? `Review ${fmtUsd(flow.a)}` : "Review"}
        </PrimaryButton>
      </div>
    </div>
  );
}
