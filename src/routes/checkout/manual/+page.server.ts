import type { PageServerLoad } from './$types';
import { redirect, error as svelteError } from '@sveltejs/kit';
import { db, pricingPlans, creditPlans } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import { getEnabledGateways } from '$lib/server/manual-gateways.js';

export const load: PageServerLoad = async ({ url, locals }) => {
  const session = await locals.auth();
  if (!session?.user?.id) {
    throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const planId = url.searchParams.get('planId');
  const creditPlanId = url.searchParams.get('creditPlanId');
  if (!planId && !creditPlanId) throw svelteError(400, 'Missing planId or creditPlanId');

  const gateways = await getEnabledGateways();

  if (creditPlanId) {
    const [plan] = await db.select().from(creditPlans).where(eq(creditPlans.id, creditPlanId)).limit(1);
    if (!plan || !plan.isActive) throw svelteError(404, 'Credit plan not found or inactive');
    return {
      orderType: 'credit' as const,
      plan: {
        id: plan.id,
        name: plan.name,
        tier: null,
        priceAmount: plan.priceAmount,
        currency: plan.currency,
        billingInterval: 'one-time',
        features: null,
        creditAmount: plan.creditAmount,
        creditTypes: plan.creditTypes && plan.creditTypes.length > 0 ? plan.creditTypes : [plan.creditType],
      },
      gateways,
      user: { id: session.user.id, email: session.user.email },
    };
  }

  const [plan] = await db.select().from(pricingPlans).where(eq(pricingPlans.id, planId!)).limit(1);
  if (!plan || !plan.isActive) throw svelteError(404, 'Plan not found or inactive');
  return {
    orderType: 'subscription' as const,
    plan: {
      id: plan.id,
      name: plan.name,
      tier: plan.tier,
      priceAmount: plan.priceAmount,
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      features: plan.features,
      creditAmount: null,
      creditTypes: null,
    },
    gateways,
    user: { id: session.user.id, email: session.user.email },
  };
};
