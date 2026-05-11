import type { PageServerLoad, Actions } from './$types';
import { db, manualOrders, users, pricingPlans, subscriptions, paymentHistory, creditPlans } from '$lib/server/db';
import { desc, eq, and, count } from 'drizzle-orm';
import { fail, error } from '@sveltejs/kit';
import { CreditService } from '$lib/server/credit-service.js';
import { emailService } from '$lib/server/email.js';

const VALID_TABS = ['all', 'new', 'pending', 'completed', 'cancelled'] as const;
type Tab = typeof VALID_TABS[number];

export const load: PageServerLoad = async ({ url, locals }) => {
  const session = await (locals as any).auth?.();
  if (!session?.user?.isAdmin) throw error(403, 'Forbidden');

  const tabParam = (url.searchParams.get('tab') || 'all') as Tab;
  const tab: Tab = (VALID_TABS as readonly string[]).includes(tabParam) ? tabParam : 'all';

  const where = tab === 'all' ? undefined : eq(manualOrders.status, tab as any);

  const orders = await db
    .select({
      id: manualOrders.id,
      userEmail: manualOrders.userEmail,
      userId: manualOrders.userId,
      orderType: manualOrders.orderType,
      planName: manualOrders.planName,
      planTier: manualOrders.planTier,
      creditPlanId: manualOrders.creditPlanId,
      gateway: manualOrders.gateway,
      amount: manualOrders.amount,
      currency: manualOrders.currency,
      status: manualOrders.status,
      txnReference: manualOrders.txnReference,
      senderInfo: manualOrders.senderInfo,
      userNotes: manualOrders.userNotes,
      adminNotes: manualOrders.adminNotes,
      createdAt: manualOrders.createdAt,
      completedAt: manualOrders.completedAt,
    })
    .from(manualOrders)
    .where(where as any)
    .orderBy(desc(manualOrders.createdAt))
    .limit(200);

  const countsRaw = await db.select({ status: manualOrders.status, c: count() }).from(manualOrders).groupBy(manualOrders.status);
  const counts: Record<string, number> = { all: 0, new: 0, pending: 0, completed: 0, cancelled: 0 };
  for (const r of countsRaw) { counts[r.status] = Number(r.c); counts.all += Number(r.c); }

  return { orders, counts, activeTab: tab };
};

export const actions: Actions = {
  complete: async ({ request, locals }) => {
    const session = await (locals as any).auth?.();
    if (!session?.user?.isAdmin) return fail(403, { error: 'Forbidden' });
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const adminNotes = data.get('adminNotes')?.toString() || null;
    if (!id) return fail(400, { error: 'Missing order id' });

    const order = (await db.select().from(manualOrders).where(eq(manualOrders.id, id)).limit(1))[0];
    if (!order) return fail(404, { error: 'Order not found' });
    if (order.status === 'completed') return fail(400, { error: 'Order already completed' });

    const adminWho = session.user.email || session.user.id;
    const txnId = `manual_${order.id}`;
    const now = new Date();

    // Branch on order type
    if (order.orderType === 'credit' && order.creditPlanId && order.userId) {
      // Grant credits via existing service (idempotent on transactionId)
      try {
        await CreditService.purchaseCredits(order.userId, order.creditPlanId, 'opaybd', txnId);
      } catch (e: any) {
        return fail(500, { error: 'Failed to grant credits: ' + (e?.message || 'unknown') });
      }
    } else if (order.userId && order.planTier && order.planId) {
      // Create / update subscription row + update user planTier (mirror opay flow)
      const periodEnd = new Date(now);
      const [pricingPlan] = await db.select().from(pricingPlans).where(eq(pricingPlans.id, order.planId)).limit(1);
      const interval = pricingPlan?.billingInterval || 'month';
      if (interval === 'year') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      else periodEnd.setMonth(periodEnd.getMonth() + 1);

      await db.transaction(async (tx) => {
        const [existingSub] = await tx
          .select()
          .from(subscriptions)
          .where(and(eq(subscriptions.userId, order.userId!), eq(subscriptions.paymentProvider, 'opaybd')));

        if (existingSub) {
          await tx.update(subscriptions).set({
            stripePriceId: pricingPlan?.stripePriceId || existingSub.stripePriceId,
            planTier: order.planTier as any,
            previousPlanTier: existingSub.planTier,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            renewalRequired: false,
            opayTransactionId: txnId,
            lastPaymentAmount: order.amount,
            planChangedAt: existingSub.planTier !== order.planTier ? now : existingSub.planChangedAt,
            updatedAt: now,
          }).where(eq(subscriptions.id, existingSub.id));
        } else {
          await tx.insert(subscriptions).values({
            userId: order.userId!,
            stripeSubscriptionId: txnId,
            stripePriceId: pricingPlan?.stripePriceId || `manual_${order.planId}`,
            planTier: order.planTier as any,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            paymentProvider: 'opaybd',
            opayTransactionId: txnId,
            lastPaymentAmount: order.amount,
            renewalRequired: false,
          });
        }

        await tx.update(users).set({
          subscriptionStatus: 'active',
          planTier: order.planTier as any,
        }).where(eq(users.id, order.userId!));

        await tx.insert(paymentHistory).values({
          userId: order.userId!,
          subscriptionId: null,
          amount: order.amount,
          currency: order.currency || 'usd',
          status: 'succeeded',
          description: `Manual ${order.gateway} payment for ${order.planName || order.planTier}`,
          paymentProvider: 'opaybd',
          opayTransactionId: txnId,
          opayPaymentMethod: order.gateway,
          paidAt: now,
        });
      });
    }

    // Mark order completed
    await db.update(manualOrders).set({
      status: 'completed',
      adminNotes,
      completedBy: adminWho,
      completedAt: now,
      updatedAt: now,
    }).where(eq(manualOrders.id, id));

    // Send confirmation email to user (non-blocking)
    if (order.userEmail) {
      const amountStr = `${(order.amount / 100).toFixed(2)} ${(order.currency || 'usd').toUpperCase()}`;
      const isCredit = order.orderType === 'credit';
      void emailService.sendEmail({
        to: order.userEmail,
        subject: isCredit
          ? `Your credits are now active — ${order.planName}`
          : `Your subscription is now active — ${order.planName}`,
        html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
          <h2 style="margin:0 0 12px">Payment verified ✓</h2>
          <p>Your manual payment has been verified by our team and your ${isCredit ? 'credits have been added' : 'subscription is now active'}.</p>
          <table style="margin-top:14px;font-size:14px;border-collapse:collapse">
            <tr><td style="color:#666;padding:4px 12px 4px 0">${isCredit ? 'Credit pack' : 'Plan'}</td><td><strong>${order.planName || ''}</strong></td></tr>
            <tr><td style="color:#666;padding:4px 12px 4px 0">Amount</td><td>${amountStr}</td></tr>
            <tr><td style="color:#666;padding:4px 12px 4px 0">Method</td><td style="text-transform:capitalize">${order.gateway}</td></tr>
          </table>
          <p style="margin-top:18px;color:#666;font-size:13px">Thank you for choosing us. If you have any questions, just reply to this email.</p>
        </div>`,
        text: `Payment verified! Your ${isCredit ? 'credits' : 'subscription'} (${order.planName}) for ${amountStr} via ${order.gateway} is now active.`,
      }).catch((e) => console.error('[Order Complete] User email failed:', e));
    }

    return { success: true };
  },

  cancel: async ({ request, locals }) => {
    const session = await (locals as any).auth?.();
    if (!session?.user?.isAdmin) return fail(403, { error: 'Forbidden' });
    const data = await request.formData();
    const id = data.get('id')?.toString();
    const adminNotes = data.get('adminNotes')?.toString() || null;
    if (!id) return fail(400, { error: 'Missing order id' });

    await db.update(manualOrders).set({
      status: 'cancelled',
      adminNotes,
      cancelledBy: session.user.email || session.user.id,
      cancelledAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(manualOrders.id, id));
    return { success: true };
  },

  setPending: async ({ request, locals }) => {
    const session = await (locals as any).auth?.();
    if (!session?.user?.isAdmin) return fail(403, { error: 'Forbidden' });
    const data = await request.formData();
    const id = data.get('id')?.toString();
    if (!id) return fail(400, { error: 'Missing order id' });
    await db.update(manualOrders).set({ status: 'pending', updatedAt: new Date() }).where(eq(manualOrders.id, id));
    return { success: true };
  },

  createForUser: async ({ request, locals }) => {
    const session = await (locals as any).auth?.();
    if (!session?.user?.isAdmin) return fail(403, { error: 'Forbidden' });
    const data = await request.formData();
    const userId = data.get('userId')?.toString();
    const planId = data.get('planId')?.toString();
    const gateway = data.get('gateway')?.toString() || 'manual';
    const amount = parseInt(data.get('amount')?.toString() || '0', 10);
    if (!userId || !planId) return fail(400, { error: 'Missing fields' });

    const u = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    const p = (await db.select().from(pricingPlans).where(eq(pricingPlans.id, planId)).limit(1))[0];
    if (!u || !p) return fail(404, { error: 'User or plan not found' });

    await db.insert(manualOrders).values({
      userId, userEmail: u.email,
      orderType: 'subscription',
      planId: p.id, planName: p.name, planTier: p.tier,
      gateway: gateway as any,
      amount: amount || p.priceAmount,
      currency: p.currency,
      status: 'new',
      adminNotes: 'Created by admin',
    });
    return { success: true };
  },
};
