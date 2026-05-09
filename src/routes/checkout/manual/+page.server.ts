import type { PageServerLoad } from './$types';
import { redirect, error as svelteError } from '@sveltejs/kit';
import { db, pricingPlans } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import { getEnabledGateways } from '$lib/server/manual-gateways.js';

export const load: PageServerLoad = async ({ url, locals }) => {
  const session = await locals.auth();
  if (!session?.user?.id) {
    throw redirect(302, `/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const planId = url.searchParams.get('planId');
  if (!planId) throw svelteError(400, 'Missing planId');

  const [plan] = await db.select().from(pricingPlans).where(eq(pricingPlans.id, planId)).limit(1);
  if (!plan || !plan.isActive) throw svelteError(404, 'Plan not found or inactive');

  const gateways = await getEnabledGateways();

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      tier: plan.tier,
      priceAmount: plan.priceAmount,
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      features: plan.features,
    },
    gateways,
    user: { id: session.user.id, email: session.user.email },
  };
};
