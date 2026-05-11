import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { creditPlans } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { CreditService } from '$lib/server/credit-service.js';
import { getActivePaymentProvider } from '$lib/server/settings-store.js';
import { StripeService } from '$lib/server/stripe.js';
import { OpayService } from '$lib/server/opaybd.js';

export const POST: RequestHandler = async ({ request, locals }) => {
	const session = await locals.auth();
	if (!session?.user?.id) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const { creditPlanId } = await request.json();
		if (!creditPlanId) {
			return json({ error: 'Credit plan ID is required' }, { status: 400 });
		}

		const [plan] = await db
			.select()
			.from(creditPlans)
			.where(eq(creditPlans.id, creditPlanId))
			.limit(1);

		if (!plan || !plan.isActive) {
			return json({ error: 'Credit plan not found or inactive' }, { status: 404 });
		}

		const provider = await getActivePaymentProvider();

		if (provider === 'opaybd') {
			const isConfigured = await OpayService.isConfigured();
			if (!isConfigured) {
				return json({ error: 'Opaybd is not configured' }, { status: 500 });
			}

			const origin = url.origin;
			const result = await OpayService.createCreditPayment({
				userId: session.user.id,
				creditPlanId: plan.id,
				amount: plan.priceAmountBdt || plan.priceAmount,
				currency: plan.priceAmountBdt ? 'BDT' : plan.currency.toUpperCase(),
				description: `${plan.creditAmount} ${plan.creditType} credits - ${plan.name}`,
				successUrl: `${origin}/api/opaybd/callback`,
				cancelUrl: `${origin}/settings/billing?canceled=true&provider=opaybd`,
				webhookUrl: `${origin}/api/opaybd/webhook`,
			});

			return json({
				provider: 'opaybd',
				paymentUrl: result.paymentUrl,
			});
		}

		const checkoutSession = await StripeService.createCreditCheckoutSession({
			userId: session.user.id,
			creditPlanId: plan.id,
			amount: plan.priceAmount,
			currency: plan.currency,
			name: plan.name,
			description: `${plan.creditAmount} ${plan.creditType} credits`,
		});

		return json({
			provider: 'stripe',
			sessionId: checkoutSession.id,
			clientSecret: checkoutSession.client_secret,
		});
	} catch (error: any) {
		console.error('Credit purchase error:', error);
		return json({ error: error.message || 'Failed to initiate purchase' }, { status: 500 });
	}
};
