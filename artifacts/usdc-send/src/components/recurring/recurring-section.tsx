import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { authHeaders } from "@/lib/wallet";

// v5 Recurring transfers: a "New schedule" card beside the list of schedules,
// shared by the web and mobile dashboards.

type Interval = "hourly" | "daily" | "weekly" | "monthly";
interface RecurringTransfer {
  id: number; recipientEmail: string; amount: string; interval: Interval;
  nextRunAt: string; endDate: string | null; status: "active" | "completed" | "cancelled"; createdAt: string;
}

const INTERVALS: Interval[] = ["hourly", "daily", "weekly", "monthly"];
const LABEL: Record<Interval, string> = { hourly: "Hourly", daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const card  = "bg-white border border-(--sw-line) rounded-[22px]";
const field = "h-[50px] w-full min-w-0 rounded-xl border border-(--sw-field-line) bg-(--sw-bg) px-3.5 text-[15px] font-medium text-(--sw-ink) outline-none placeholder:text-[#9aa4b5] focus:border-(--sw-blue) focus:bg-white transition-colors";
const label = "text-[13px] font-bold text-(--sw-label)";

const usd  = (v: number | string) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string, interval?: Interval) => {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const today = new Date().toDateString() === d.toDateString();
  return interval === "hourly" || today ? (today ? `Today ${time}` : `${date} ${time}`) : date;
};
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" });
const amountInput = (raw: string) => {
  const cleaned = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
  const [w, d] = cleaned.split(".");
  return (d !== undefined ? `${w}.${d.slice(0, 2)}` : w).slice(0, 9);
};

const RECURRING_KEY = ["/api/recurring"];

export function RecurringSection({ userEmail, available, hasTransactionPassword }: {
  userEmail: string;
  available: number;
  hasTransactionPassword: boolean;
}) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: RECURRING_KEY,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res  = await fetch(`${API_BASE}/api/recurring`, { headers: authHeaders() });
      const json = res.ok ? await res.json().catch(() => null) : null;
      return Array.isArray(json) ? (json as RecurringTransfer[]) : [];
    },
  });

  const [email,    setEmail]    = useState("");
  const [amount,   setAmount]   = useState("");
  const [interval, setInterval] = useState<Interval>("monthly");
  const [hour,     setHour]     = useState(9);
  const [weekday,  setWeekday]  = useState(1);
  const [monthDay, setMonthDay] = useState(1);
  const [endOn,    setEndOn]    = useState(false);
  const [endDate,  setEndDate]  = useState("");
  const [txPwd,    setTxPwd]    = useState("");
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [notice,   setNotice]   = useState<string | null>(null);

  const to = email.trim().toLowerCase();
  const a  = parseFloat(amount) || 0;
  const problem =
    !EMAIL_RE.test(to)                   ? "Add the recipient's payment ID" :
    to === userEmail.toLowerCase()       ? "That's your own payment ID" :
    !a                                   ? "Enter an amount" :
    a > available                        ? `More than your available ${usd(available)}` :
    endOn && !endDate                    ? "Pick an end date" :
    hasTransactionPassword && !txPwd     ? "Enter your transaction password" : null;
  const touched = !!(email || amount);

  const create = async () => {
    if (problem || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const body: Record<string, unknown> = { recipientEmail: to, amount: a.toFixed(2), interval };
      if (interval !== "hourly") body.startHour = hour;
      if (interval === "weekly") body.startDayOfWeek = weekday;
      if (interval === "monthly") body.startDayOfMonth = monthDay;
      if (endOn && endDate) body.endDate = new Date(`${endDate}T23:59:59`).toISOString();
      if (hasTransactionPassword) body.transactionPassword = txPwd;
      const res  = await fetch(`${API_BASE}/api/recurring`, { method: "POST", headers: authHeaders(true), body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "Could not create the schedule");
      setNotice(json.message ?? "Schedule created.");
      setEmail(""); setAmount(""); setTxPwd(""); setEndOn(false); setEndDate("");
      qc.invalidateQueries({ queryKey: RECURRING_KEY });
    } catch (e: any) {
      setError(e?.message ?? "Could not create the schedule");
    } finally {
      setBusy(false);
    }
  };

  const schedules = list.data ?? [];
  const active    = schedules.filter((t) => t.status === "active");
  const past      = schedules.filter((t) => t.status !== "active");
  const monthlyOut = active.reduce((s, t) => {
    const v = parseFloat(t.amount);
    return s + (t.interval === "hourly" ? v * 730 : t.interval === "daily" ? v * 30.4 : t.interval === "weekly" ? (v * 52) / 12 : v);
  }, 0);

  const scheduleHint =
    interval === "hourly"  ? "Runs at the start of every hour." :
    interval === "daily"   ? `Runs every day at ${hourLabel(hour)}.` :
    interval === "weekly"  ? `Runs every ${DAYS[weekday]} at ${hourLabel(hour)}.` :
                             `Runs on day ${monthDay} of each month at ${hourLabel(hour)}${monthDay > 28 ? " (or the month's last day)" : ""}.`;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] gap-5 items-start">
      {/* New schedule */}
      <form className={cn(card, "p-4 sm:p-5 flex flex-col gap-3 xl:sticky xl:top-6")} onSubmit={(e) => { e.preventDefault(); create(); }}>
        <span className="font-extrabold text-base">New schedule</span>
        <input value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} placeholder="Recipient's payment ID (email)"
          aria-label="Recipient email" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" className={field} />
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-medium text-(--sw-faint) pointer-events-none">$</span>
          <input value={amount} onChange={(e) => { setAmount(amountInput(e.target.value)); setError(null); }} placeholder="Amount (USD)"
            aria-label="Amount in USD" inputMode="decimal" autoComplete="off" className={cn(field, "pl-7 tabular-nums")} />
        </div>
        <div className="flex bg-(--sw-line) rounded-xl p-[3px] gap-[3px]" role="radiogroup" aria-label="How often">
          {INTERVALS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={interval === k} onClick={() => setInterval(k)}
              className={cn("flex-1 py-[7px] rounded-[9px] text-[13px] font-bold transition-colors",
                interval === k ? "bg-white text-(--sw-ink) shadow-[0_1px_2px_rgb(11_18_32/.08)]" : "text-(--sw-muted)")}>
              {LABEL[k]}
            </button>
          ))}
        </div>

        {interval !== "hourly" && (
          <div className={cn("grid gap-2", interval === "daily" ? "grid-cols-1" : "grid-cols-2")}>
            {interval === "weekly" && (
              <select value={weekday} onChange={(e) => setWeekday(+e.target.value)} aria-label="Day of the week" className={cn(field, "font-semibold")}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            )}
            {interval === "monthly" && (
              <select value={monthDay} onChange={(e) => setMonthDay(+e.target.value)} aria-label="Day of the month" className={cn(field, "font-semibold")}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Day {d}</option>)}
              </select>
            )}
            <select value={hour} onChange={(e) => setHour(+e.target.value)} aria-label="Time of day" className={cn(field, "font-semibold")}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </div>
        )}
        <p className="text-xs text-(--sw-muted) -mt-1">{scheduleHint}</p>

        <label className="flex items-center justify-between gap-3 text-sm font-semibold text-(--sw-label)">
          End on a date
          <input type="checkbox" checked={endOn} onChange={(e) => setEndOn(e.target.checked)} className="w-[18px] h-[18px] accent-(--sw-blue)" />
        </label>
        {endOn && (
          <input type="date" value={endDate} min={new Date(Date.now() + 864e5).toISOString().slice(0, 10)}
            onChange={(e) => setEndDate(e.target.value)} aria-label="End date" className={field} />
        )}

        {hasTransactionPassword && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rec-txpwd" className={label}>Transaction password</label>
            <input id="rec-txpwd" type="password" value={txPwd} onChange={(e) => { setTxPwd(e.target.value); setError(null); }}
              placeholder="Authorize this schedule" autoComplete="off" className={field} />
          </div>
        )}

        {error && <p role="alert" className="rounded-xl bg-[#fef3f2] text-[#b42318] px-3.5 py-2.5 text-sm font-medium">{error}</p>}
        {notice && <p role="status" className="rounded-xl bg-[#ecfdf3] text-[#067647] px-3.5 py-2.5 text-sm font-medium">{notice}</p>}
        {touched && problem && !error && <p className="text-[13px] font-semibold text-(--sw-muted) text-center">{problem}</p>}

        <button type="submit" disabled={!!problem || busy}
          className="h-[50px] rounded-[14px] bg-(--sw-blue) text-white text-[15px] font-bold hover:bg-(--sw-blue-hover) disabled:bg-[#c5ccd8] disabled:cursor-not-allowed flex items-center justify-center gap-2">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}{busy ? "Creating…" : a ? `Create schedule · ${usd(a)} ${LABEL[interval].toLowerCase()}` : "Create schedule"}
        </button>
        <p className="text-xs text-(--sw-faint) text-center">Each run sends from your Sweep balance. A run is skipped if your balance is too low.</p>
      </form>

      {/* Schedules */}
      <div className="flex flex-col gap-4 min-w-0">
        {list.isLoading ? (
          <div className="py-16 grid place-items-center text-(--sw-muted)"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : !schedules.length ? (
          <div className={cn(card, "px-6 py-12 flex flex-col items-center text-center gap-3")}>
            <span className="w-12 h-12 rounded-2xl bg-(--sw-tint) text-(--sw-blue) grid place-items-center"><Repeat className="w-6 h-6" /></span>
            <h3 className="font-extrabold text-lg">No schedules yet</h3>
            <p className="text-sm text-(--sw-muted) max-w-xs">Send rent, allowances or savings automatically, by email, on the schedule you choose.</p>
          </div>
        ) : (
          <>
            {active.length > 0 && (
              <div className={cn(card, "grid grid-cols-2 divide-x divide-(--sw-line)")}>
                <div className="px-5 py-4 flex flex-col gap-1">
                  <span className="text-xs font-bold tracking-[0.07em] text-(--sw-faint)">ACTIVE</span>
                  <span className="font-extrabold text-[28px] tracking-[-0.03em] leading-none">{active.length}</span>
                </div>
                <div className="px-5 py-4 flex flex-col gap-1 min-w-0">
                  <span className="text-xs font-bold tracking-[0.07em] text-(--sw-faint)">ABOUT PER MONTH</span>
                  <span className="font-extrabold text-[28px] tracking-[-0.03em] leading-none tabular-nums truncate">{usd(monthlyOut)}</span>
                </div>
              </div>
            )}
            <ScheduleList title="Active" items={active} />
            {past.length > 0 && <ScheduleList title="Past" items={past} muted />}
          </>
        )}
      </div>
    </div>
  );
}

function ScheduleList({ title, items, muted }: { title: string; items: RecurringTransfer[]; muted?: boolean }) {
  if (!items.length) return null;
  return (
    <div className={cn(card, "py-1.5 overflow-hidden")}>
      <div className="px-[18px] pt-3 pb-1 text-[13px] font-bold text-(--sw-muted)">{title} · {items.length}</div>
      {/* Wide screens: table-like header */}
      <div className="hidden md:grid grid-cols-[minmax(0,1.6fr)_0.8fr_0.9fr_0.8fr_auto] gap-3 px-[18px] pt-2 pb-1.5 text-[11px] font-bold tracking-[0.07em] text-(--sw-faint)">
        <span>RECIPIENT</span><span>INTERVAL</span><span>{muted ? "STATUS" : "NEXT"}</span><span className="text-right">AMOUNT</span><span className="w-[72px]" />
      </div>
      <ul className="divide-y divide-[#f0f2f6]">
        {items.map((t) => <ScheduleRow key={t.id} t={t} muted={muted} />)}
      </ul>
    </div>
  );
}

function ScheduleRow({ t, muted }: { t: RecurringTransfer; muted?: boolean }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const cancel = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/recurring/${t.id}`, { method: "DELETE", headers: authHeaders() });
      if (res.ok) qc.invalidateQueries({ queryKey: RECURRING_KEY });
    } finally {
      setBusy(false); setConfirm(false);
    }
  };
  const status = t.status === "active" ? null : t.status === "completed" ? "Completed" : "Cancelled";
  const next = t.status === "active" ? `next ${when(t.nextRunAt, t.interval)}` : status!;
  const ends = t.endDate && t.status === "active" ? ` · ends ${new Date(t.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";

  const action = t.status === "active" && (confirm ? (
    <span className="flex items-center gap-2 justify-end">
      <button type="button" onClick={() => setConfirm(false)} className="text-xs font-bold text-(--sw-muted)">Keep</button>
      <button type="button" onClick={cancel} disabled={busy} className="text-xs font-bold text-white bg-[#b42318] rounded-lg px-2.5 py-1.5 disabled:opacity-60 flex items-center gap-1">
        {busy && <Loader2 className="w-3 h-3 animate-spin" />} Stop it
      </button>
    </span>
  ) : (
    <button type="button" onClick={() => setConfirm(true)} className="justify-self-end text-xs font-bold text-[#b42318] hover:underline">Cancel</button>
  ));

  return (
    <li className={cn("px-[18px] py-2.5", muted && "opacity-70")}>
      {/* Phone: two-line layout from the prototype */}
      <div className="md:hidden grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 items-center">
        <span className="font-bold text-[15px] truncate">{t.recipientEmail}</span>
        <span className="font-bold text-[15px] tabular-nums">{usd(t.amount)}</span>
        <span className="text-[13px] text-(--sw-muted) truncate">{LABEL[t.interval]} · {next}{ends}</span>
        {action || <span />}
      </div>
      {/* Wide screens: columns */}
      <div className="hidden md:grid grid-cols-[minmax(0,1.6fr)_0.8fr_0.9fr_0.8fr_auto] gap-3 items-center text-sm">
        <span className="font-bold truncate">{t.recipientEmail}</span>
        <span className="text-(--sw-label)">{LABEL[t.interval]}</span>
        <span className="text-(--sw-label) flex flex-col min-w-0">
          <span className="truncate">{t.status === "active" ? when(t.nextRunAt, t.interval) : status}</span>
          {ends && <span className="text-xs text-(--sw-faint) truncate">{ends.replace(" · ", "")}</span>}
        </span>
        <span className="font-bold tabular-nums text-right">{usd(t.amount)}</span>
        <span className="w-[72px] flex justify-end">{action || null}</span>
      </div>
    </li>
  );
}
