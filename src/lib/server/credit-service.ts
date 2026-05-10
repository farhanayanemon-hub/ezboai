import { db } from './db/index.js';
import { userCredits, creditPlans } from './db/schema.js';
import { eq, and, gt, sql, isNull, or } from 'drizzle-orm';

export type CreditType = 'text' | 'image' | 'video' | 'audio';

export class CreditService {
        static async getUserCredits(userId: string): Promise<Record<CreditType, number>> {
                const now = new Date();
                const credits = await db
                        .select({
                                creditType: userCredits.creditType,
                                total: sql<number>`COALESCE(SUM(${userCredits.creditAmount}), 0)`,
                        })
                        .from(userCredits)
                        .where(
                                and(
                                        eq(userCredits.userId, userId),
                                        gt(userCredits.creditAmount, 0),
                                        or(
                                                isNull(userCredits.expiresAt),
                                                gt(userCredits.expiresAt, now)
                                        )
                                )
                        )
                        .groupBy(userCredits.creditType);

                const result: Record<CreditType, number> = {
                        text: 0,
                        image: 0,
                        video: 0,
                        audio: 0,
                };

                for (const row of credits) {
                        result[row.creditType as CreditType] = Number(row.total);
                }

                return result;
        }

        static async getAvailableCredits(userId: string, creditType: CreditType): Promise<number> {
                const now = new Date();
                const [result] = await db
                        .select({
                                total: sql<number>`COALESCE(SUM(${userCredits.creditAmount}), 0)`,
                        })
                        .from(userCredits)
                        .where(
                                and(
                                        eq(userCredits.userId, userId),
                                        eq(userCredits.creditType, creditType),
                                        gt(userCredits.creditAmount, 0),
                                        or(
                                                isNull(userCredits.expiresAt),
                                                gt(userCredits.expiresAt, now)
                                        )
                                )
                        );

                return Number(result?.total ?? 0);
        }

        static async useCredit(userId: string, creditType: CreditType): Promise<boolean> {
                const now = new Date();
                const availableCredits = await db
                        .select({
                                id: userCredits.id,
                                creditAmount: userCredits.creditAmount,
                        })
                        .from(userCredits)
                        .where(
                                and(
                                        eq(userCredits.userId, userId),
                                        eq(userCredits.creditType, creditType),
                                        gt(userCredits.creditAmount, 0),
                                        or(
                                                isNull(userCredits.expiresAt),
                                                gt(userCredits.expiresAt, now)
                                        )
                                )
                        )
                        .orderBy(userCredits.purchasedAt)
                        .limit(1);

                if (availableCredits.length === 0) {
                        return false;
                }

                const credit = availableCredits[0];
                await db
                        .update(userCredits)
                        .set({
                                creditAmount: credit.creditAmount - 1,
                        })
                        .where(eq(userCredits.id, credit.id));

                return true;
        }

        static async purchaseCredits(
                userId: string,
                creditPlanId: string,
                paymentProvider: 'stripe' | 'opaybd',
                transactionId: string
        ): Promise<void> {
                const [existing] = await db
                        .select({ id: userCredits.id })
                        .from(userCredits)
                        .where(eq(userCredits.transactionId, transactionId))
                        .limit(1);

                if (existing) {
                        console.log('Credit purchase already processed for transaction:', transactionId);
                        return;
                }

                const [plan] = await db
                        .select()
                        .from(creditPlans)
                        .where(eq(creditPlans.id, creditPlanId))
                        .limit(1);

                if (!plan) {
                        throw new Error('Credit plan not found');
                }

                // A plan may grant credits across multiple categories at once
                // (text + image + video, etc.). Fall back to the legacy single
                // `creditType` column for old rows that pre-date `creditTypes`.
                const grantedTypes = (plan.creditTypes && plan.creditTypes.length > 0
                        ? plan.creditTypes
                        : [plan.creditType]) as CreditType[];

                // Per-type amounts when the plan stores `creditAmounts` (e.g.
                // {text: 1000, image: 50, video: 10}). Falls back to the legacy
                // single `creditAmount` granted equally to every selected type.
                const perType = (plan as any).creditAmounts as Record<string, number> | null;
                const rows = grantedTypes.map((type) => {
                        const amount = perType && typeof perType[type] === 'number' && perType[type] > 0
                                ? perType[type]
                                : plan.creditAmount;
                        return {
                                userId,
                                creditType: type,
                                creditAmount: amount,
                                purchasedAmount: amount,
                                creditPlanId: plan.id,
                                paymentProvider,
                                // Suffix the txn id per type so the unique-on-transactionId
                                // duplicate guard above still holds across multiple rows
                                // from one purchase.
                                transactionId: grantedTypes.length > 1 ? `${transactionId}#${type}` : transactionId,
                        };
                });

                await db.insert(userCredits).values(rows);
        }

        static async getActiveCreditPlans() {
                return await db
                        .select()
                        .from(creditPlans)
                        .where(eq(creditPlans.isActive, true))
                        .orderBy(creditPlans.creditType, creditPlans.priceAmount);
        }

        static async getUserCreditHistory(userId: string) {
                return await db
                        .select({
                                id: userCredits.id,
                                creditType: userCredits.creditType,
                                creditAmount: userCredits.creditAmount,
                                purchasedAmount: userCredits.purchasedAmount,
                                paymentProvider: userCredits.paymentProvider,
                                purchasedAt: userCredits.purchasedAt,
                                expiresAt: userCredits.expiresAt,
                        })
                        .from(userCredits)
                        .where(eq(userCredits.userId, userId))
                        .orderBy(sql`${userCredits.purchasedAt} DESC`)
                        .limit(20);
        }
}
