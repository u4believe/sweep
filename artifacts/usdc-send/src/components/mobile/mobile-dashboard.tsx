import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Clock, CreditCard, Loader2, Repeat, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { authHeaders, WITHDRAWAL_CHAINS, type FullBalance, type HistoryPage, type UnifiedTx } from "@/lib/wallet";
import {
  Card, Chip, CopyIcon, MenuGroup, OutlineButton, PrimaryButton, ScreenHeader, Segmented, TxRow,
  fmtUsd, useCopy,
} from "./ui";
import { MobileSend, type SendStep, type WithdrawMutation } from "./send";

type Screen = "home" | "history" | "send" | "fund" | "me" | "recurring" | "subs" | "settings" | "support";
type Tab = "home" | "send" | "fund" | "me";
type SubsTab = "mine" | "plans" | "pay";

const TAB_OF: Record<Screen, Tab> = {
  home: "home", history: "home", send: "send", fund: "fund",
  me: "me", recurring: "me", subs: "me", settings: "me", support: "me",
};

const HIDE_KEY = "sweep.hideBalance";

// Deposit networks in display order — Unichain is withdrawal-only.
const DEPOSIT_KEYS = ["ARC-TESTNET", "BASE-SEPOLIA", "ARB-SEPOLIA", "OP-SEPOLIA", "MATIC-AMOY", "AVAX-FUJI", "SOL-DEVNET"];

export interface MobileDashboardProps {
  user: { name: string; email: string; hasTransactionPassword: boolean; circleWalletAddress?: string | null };
  balance: FullBalance | undefined;
  depositAddresses: Record<string, string>;
  withdraw: WithdrawMutation;
  onBalanceChanged: () => void;
  onLogout: () => void;
  slots: {
    recurring: ReactNode;
    subsMine: ReactNode;
    subsCreate: ReactNode;
    subsPay: ReactNode;
    settings: ReactNode;
    support: ReactNode;
  };
}

export function MobileDashboard({ user, balance, depositAddresses, withdraw, onBalanceChanged, onLogout, slots }: MobileDashboardProps) {
  const [screen,   setScreen]   = useState<Screen>("home");
  const [backTo,   setBackTo]   = useState<Screen>("home");
  const [sendStep, setSendStep] = useState<SendStep>("form");
  const [subsTab,  setSubsTab]  = useState<SubsTab>("mine");

  const go = (next: Screen, from?: Screen) => {
    if (from) setBackTo(from);
    setScreen(next);
  };

  // ── Data ────────────────────────────────────────────────────────────────────
  const history = useInfiniteQuery({
    queryKey: ["/api/user/history", "mobile"],
    initialPageParam: 1,
    refetchInterval: 10_000,
    queryFn: async ({ pageParam }) => {
      const res = await fetch(`${API_BASE}/api/user/history?page=${pageParam}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Could not load activity (${res.status})`);
      return res.json() as Promise<HistoryPage>;
    },
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
  const txs: UnifiedTx[] = useMemo(() => history.data?.pages.flatMap((p) => p.transactions) ?? [], [history.data]);
  const txTotal = history.data?.pages[0]?.total;

  const recurring = useQuery({
    queryKey: ["/api/recurring"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/recurring`, { headers: authHeaders() });
      return res.ok ? ((await res.json()) as Array<{ status: string }>) : [];
    },
  });
  const subs = useQuery({
    queryKey: ["/api/subscriptions/my"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/subscriptions/my`, { headers: authHeaders() });
      return res.ok ? ((await res.json()) as { subscriptions: Array<{ status: string }> }).subscriptions : [];
    },
  });
  const recurringActive = recurring.data?.filter((r) => r.status === "active").length;
  const subsActive      = subs.data?.filter((s) => s.status === "active" || s.status === "trialing").length;

  // The reused desktop tabs manage their own data, so refresh the counts when coming back.
  useEffect(() => {
    if (screen === "home" || screen === "me") { recurring.refetch(); subs.refetch(); }
  }, [screen]);

  // Recent email recipients become one-tap contacts on the Send screen.
  const contacts = useMemo(() => {
    const seen = new Set<string>();
    for (const t of txs) {
      if (t.category === "escrow" && t.direction === "out" && t.toAddress?.includes("@")) seen.add(t.toAddress.toLowerCase());
      if (seen.size === 4) break;
    }
    return [...seen];
  }, [txs]);

  const available = parseFloat(balance?.claimedBalance ?? "0") || 0;
  const showTabs  = !(screen === "send" && sendStep !== "form");

  const tabs: Array<[Tab, string]> = [["home", "Home"], ["send", "Sweep"], ["fund", "Add"], ["me", "Me"]];

  return (
    <div className="sweep-m h-[100dvh] flex flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={screen}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
          className="flex-1 flex flex-col min-h-0">

          {screen === "home" && (
            <HomeScreen
              user={user} balance={balance}
              txs={txs.slice(0, 5)} txTotal={txTotal} historyState={history}
              recurringActive={recurringActive} subsActive={subsActive}
              go={(s) => go(s, "home")}
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
            />
          )}

          {screen === "fund" && <FundScreen addresses={depositAddresses} />}

          {screen === "me" && (
            <MeScreen
              user={user} recurringActive={recurringActive} subsActive={subsActive}
              go={(s) => go(s, "me")} onLogout={onLogout}
            />
          )}

          {screen === "recurring" && (
            <SubScreen title="Recurring transfers" onBack={() => setScreen(backTo)}>{slots.recurring}</SubScreen>
          )}

          {screen === "subs" && (
            <SubScreen title="Subscriptions" onBack={() => setScreen(backTo)}
              toolbar={
                <Segmented<SubsTab> value={subsTab} onChange={setSubsTab}
                  options={[{ value: "mine", label: "Subscribed" }, { value: "plans", label: "My plans" }, { value: "pay", label: "Pay" }]} />
              }>
              {subsTab === "mine" ? slots.subsMine : subsTab === "plans" ? slots.subsCreate : slots.subsPay}
            </SubScreen>
          )}

          {screen === "settings" && <SubScreen title="Settings" onBack={() => setScreen("me")}>{slots.settings}</SubScreen>}
          {screen === "support"  && <SubScreen title="Support"  onBack={() => setScreen("me")} bare>{slots.support}</SubScreen>}
        </motion.div>
      </AnimatePresence>

      {showTabs && (
        <nav aria-label="Main" className="flex-none grid grid-cols-4 gap-1.5 px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom),14px)] bg-white border-t border-(--m-line)">
          {tabs.map(([t, label]) => {
            const active = TAB_OF[screen] === t;
            return (
              <button key={t} type="button" onClick={() => setScreen(t)} aria-current={active ? "page" : undefined}
                className={cn("py-2.5 rounded-xl text-[13px] font-bold transition-colors",
                  active ? "bg-(--m-tint) text-(--m-blue)" : "text-(--m-muted)")}>
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

type HistoryState = { isLoading: boolean; isError: boolean; error: unknown };

function HomeScreen({ user, balance, txs, txTotal, historyState, recurringActive, subsActive, go }: {
  user: MobileDashboardProps["user"];
  balance: FullBalance | undefined;
  txs: UnifiedTx[];
  txTotal: number | undefined;
  historyState: HistoryState;
  recurringActive: number | undefined;
  subsActive: number | undefined;
  go: (s: Screen) => void;
}) {
  const [hide, setHide] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
  });
  const toggleHide = () => {
    setHide((h) => {
      try { localStorage.setItem(HIDE_KEY, h ? "0" : "1"); } catch { /* storage unavailable */ }
      return !h;
    });
  };

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const total    = balance?.usdBalance ?? "0";
  const claimed  = balance?.claimedBalance ?? "0";
  const count    = (n: number | undefined, unit: string) => (n === undefined ? "—" : `${n} ${unit}`);

  const tiles: Array<{ label: string; value: string; icon: ReactNode; to: Screen }> = [
    { label: "Recurring",     value: count(recurringActive, "active"), icon: <Repeat className="w-5 h-5" />,     to: "recurring" },
    { label: "Subscriptions", value: count(subsActive, "active"),      icon: <CreditCard className="w-5 h-5" />, to: "subs" },
    { label: "History",       value: count(txTotal, txTotal === 1 ? "item" : "items"), icon: <Clock className="w-5 h-5" />, to: "history" },
  ];

  return (
    <div className="flex-1 overflow-y-auto min-h-0 pb-5">
      <div className="flex items-center gap-3 px-5 pt-[18px] pb-[22px]">
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-[13px] text-(--m-muted) font-medium">{greeting}</span>
          <span className="font-extrabold text-lg tracking-[-0.02em] truncate">{user.name}</span>
        </div>
        <span className="text-[11px] font-bold tracking-[0.04em] text-(--m-blue) border border-[#c9d0fd] px-2.5 py-[5px] rounded-full">TESTNET</span>
      </div>

      <div className="mx-4 rounded-3xl px-[22px] pt-[22px] pb-[18px] text-white bg-(--m-blue) relative overflow-hidden">
        <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute -right-6 -bottom-10 w-44 opacity-[.07] pointer-events-none" />
        <div className="flex items-center justify-between text-[13px] font-medium relative">
          <span className="opacity-80">Total balance · USD</span>
          <button type="button" onClick={toggleHide} className="text-xs font-bold opacity-80 hover:opacity-100">
            {hide ? "Show" : "Hide"}
          </button>
        </div>
        <div className="font-extrabold text-[44px] tracking-[-0.04em] leading-[1.1] mt-1.5 tabular-nums relative">
          {hide ? "$ ••••••" : fmtUsd(total)}
        </div>
        <div className="text-xs opacity-75 mt-1 mb-5 relative">
          {hide ? "Backed 1:1 by USDC" : `${fmtUsd(claimed)} available to send`}
        </div>
        <div className="grid grid-cols-2 gap-2.5 relative">
          <button type="button" onClick={() => go("send")}
            className="h-12 rounded-[14px] bg-white text-(--m-blue) text-[15px] font-bold flex items-center justify-center gap-2 hover:bg-(--m-tint) active:scale-[.98] transition">
            <Send className="w-[18px] h-[18px]" /> Sweep
          </button>
          <button type="button" onClick={() => go("fund")}
            className="h-12 rounded-[14px] border border-white/35 text-white text-[15px] font-bold hover:bg-white/10 active:scale-[.98] transition">
            Add money
          </button>
        </div>
      </div>

      <div className="mx-4 mt-2.5 px-4 py-3 bg-white border border-(--m-line) rounded-2xl flex items-center gap-2.5">
        <span className="text-[13px] font-semibold text-(--m-muted) whitespace-nowrap">Payment ID</span>
        <span className="flex-1 min-w-0 text-sm font-bold truncate text-right">{user.email}</span>
        <CopyIcon text={user.email} label="Copy payment ID" />
      </div>

      <div className="grid grid-cols-3 gap-2 px-4 pt-3">
        {tiles.map((t) => (
          <button key={t.label} type="button" onClick={() => go(t.to)}
            className="bg-white border border-(--m-line) rounded-[18px] px-3 py-3.5 flex flex-col items-start gap-2 text-left hover:border-[#c9d0fd] transition-colors">
            <span className="w-9 h-9 rounded-xl bg-(--m-tint) text-(--m-blue) grid place-items-center">{t.icon}</span>
            <span className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-(--m-muted) truncate">{t.label}</span>
              <span className="font-extrabold text-[15px] tracking-[-0.01em] tabular-nums">{t.value}</span>
            </span>
          </button>
        ))}
      </div>

      <Card className="mx-4 mt-3 py-1.5">
        <div className="flex items-center justify-between px-[18px] pt-3 pb-1.5">
          <span className="font-extrabold text-base tracking-[-0.01em]">Recent activity</span>
          <button type="button" onClick={() => go("history")} className="text-[13px] font-bold text-(--m-blue)">See all</button>
        </div>
        <ActivityList txs={txs} state={historyState} />
      </Card>
    </div>
  );
}

function ActivityList({ txs, state, expandable }: { txs: UnifiedTx[]; state: HistoryState; expandable?: boolean }) {
  if (state.isError) {
    return <p className="px-[18px] py-8 text-center text-sm text-[#b42318]">{(state.error as Error)?.message ?? "Could not load activity"}</p>;
  }
  if (state.isLoading) {
    return <div className="py-10 grid place-items-center text-(--m-muted)"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (!txs.length) {
    return (
      <div className="px-[18px] py-10 text-center">
        <p className="font-bold text-[15px]">No activity yet</p>
        <p className="text-[13px] text-(--m-muted) mt-1">Add money or sweep to someone and it will show up here.</p>
      </div>
    );
  }
  return <>{txs.map((t) => <TxRow key={t.id} tx={t} expandable={expandable} />)}</>;
}

// ── History ───────────────────────────────────────────────────────────────────

type Filter = "all" | "email" | "in" | "out";

function HistoryScreen({ txs, onBack, hasMore, loadingMore, onLoadMore, state }: {
  txs: UnifiedTx[];
  onBack: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  state: HistoryState;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = txs.filter((t) =>
    filter === "all" ? true :
    filter === "email" ? t.category === "escrow" :
    t.direction === filter);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title="History" onBack={onBack} />
      <div className="px-4 pt-1 pb-3">
        <Segmented<Filter> value={filter} onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "email", label: "Email" }, { value: "in", label: "In" }, { value: "out", label: "Out" }]} />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-5 space-y-3">
        <Card className="py-1.5">
          {filter !== "all" && !shown.length && txs.length ? (
            <p className="px-[18px] py-8 text-center text-sm text-(--m-muted)">
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
  const [method,   setMethod]   = useState<"crypto" | "bank">("crypto");
  const available = DEPOSIT_KEYS.filter((k) => addresses[k]);
  const [chainKey, setChainKey] = useState<string | null>(null);
  const active   = chainKey && addresses[chainKey] ? chainKey : available[0];
  const label    = WITHDRAWAL_CHAINS.find((c) => c.key === active)?.label ?? active;
  const address  = active ? addresses[active] : undefined;
  const { copied, copy } = useCopy(2000);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ScreenHeader title="Add money" />
      <div className="px-4">
        <Segmented<"crypto" | "bank"> value={method} onChange={setMethod}
          options={[{ value: "crypto", label: "Crypto" }, { value: "bank", label: "Bank" }]} />
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-3.5 pb-5 space-y-3">
        {method === "bank" ? (
          <Card className="px-5 py-6 flex flex-col gap-2.5">
            <span className="self-start text-[11px] font-bold tracking-[0.04em] text-[#93370d] bg-[#fef0c7] px-2.5 py-[5px] rounded-full">COMING SOON</span>
            <span className="font-extrabold text-[22px] leading-tight tracking-[-0.02em]">Bank wire deposits aren't live yet</span>
            <span className="text-sm text-(--m-muted) leading-relaxed">You'll get personal wire details and Circle mints USDC when the transfer lands. Fund with crypto for now.</span>
            <OutlineButton onClick={() => setMethod("crypto")} className="mt-1.5 h-[50px] rounded-[14px]">Use crypto instead</OutlineButton>
          </Card>
        ) : !address ? (
          <Card className="px-5 py-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-(--m-muted)" />
            <p className="text-sm text-(--m-muted) mt-3">Loading your deposit addresses…</p>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {available.map((k) => (
                <Chip key={k} active={k === active} onClick={() => setChainKey(k)}>
                  {WITHDRAWAL_CHAINS.find((c) => c.key === k)?.label ?? k}
                </Chip>
              ))}
            </div>
            <Card className="px-[18px] py-5 flex flex-col gap-3">
              <span className="text-[13px] font-semibold text-(--m-muted)">Your USDC address on {label}</span>
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
                  <span className="text-(--m-muted)">{r.k}</span>
                  <span className={cn("font-bold", r.ok && "text-[#067647]")}>{r.v}</span>
                </div>
              ))}
            </Card>
            <p className="text-xs text-(--m-muted) px-1 leading-relaxed">
              Sending any other token, or USDC on a different network, can't be recovered.
              {active === "SOL-DEVNET" && " Solana uses its own address."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Me ────────────────────────────────────────────────────────────────────────

function MeScreen({ user, recurringActive, subsActive, go, onLogout }: {
  user: MobileDashboardProps["user"];
  recurringActive: number | undefined;
  subsActive: number | undefined;
  go: (s: Screen) => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-4 pt-[18px] pb-5 flex flex-col gap-3.5">
      <div className="flex items-center gap-3.5 px-1 pt-1.5 pb-2.5">
        <span className="w-14 h-14 rounded-[18px] bg-(--m-blue) grid place-items-center shrink-0">
          <img src="/sweep-mark-white.svg" alt="" aria-hidden className="w-6" />
        </span>
        <span className="flex flex-col flex-1 min-w-0">
          <span className="font-extrabold text-[19px] tracking-[-0.02em] truncate">{user.name}</span>
          <span className="text-[13px] font-semibold text-(--m-muted) truncate">
            Payment ID · <span className="text-(--m-blue)">{user.email}</span>
          </span>
        </span>
        <button type="button" onClick={() => go("support")}
          className="text-[13px] font-bold text-(--m-blue) px-3 py-2 rounded-full border border-(--m-tint-line) hover:bg-(--m-tint)">
          Help
        </button>
      </div>

      <MenuGroup rows={[
        { k: "Subscriptions",       v: subsActive === undefined ? undefined : `${subsActive} active`,      onClick: () => go("subs") },
        { k: "Recurring transfers", v: recurringActive === undefined ? undefined : `${recurringActive} active`, onClick: () => go("recurring") },
      ]} />
      <MenuGroup rows={[
        { k: "Contact support", onClick: () => go("support") },
        { k: "Settings", v: "Security", onClick: () => go("settings") },
      ]} />

      <button type="button" onClick={onLogout}
        className="mt-auto h-[52px] rounded-2xl border-[1.5px] border-(--m-blue) text-(--m-blue) text-[15px] font-bold hover:bg-(--m-tint) transition-colors">
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
