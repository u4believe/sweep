/**
 * Face ID / fingerprint (passkeys).
 *   GET    /api/webauthn/credentials          — this user's registered devices
 *   POST   /api/webauthn/register/options     — start adding this device
 *   POST   /api/webauthn/register/verify      — finish adding it { response, deviceName }
 *   DELETE /api/webauthn/credentials/:id      — remove a device
 *   POST   /api/webauthn/approve/options      — challenge for approving a transaction
 */

import { Router, type IRouter } from "express";
import { db, usersTable, webauthnCredentialsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireEmailVerified } from "../lib/auth.js";
import { hasTotp } from "../lib/two-factor.js";
import { approvalKey, authenticationOptions, listCredentials, registrationOptions, rpFor, verifyRegistration } from "../lib/webauthn.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const BAD_ORIGIN = { error: "Unsupported origin", message: "Face ID / fingerprint only works on the Sweep app." };
const NEEDS_2FA  = { error: "Two-factor required", code: "TWO_FACTOR_REQUIRED", message: "Turn on two-factor authentication before setting up Face ID / fingerprint." };

const userHasTotp = async (userId: number) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return !!user && hasTotp(user);
};

router.get("/credentials", requireAuth, async (req, res) => {
  const { userId } = (req as any).user;
  const creds = await listCredentials(userId);
  res.json({
    credentials: creds.map((c) => ({ id: c.id, credentialId: c.credentialId, deviceName: c.deviceName, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt })),
  });
});

router.post("/register/options", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const rp = rpFor(req.headers.origin);
    if (!rp) { res.status(400).json(BAD_ORIGIN); return; }
    const { userId } = (req as any).user;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "Not found", message: "User not found" }); return; }
    if (!hasTotp(user)) { res.status(403).json(NEEDS_2FA); return; }
    res.json(await registrationOptions(user, rp));
  } catch (err: any) {
    logger.error({ err: err.message }, "[webauthn] register options");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

router.post("/register/verify", requireAuth, requireEmailVerified, async (req, res) => {
  try {
    const { userId } = (req as any).user;
    const { response, deviceName } = req.body ?? {};
    if (!(await userHasTotp(userId))) { res.status(403).json(NEEDS_2FA); return; }
    const row = await verifyRegistration(userId, response, typeof deviceName === "string" ? deviceName : undefined);
    logger.info({ userId, credentialId: row.id }, "[webauthn] Device registered");
    res.json({ success: true, credential: { id: row.id, credentialId: row.credentialId, deviceName: row.deviceName } });
  } catch (err: any) {
    res.status(400).json({ error: "Registration failed", message: err?.message ?? "Face ID / fingerprint couldn't be set up." });
  }
});

router.delete("/credentials/:id", requireAuth, async (req, res) => {
  const { userId } = (req as any).user;
  const id = parseInt(String(req.params["id"]), 10);
  const rows = await db.delete(webauthnCredentialsTable)
    .where(and(eq(webauthnCredentialsTable.id, id), eq(webauthnCredentialsTable.userId, userId)))
    .returning({ id: webauthnCredentialsTable.id });
  if (!rows.length) { res.status(404).json({ error: "Not found", message: "Device not found" }); return; }
  res.json({ success: true });
});

router.post("/approve/options", requireAuth, async (req, res) => {
  try {
    const rp = rpFor(req.headers.origin);
    if (!rp) { res.status(400).json(BAD_ORIGIN); return; }
    const { userId } = (req as any).user;
    const options = (await userHasTotp(userId)) ? await authenticationOptions(userId, approvalKey(userId), rp) : null;
    if (!options) { res.status(404).json({ error: "Not set up", message: "Face ID / fingerprint isn't set up on this account." }); return; }
    res.json(options);
  } catch (err: any) {
    logger.error({ err: err.message }, "[webauthn] approve options");
    res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;
