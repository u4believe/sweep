import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "wouter";
import { ChevronDown, ExternalLink, PanelLeftClose, PanelLeftOpen, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UnifiedTx } from "@/lib/wallet";
import {
  ActivityList, AnimatedUsd, Card, CopyIcon, OutlineButton, Segmented, StatusPill, TxDetails,
  fmtUsd, historyFilter, txView, useHiddenBalance, whenLabel, type HistoryFilter,
} from "@/components/sweep/ui";
import { AddMoney } from "@/components/sweep/deposit-addresses";
import { useDashboardData, type HistoryState } from "@/components/sweep/use-dashboard-data";
import type { DashboardShellProps } from "@/components/sweep/types";
import { SendPanel } from "./send-panel";

type Page = "dash" | "history" | "recurring" | "subs" | "settings" | "support";
type SubsTab = "mine" | "plans" | "pay";

const SIDEBAR_KEY = "sweep.sidebarHidden";

export function WebDashboard({ user, balance, depositAddresses, withdraw, onBalanceChanged, onLogout, slots }: DashboardShellProps) {
  const [page,     setPage]     = useState<Page>("dash");
  const [subsTab,  setSubsTab]  = useState<SubsTab>("mine");
  const [fundOpen, setFundOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === "1"; } catch { return false; }
  });
  const toggleSidebar = () => setSidebarHidden((h) => {
    try { localStorage.setItem(SIDEBAR_KEY, h ? "0" : "1"); } catch { /* storage unavailable */ }
    return !h;
  });

  const { history, txs, txTotal, recurringActive, subsActive, refreshCounts, contacts } = useDashboardData();

  // The reused Recurring / Subscriptions tabs manage their own data — refresh counts when leaving them.
  useEffect(() => { refreshCounts(); }, [page]);

  const available = parseFloat(balance?.claimedBalance ?? "0") || 0;
  const firstName = user.name.split(" ")[0];
  const hour      = new Date().getHours();
  const greeting  = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${firstName}`;

  const focusSend = () => {
    setPage("dash");
    setTimeout(() => document.getElementById("d-amount")?.focus(), 60);
  };

  const pages: Record<Page, [string, string]> = {
    dash:      ["Dashboard", greeting],
    history:   ["History", "All transactions"],
    recurring: ["Recurring transfers", "Scheduled sends by email"],
    subs:      ["Subscriptions", "Plans you pay for and plans you sell"],
    settings:  ["Settings", "Security and account"],
    support:   ["Support", "Get help from our team"],
  };
  const count = (n: number | undefined) => (n === undefined ? "" : String(n));

  return (
    <div className={cn("sweep-ui min-h-screen grid", sidebarHidden ? "grid-cols-1" : "grid-cols-[248px_minmax(0,1fr)]")}>
      {!sidebarHidden && (
        <aside className="bg-white border-r border-(--sw-line) px-4 py-6 flex flex-col gap-1.5 sticky top-0 h-screen overflow-y-auto">
          <div className="flex items-center gap-2.5 px-2.5 pb-5">
            <Link href="/landing" className="flex items-center gap-2.5" title="Sweep website">
              <img src="/sweep-mark-blue.svg" alt="" className="w-[22px]" />
              <span className="font-extrabold text-xl tracking-[-0.02em]">Sweep</span>
            </Link>
            <span className="ml-auto text-[10px] font-bold tracking-[0.05em] text-(--sw-blue) border border-[#c9d0fd] px-[7px] py-[3px] rounded-full">TESTNET</span>
            <button type="button" onClick={toggleSidebar} aria-label="Hide sidebar" title="Hide sidebar"
              className="w-7 h-7 rounded-lg grid place-items-center text-(--sw-faint) hover:bg-(--sw-bg) hover:text-(--sw-ink)">
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          <NavItem label="Dashboard" active={page === "dash"} onClick={() => setPage("dash")} />
          <NavItem label="History" count={count(txTotal)} active={page === "history"} onClick={() => setPage("history")} />
          <NavItem label="Add money" onClick={() => setFundOpen(true)} />
          <NavItem label="Recurring" count={count(recurringActive)} active={page === "recurring"} onClick={() => setPage("recurring")} />
          <NavItem label="P2P" soon />
          <NavItem label="Subscriptions" count={count(subsActive)} active={page === "subs"} onClick={() => setPage("subs")} />
          <div className="h-3" />
          <NavItem label="Settings" active={page === "settings"} onClick={() => setPage("settings")} />
          <NavItem label="Support" active={page === "support"} onClick={() => setPage("support")} />

          <div className="mt-auto pt-4 space-y-2">
            <Link href="/landing" className="flex items-center gap-1.5 px-3 text-[13px] font-semibold text-(--sw-muted) hover:text-(--sw-ink)">
              Sweep website <ExternalLink className="w-3.5 h-3.5" />
            </Link>
            <div className="px-3 py-3.5 border border-(--sw-line) rounded-2xl flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-(--sw-blue) grid place-items-center shrink-0">
                <img src="/sweep-mark-white.svg" alt="" className="w-[15px]" />
              </span>
              <span className="flex flex-col min-w-0 flex-1">
                <span className="font-bold text-sm truncate">{user.name}</span>
                <span className="text-xs text-(--sw-muted) truncate">{user.email}</span>
              </span>
              <button type="button" onClick={onLogout} className="text-xs font-bold text-[#b42318] whitespace-nowrap hover:underline">Log out</button>
            </div>
          </div>
        </aside>
      )}

      <main className="px-9 pt-7 pb-12 flex flex-col gap-[22px] min-w-0 max-w-[1320px] w-full mx-auto">
        <header className="flex items-center gap-4 flex-wrap">
          {sidebarHidden && (
            <button type="button" onClick={toggleSidebar} aria-label="Show sidebar" title="Show sidebar"
              className="w-10 h-10 rounded-xl border border-(--sw-line) bg-white grid place-items-center hover:bg-(--sw-tint)">
              <PanelLeftOpen className="w-5 h-5" />
            </button>
          )}
          <div className="flex flex-col flex-1 min-w-[220px]">
            <span className="text-[13px] text-(--sw-muted) font-medium">{pages[page][1]}</span>
            <h1 className="font-extrabold text-[28px] tracking-[-0.03em]">{pages[page][0]}</h1>
          </div>
          {page !== "dash" && (
            <div className="flex items-center gap-2 px-4 h-12 bg-white border border-(--sw-line) rounded-[14px]">
              <span className="text-[13px] font-semibold text-(--sw-muted)">Available</span>
              <span className="text-sm font-bold tabular-nums">{fmtUsd(available)}</span>
            </div>
          )}
          <div className="flex items-center gap-2.5 pl-4 pr-2 h-12 bg-white border border-(--sw-line) rounded-[14px]">
            <span className="text-[13px] font-semibold text-(--sw-muted)">Payment ID</span>
            <span className="text-sm font-bold">{user.email}</span>
            <CopyIcon text={user.email} label="Copy payment ID" />
          </div>
        </header>

        {page === "dash" && (
          <div className="grid grid-cols-2 xl:grid-cols-[minmax(0,1fr)_420px] gap-5 items-start">
            <div className="flex flex-col gap-5 min-w-0">
              <BalanceCard balance={balance} onSweep={focusSend} onAddMoney={() => setFundOpen(true)} />
              <div className="grid grid-cols-3 gap-3">
                <StatTile label="Recurring"     value={recurringActive === undefined ? "—" : `${recurringActive} active`} onClick={() => setPage("recurring")} />
                <StatTile label="Subscriptions" value={subsActive === undefined ? "—" : `${subsActive} active`}           onClick={() => setPage("subs")} />
                <StatTile label="History"       value={txTotal === undefined ? "—" : `${txTotal} ${txTotal === 1 ? "item" : "items"}`} onClick={() => setPage("history")} />
              </div>
              <Card className="py-2">
                <div className="flex items-center justify-between px-[22px] pt-3.5 pb-2">
                  <span className="font-extrabold text-[17px]">Recent activity</span>
                  <button type="button" onClick={() => setPage("history")} className="text-[13px] font-bold text-(--sw-blue)">See all</button>
                </div>
                <ActivityList txs={txs.slice(0, 5)} state={history} expandable />
              </Card>
              <DepositAddressesCard addresses={depositAddresses} onAllNetworks={() => setFundOpen(true)} />
            </div>

            <Card className="rounded-[26px] p-6 sticky top-6">
              <SendPanel
                available={available}
                userEmail={user.email}
                hasTransactionPassword={user.hasTransactionPassword}
                withdraw={withdraw}
                onSent={onBalanceChanged}
                contacts={contacts}
                circleWallet={user.circleWalletAddress ?? undefined}
                onViewHistory={() => setPage("history")}
              />
            </Card>
          </div>
        )}

        {page === "history" && (
          <HistoryTable txs={txs} state={history}
            hasMore={!!history.hasNextPage} loadingMore={history.isFetchingNextPage} onLoadMore={() => history.fetchNextPage()} />
        )}

        {page === "recurring" && <Card className="p-6 max-w-4xl">{slots.recurring}</Card>}

        {page === "subs" && (
          <div className="flex flex-col gap-4">
            <div className="max-w-xl">
              <Segmented<SubsTab> value={subsTab} onChange={setSubsTab}
                options={[{ value: "mine", label: "My subscriptions" }, { value: "plans", label: "Create a plan" }, { value: "pay", label: "Pay a subscription" }]} />
            </div>
            {subsTab === "plans"
              ? slots.subsCreate
              : <Card className="p-6">{subsTab === "mine" ? slots.subsMine : slots.subsPay}</Card>}
          </div>
        )}

        {page === "settings" && (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)] gap-5 items-start">
            <Section title="SECURITY"><Card className="p-6">{slots.settings}</Card></Section>
            <Section title="ACCOUNT">
              <Card className="rounded-[20px] overflow-hidden">
                <AccountRow k="Name" v={user.name} />
                <AccountRow k="Email · payment ID" v={user.email} copy />
                {user.circleWalletAddress && <AccountRow k="Circle wallet" v={user.circleWalletAddress} copy mono />}
                <div className="flex items-center gap-3 px-5 py-[18px] border-t border-[#f0f2f6]">
                  <span className="font-bold text-[15px] flex-1">Session</span>
                  <button type="button" onClick={onLogout} className="text-[13px] font-bold text-[#b42318] hover:underline">Log out</button>
                </div>
              </Card>
            </Section>
          </div>
        )}

        {page === "support" && <div className="max-w-3xl">{slots.support}</div>}
      </main>

      <AnimatePresence>
        {fundOpen && <AddMoneyDialog addresses={depositAddresses} onClose={() => setFundOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function NavItem({ label, count, active, soon, onClick }: {
  label: string;
  count?: string;
  active?: boolean;
  soon?: boolean;
  onClick?: () => void;
}) {
  if (soon) {
    return (
      <div className="flex items-center justify-between px-3 py-[11px] rounded-xl text-sm font-bold text-(--sw-faint) cursor-not-allowed select-none">
        <span>{label}</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#fef0c7] text-[#93370d]">Soon</span>
      </div>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined}
      className={cn("flex items-center justify-between px-3 py-[11px] rounded-xl text-sm font-bold text-left transition-colors",
        active ? "bg-(--sw-tint) text-(--sw-blue)" : "text-(--sw-label) hover:bg-[#f3f5fb]")}>
      <span>{label}</span>
      {count && <span className="text-xs font-semibold text-(--sw-faint)">{count}</span>}
    </button>
  );
}

// ── Dashboard blocks ──────────────────────────────────────────────────────────

function BalanceCard({ balance, onSweep, onAddMoney }: {
  balance: DashboardShellProps["balance"];
  onSweep: () => void;
  onAddMoney: () => void;
}) {
  const { hidden, toggle } = useHiddenBalance();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[26px] px-7 pt-7 pb-6 text-white bg-(--sw-blue) relative overflow-hidden">
      <img src="/sweep-mark-white.svg" alt="" aria-hidden className="absolute -right-8 -bottom-12 w-[220px] opacity-[.07] pointer-events-none" />
      <div className="flex justify-between text-sm font-medium relative">
        <span className="opacity-80">Total balance · USD</span>
        <button type="button" onClick={toggle} className="text-[13px] font-bold opacity-80 hover:opacity-100">{hidden ? "Show" : "Hide"}</button>
      </div>
      <div className="font-extrabold text-[60px] tracking-[-0.045em] leading-[1.1] mt-2 tabular-nums relative">
        {hidden ? "$ ••••••" : <AnimatedUsd value={balance?.usdBalance ?? 0} />}
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="relative mt-1 mb-5 flex items-center gap-1 text-[13px] opacity-80 hover:opacity-100">
        {hidden ? "Backed 1:1 by USDC" : `${fmtUsd(balance?.claimedBalance ?? 0)} available to send`}
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="relative overflow-hidden">
            <div className="mb-5 border-t border-white/20 pt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="opacity-75">Credited balance · available</span><span className="font-bold tabular-nums">{hidden ? "••••" : fmtUsd(balance?.claimedBalance ?? 0)}</span></div>
              <div className="flex justify-between"><span className="opacity-75">On-chain escrow</span><span className="font-bold tabular-nums">{hidden ? "••••" : fmtUsd(balance?.onChainUsdcBalance ?? 0)}</span></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex gap-2.5 flex-wrap relative">
        <button type="button" onClick={onSweep}
          className="h-12 px-[22px] rounded-[14px] bg-white text-(--sw-blue) text-[15px] font-bold flex items-center gap-2 hover:bg-(--sw-tint)">
          <Send className="w-[18px] h-[18px]" /> Sweep
        </button>
        <button type="button" onClick={onAddMoney}
          className="h-12 px-[22px] rounded-[14px] border border-white/35 text-white text-[15px] font-bold hover:bg-white/10">
          Add money
        </button>
      </div>
    </div>
  );
}

function StatTile({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="bg-white border border-(--sw-line) rounded-[18px] px-3.5 xl:px-[18px] py-4 flex flex-col gap-1.5 text-left hover:border-[#c9d0fd] transition-colors min-w-0">
      <span className="text-xs xl:text-[13px] font-semibold text-(--sw-muted) truncate">{label}</span>
      <span className="font-extrabold text-lg xl:text-[22px] tracking-[-0.02em] tabular-nums truncate">{value}</span>
    </button>
  );
}

function DepositAddressesCard({ addresses, onAllNetworks }: { addresses: Record<string, string>; onAllNetworks: () => void }) {
  const evm = addresses["BASE-SEPOLIA"] ?? addresses["ARC-TESTNET"] ?? Object.entries(addresses).find(([k]) => k !== "SOL-DEVNET")?.[1];
  const sol = addresses["SOL-DEVNET"];
  if (!evm && !sol) return null;
  return (
    <Card className="px-[22px] py-4">
      <div className="flex items-center justify-between mb-1">
        <span className="font-extrabold text-[17px]">Deposit addresses</span>
        <button type="button" onClick={onAllNetworks} className="text-[13px] font-bold text-(--sw-blue)">All networks</button>
      </div>
      {[["EVM networks", evm], ["Solana", sol]].filter(([, a]) => a).map(([k, a], i) => (
        <div key={k} className={cn("flex items-center gap-3 py-2.5", i > 0 && "border-t border-[#f0f2f6]")}>
          <span className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-semibold text-(--sw-muted)">{k}</span>
            <span className="font-mono text-[13px] truncate">{a}</span>
          </span>
          <CopyIcon text={a!} label={`Copy ${k} address`} />
        </div>
      ))}
    </Card>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

const COLS = "grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_120px]";

function HistoryTable({ txs, state, hasMore, loadingMore, onLoadMore }: {
  txs: UnifiedTx[];
  state: HistoryState;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = txs.filter(historyFilter(filter));

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <div className="px-[22px] py-4 border-b border-[#f0f2f6]">
          <div className="max-w-md">
            <Segmented<HistoryFilter> value={filter} onChange={setFilter}
              options={[{ value: "all", label: "All" }, { value: "email", label: "Email" }, { value: "in", label: "In" }, { value: "out", label: "Out" }]} />
          </div>
        </div>
        <div className={cn("grid gap-4 px-[22px] py-3 text-xs font-bold tracking-[0.05em] text-(--sw-muted) bg-[#f8f9fc]", COLS)}>
          <span>DETAILS</span><span>TYPE</span><span>DATE</span><span>AMOUNT</span><span>STATUS</span>
        </div>
        {state.isLoading || state.isError || !shown.length ? (
          filter !== "all" && txs.length && !shown.length ? (
            <p className="px-[22px] py-10 text-center text-sm text-(--sw-muted)">
              Nothing here in the {txs.length} most recent items{hasMore ? " — load more to look further back" : ""}.
            </p>
          ) : <ActivityList txs={[]} state={state} />
        ) : shown.map((t) => {
          const v = txView(t);
          const open = openId === t.id;
          return (
            <div key={t.id} className="border-t border-[#f0f2f6]">
              <button type="button" onClick={() => setOpenId(open ? null : t.id)} aria-expanded={open}
                className={cn("grid gap-4 items-center w-full text-left px-[22px] py-3.5 text-sm hover:bg-[#f8f9fc]", COLS)}>
                <span className="flex items-center gap-3 min-w-0">
                  <span className={cn("w-9 h-9 rounded-full grid place-items-center font-extrabold shrink-0", v.isEmail ? "text-sm" : "text-[9px]", v.avatar)}>{v.mono}</span>
                  <span className="font-bold truncate">{v.title}</span>
                </span>
                <span className="text-(--sw-muted) truncate">{v.sub}</span>
                <span className="text-(--sw-muted)">{whenLabel(t.createdAt)}</span>
                <span className={cn("font-bold tabular-nums", t.direction === "in" ? "text-[#067647]" : "text-(--sw-ink)")}>{v.amount}</span>
                <span className="flex items-center justify-between gap-2">
                  <StatusPill {...v.status} />
                  <ChevronDown className={cn("w-4 h-4 text-(--sw-faint) transition-transform shrink-0", open && "rotate-180")} />
                </span>
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <TxDetails tx={t} className="mx-[22px] mb-4 max-w-2xl" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </Card>
      {hasMore && (
        <OutlineButton onClick={onLoadMore} disabled={loadingMore} className="max-w-xs self-center">
          {loadingMore ? "Loading…" : "Load more"}
        </OutlineButton>
      )}
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="text-xs font-bold tracking-[0.06em] text-(--sw-muted) px-1">{title}</span>
      {children}
    </div>
  );
}

function AccountRow({ k, v, copy, mono }: { k: string; v: string; copy?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-5 py-[18px] border-t border-[#f0f2f6] first:border-t-0">
      <span className="font-bold text-[15px] shrink-0">{k}</span>
      <span className={cn("flex-1 min-w-0 truncate text-right text-sm text-(--sw-muted)", mono && "font-mono text-xs")}>{v}</span>
      {copy && <CopyIcon text={v} label={`Copy ${k}`} />}
    </div>
  );
}

// ── Add money dialog ──────────────────────────────────────────────────────────

function AddMoneyDialog({ addresses, onClose }: { addresses: Record<string, string>; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-[rgb(11_18_32/.45)] grid place-items-center p-6">
      <motion.div role="dialog" aria-modal="true" aria-labelledby="add-money-title"
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] max-h-[calc(100vh-48px)] overflow-y-auto bg-white rounded-[26px] p-[26px] flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <h2 id="add-money-title" className="font-extrabold text-xl tracking-[-0.02em]">Add money</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close"
            className="w-9 h-9 rounded-xl grid place-items-center text-(--sw-muted) hover:bg-(--sw-bg)">
            <X className="w-5 h-5" />
          </button>
        </div>
        <AddMoney addresses={addresses} inset />
      </motion.div>
    </motion.div>
  );
}

