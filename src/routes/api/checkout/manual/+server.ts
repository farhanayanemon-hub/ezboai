import type { RequestHandler } from './$types';
import { json, error as svelteError } from '@sveltejs/kit';
import { db, pricingPlans, manualOrders, users } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import { getEnabledGateways, type GatewayId } from '$lib/server/manual-gateways.js';
import { z } from 'zod/v4';

const Body = z.object({
  planId: z.string().min(1),
  gateway: z.enum(['paypal', 'wise', 'skrill', 'binance', 'bybit']),
  txnReference: z.string().min(2).max(200),
  senderInfo: z.string().max(200).nullable().optional(),
  userNotes: z.string().max(1000).nullable().optional(),
});

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();
  if (!session?.user?.id) throw svelteError(401, 'Not authenticated');

  let body;
  try { body = Body.parse(await request.json()); }
  catch (e: any) { throw svelteError(400, 'Invalid request: ' + (e?.message || 'bad body')); }

  // Verify gateway is enabled
  const enabled = await getEnabledGateways();
  if (!enabled.find((g) => g.id === body.gateway)) {
    throw svelteError(400, 'This payment method is not currently available');
  }

  // Verify plan exists
  const [plan] = await db.select().from(pricingPlans).where(eq(pricingPlans.id, body.planId)).limit(1);
  if (!plan || !plan.isActive) throw svelteError(404, 'Plan not found');

  // Get user email
  const [u] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);

  const [order] = await db.insert(manualOrders).values({
    userId: session.user.id,
    userEmail: u?.email || session.user.email || null,
    planId: plan.id,
    planName: plan.name,
    planTier: plan.tier as any,
    gateway: body.gateway as GatewayId,
    amount: plan.priceAmount,
    currency: plan.currency,
    status: 'new',
    txnReference: body.txnReference,
    senderInfo: body.senderInfo || null,
    userNotes: body.userNotes || null,
  }).returning();

  return json({ ok: true, orderId: order.id });
};
