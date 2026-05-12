/**
 * POST   /v1/webhooks       — register a webhook endpoint
 * GET    /v1/webhooks       — list registered webhooks
 * DELETE /v1/webhooks/:id   — remove a webhook endpoint
 * GET    /v1/webhooks/:id/events — delivery log for an endpoint
 * POST   /v1/webhooks/:webhook_id/replay/:event_id — replay a specific event
 */

import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { db, webhookEndpointsTable, webhookEventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireApiKey } from "../../lib/apiKeyAuth.js";
import { logger } from "../../lib/logger.js";

const router: IRouter = Router();

// ─── POST /v1/webhooks ────────────────────────────────────────────────────────

router.post("/", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const { url, label } = req.body as { url?: string; label?: string };

    if (!url?.trim()) {
      res.status(400).json({ error: "Validation", message: "url is required" });
      return;
    }
    try { new URL(url); } catch {
      res.status(400).json({ error: "Validation", message: "url must be a valid HTTPS URL" });
      return;
    }
    if (!url.startsWith("https://") && process.env.NODE_ENV === "production") {
      res.status(400).json({ error: "Validation", message: "url must use HTTPS" });
      return;
    }

    const secret = "whsec_" + crypto.randomBytes(24).toString("hex");

    const [endpoint] = await db.insert(webhookEndpointsTable).values({
      developerId: dev.developerId,
      url:         url.trim(),
      secret,
      label:       label?.trim() || "Default",
    }).returning();

    logger.info({ developerId: dev.developerId, url }, "[v1/webhooks] Registered");

    res.status(201).json({
      id:         endpoint!.id,
      url:        endpoint!.url,
      label:      endpoint!.label,
      secret,           // shown once — store it for signature verification
      active:     true,
      created_at: endpoint!.createdAt,
      message:    "Store the secret — it is shown once and used to verify webhook signatures.",
    });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /v1/webhooks ─────────────────────────────────────────────────────────

router.get("/", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const endpoints = await db
      .select({
        id:         webhookEndpointsTable.id,
        url:        webhookEndpointsTable.url,
        label:      webhookEndpointsTable.label,
        active:     webhookEndpointsTable.active,
        createdAt:  webhookEndpointsTable.createdAt,
      })
      .from(webhookEndpointsTable)
      .where(eq(webhookEndpointsTable.developerId, dev.developerId));

    res.json({ webhooks: endpoints, total: endpoints.length });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── DELETE /v1/webhooks/:id ──────────────────────────────────────────────────

router.delete("/:id", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const id  = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Validation", message: "Invalid webhook ID" });
      return;
    }

    const [endpoint] = await db
      .select()
      .from(webhookEndpointsTable)
      .where(
        and(
          eq(webhookEndpointsTable.id, id),
          eq(webhookEndpointsTable.developerId, dev.developerId),
        ),
      )
      .limit(1);

    if (!endpoint) {
      res.status(404).json({ error: "Not found", message: "Webhook not found" });
      return;
    }

    await db.update(webhookEndpointsTable)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(webhookEndpointsTable.id, id));

    res.json({ message: "Webhook endpoint removed" });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── GET /v1/webhooks/:id/events ─────────────────────────────────────────────

router.get("/:id/events", requireApiKey, async (req, res) => {
  try {
    const dev = req.developer!;
    const id  = parseInt(String(req.params["id"]), 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Validation", message: "Invalid webhook ID" });
      return;
    }

    const [endpoint] = await db
      .select()
      .from(webhookEndpointsTable)
      .where(
        and(
          eq(webhookEndpointsTable.id, id),
          eq(webhookEndpointsTable.developerId, dev.developerId),
        ),
      )
      .limit(1);

    if (!endpoint) {
      res.status(404).json({ error: "Not found", message: "Webhook not found" });
      return;
    }

    const events = await db
      .select()
      .from(webhookEventsTable)
      .where(eq(webhookEventsTable.endpointId, id));

    res.json({ events: events.map((e) => ({
      id:              e.id,
      event_id:        e.eventId,
      event_type:      e.eventType,
      attempt_count:   e.attemptCount,
      delivered_at:    e.deliveredAt,
      last_status_code: e.lastStatusCode,
      last_error:      e.lastError,
      next_retry_at:   e.nextRetryAt,
      created_at:      e.createdAt,
    })), total: events.length });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

// ─── POST /v1/webhooks/:webhook_id/replay/:event_id ──────────────────────────

router.post("/:webhook_id/replay/:event_id", requireApiKey, async (req, res) => {
  try {
    const dev        = req.developer!;
    const webhookId  = parseInt(String(req.params["webhook_id"]), 10);
    const eventRowId = parseInt(String(req.params["event_id"]), 10);

    const [endpoint] = await db
      .select()
      .from(webhookEndpointsTable)
      .where(
        and(
          eq(webhookEndpointsTable.id, webhookId),
          eq(webhookEndpointsTable.developerId, dev.developerId),
        ),
      )
      .limit(1);

    if (!endpoint) {
      res.status(404).json({ error: "Not found", message: "Webhook not found" });
      return;
    }

    const [event] = await db
      .select()
      .from(webhookEventsTable)
      .where(
        and(
          eq(webhookEventsTable.id, eventRowId),
          eq(webhookEventsTable.endpointId, webhookId),
        ),
      )
      .limit(1);

    if (!event) {
      res.status(404).json({ error: "Not found", message: "Event not found" });
      return;
    }

    // Reset for re-delivery
    await db.update(webhookEventsTable).set({
      deliveredAt:  null,
      nextRetryAt:  new Date(),
      attemptCount: 0,
      lastError:    null,
      lastStatusCode: null,
    }).where(eq(webhookEventsTable.id, event.id));

    res.json({ message: "Event queued for replay", event_id: event.eventId });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;