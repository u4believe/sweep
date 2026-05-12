import { db, usersTable, escrowsTable } from "@workspace/db";
import {
  subscriptionsTable,
  subscriptionPlansTable,
  subscriptionPaymentsTable,
  developersTable,
} from "@workspace/db";
import { eq, and, lte, lt, ne } from "drizzle-orm";
import { enqueueWebhook } from "./webhookDelivery.js";
import { logger } from "./logger.js";
import { hashEmail, parseUsdcAmount } from "./escrow.js";
import {
  sendSubscriptionBillingSuccessEmail,
  sendSubscriptionBillingFailureEmail,
  sendCreatorRenewalEmail,
  sendCreatorPaymentFailedEmail,
  sendCreatorCancelledEmail,
  sendCreatorTrialEndingSoonEmail,
  sendSubscriptionTrialEndingSoonEmail,
} from "./email.js";

const MAX_RETRIES = 7;

type Interval = "weekly" | "monthly" | "yearly";

function advanceBillingDate(from: Date, interval: Interval): Date {
  const next = new Date(from);
  if (interval === "weekly")  next.setDate(next.getDate() + 7);
  if (interval === "monthly") next.setMonth(next.getMonth() + 1);
  if (interval === "yearly")  next.setFullYear(next.getFullYear() + 1);
  return next;
}

async function attemptBilling(
  sub:        typeof subscriptionsTable.$inferSelect,
  plan:       typeof subscriptionPlansTable.$inferSelect,
  subscriber: typeof usersTable.$inferSelect,
): Promise<boolean> {
  const amount       = parseFloat(sub.amount);
  const balance      = parseFloat(subscriber.claimedBalance ?? "0");

  if (balance < amount) return false;

  const newBalance   = (balance - amount).toFixed(6);
  const creatorEmail = plan.paymentEmail.toLowerCase().trim();
  const emailHash    = hashEmail(creatorEmail);

  const [creatorUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, creatorEmail))
    .limit(1);

  await db.transaction(async (tx) => {
    await tx.update(usersTable)
      .set({ claimedBalance: newBalance })
      .where(eq(usersTable.id, subscriber.id));

    if (creatorUser) {
      const creatorNewBalance = (parseFloat(creatorUser.claimedBalance ?? "0") + amount).toFixed(6);
      await tx.update(usersTable)
        .set({ claimedBalance: creatorNewBalance })
        .where(eq(usersTable.id, creatorUser.id));

      await tx.insert(escrowsTable).values({
        senderAddress:   subscriber.email,
        recipientEmail:  creatorEmail,
        emailHash,
        amount:          amount.toFixed(6),
        amountWei:       parseUsdcAmount(amount.toFixed(6)).toString(),
        status:          "claimed",
        recipientUserId: creatorUser.id,
        claimedAt:       new Date(),
      });
    } else {
      await tx.insert(escrowsTable).values({
        senderAddress:  subscriber.email,
        recipientEmail: creatorEmail,
        emailHash,
        amount:         amount.toFixed(6),
        amountWei:      parseUsdcAmount(amount.toFixed(6)).toString(),
        status:         "pending",
      });
    }
  });

  return true;
}

// Look up developer ID for a given merchant ID (null for creator-class plans)
async function getDeveloperIdForMerchant(merchantId: string): Promise<number | null> {
  const [dev] = await db
    .select({ id: developersTable.id })
    .from(developersTable)
    .where(eq(developersTable.merchantId, merchantId))
    .limit(1);
  return dev?.id ?? null;
}

async function recordPayment(
  subId: number,
  merchantId: string,
  amount: string,
  status: "succeeded" | "failed",
  failureReason?: string,
): Promise<void> {
  try {
    await db.insert(subscriptionPaymentsTable).values({
      subscriptionId: subId,
      merchantId,
      amount,
      currency: "USD",
      status,
      failureReason: failureReason ?? null,
    });
  } catch { /* non-fatal */ }
}

async function countActiveSubs(planId: number): Promise<number> {
  const rows = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.planId, planId),
        ne(subscriptionsTable.status, "cancelled"),
        ne(subscriptionsTable.status, "failed"),
      ),
    );
  return rows.length;
}

export async function processSubscriptionBilling() {
  try {
    const now         = new Date();
    const oneDayAgo   = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const in3Days     = new Date(now.getTime() + threeDaysMs);

    // ── 0. Trial ending soon (3-day warning to creator) ──────────────────────
    const trialEndingSoon = await db
      .select({ sub: subscriptionsTable, plan: subscriptionPlansTable })
      .from(subscriptionsTable)
      .innerJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, subscriptionsTable.planId))
      .where(
        and(
          eq(subscriptionsTable.status, "trialing"),
          lte(subscriptionsTable.trialEndsAt, in3Days),
          // trialEndsAt > now (hasn't ended yet)
        ),
      );

    for (const { sub, plan } of trialEndingSoon) {
      if (!sub.trialEndsAt || sub.trialEndsAt <= now) continue;
      const [subscriber] = await db.select().from(usersTable)
        .where(eq(usersTable.id, sub.subscriberUserId)).limit(1);
      if (!subscriber) continue;
      try {
        await sendCreatorTrialEndingSoonEmail(
          plan.paymentEmail, subscriber.email, plan.planTitle, sub.trialEndsAt,
        );
      } catch (emailErr) {
        logger.warn({ err: emailErr }, "[subscriptionWorker] Failed to send trial-ending-soon email to creator");
      }
      try {
        await sendSubscriptionTrialEndingSoonEmail(
          subscriber.email, plan.planTitle, sub.amount, sub.planInterval, sub.trialEndsAt,
        );
      } catch (emailErr) {
        logger.warn({ err: emailErr }, "[subscriptionWorker] Failed to send trial-ending-soon email to subscriber");
      }
    }

    // ── 1. Trial → first billing ─────────────────────────────────────────────
    const trialingDue = await db
      .select({ sub: subscriptionsTable, plan: subscriptionPlansTable })
      .from(subscriptionsTable)
      .innerJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, subscriptionsTable.planId))
      .where(
        and(
          eq(subscriptionsTable.status, "trialing"),
          lte(subscriptionsTable.trialEndsAt, now),
        ),
      );

    for (const { sub, plan } of trialingDue) {
      const [subscriber] = await db.select().from(usersTable)
        .where(eq(usersTable.id, sub.subscriberUserId)).limit(1);
      if (!subscriber) continue;

      try {
        const success = await attemptBilling(sub, plan, subscriber);

        if (success) {
          const nextBillingAt = advanceBillingDate(now, sub.planInterval as Interval);
          await db.update(subscriptionsTable)
            .set({ status: "active", nextBillingAt, retryCount: 0, updatedAt: now })
            .where(eq(subscriptionsTable.id, sub.id));

          void recordPayment(sub.id, sub.merchantId, sub.amount, "succeeded");
          try { await sendSubscriptionBillingSuccessEmail(subscriber.email, plan.planTitle, sub.amount, sub.planInterval, nextBillingAt); } catch {}
          try { await sendCreatorRenewalEmail(plan.paymentEmail, subscriber.email, plan.planTitle, sub.amount, sub.planInterval); } catch {}
          getDeveloperIdForMerchant(sub.merchantId).then((devId) => {
            if (devId) enqueueWebhook(devId, "subscription.renewed", { subscription_id: sub.id, external_ref: sub.externalRef ?? null, amount: sub.amount, merchant_id: sub.merchantId, next_billing_date: nextBillingAt }).catch(() => {});
          }).catch(() => {});
          logger.info({ subscriptionId: sub.id }, "[subscriptionWorker] Trial ended — first billing succeeded");
        } else {
          await db.update(subscriptionsTable)
            .set({ status: "past_due", retryCount: 1, lastRetryAt: now, updatedAt: now })
            .where(eq(subscriptionsTable.id, sub.id));

          void recordPayment(sub.id, sub.merchantId, sub.amount, "failed", "insufficient_balance");
          try { await sendSubscriptionBillingFailureEmail(subscriber.email, plan.planTitle, sub.amount, 1); } catch {}
          try { await sendCreatorPaymentFailedEmail(plan.paymentEmail, subscriber.email, plan.planTitle); } catch {}
          getDeveloperIdForMerchant(sub.merchantId).then((devId) => {
            if (devId) enqueueWebhook(devId, "subscription.past_due", { subscription_id: sub.id, external_ref: sub.externalRef ?? null, merchant_id: sub.merchantId, retry_count: 1 }).catch(() => {});
          }).catch(() => {});
          logger.info({ subscriptionId: sub.id }, "[subscriptionWorker] Trial ended — first billing failed → past_due");
        }
      } catch (err: any) {
        logger.error({ err: err.message, subscriptionId: sub.id }, "[subscriptionWorker] Trial billing error");
      }
    }

    // ── 2. Active renewal billing ─────────────────────────────────────────────
    const activeDue = await db
      .select({ sub: subscriptionsTable, plan: subscriptionPlansTable })
      .from(subscriptionsTable)
      .innerJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, subscriptionsTable.planId))
      .where(
        and(
          eq(subscriptionsTable.status, "active"),
          lte(subscriptionsTable.nextBillingAt, now),
        ),
      );

    for (const { sub, plan } of activeDue) {
      const [subscriber] = await db.select().from(usersTable)
        .where(eq(usersTable.id, sub.subscriberUserId)).limit(1);
      if (!subscriber) continue;

      try {
        const success       = await attemptBilling(sub, plan, subscriber);
        const nextBillingAt = advanceBillingDate(now, sub.planInterval as Interval);

        if (success) {
          await db.update(subscriptionsTable)
            .set({ nextBillingAt, retryCount: 0, updatedAt: now })
            .where(eq(subscriptionsTable.id, sub.id));

          void recordPayment(sub.id, sub.merchantId, sub.amount, "succeeded");
          try { await sendSubscriptionBillingSuccessEmail(subscriber.email, plan.planTitle, sub.amount, sub.planInterval, nextBillingAt); } catch {}
          try { await sendCreatorRenewalEmail(plan.paymentEmail, subscriber.email, plan.planTitle, sub.amount, sub.planInterval); } catch {}
          getDeveloperIdForMerchant(sub.merchantId).then((devId) => {
            if (devId) enqueueWebhook(devId, "subscription.renewed", { subscription_id: sub.id, external_ref: sub.externalRef ?? null, amount: sub.amount, merchant_id: sub.merchantId, next_billing_date: nextBillingAt }).catch(() => {});
          }).catch(() => {});
          logger.info({ subscriptionId: sub.id }, "[subscriptionWorker] Renewal billing succeeded");
        } else {
          await db.update(subscriptionsTable)
            .set({ status: "past_due", retryCount: 1, lastRetryAt: now, updatedAt: now })
            .where(eq(subscriptionsTable.id, sub.id));

          void recordPayment(sub.id, sub.merchantId, sub.amount, "failed", "insufficient_balance");
          try { await sendSubscriptionBillingFailureEmail(subscriber.email, plan.planTitle, sub.amount, 1); } catch {}
          try { await sendCreatorPaymentFailedEmail(plan.paymentEmail, subscriber.email, plan.planTitle); } catch {}
          getDeveloperIdForMerchant(sub.merchantId).then((devId) => {
            if (devId) enqueueWebhook(devId, "subscription.past_due", { subscription_id: sub.id, external_ref: sub.externalRef ?? null, merchant_id: sub.merchantId, retry_count: 1 }).catch(() => {});
          }).catch(() => {});
          logger.info({ subscriptionId: sub.id }, "[subscriptionWorker] Renewal billing failed → past_due");
        }
      } catch (err: any) {
        logger.error({ err: err.message, subscriptionId: sub.id }, "[subscriptionWorker] Renewal billing error");
      }
    }

    // ── 3. Past-due daily retry ───────────────────────────────────────────────
    const pastDueRetry = await db
      .select({ sub: subscriptionsTable, plan: subscriptionPlansTable })
      .from(subscriptionsTable)
      .innerJoin(subscriptionPlansTable, eq(subscriptionPlansTable.id, subscriptionsTable.planId))
      .where(
        and(
          eq(subscriptionsTable.status, "past_due"),
          lte(subscriptionsTable.lastRetryAt, oneDayAgo),
          lt(subscriptionsTable.retryCount, MAX_RETRIES),
        ),
      );

    for (const { sub, plan } of pastDueRetry) {
      const [subscriber] = await db.select().from(usersTable)
        .where(eq(usersTable.id, sub.subscriberUserId)).limit(1);
      if (!subscriber) continue;

      try {
        const success       = await attemptBilling(sub, plan, subscriber);
        const newRetryCount = sub.retryCount + 1;

        if (success) {
          const nextBillingAt = advanceBillingDate(now, sub.planInterval as Interval);
          await db.update(subscriptionsTable)
            .set({ status: "active", nextBillingAt, retryCount: 0, lastRetryAt: null, updatedAt: now })
            .where(eq(subscriptionsTable.id, sub.id));

          void recordPayment(sub.id, sub.merchantId, sub.amount, "succeeded");
          try { await sendSubscriptionBillingSuccessEmail(subscriber.email, plan.planTitle, sub.amount, sub.planInterval, nextBillingAt); } catch {}
          try { await sendCreatorRenewalEmail(plan.paymentEmail, subscriber.email, plan.planTitle, sub.amount, sub.planInterval); } catch {}
          getDeveloperIdForMerchant(sub.merchantId).then((devId) => {
            if (devId) enqueueWebhook(devId, "subscription.renewed", { subscription_id: sub.id, external_ref: sub.externalRef ?? null, amount: sub.amount, merchant_id: sub.merchantId, next_billing_date: nextBillingAt }).catch(() => {});
          }).catch(() => {});
          logger.info({ subscriptionId: sub.id }, "[subscriptionWorker] Retry billing succeeded → active");
        } else {
          const isFinalRetry = newRetryCount >= MAX_RETRIES;
          await db.update(subscriptionsTable)
            .set({ status: isFinalRetry ? "failed" : "past_due", retryCount: newRetryCount, lastRetryAt: now, updatedAt: now })
            .where(eq(subscriptionsTable.id, sub.id));

          void recordPayment(sub.id, sub.merchantId, sub.amount, "failed", "insufficient_balance");
          try { await sendSubscriptionBillingFailureEmail(subscriber.email, plan.planTitle, sub.amount, newRetryCount); } catch {}

          if (isFinalRetry) {
            try {
              const remaining = await countActiveSubs(plan.id);
              await sendCreatorCancelledEmail(plan.paymentEmail, subscriber.email, plan.planTitle, "retry exhaustion", remaining);
            } catch {}
            getDeveloperIdForMerchant(sub.merchantId).then((devId) => {
              if (devId) enqueueWebhook(devId, "subscription.failed", { subscription_id: sub.id, external_ref: sub.externalRef ?? null, merchant_id: sub.merchantId, retry_count: newRetryCount }).catch(() => {});
            }).catch(() => {});
          } else {
            try { await sendCreatorPaymentFailedEmail(plan.paymentEmail, subscriber.email, plan.planTitle); } catch {}
            getDeveloperIdForMerchant(sub.merchantId).then((devId) => {
              if (devId) enqueueWebhook(devId, "subscription.past_due", { subscription_id: sub.id, external_ref: sub.externalRef ?? null, merchant_id: sub.merchantId, retry_count: newRetryCount }).catch(() => {});
            }).catch(() => {});
          }

          logger.info(
            { subscriptionId: sub.id, retryCount: newRetryCount, failed: isFinalRetry },
            isFinalRetry ? "[subscriptionWorker] Retries exhausted → failed" : "[subscriptionWorker] Retry billing failed",
          );
        }
      } catch (err: any) {
        logger.error({ err: err.message, subscriptionId: sub.id }, "[subscriptionWorker] Retry billing error");
      }
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "[subscriptionWorker] processSubscriptionBilling error");
  }
}

let workerInterval: ReturnType<typeof setInterval> | null = null;
export let billingWorkerLastRunAt: Date | null = null;
export const BILLING_WORKER_INTERVAL_MS = 5 * 60 * 1000;

export function startSubscriptionBillingWorker() {
  if (workerInterval) return;
  logger.info("Starting Subscription Billing background worker...");
  const run = async () => { await processSubscriptionBilling(); billingWorkerLastRunAt = new Date(); };
  workerInterval = setInterval(run, BILLING_WORKER_INTERVAL_MS);
  void run();
}

export function stopSubscriptionBillingWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info("Stopped subscription billing worker");
  }
}
