import type { PageServerLoad } from './$types';
import { getPricingPlans } from '$lib/server/pricing-plans-seeder.js';
import { StripeService } from '$lib/server/stripe.js';
import { db, users } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import { getActivePaymentProvider } from '$lib/server/settings-store.js';
import { adminSettingsService } from '$lib/server/admin-settings.js';
import { getEnabledGateways } from '$lib/server/manual-gateways.js';
import { isCurrencyCode, DEFAULT_CURRENCY, getEffectiveRates, type CurrencyCode, type CurrencyRates } from '$lib/utils/currencies.js';

export const load: PageServerLoad = async ({ locals }) => {
        const session = await locals.auth();

        try {
                const plans = await getPricingPlans();
                const activePaymentProvider = await getActivePaymentProvider();
                const manualGatewaysEnabled = (await getEnabledGateways()).length > 0;

                // Default display currency + FX rate overrides from admin settings (general category)
                let defaultCurrency: CurrencyCode = DEFAULT_CURRENCY;
                let rateOverrides: CurrencyRates = {};
                try {
                        const general = await adminSettingsService.getSettingsByCategory('general');
                        const dc = general?.default_currency;
                        if (typeof dc === 'string' && isCurrencyCode(dc.toUpperCase())) {
                                defaultCurrency = dc.toUpperCase() as CurrencyCode;
                        }
                        if (general?.currency_rates) {
                                try {
                                        const parsed = JSON.parse(general.currency_rates);
                                        if (parsed && typeof parsed === 'object') {
                                                for (const [k, v] of Object.entries(parsed)) {
                                                        if (isCurrencyCode(k) && typeof v === 'number' && v > 0) {
                                                                rateOverrides[k] = v;
                                                        }
                                                }
                                        }
                                } catch {
                                        // ignore malformed JSON
                                }
                        }
                } catch (e) {
                        console.warn('Failed to load currency settings, using defaults:', e);
                }
                const currencyRates = getEffectiveRates(rateOverrides);

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
                        manualGatewaysEnabled,
                        defaultCurrency,
                        currencyRates,
                };
        } catch (error) {
                console.error('Error loading pricing data:', error);
                return {
                        plans: [],
                        currentSubscription: null,
                        user: session?.user || null,
                        userData: null,
                        activePaymentProvider: 'stripe' as const,
                        manualGatewaysEnabled: false,
                        defaultCurrency: DEFAULT_CURRENCY,
                        currencyRates: getEffectiveRates({}),
                };
        }
};
