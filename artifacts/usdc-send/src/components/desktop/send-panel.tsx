import { ChevronLeft, Loader2 } from "lucide-react";
import { OutlineButton, PrimaryButton, Segmented, SummaryRows, fmtUsd } from "@/components/sweep/ui";
import {
  AmountInput, ErrorLine, RecipientFields, ResultRows, ReviewCard, SendHint, SentHero, TxPasswordField, UnregisteredNote,
} from "@/components/sweep/send-parts";
import { useSendFlow, type SendFlowOptions, type SendMode } from "@/components/sweep/use-send-flow";

/** The web dashboard's "Sweep money" panel: form → review → sent, all in place. */
export function SendPanel({ contacts, circleWallet, onViewHistory, ...opts }: SendFlowOptions & {
  contacts: string[];
  circleWallet?: string;
  onViewHistory: () => void;
}) {
  const flow = useSendFlow(opts);

  if (flow.step === "sent" && flow.result) {
    return (
      <div className="-m-6 rounded-[26px] overflow-hidden flex flex-col">
        <SentHero flow={flow} className="px-[26px] pt-10 pb-9 min-h-[300px]" />
        <div className="px-6 pt-4 pb-6">
          <ResultRows flow={flow} />
          <div className="grid grid-cols-2 gap-2.5 mt-4">
            <OutlineButton onClick={flow.reset} className="h-[50px] rounded-[14px]">Send again</OutlineButton>
            <PrimaryButton onClick={flow.reset} className="h-[50px] rounded-[14px] text-[15px]">Done</PrimaryButton>
          </div>
          <button type="button" onClick={() => { flow.reset(); onViewHistory(); }}
            className="mt-3 w-full text-center text-[13px] font-bold text-(--sw-blue)">
            View history
          </button>
        </div>
      </div>
    );
  }

  if (flow.step === "review") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={flow.backToForm} aria-label="Back to form"
            className="w-9 h-9 rounded-xl border border-(--sw-line) grid place-items-center hover:bg-(--sw-bg)">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="font-extrabold text-xl tracking-[-0.02em]">Review & send</h2>
        </div>
        <ReviewCard flow={flow} className="border-0 px-0 pt-2" />
        <UnregisteredNote flow={flow} />
        {opts.hasTransactionPassword && <TxPasswordField flow={flow} id="d-txpwd" />}
        {flow.error && <ErrorLine message={flow.error} />}
        <PrimaryButton onClick={flow.send} disabled={flow.busy || flow.pwdMissing} className="h-[54px]">
          {flow.busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Sweeping…</> : `Sweep ${fmtUsd(flow.a)}`}
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-extrabold text-xl tracking-[-0.02em]">Sweep money</h2>
      <Segmented<SendMode> value={flow.mode} onChange={flow.setMode}
        options={[{ value: "usd", label: "Email · USD" }, { value: "usdc", label: "Wallet · USDC" }]} />
      <div className="pt-2.5 pb-1">
        <AmountInput flow={flow} available={opts.available} size="md" id="d-amount" />
      </div>
      <RecipientFields flow={flow} contacts={contacts} circleWallet={circleWallet} idPrefix="d" />
      <SummaryRows rows={flow.summary} className="border-t border-dashed border-(--sw-field-line) pt-1.5" />
      {flow.error && <ErrorLine message={flow.error} />}
      <div className="space-y-2">
        <SendHint flow={flow} />
        <PrimaryButton onClick={flow.goReview} disabled={!!flow.err || flow.busy} className="h-[54px]">
          {flow.busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Checking recipient…</> : flow.a ? `Review ${fmtUsd(flow.a)}` : "Review"}
        </PrimaryButton>
      </div>
    </div>
  );
}
