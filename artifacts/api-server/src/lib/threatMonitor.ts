/**
 * IP-level threat monitor with progressive blocking.
 *
 * Works as a second layer on top of the per-route express-rate-limit
 * guards. While those limit request rates on specific routes, this
 * middleware watches the response codes from every route and builds
 * a suspicion score per IP. Repeated or escalating violations trigger
 * increasingly long blocks.
 *
 * Violation sources (scored after the response is sent):
 *   401 — auth failure (bad credentials, expired token)       +1
 *   403 — forbidden (bad tx password, passport revoked, etc.) +1
 *   429 — already hit a per-route rate limiter                +2
 *   404 on /api or /v1 — endpoint fishing / scanner           +1
 *   High API request rate (> REQ_RATE_LIMIT req / 60 s)       +1
 *
 * Block escalation (resets 24 h after last violation):
 *   1st block:  1 minute
 *   2nd block:  15 minutes
 *   3rd block:  2 hours
 *   4th+ block: 24 hours
 *
 * Memory: one Map entry per seen IP, pruned hourly. No external
 * dependency — swap the store for Redis if you run multiple processes.
 */

import { type Request, type Response, type NextFunction } from "express";
import { logger } from "./logger.js";

// ─── Configuration ────────────────────────────────────────────────────────────

const VIOLATION_WINDOW_MS    = 10 * 60 * 1000;  // rolling window to count violations in
const VIOLATIONS_TO_BLOCK    = 10;              // strikes in window before blocking
const REQ_RATE_LIMIT         = 80;              // max API requests per minute before a strike
const RECORD_TTL_MS          = 24 * 60 * 60 * 1000; // forget inactive IPs after 24 h

// Auth/OTP paths — 401 and 403 responses here are expected user behaviour
// (wrong OTP, wrong password) and must not be scored as suspicious activity.
// 429 (rate-limit hit) still scores on these paths.
const AUTH_PATHS = new Set([
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/verify-otp",
  "/api/auth/resend-otp",
  "/api/auth/verify-email",
  "/api/auth/resend-verification",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
]);

const BLOCK_DURATIONS_MS = [
  1  * 60 * 1000,   // 1st block: 1 minute
  15 * 60 * 1000,   // 2nd block: 15 minutes
  2  * 60 * 60 * 1000,  // 3rd block: 2 hours
  24 * 60 * 60 * 1000,  // 4th+ block: 24 hours
];

// Response codes that add violations and how many points each one costs
const VIOLATION_SCORES: Partial<Record<number, number>> = {
  401: 1,
  403: 1,
  429: 2,
};

// ─── In-memory store ──────────────────────────────────────────────────────────

interface IpRecord {
  violations:   number[]; // timestamps of recent violations (pruned to window)
  blockUntil:   number;   // epoch ms when block expires (0 = not blocked)
  blockCount:   number;   // total number of times this IP has been blocked
  reqCount:     number;   // API requests in the current 60-second window
  reqWindowStart: number; // start of the current request-rate window
  lastSeenAt:   number;   // last activity timestamp (for TTL pruning)
}

const store = new Map<string, IpRecord>();

function getRecord(ip: string): IpRecord {
  let r = store.get(ip);
  if (!r) {
    r = {
      violations:     [],
      blockUntil:     0,
      blockCount:     0,
      reqCount:       0,
      reqWindowStart: Date.now(),
      lastSeenAt:     Date.now(),
    };
    store.set(ip, r);
  } else {
    r.lastSeenAt = Date.now();
  }
  return r;
}

// Prune violations older than the window
function pruneViolations(r: IpRecord): void {
  const cutoff = Date.now() - VIOLATION_WINDOW_MS;
  r.violations = r.violations.filter((t) => t > cutoff);
}

function blockDurationMs(blockCount: number): number {
  const idx = Math.min(blockCount, BLOCK_DURATIONS_MS.length - 1);
  return BLOCK_DURATIONS_MS[idx]!;
}

function recordViolation(ip: string, score: number, reason: string): void {
  const r   = getRecord(ip);
  const now = Date.now();

  pruneViolations(r);
  for (let i = 0; i < score; i++) r.violations.push(now);

  logger.warn(
    { ip, score, total: r.violations.length, threshold: VIOLATIONS_TO_BLOCK, reason },
    "[threat] Violation recorded",
  );

  // Trigger a block only if not already blocked and threshold is crossed
  if (r.blockUntil <= now && r.violations.length >= VIOLATIONS_TO_BLOCK) {
    const duration    = blockDurationMs(r.blockCount);
    r.blockUntil      = now + duration;
    r.blockCount     += 1;
    r.violations      = []; // reset strike count after blocking so window is fresh

    logger.warn(
      {
        ip,
        blockNumber:  r.blockCount,
        durationMin:  Math.round(duration / 60_000),
        unblockAt:    new Date(r.blockUntil).toISOString(),
      },
      "[threat] IP blocked",
    );
  }
}

// ─── Hourly cleanup to prevent unbounded memory growth ───────────────────────

setInterval(() => {
  const cutoff = Date.now() - RECORD_TTL_MS;
  let pruned   = 0;
  for (const [ip, r] of store) {
    if (r.lastSeenAt < cutoff && r.blockUntil < Date.now()) {
      store.delete(ip);
      pruned++;
    }
  }
  if (pruned > 0) {
    logger.info({ pruned, remaining: store.size }, "[threat] Pruned inactive IP records");
  }
}, 60 * 60 * 1000);

// ─── Helper: is this a loopback / trusted local address? ─────────────────────

function isLocalAddress(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1"       ||
    ip.startsWith("::ffff:127.") || // IPv4-mapped loopback
    ip === "unknown"
  );
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function threatMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";

  // Never block localhost / health checks from the same machine
  if (isLocalAddress(ip)) return next();

  const r   = getRecord(ip);
  const now = Date.now();

  // ── 1. Enforce active block ─────────────────────────────────────────────────
  if (r.blockUntil > now) {
    const retryAfter = Math.ceil((r.blockUntil - now) / 1_000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      error:      "Too many requests",
      message:    "Your IP has been temporarily blocked due to suspicious activity. Please try again later.",
      retryAfter,
    });
    return;
  }

  // ── 2. Track API request rate ───────────────────────────────────────────────
  const isApiPath = req.originalUrl.startsWith("/api/") || req.originalUrl.startsWith("/v1/");
  if (isApiPath) {
    if (now - r.reqWindowStart > 60_000) {
      r.reqCount      = 0;
      r.reqWindowStart = now;
    }
    r.reqCount++;

    if (r.reqCount > REQ_RATE_LIMIT) {
      recordViolation(ip, 1, `API request rate ${r.reqCount}/min exceeds ${REQ_RATE_LIMIT}`);
    }
  }

  // ── 3. Score the response after it's sent ───────────────────────────────────
  res.on("finish", () => {
    const status     = res.statusCode;
    const score      = VIOLATION_SCORES[status];
    const isAuthPath = AUTH_PATHS.has(req.path);

    if (score !== undefined) {
      // 401/403 on auth/OTP paths are normal user mistakes — don't penalise.
      // 429 still scores everywhere (rate-limit abuse is always suspicious).
      if (isAuthPath && (status === 401 || status === 403)) return;
      recordViolation(ip, score, `HTTP ${status} on ${req.method} ${req.path}`);
      return;
    }

    // 404 on /api or /v1 paths indicates endpoint scanning
    if (status === 404 && isApiPath) {
      recordViolation(ip, 1, `404 probe on ${req.method} ${req.path}`);
    }
  });

  next();
}

// ─── Admin introspection ──────────────────────────────────────────────────────

export interface BlockedIpEntry {
  ip:         string;
  blockUntil: string;  // ISO timestamp
  blockCount: number;
  retryAfterSec: number;
}

export function getBlockedIps(): BlockedIpEntry[] {
  const now = Date.now();
  const out: BlockedIpEntry[] = [];
  for (const [ip, r] of store) {
    if (r.blockUntil > now) {
      out.push({
        ip,
        blockUntil:    new Date(r.blockUntil).toISOString(),
        blockCount:    r.blockCount,
        retryAfterSec: Math.ceil((r.blockUntil - now) / 1_000),
      });
    }
  }
  return out.sort((a, b) => b.retryAfterSec - a.retryAfterSec);
}

export function getIpStats(ip: string): IpRecord | undefined {
  return store.get(ip);
}

export function unblockIp(ip: string): boolean {
  const r = store.get(ip);
  if (!r) return false;
  r.blockUntil  = 0;
  r.violations  = [];
  logger.info({ ip }, "[threat] IP manually unblocked");
  return true;
}