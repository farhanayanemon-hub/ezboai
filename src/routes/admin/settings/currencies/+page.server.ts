import type { Actions, PageServerLoad } from './$types'
import { fail } from '@sveltejs/kit'
import { adminSettingsService } from '$lib/server/admin-settings'
import { settingsStore } from '$lib/server/settings-store'
import { isDemoModeEnabled, DEMO_MODE_MESSAGES } from '$lib/constants/demo-mode.js'
import { db, pricingPlans } from '$lib/server/db'
import { eq } from 'drizzle-orm'
import {
        CURRENCIES,
        DEFAULT_CURRENCY,
        getEffectiveRates,
        isCurrencyCode,
        type CurrencyCode,
        type CurrencyRates,
} from '$lib/utils/currencies.js'

function parseStoredRates(raw: string | undefined | null): CurrencyRates {
        if (!raw) return {};
        try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                        const cleaned: CurrencyRates = {};
                        for (const [k, v] of Object.entries(parsed)) {
                                if (isCurrencyCode(k) && typeof v === 'number' && v > 0) cleaned[k] = v;
                        }
                        return cleaned;
                }
        } catch {
                // ignore
        }
        return {};
}

export const load: PageServerLoad = async () => {
        try {
                const general = await adminSettingsService.getSettingsByCategory('general');
                const overrides = parseStoredRates(general?.currency_rates);
                const effective = getEffectiveRates(overrides);
                const defaultCurrencyRaw = (general?.default_currency || DEFAULT_CURRENCY).toString().toUpperCase();
                const defaultCurrency: CurrencyCode = isCurrencyCode(defaultCurrencyRaw) ? defaultCurrencyRaw : DEFAULT_CURRENCY;

                return {
                        currencies: Object.values(CURRENCIES),
                        rates: effective,
                        defaults: Object.fromEntries(
                                Object.entries(CURRENCIES).map(([code, m]) => [code, m.rateFromUsd])
                        ) as Record<CurrencyCode, number>,
                        defaultCurrency,
                        isDemoMode: isDemoModeEnabled(),
                };
        } catch (e) {
                console.error('Failed to load currency settings:', e);
                return {
                        currencies: Object.values(CURRENCIES),
                        rates: getEffectiveRates({}),
                        defaults: Object.fromEntries(
                                Object.entries(CURRENCIES).map(([code, m]) => [code, m.rateFromUsd])
                        ) as Record<CurrencyCode, number>,
                        defaultCurrency: DEFAULT_CURRENCY,
                        isDemoMode: isDemoModeEnabled(),
                };
        }
};

export const actions: Actions = {
        update: async ({ request, locals }) => {
                // Defense in depth: layout load() guards GET, but POST actions bypass layout loads.
                const session = await locals.auth();
                if (!session?.user?.isAdmin) {
                        return fail(403, { error: 'Forbidden: Admin access required' });
                }

                if (isDemoModeEnabled()) {
                        return fail(403, { error: DEMO_MODE_MESSAGES.ADMIN_SAVE_DISABLED });
                }

                const data = await request.formData();
                const defaultCurrencyRaw = (data.get('defaultCurrency')?.toString() || '').toUpperCase();

                if (!isCurrencyCode(defaultCurrencyRaw)) {
                        return fail(400, { error: 'Invalid default currency' });
                }

                // Build rates from form (one field per currency, e.g. rate_BDT=110)
                const rates: CurrencyRates = {};
                for (const code of Object.keys(CURRENCIES) as CurrencyCode[]) {
                        if (code === 'USD') continue; // USD always 1
                        const raw = data.get(`rate_${code}`)?.toString() ?? '';
                        const num = Number(raw);
                        if (!raw.trim() || !Number.isFinite(num) || num <= 0) {
                                return fail(400, { error: `Invalid rate for ${code}. Must be a positive number.` });
                        }
                        rates[code] = num;
                }

                // Optional: recalculate priceAmountBdt for paid plans using new BDT rate
                const recalcBdt = data.get('recalcBdt')?.toString() === 'on';

                try {
                        await adminSettingsService.setSettings([
                                {
                                        key: 'currency_rates',
                                        value: JSON.stringify(rates),
                                        category: 'general',
                                        description: 'Per-currency FX rates (1 USD = N target). USD is always 1.',
                                },
                                {
                                        key: 'default_currency',
                                        value: defaultCurrencyRaw,
                                        category: 'general',
                                        description: 'Default display currency on the pricing page',
                                },
                        ]);

                        let recalculated = 0;
                        if (recalcBdt && rates.BDT) {
                                // Only touch plans whose billing currency is BDT — other plans manage their
                                // own priceAmountBdt (or don't use it) and must not be silently overwritten.
                                const allPlans = await db.select().from(pricingPlans);
                                for (const p of allPlans) {
                                        if (p.tier === 'free' || p.priceAmount === 0) continue;
                                        const planCurrency = (p.currency || '').toString().toUpperCase();
                                        if (planCurrency !== 'BDT') continue;
                                        const usd = p.priceAmount / 100;
                                        const bdt = Math.round(usd * rates.BDT);
                                        const bdtPaisa = bdt * 100;
                                        await db
                                                .update(pricingPlans)
                                                .set({ priceAmountBdt: bdtPaisa, updatedAt: new Date() })
                                                .where(eq(pricingPlans.id, p.id));
                                        recalculated++;
                                }
                        }

                        settingsStore.clearCache();

                        return {
                                success: true,
                                message: recalcBdt
                                        ? `Saved. Recalculated ${recalculated} BDT plan price${recalculated === 1 ? '' : 's'} from new rate.`
                                        : 'Saved successfully.',
                        };
                } catch (err) {
                        console.error('Error saving currency settings:', err);
                        return fail(500, { error: 'Failed to save currency settings.' });
                }
        },

        reset: async ({ locals }) => {
                const session = await locals.auth();
                if (!session?.user?.isAdmin) {
                        return fail(403, { error: 'Forbidden: Admin access required' });
                }
                if (isDemoModeEnabled()) {
                        return fail(403, { error: DEMO_MODE_MESSAGES.ADMIN_SAVE_DISABLED });
                }
                try {
                        await adminSettingsService.deleteSetting('currency_rates');
                        settingsStore.clearCache();
                        return { success: true, message: 'Reset to default rates.' };
                } catch (err) {
                        console.error('Error resetting currency rates:', err);
                        return fail(500, { error: 'Failed to reset rates.' });
                }
        },
};
