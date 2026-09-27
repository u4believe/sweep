// ─── Measured transfer times ─────────────────────────────────────────────────
// How long crypto deposits and withdrawals actually take, per chain, from our
// own records — never a hard-coded guess:
//   deposit:    detected on-chain (Circle's first sighting) → credited to the balance
//   withdrawal: requested → landed on-chain at the destination
// Only chains with enough recent samples get an estimate; the app shows plain
// status wording for the rest.

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const WINDOW_DAYS = 30;
const MIN_SAMPLES = 5;
const CACHE_MS    = 5 * 60_000;

export interface ChainTiming {
  /** Median seconds. */
  typical: number;
  /** 90th-percentile seconds — the slow end of normal. */
  slow: number;
  samples: number;
}
export interface TransferTimes {
  deposit:    Record<string, ChainTiming>;
  withdrawal: Record<string, ChainTiming>;
  windowDays: number;
}

/** A Circle timestamp (ISO string) as a Date, or null if missing or invalid. */
export function circleDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

let cache: { at: number; data: TransferTimes } | null = null;

export async function getTransferTimes(): Promise<TransferTimes> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const summarise = (rows: any[]) => Object.fromEntries(
    rows.map((r) => [r.chain, { typical: Math.round(Number(r.typical)), slow: Math.round(Number(r.slow)), samples: Number(r.samples) }]),
  );

  const deposits = await db.execute(sql`
    SELECT chain,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM credited_at - detected_at)) AS typical,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM credited_at - detected_at)) AS slow,
           count(*) AS samples
      FROM deposits
     WHERE type = 'crypto' AND status = 'completed'
       AND chain IS NOT NULL AND detected_at IS NOT NULL AND credited_at >= detected_at
       AND credited_at > NOW() - make_interval(days => ${WINDOW_DAYS})
     GROUP BY chain
    HAVING count(*) >= ${MIN_SAMPLES}`);

  const withdrawals = await db.execute(sql`
    SELECT chain,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM delivered_at - created_at)) AS typical,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM delivered_at - created_at)) AS slow,
           count(*) AS samples
      FROM withdrawals
     WHERE type = 'crypto' AND status = 'completed'
       AND chain IS NOT NULL AND delivered_at IS NOT NULL AND delivered_at >= created_at
       AND delivered_at > NOW() - make_interval(days => ${WINDOW_DAYS})
     GROUP BY chain
    HAVING count(*) >= ${MIN_SAMPLES}`);

  const data: TransferTimes = {
    deposit:    summarise((deposits as any).rows ?? deposits),
    withdrawal: summarise((withdrawals as any).rows ?? withdrawals),
    windowDays: WINDOW_DAYS,
  };
  cache = { at: Date.now(), data };
  return data;
}
