import type { PageServerLoad } from './$types';
import { getPricingPlans } from '$lib/server/pricing-plans-seeder.js';
import { StripeService } from '$lib/server/stripe.js';
import { db, users } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import { getActivePaymentProvider } from '$lib/server/settings-store.js';
import { adminSettingsService } from '$lib/server/admin-settings.js';
import { isCurrencyCode, DEFAULT_CURRENCY, type CurrencyCode } from '$lib/utils/currencies.js';

export const load: PageServerLoad = async ({ locals }) => {
	const session = await locals.auth();

	try {
		const plans = await getPricingPlans();
		const activePaymentProvider = await getActivePaymentProvider();

		// Default display currency from admin settings (general category)
		let defaultCurrency: CurrencyCode = DEFAULT_CURRENCY;
		try {
			const general = await adminSettingsService.getSettingsByCategory('general');
			const dc = general?.default_currency;
			if (typeof dc === 'string' && isCurrencyCode(dc.toUpperCase())) {
				defaultCurrency = dc.toUpperCase() as CurrencyCode;
			}
		} catch (e) {
			console.warn('Failed to load default_currency setting, using BDT:', e);
		}

		let currentSubscription = null;
		let userData = null;
		if (session?.user?.id) {
			currentSubscription = await StripeService.getActiveSubscription(session.user.id);
			const [u] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
			userData = u || null;
		}

		return {
			plans,
			currentSubscription,
			user: session?.user || null,
			userData,
			activePaymentProvider,
			defaultCurrency,
		};
	} catch (error) {
		console.error('Error loading pricing data:', error);
		return {
			plans: [],
			currentSubscription: null,
			user: session?.user || null,
			userData: null,
			activePaymentProvider: 'stripe' as const,
			defaultCurrency: DEFAULT_CURRENCY,
		};
	}
};
