import crypto from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { db, developerApiKeysTable, developersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ─── In-memory rate limit store (per API key, per minute window) ───────────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100; // req/min per key

function checkRateLimit(keyHash: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowMs = 60_000;
  let entry = rateLimitStore.get(keyHash);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    rateLimitStore.set(keyHash, entry);
  }

  entry.count++;
  const remaining = Math.max(0, RATE_LIMIT - entry.count);
  return {
    allowed:  entry.count <= RATE_LIMIT,
    remaining,
    resetAt:  entry.resetAt,
  };
}

function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export interface DeveloperContext {
  developerId: number;
  merchantId:  string;
  keyId:       number;
  keyType:     "live" | "test";
}

declare global {
  namespace Express {
    interface Request {
      developer?: DeveloperContext;
    }
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({
      error:   "Unauthorized",
      message: "Missing Authorization: Bearer <api_key> header",
    });
    return;
  }

  const token = authHeader.slice(7).trim();

  if (!token.startsWith("live_sk_") && !token.startsWith("test_sk_")) {
    res.status(401).json({ error: "Unauthorized", message: "Invalid API key format. Keys must start with live_sk_ or test_sk_" });
    return;
  }

  const keyHash = hashApiKey(token);

  try {
    const [keyRow] = await db
      .select({
        id:          developerApiKeysTable.id,
        developerId: developerApiKeysTable.developerId,
        type:        developerApiKeysTable.type,
        active:      developerApiKeysTable.active,
        merchantId:  developersTable.merchantId,
      })
      .from(developerApiKeysTable)
      .innerJoin(developersTable, eq(developerApiKeysTable.developerId, developersTable.id))
      .where(
        and(
          eq(developerApiKeysTable.keyHash, keyHash),
          eq(developerApiKeysTable.active, true),
        ),
      )
      .limit(1);

    if (!keyRow) {
      res.status(401).json({ error: "Unauthorized", message: "Invalid or revoked API key" });
      return;
    }

    const rl = checkRateLimit(keyHash);
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.floor(rl.resetAt / 1000)));

    if (!rl.allowed) {
      res.status(429).json({
        error:   "Too Many Requests",
        message: `Rate limit exceeded. ${RATE_LIMIT} requests/minute per API key.`,
      });
      return;
    }

    db.update(developerApiKeysTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(developerApiKeysTable.id, keyRow.id))
      .catch(() => {});

    req.developer = {
      developerId: keyRow.developerId,
      merchantId:  keyRow.merchantId,
      keyId:       keyRow.id,
      keyType:     keyRow.type as "live" | "test",
    };
    next();
  } catch {
    res.status(500).json({ error: "Internal server error", message: "Failed to validate API key" });
  }
}
