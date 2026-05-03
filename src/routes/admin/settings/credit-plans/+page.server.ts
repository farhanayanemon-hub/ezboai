import type { Actions, PageServerLoad } from './$types'
import { db, creditPlans } from '$lib/server/db/index.js'
import { eq, desc } from 'drizzle-orm'
import { fail, redirect } from '@sveltejs/kit'
import { isDemoModeEnabled, DEMO_MODE_MESSAGES } from '$lib/constants/demo-mode.js'

const ALLOWED_CREDIT_TYPES = ['text', 'image', 'video', 'audio'] as const
type CreditTypeValue = typeof ALLOWED_CREDIT_TYPES[number]

function parseCreditTypes(data: FormData): CreditTypeValue[] {
  const raw = data.getAll('creditTypes').map((v) => v.toString())
  // De-dupe and keep only allowed values.
  const filtered = Array.from(new Set(raw)).filter((v): v is CreditTypeValue =>
    (ALLOWED_CREDIT_TYPES as readonly string[]).includes(v)
  )
  return filtered
}

export const load: PageServerLoad = async () => {
  try {
    const allPlans = await db
      .select()
      .from(creditPlans)
      .orderBy(creditPlans.creditType, desc(creditPlans.createdAt))

    return {
      creditPlans: allPlans,
      isDemoMode: isDemoModeEnabled()
    }
  } catch (error) {
    console.error('Error loading credit plans (table may not exist yet):', error)
    return {
      creditPlans: [],
      isDemoMode: isDemoModeEnabled()
    }
  }
}

export const actions: Actions = {
  create: async ({ request }) => {
    if (isDemoModeEnabled()) {
      return fail(403, { error: DEMO_MODE_MESSAGES.ADMIN_SAVE_DISABLED });
    }

    const data = await request.formData()

    const name = data.get('name')?.toString()
    const description = data.get('description')?.toString() || null
    const creditTypesArr = parseCreditTypes(data)
    const creditAmount = data.get('creditAmount')?.toString()
    const priceAmount = data.get('priceAmount')?.toString()
    const priceAmountBdt = data.get('priceAmountBdt')?.toString()
    const currency = data.get('currency')?.toString() || 'usd'

    const failBack = (status: number, error: string) =>
      fail(status, {
        error,
        name,
        description,
        creditTypes: creditTypesArr,
        creditAmount,
        priceAmount,
        priceAmountBdt,
        currency,
      })

    if (!name || creditTypesArr.length === 0 || !creditAmount || !priceAmount) {
      return failBack(400, 'Name, at least one credit type, credit amount and price are required')
    }

    const creditAmountNum = parseInt(creditAmount)
    if (isNaN(creditAmountNum) || creditAmountNum <= 0) {
      return failBack(400, 'Credit amount must be a positive number')
    }

    const priceAmountNum = parseInt(priceAmount)
    if (isNaN(priceAmountNum) || priceAmountNum < 0) {
      return failBack(400, 'Price amount must be a valid positive number')
    }

    const priceAmountBdtNum = priceAmountBdt ? parseInt(priceAmountBdt) : null
    if (priceAmountBdtNum !== null && (isNaN(priceAmountBdtNum) || priceAmountBdtNum < 0)) {
      return failBack(400, 'BDT price must be a valid positive number')
    }

    try {
      await db.insert(creditPlans).values({
        name,
        description,
        // Keep the legacy single-type column populated with the first selected
        // type so any code path still reading `creditType` keeps working.
        creditType: creditTypesArr[0],
        creditTypes: creditTypesArr,
        creditAmount: creditAmountNum,
        priceAmount: priceAmountNum,
        priceAmountBdt: priceAmountBdtNum,
        currency,
        isActive: true
      })

      throw redirect(303, '/admin/settings/credit-plans')
    } catch (error) {
      if (error instanceof Response || (error && typeof error === 'object' && 'status' in error && error.status === 303)) {
        throw error
      }

      console.error('Error creating credit plan:', error)
      return failBack(500, 'Failed to create credit plan')
    }
  },

  toggleActive: async ({ request }) => {
    if (isDemoModeEnabled()) {
      return fail(403, { error: DEMO_MODE_MESSAGES.ADMIN_SAVE_DISABLED });
    }

    const data = await request.formData()
    const planId = data.get('planId')?.toString()

    if (!planId) {
      return fail(400, { error: 'Plan ID is required' })
    }

    try {
      const existing = await db
        .select({ isActive: creditPlans.isActive })
        .from(creditPlans)
        .where(eq(creditPlans.id, planId))
        .limit(1)

      if (existing.length === 0) {
        return fail(404, { error: 'Credit plan not found' })
      }

      await db
        .update(creditPlans)
        .set({
          isActive: !existing[0].isActive,
          updatedAt: new Date()
        })
        .where(eq(creditPlans.id, planId))

      return { success: true }
    } catch (error) {
      console.error('Error toggling credit plan status:', error)
      return fail(500, { error: 'Failed to toggle credit plan status' })
    }
  }
}
