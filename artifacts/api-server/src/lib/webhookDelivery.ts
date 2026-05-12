import crypto from "node:crypto";
import { db, webhookEndpointsTable, webhookEventsTable } from "@workspace/db";
import { eq, and, isNull, lte } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Retry schedule: 5 attempts ───────────────────────────────────────────────
// Attempt 1: immediate
// Attempt 2: +1 min
// Attempt 3: +5 min
// Attempt 4: +30 min
// Attempt 5: +2 hr
const RETRY_DELAYS_MS = [0, 60_000, 300_000, 1_800_000, 7_200_000];

function nextRetryDelay(attemptCount: number): number | null {
  return attemptCount < RETRY_DELAYS_MS.length
    ? RETRY_DELAYS_MS[attemptCount]!
    : null;
}

function sign(payload: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// ─── Enqueue a webhook event ──────────────────────────────────────────────────
// Called by route handlers and billing worker on any subscription state change.
// Looks up all active endpoints for the merchant and creates one event row per endpoint.

export async function enqueueWebhook(
  developerId: number,
  eventType:   string,
  data:        Record<string, unknown>,
): Promise<void> {
  try {
    const endpoints = await db
      .select()
      .from(webhookEndpointsTable)
      .where(
        and(
          eq(webhookEndpointsTable.developerId, developerId),
          eq(webhookEndpointsTable.active, true),
        ),
      );

    if (endpoints.length === 0) return;

    const eventId   = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    for (const endpoint of endpoints) {
      const payload = JSON.stringify({
        event_id:    eventId,
        event_type:  eventType,
        created_at:  createdAt,
        developer_id: developerId,
        data,
      });

      await db.insert(webhookEventsTable).values({
        developerId,
        endpointId:   endpoint.id,
        eventId:      `${eventId}-${endpoint.id}`,
        eventType,
        payload,
        nextRetryAt:  new Date(),
      });
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "[webhookDelivery] enqueue error");
  }
}

// ─── Deliver a single webhook event row ──────────────────────────────────────

async function deliverEvent(event: typeof webhookEventsTable.$inferSelect): Promise<void> {
  const [endpoint] = await db
    .select()
    .from(webhookEndpointsTable)
    .where(eq(webhookEndpointsTable.id, event.endpointId))
    .limit(1);

  if (!endpoint || !endpoint.active) {
    await db.update(webhookEventsTable)
      .set({ lastError: "Endpoint disabled or deleted", nextRetryAt: null })
      .where(eq(webhookEventsTable.id, event.id));
    return;
  }

  const signature = sign(event.payload, endpoint.secret);

  let statusCode: number | null = null;
  let errorMsg: string | null   = null;
  let delivered                 = false;

  try {
    const resp = await fetch(endpoint.url, {
      method:  "POST",
      headers: {
        "Content-Type":    "application/json",
        "X-Signature-256": signature,
        "X-Event-Type":    event.eventType,
        "User-Agent":      "Sweep-Webhook/1.0",
      },
      body:    event.payload,
      signal:  AbortSignal.timeout(15_000),
    });

    statusCode = resp.status;
    delivered  = resp.ok;
    if (!resp.ok) errorMsg = `HTTP ${resp.status}`;
  } catch (err: any) {
    errorMsg = err.message ?? "Network error";
  }

  const newCount    = event.attemptCount + 1;
  const retryDelay  = nextRetryDelay(newCount);

  await db.update(webhookEventsTable).set({
    attemptCount:   newCount,
    lastStatusCode: statusCode,
    lastError:      errorMsg,
    deliveredAt:    delivered ? new Date() : null,
    nextRetryAt:    delivered || retryDelay === null
      ? null
      : new Date(Date.now() + retryDelay),
  }).where(eq(webhookEventsTable.id, event.id));

  if (delivered) {
    logger.info({ eventId: event.eventId, endpoint: endpoint.url }, "[webhookDelivery] delivered");
  } else if (retryDelay === null) {
    logger.warn({ eventId: event.eventId, attempts: newCount }, "[webhookDelivery] max retries exhausted");
  }
}

// ─── Worker: poll for pending events and deliver them ─────────────────────────

let workerTimer: ReturnType<typeof setInterval> | null = null;
export let webhookWorkerLastRunAt: Date | null = null;
export const WEBHOOK_WORKER_INTERVAL_MS = 30_000;

async function runDeliveryPass(): Promise<void> {
  try {
    const pending = await db
      .select()
      .from(webhookEventsTable)
      .where(
        and(
          isNull(webhookEventsTable.deliveredAt),
          lte(webhookEventsTable.nextRetryAt, new Date()),
        ),
      )
      .limit(50);

    await Promise.allSettled(pending.map(deliverEvent));
    webhookWorkerLastRunAt = new Date();
  } catch (err: any) {
    logger.error({ err: err.message }, "[webhookDelivery] worker pass error");
  }
}

export function startWebhookDeliveryWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(runDeliveryPass, 30_000); // every 30 s
  void runDeliveryPass(); // immediate first pass
  logger.info("[webhookDelivery] worker started");
}

export function stopWebhookDeliveryWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}