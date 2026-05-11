/**
 * Subscription renewal reminder + auto-expire cron job.
 *
 * Logic (run hourly via system crontab):
 *   - For every active subscription whose currentPeriodEnd is within the next 3 days
 *     AND a reminder hasn't been sent in the last 22h → send expiry-warning email
 *     and update renewalReminderSentAt = now.
 *   - For every active subscription whose currentPeriodEnd has passed → mark
 *     status = 'expired' and endedAt = now (no auto-renew).
 *
 * Auth: requires header `x-cron-secret` matching CRON_SECRET env var.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db/index.js';
import { subscriptions, users, pricingPlans } from '$lib/server/db/schema.js';
import { and, eq, lte, gte, lt, or, isNull } from 'drizzle-orm';
import { emailService } from '$lib/server/email.js';

const REMINDER_WINDOW_DAYS = 3;
const REMINDER_COOLDOWN_HOURS = 22;

export const POST: RequestHandler = async ({ request }) => {
  const secret = request.headers.get('x-cron-secret');
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const reminderHorizon = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const cooldownCutoff = new Date(now.getTime() - REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000);

  let remindersSent = 0;
  let expired = 0;
  const errors: string[] = [];

  // 1) Auto-expire past-due subscriptions
  try {
    const past = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.status, 'active'), lt(subscriptions.currentPeriodEnd, now)));
    for (const row of past) {
      await db
        .update(subscriptions)
        .set({ status: 'expired', endedAt: now, updatedAt: now })
        .where(eq(subscriptions.id, row.id));
      expired++;
    }
  } catch (e) {
    errors.push(`expire: ${(e as Error).message}`);
  }

  // 2) Send reminder for subs expiring within window (and not reminded recently)
  try {
    const upcoming = await db
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        planTier: subscriptions.planTier,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        renewalReminderSentAt: subscriptions.renewalReminderSentAt,
        email: users.email,
        name: users.name,
      })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .where(
        and(
          eq(subscriptions.status, 'active'),
          gte(subscriptions.currentPeriodEnd, now),
          lte(subscriptions.currentPeriodEnd, reminderHorizon)
        )
      );

    for (const sub of upcoming) {
      if (
        sub.renewalReminderSentAt &&
        new Date(sub.renewalReminderSentAt).getTime() > cooldownCutoff.getTime()
      ) {
        continue; // already reminded in cooldown window
      }
      if (!sub.email) continue;
      const expiryDate = new Date(sub.currentPeriodEnd);
      const days = Math.max(
        0,
        Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      );

      // Resolve plan display name
      let planName = sub.planTier;
      try {
        const [p] = await db
          .select({ name: pricingPlans.name })
          .from(pricingPlans)
          .where(eq(pricingPlans.tier, sub.planTier))
          .limit(1);
        if (p?.name) planName = p.name;
      } catch {
        /* ignore */
      }

      try {
        await emailService.sendExpiryWarningEmail({
          email: sub.email,
          name: sub.name || undefined,
          planName,
          expiryDate: expiryDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
          daysRemaining: days,
        });
        await db
          .update(subscriptions)
          .set({ renewalReminderSentAt: now, updatedAt: now })
          .where(eq(subscriptions.id, sub.id));
        remindersSent++;
      } catch (e) {
        errors.push(`reminder ${sub.id}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    errors.push(`reminders: ${(e as Error).message}`);
  }

  return json({
    ok: true,
    timestamp: now.toISOString(),
    remindersSent,
    expired,
    errors,
  });
};

export const GET: RequestHandler = async (event) => {
  // Convenience for health checks (returns counts but no work done)
  const secret = event.request.headers.get('x-cron-secret');
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  return json({ ok: true, message: 'cron endpoint is reachable' });
};
