import { db } from './db/index.js';
import { users, subscriptions, pricingPlans, paymentHistory, userCredits } from './db/schema.js';
import { eq, and, lt } from 'drizzle-orm';
import { getOpaySettings } from './settings-store.js';

// Opaybd API base URL
const OPAY_API_BASE = 'https://verify.opaybd.com/api/payment';

export interface OpayPaymentCreateParams {
        userId: string;
        planId: string;
        priceId: string;
        successUrl: string;
        cancelUrl: string;
}

export interface OpayCallbackParams {
        transactionId: string;
        paymentMethod: string;
        paymentAmount: number;
        paymentFee: number;
        status: 'pending' | 'success' | 'failed';
}

export interface OpayPaymentMetadata {
        userId: string;
        planId: string;
        priceId: string;
        planTier: string;
        originalAmountCents: number;
        billingInterval: string;
        // Optional fields used by credit-purchase flow
        type?: string;
        creditPlanId?: string;
}

export interface OpayVerificationResult {
        status: 'COMPLETED' | 'PENDING' | 'ERROR' | string;
        cus_name?: string;
        cus_email?: string;
        amount?: string;
        transaction_id?: string;
        payment_method?: string;
        message?: string;
        metadata?: OpayPaymentMetadata | null;
        meta_data?: unknown;
}

export class OpayService {
        private static normalizeMetadata(rawMetadata: unknown): OpayPaymentMetadata | null {
                if (!rawMetadata) {
                        return null;
                }

                let parsedMetadata: unknown = rawMetadata;

                if (typeof parsedMetadata === 'string') {
                        try {
                                parsedMetadata = JSON.parse(parsedMetadata);
                        } catch {
                                console.error('Failed to parse Opaybd metadata:', parsedMetadata);
                                return null;
                        }
                }

                if (!parsedMetadata || typeof parsedMetadata !== 'object') {
                        return null;
                }

                const metadata = parsedMetadata as Partial<OpayPaymentMetadata>;

                const result: OpayPaymentMetadata = {
                        userId: String(metadata.userId ?? ''),
                        planId: String(metadata.planId ?? ''),
                        priceId: String(metadata.priceId ?? ''),
                        planTier: String(metadata.planTier ?? ''),
                        originalAmountCents: Number(metadata.originalAmountCents ?? 0),
                        billingInterval: String(metadata.billingInterval ?? ''),
                };
                // Preserve credit-purchase markers so handlePaymentSuccess can route correctly
                if ((metadata as any).type) result.type = String((metadata as any).type);
                if ((metadata as any).creditPlanId) result.creditPlanId = String((metadata as any).creditPlanId);
                return result;
        }

        private static toCents(amount: number): number {
                if (!Number.isFinite(amount)) {
                        return 0;
                }

                return Math.max(0, Math.round(amount * 100));
        }

        /**
         * Get Opaybd API headers with authentication
         */
        private static async getHeaders(): Promise<HeadersInit> {
                const settings = await getOpaySettings();

                if (!settings.apiKey) {
                        throw new Error('Opaybd credentials not configured. Please configure them in Admin > Payment Methods.');
                }

                return {
                        'Content-Type': 'application/json',
                        'API-KEY': settings.apiKey,
                };
        }

        /**
         * Create a payment request with Opaybd
         * Returns the payment URL for redirect
         */
        static async createPayment(params: OpayPaymentCreateParams): Promise<{ status: boolean; message: string; payment_url: string }> {
                // Get user details
                const [user] = await db.select().from(users).where(eq(users.id, params.userId));
                if (!user) {
                        throw new Error('User not found');
                }

                // Get plan details
                const [plan] = await db.select().from(pricingPlans).where(eq(pricingPlans.id, params.planId));
                if (!plan) {
                        throw new Error('Pricing plan not found');
                }

                // Use BDT price if available, otherwise log warning and fallback to USD amount
                let amount: number;
                if (plan.priceAmountBdt !== null && plan.priceAmountBdt !== undefined) {
                        // Convert from paisa to BDT (divide by 100)
                        amount = plan.priceAmountBdt / 100;
                } else {
                        // Fallback: use USD cents value as BDT (admin should configure proper BDT prices)
                        console.warn(`Plan ${plan.name} (${plan.tier}) has no BDT price configured. Using USD amount as fallback.`);
                        amount = plan.priceAmount / 100;
                }

                const headers = await this.getHeaders();

                // Prepare metadata to track subscription details
                const metadata = {
                        userId: params.userId,
                        planId: params.planId,
                        priceId: params.priceId,
                        planTier: plan.tier,
                        originalAmountCents: plan.priceAmount,
                        billingInterval: plan.billingInterval,
                };

                // Build webhook URL from success URL (same origin)
                const successUrlObj = new URL(params.successUrl);
                const webhookUrl = `${successUrlObj.origin}/api/opaybd/webhook`;

                const response = await fetch(`${OPAY_API_BASE}/create`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                                cus_name: user.name || user.email?.split('@')[0] || 'Customer',
                                cus_email: user.email,
                                amount: amount, // Send as number per Opaybd API spec
                                success_url: params.successUrl,
                                cancel_url: params.cancelUrl,
                                webhook_url: webhookUrl,
                                metadata: metadata,
                                meta_data: JSON.stringify(metadata),
                        }),
                });

                if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Opaybd create payment error:', errorText);
                        throw new Error(`Opaybd API error: ${response.status}`);
                }

                const data = await response.json();

                if (!data.status) {
                        throw new Error(data.message || 'Failed to create payment with Opaybd');
                }

                console.log('Opaybd payment created successfully:', data);
                return data;
        }

        static async createCreditPayment({
                userId,
                creditPlanId,
                amount,
                currency,
                description,
                successUrl,
                cancelUrl,
                webhookUrl,
        }: {
                userId: string;
                creditPlanId: string;
                amount: number;
                currency: string;
                description: string;
                successUrl: string;
                cancelUrl: string;
                webhookUrl: string;
        }): Promise<{ paymentUrl: string }> {
                const [user] = await db.select().from(users).where(eq(users.id, userId));
                if (!user) {
                        throw new Error('User not found');
                }

                const amountValue = currency === 'BDT' ? amount / 100 : amount / 100;

                const headers = await this.getHeaders();

                const metadata = {
                        userId,
                        creditPlanId,
                        type: 'credit_purchase',
                };

                const response = await fetch(`${OPAY_API_BASE}/create`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                                cus_name: user.name || user.email?.split('@')[0] || 'Customer',
                                cus_email: user.email,
                                amount: amountValue,
                                success_url: successUrl,
                                cancel_url: cancelUrl,
                                webhook_url: webhookUrl,
                                metadata: metadata,
                                meta_data: JSON.stringify(metadata),
                        }),
                });

                console.log('Opaybd createCreditPayment request:', {
                        amount: amountValue, currency,
                        success_url: successUrl, cancel_url: cancelUrl, webhook_url: webhookUrl,
                        metadata,
                });

                if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Opaybd create credit payment error:', response.status, errorText);
                        throw new Error(`Opaybd API error: ${response.status} ${errorText}`);
                }

                const data = await response.json();
                console.log('Opaybd createCreditPayment response:', data);

                if (!data.status) {
                        throw new Error(data.message || 'Failed to create credit payment with Opaybd');
                }

                return { paymentUrl: data.payment_url };
        }

        /**
         * Verify a payment with Opaybd
         */
        static async verifyPayment(transactionId: string): Promise<OpayVerificationResult> {
                const headers = await this.getHeaders();

                const response = await fetch(`${OPAY_API_BASE}/verify`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ transaction_id: transactionId }),
                });

                if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Opaybd verify payment error:', errorText);
                        throw new Error(`Opaybd API error: ${response.status}`);
                }

                const data = await response.json() as OpayVerificationResult;
                const normalizedMetadata = this.normalizeMetadata(data.metadata ?? data.meta_data ?? null);

                return {
                        ...data,
                        metadata: normalizedMetadata,
                };
        }

        /**
         * Handle successful payment callback - creates/updates subscription or grants credits
         */
        static async handlePaymentSuccess(
                params: OpayCallbackParams,
                verificationResult?: OpayVerificationResult
        ): Promise<{ planTier: string; userId: string; alreadyProcessed: boolean }> {
                console.log('Processing Opaybd payment success:', params.transactionId);

                const verification = verificationResult ?? await this.verifyPayment(params.transactionId);

                if (verification.status !== 'COMPLETED') {
                        throw new Error(`Payment not completed. Status: ${verification.status}`);
                }

                const rawMeta = verification.metadata ?? (typeof verification.meta_data === 'string'
                        ? (() => { try { return JSON.parse(verification.meta_data); } catch { return null; } })()
                        : verification.meta_data);

                if (rawMeta && (rawMeta as any).type === 'credit_purchase') {
                        return this.handleCreditPurchaseSuccess(params.transactionId, rawMeta as any);
                }

                const metadata = verification.metadata;
                if (!metadata?.userId || !metadata?.planTier || !metadata?.priceId || !metadata?.billingInterval) {
                        throw new Error('Invalid payment metadata');
                }

                // Idempotency guard - if we already recorded this transaction as succeeded, skip processing
                const [existingPayment] = await db
                        .select({ id: paymentHistory.id })
                        .from(paymentHistory)
                        .where(and(
                                eq(paymentHistory.paymentProvider, 'opaybd'),
                                eq(paymentHistory.opayTransactionId, params.transactionId),
                                eq(paymentHistory.status, 'succeeded')
                        ))
                        .limit(1);

                if (existingPayment) {
                        console.log('Opaybd transaction already processed, skipping:', params.transactionId);
                        return {
                                planTier: metadata.planTier,
                                userId: metadata.userId,
                                alreadyProcessed: true,
                        };
                }

                const now = new Date();
                const verifiedAmount = Number.parseFloat(verification.amount ?? '0');
                const normalizedAmount = Number.isFinite(params.paymentAmount) && params.paymentAmount > 0
                        ? params.paymentAmount
                        : (Number.isFinite(verifiedAmount) ? verifiedAmount : 0);
                const amountCents = this.toCents(normalizedAmount > 0 ? normalizedAmount : (metadata.originalAmountCents / 100));
                const feeCents = this.toCents(params.paymentFee);

                // Calculate subscription period based on billing interval
                const periodEnd = new Date(now);
                if (metadata.billingInterval === 'year') {
                        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                } else {
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                }

                await db.transaction(async (tx) => {
                        // Check for existing Opaybd subscription for this user
                        const [existingSub] = await tx
                                .select()
                                .from(subscriptions)
                                .where(and(
                                        eq(subscriptions.userId, metadata.userId),
                                        eq(subscriptions.paymentProvider, 'opaybd')
                                ));

                        if (existingSub) {
                                // Update existing subscription
                                await tx.update(subscriptions)
                                        .set({
                                                stripePriceId: metadata.priceId,
                                                planTier: metadata.planTier as 'free' | 'starter' | 'pro' | 'advanced',
                                                previousPlanTier: existingSub.planTier,
                                                status: 'active',
                                                currentPeriodStart: now,
                                                currentPeriodEnd: periodEnd,
                                                renewalRequired: false,
                                                opayTransactionId: params.transactionId,
                                                lastPaymentAmount: amountCents,
                                                planChangedAt: existingSub.planTier !== metadata.planTier ? now : existingSub.planChangedAt,
                                                updatedAt: now,
                                        })
                                        .where(eq(subscriptions.id, existingSub.id));

                                console.log('Updated existing Opaybd subscription:', existingSub.id);
                        } else {
                                // Create new subscription
                                // Use transaction ID as the unique identifier for Opaybd subscriptions
                                await tx.insert(subscriptions).values({
                                        userId: metadata.userId,
                                        stripeSubscriptionId: `opay_${params.transactionId}`, // Prefix to distinguish from Stripe IDs
                                        stripePriceId: metadata.priceId,
                                        planTier: metadata.planTier as 'free' | 'starter' | 'pro' | 'advanced',
                                        status: 'active',
                                        currentPeriodStart: now,
                                        currentPeriodEnd: periodEnd,
                                        paymentProvider: 'opaybd',
                                        opayTransactionId: params.transactionId,
                                        lastPaymentAmount: amountCents,
                                        renewalRequired: false,
                                });

                                console.log('Created new Opaybd subscription for user:', metadata.userId);
                        }

                        // Update user plan tier and subscription status
                        await tx.update(users)
                                .set({
                                        subscriptionStatus: 'active',
                                        planTier: metadata.planTier as 'free' | 'starter' | 'pro' | 'advanced',
                                })
                                .where(eq(users.id, metadata.userId));

                        // Get subscription ID for payment history
                        const [subscription] = await tx
                                .select({ id: subscriptions.id })
                                .from(subscriptions)
                                .where(and(
                                        eq(subscriptions.userId, metadata.userId),
                                        eq(subscriptions.paymentProvider, 'opaybd')
                                ));

                        // Record payment history
                        await tx.insert(paymentHistory).values({
                                userId: metadata.userId,
                                subscriptionId: subscription?.id || null,
                                amount: amountCents,
                                currency: 'bdt', // Opaybd uses BDT (Bangladesh Taka)
                                status: 'succeeded',
                                description: `Subscription payment for ${metadata.planTier} plan`,
                                paymentProvider: 'opaybd',
                                opayTransactionId: params.transactionId,
                                opayPaymentMethod: params.paymentMethod,
                                opayPaymentFee: feeCents,
                                paidAt: now,
                        });
                });

                console.log('Successfully processed Opaybd payment for user:', metadata.userId);

                return {
                        planTier: metadata.planTier,
                        userId: metadata.userId,
                        alreadyProcessed: false,
                };
        }

        /**
         * Get subscription needing renewal for a user
         * Returns null if no renewal needed
         */
        private static async handleCreditPurchaseSuccess(
                transactionId: string,
                meta: { userId: string; creditPlanId: string; type: string }
        ): Promise<{ planTier: string; userId: string; alreadyProcessed: boolean }> {
                const { CreditService } = await import('./credit-service.js');

                const existingCredits = await db
                        .select({ id: userCredits.id })
                        .from(userCredits)
                        .where(eq(userCredits.transactionId, transactionId))
                        .limit(1);

                if (existingCredits.length > 0) {
                        console.log('Opaybd credit purchase already processed:', transactionId);
                        return { planTier: 'credit_purchase', userId: meta.userId, alreadyProcessed: true };
                }

                try {
                        await CreditService.purchaseCredits(meta.userId, meta.creditPlanId, 'opaybd', transactionId);
                        console.log(`Opaybd credit purchase completed: user=${meta.userId}, plan=${meta.creditPlanId}`);
                } catch (error) {
                        console.error('Error processing Opaybd credit purchase:', error);
                }

                return { planTier: 'credit_purchase', userId: meta.userId, alreadyProcessed: false };
        }

        static async getSubscriptionNeedingRenewal(userId: string) {
                const [sub] = await db
                        .select()
                        .from(subscriptions)
                        .where(and(
                                eq(subscriptions.userId, userId),
                                eq(subscriptions.paymentProvider, 'opaybd'),
                                eq(subscriptions.renewalRequired, true),
                                eq(subscriptions.status, 'active')
                        ));

                return sub || null;
        }

        /**
         * Mark expired Opaybd subscriptions as needing renewal
         * This should be called periodically (e.g., in middleware or cron job)
         */
        static async markExpiredSubscriptionsForRenewal(): Promise<number> {
                const now = new Date();

                // First, find the expired subscriptions to count them
                const expiredSubs = await db
                        .select({ id: subscriptions.id })
                        .from(subscriptions)
                        .where(and(
                                eq(subscriptions.paymentProvider, 'opaybd'),
                                eq(subscriptions.status, 'active'),
                                eq(subscriptions.renewalRequired, false),
                                lt(subscriptions.currentPeriodEnd, now)
                        ));

                if (expiredSubs.length === 0) {
                        return 0;
                }

                // Then update them
                await db.update(subscriptions)
                        .set({
                                renewalRequired: true,
                                updatedAt: now,
                        })
                        .where(and(
                                eq(subscriptions.paymentProvider, 'opaybd'),
                                eq(subscriptions.status, 'active'),
                                eq(subscriptions.renewalRequired, false),
                                lt(subscriptions.currentPeriodEnd, now)
                        ));

                console.log(`Marked ${expiredSubs.length} Opaybd subscription(s) for renewal`);
                return expiredSubs.length;
        }

        /**
         * Get active Opaybd subscription for a user
         */
        static async getActiveSubscription(userId: string) {
                const [sub] = await db
                        .select()
                        .from(subscriptions)
                        .where(and(
                                eq(subscriptions.userId, userId),
                                eq(subscriptions.paymentProvider, 'opaybd'),
                                eq(subscriptions.status, 'active')
                        ));

                if (!sub) {
                        return null;
                }

                // Get plan details
                const [plan] = await db
                        .select()
                        .from(pricingPlans)
                        .where(eq(pricingPlans.stripePriceId, sub.stripePriceId));

                return {
                        subscription: sub,
                        plan: plan || null,
                };
        }

        /**
         * Check if Opaybd is properly configured
         */
        static async isConfigured(): Promise<boolean> {
                try {
                        const settings = await getOpaySettings();
                        return !!settings.apiKey;
                } catch {
                        return false;
                }
        }
}
