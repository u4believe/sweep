import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { History, Repeat, ScanLine, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FullBalance, UnifiedTx } from "@/lib/wallet";
import {
  ActivityList, Card, CopyIcon, MenuGroup, OutlineButton, ScreenHeader, Segmented, fmtUsd, historyFilter, useHiddenBalance,
  type HistoryFilter,
} from "@/components/sweep/ui";
import { AddMoney } from "@/components/sweep/deposit-addresses";
import { useDashboardData, type HistoryState } from "@/components/sweep/use-dashboard-data";
import type { SendStep } from "@/components/sweep/use-send-flow";
import type { DashboardShellProps } from "@/components/sweep/types";
import { MobileSend } from "./send";
import { usePayQr } from "@/components/sweep/qr";
import { SubscriptionsSection } from "@/components/subscriptions/subscriptions-section";
import { RecurringSection } from "@/components/recurring/recurring-section";

type Screen = "home" | "history" | "send" | "fund" | "me" | "recurring" | "subs" | "settings" | "support";
type Tab = "home" | "send" | "fund" | "me";

const TAB_OF: Record<Screen, Tab> = {
  home: "home", history: "home", send: "send", fund: "fund",
  me: "me", recurring: "me", subs: "me", settings: "me", support: "me",
};

type MobileDashboardProps = DashboardShellProps;

export function MobileDashboard({ user, balance, depositAddresses, withdraw, onBalanceChanged, onLogout, slots, initialPayTo }: MobileDashboardProps) {
  const [screen,   setScreen]   = useState<Screen>(initialPayTo ? "send" : "home");
  const [backTo,   setBackTo]   = useState<Screen>("home");
  const [sendStep, setSendStep] = useState<SendStep>("form");
  const [payTo,    setPayTo]    = useState(initialPayTo ? { id: initialPayTo, n: 1 } : null);

  const qr = usePayQr({
    name: user.name, paymentId: user.email,
    onPayUser: (id) => { setPayTo({ id, n: Date.now() }); setScreen("send"); },
  });

  const go = (next: Screen, from?: Screen) => {
    if (from) setBackTo(from);
    setScreen(next);
  };

  const { history, txs, recurringActive, subsActive, refreshCounts, contacts } = useDashboardData();

  // The reused desktop tabs manage their own data, so refresh the counts when coming back.
  useEffect(() => {
    if (screen === "home" || screen === "me") refreshCounts();
  }, [screen]);

  const available = parseFloat(balance?.claimedBalance ?? "0") || 0;
  const showTabs  = !(screen === "send" && sendStep !== "form");

  const tabs: Array<[Tab, string]> = [["home", "Home"], ["send", "Sweep"], ["fund", "Add"], ["me", "Me"]];

  return (
    <div className="sweep-ui h-[100dvh] flex flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={screen}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
          className="flex-1 flex flex-col min-h-0">

          {screen === "home" && (
            <HomeScreen
              user={user} balance={balance}
              txs={txs.slice(0, 5)} historyState={history}
              go={(s) => go(s, "home")} onScan={qr.openScan}
            />
          )}

          {screen === "history" && (
            <HistoryScreen
              txs={txs} onBack={() => setScreen(backTo)}
              hasMore={!!history.hasNextPage} loadingMore={history.isFetchingNextPage}
              onLoadMore={() => history.fetchNextPage()} state={history}
            />
          )}

          {screen === "send" && (
            <MobileSend
              available={available}
              userEmail={user.email}
              hasTransactionPassword={user.hasTransactionPassword}
              circleWallet={user.circleWalletAddress ?? undefined}
              contacts={contacts}
              withdraw={withdraw}
              onSent={onBalanceChanged}
              onDone={() => setScreen("home")}
              onStepChange={setSendStep}
              onScan={qr.openScan}
              prefillTo={payTo}
            />
          )}

          {screen === "fund" && <FundScreen addresses={depositAddresses} />}

          {screen === "me" && (
            <MeScreen
              user={user} recurringActive={recurringActive} subsActive={subsActive}
              go={(s) => go(s, "me")} onLogout={onLogout} onMyQr={qr.openMyQr}
            />
          )}

          {screen === "recurring" && (
            <SubScreen title="Recurring transfers" onBack={() => setScreen(backTo)} bare>
              <RecurringSection userEmail={user.email} available={available} hasTransactionPassword={user.hasTransactionPassword} />
            </SubScreen>
          )}

          {screen === "subs" && (
            <SubScreen title="Subscriptions" onBack={() => setScreen(backTo)} bare>
              <SubscriptionsSection user={user} available={available} onScan={qr.openScan} onAddMoney={() => setScreen("fund")} />
            </SubScreen>
          )}

          {screen === "settings" && <SubScreen title="Settings" onBack={() => setScreen("me")}>{slots.settings}</SubScreen>}
          {screen === "support"  && <SubScreen title="Support"  onBack={() => setScreen("me")} bare>{slots.support}</SubScreen>}
        </motion.div>
      </AnimatePresence>

      {qr.dialogs}

      {showTabs && (
        <nav aria-label="Main" className="flex-none grid grid-cols-4 gap-1.5 px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom),14px)] bg-white border-t border-(--sw-line)">
          {tabs.map(([t, label]) => {
            const active = TAB_OF[screen] === t;
            return (
              <button key={t} type="button" onClick={() => setScreen(t)} aria-current={active ? "page" : undefined}
                className={cn("py-2.5 rounded-xl text-[13px] font-bold transition-colors",
                  active ? "bg-(--sw-tint) text-(--sw-blue)" : "text-(--sw-muted)")}>
                {label}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────────

function HomeScreen({ user, balance, txs, historyState, go, onScan }: {
  user: MobileDashboardProps["user"];
  balance: FullBalance | undefined;
  txs: UnifiedTx[];
  historyState: HistoryState;
  go: (s: Screen) => void;
  onScan: () => void;
}) {
  const { hidden: hide, toggle: toggleHide } = useHiddenBalance();

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const total    = balance?.usdBalance ?? "0";

  const actions: Array<{ label: string; icon: ReactNode; onClick: () => void }> = [
    { label: "Sweep",     icon: <img src="/sweep-mark-blue.svg" alt="" className="w-[22px]" />, onClick: () => go("send") },
    { label: "Scan",      icon: <ScanLine className="w-[22px] h-[22px]" />, onClick: onScan },
    { label: "Recurring", icon: <Repeat className="w-[22px] h-[22px]" />,   onClick: () => go("recurring") },
    { label: "History",   icon: <History className="w-[22px] h-[22px]" />,  onClick: () => go("history") },
  ];

  return (
    <div className="flex-1 overflow-y-auto min-h-0 pb-5">
      <div className="flex items-center gap-3 px-5 pt-[18px] pb-[22px]">
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-[13px] text-(--sw-muted) font-medium">{greeting}</span>
          <span className="font-extrabold text-lg tracking-[-0.02em] truncate">{user.name}</span>
        </div>
        <span className="text-[11px] font-bold tracking-[0.04em] text-(--sw-blue) border border-[#c9d0fd] px-2.5 py-[5px] rounded-full">TESTNET</span>
      </div>

      <div className="mx-4 rounded-3xl px-[22px] pt-[22px] pb-[18px] text-white bg-(--sw-blue) relative overflow-hidden">
        <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute -right-6 -bottom-10 w-44 opacity-[.07] pointer-events-none" />
        <div className="flex items-center justify-between text-[13px] font-medium relative">
          <span className="opacity-80">Total balance · USDC</span>
          <button type="button" onClick={toggleHide} className="text-xs font-bold opacity-80 hover:opacity-100">
            {hide ? "Show" : "Hide"}
          </button>
        </div>
        <div className="font-extrabold text-[44px] tracking-[-0.04em] leading-[1.1] mt-1.5 mb-5 tabular-nums relative">
          {hide ? "$ ••••••" : fmtUsd(total)}
        </div>
        <div className="grid grid-cols-2 gap-2.5 relative">
          <button type="button" onClick={() => go("send")}
            className="h-12 rounded-[14px] bg-white text-(--sw-blue) text-[15px] font-bold flex items-center justify-center gap-2 hover:bg-(--sw-tint) active:scale-[.98] transition">
            <Send className="w-[18px] h-[18px]" /> Sweep
          </button>
          <button type="button" onClick={() => go("fund")}
            className="h-12 rounded-[14px] border border-white/35 text-white text-[15px] font-bold hover:bg-white/10 active:scale-[.98] transition">
            Add money
          </button>
        </div>
      </div>

      <div className="mx-4 mt-2.5 px-4 py-3 bg-white border border-(--sw-line) rounded-2xl flex items-center gap-2.5">
        <span className="text-[13px] font-semibold text-(--sw-muted) whitespace-nowrap">Payment ID</span>
        <span className="flex-1 min-w-0 text-sm font-bold truncate text-right">{user.email}</span>
        <CopyIcon text={user.email} label="Copy payment ID" />
      </div>

      <nav aria-label="Quick actions" className="grid grid-cols-4 gap-2 px-4 pt-4">
        {actions.map((a) => (
          <button key={a.label} type="button" onClick={a.onClick} className="flex flex-col items-center gap-2 group">
            <span className="w-[52px] h-[52px] rounded-2xl bg-white border border-(--sw-line) text-(--sw-blue) grid place-items-center group-hover:border-[#c9d0fd] group-active:scale-95 transition">
              {a.icon}
            </span>
            <span className="text-xs font-semibold text-(--sw-label)">{a.label}</span>
          </button>
        ))}
      </nav>

      <Card className="mx-4 mt-3 py-1.5">
        <div className="flex items-center justify-between px-[18px] pt-3 pb-1.5">
          <span className="font-extrabold text-base tracking-[-0.01em]">Recent activity</span>
          <button type="button" onClick={() => go("history")} className="text-[13px] font-bold text-(--sw-blue)">See all</button>
        </div>
        <ActivityList txs={txs} state={historyState} />
      </Card>
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

function HistoryScreen({ txs, onBack, hasMore, loadingMore, onLoadMore, state }: {
  txs: UnifiedTx[];
  onBack: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  state: HistoryState;
}) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const shown = txs.filter(historyFilter(filter));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title="History" onBack={onBack} />
      <div className="px-4 pt-1 pb-3">
        <Segmented<HistoryFilter> value={filter} onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "email", label: "Email" }, { value: "in", label: "In" }, { value: "out", label: "Out" }]} />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-5 space-y-3">
        <Card className="py-1.5">
          {filter !== "all" && !shown.length && txs.length ? (
            <p className="px-[18px] py-8 text-center text-sm text-(--sw-muted)">
              Nothing here in the {txs.length} most recent items{hasMore ? " — load more to look further back" : ""}.
            </p>
          ) : (
            <ActivityList txs={shown} state={state} expandable />
          )}
        </Card>
        {hasMore && (
          <OutlineButton onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </OutlineButton>
        )}
      </div>
    </div>
  );
}

// ── Add money ─────────────────────────────────────────────────────────────────

function FundScreen({ addresses }: { addresses: Record<string, string> }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title="Add money" />
      <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-5">
        <AddMoney addresses={addresses} />
      </div>
    </div>
  );
}

// ── Me ────────────────────────────────────────────────────────────────────────

function MeScreen({ user, recurringActive, subsActive, go, onLogout, onMyQr }: {
  user: MobileDashboardProps["user"];
  recurringActive: number | undefined;
  subsActive: number | undefined;
  go: (s: Screen) => void;
  onLogout: () => void;
  onMyQr: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-[18px] pb-5 flex flex-col gap-3.5">
      <div className="flex items-center gap-3.5 px-1 pt-1.5 pb-2.5">
        <span className="w-14 h-14 rounded-[18px] bg-(--sw-blue) grid place-items-center shrink-0">
          <img src="/sweep-mark-white.svg" alt="" aria-hidden className="w-6" />
        </span>
        <span className="flex flex-col flex-1 min-w-0">
          <span className="font-extrabold text-[19px] tracking-[-0.02em] truncate">{user.name}</span>
          <span className="text-[13px] font-semibold text-(--sw-muted) truncate">
            Payment ID · <span className="text-(--sw-blue)">{user.email}</span>
          </span>
        </span>
        <button type="button" onClick={() => go("support")}
          className="text-[13px] font-bold text-(--sw-blue) px-3 py-2 rounded-full border border-(--sw-tint-line) hover:bg-(--sw-tint)">
          Help
        </button>
      </div>

      <MenuGroup rows={[
        { k: "My QR code", v: "Get paid by scan", onClick: onMyQr },
      ]} />
      <MenuGroup rows={[
        { k: "Subscriptions",       v: subsActive === undefined ? undefined : `${subsActive} active`,      onClick: () => go("subs") },
        { k: "Recurring transfers", v: recurringActive === undefined ? undefined : `${recurringActive} active`, onClick: () => go("recurring") },
      ]} />
      <MenuGroup rows={[
        { k: "Contact support", onClick: () => go("support") },
        { k: "Settings", v: "Security", onClick: () => go("settings") },
      ]} />

      <button type="button" onClick={onLogout}
        className="mt-auto h-[52px] rounded-2xl border-[1.5px] border-(--sw-blue) text-(--sw-blue) text-[15px] font-bold hover:bg-(--sw-tint) transition-colors">
        Log out
      </button>
    </div>
  );
}

// ── Wrapper for the reused desktop tabs ───────────────────────────────────────

function SubScreen({ title, onBack, toolbar, bare, children }: {
  title: string;
  onBack: () => void;
  toolbar?: ReactNode;
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title={title} onBack={onBack} />
      {toolbar && <div className="px-4 pt-1 pb-3">{toolbar}</div>}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-5">
        {bare ? children : <Card className="p-4">{children}</Card>}
      </div>
    </div>
  );
}
