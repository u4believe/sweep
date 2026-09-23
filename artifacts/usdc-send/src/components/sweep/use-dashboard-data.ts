import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api";
import { authHeaders, type HistoryPage, type UnifiedTx } from "@/lib/wallet";

// Data shared by the mobile and desktop dashboards: paged history, the counts
// shown on Home / the sidebar, and recent email recipients for one-tap sends.
export function useDashboardData() {
  const history = useInfiniteQuery({
    queryKey: ["/api/user/history", "paged"],
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
      const json = res.ok ? await res.json().catch(() => null) : null;
      return Array.isArray(json) ? (json as Array<{ status: string }>) : [];
    },
  });
  const subs = useQuery({
    queryKey: ["/api/subscriptions/my"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/subscriptions/my`, { headers: authHeaders() });
      const json = res.ok ? await res.json().catch(() => null) : null;
      return Array.isArray(json?.subscriptions) ? (json.subscriptions as Array<{ status: string }>) : [];
    },
  });
  const recurringActive = recurring.data?.filter((r) => r.status === "active").length;
  const subsActive      = subs.data?.filter((s) => s.status === "active" || s.status === "trialing").length;

  // The reused Recurring / Subscriptions tabs manage their own data; call this when returning from them.
  const refreshCounts = () => { recurring.refetch(); subs.refetch(); };

  const contacts = useMemo(() => {
    const seen = new Set<string>();
    for (const t of txs) {
      if (t.category === "escrow" && t.direction === "out" && t.toAddress?.includes("@")) seen.add(t.toAddress.toLowerCase());
      if (seen.size === 4) break;
    }
    return [...seen];
  }, [txs]);

  return { history, txs, txTotal, recurringActive, subsActive, refreshCounts, contacts };
}

export type HistoryState = { isLoading: boolean; isError: boolean; error: unknown };
