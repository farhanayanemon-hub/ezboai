import type { Actions, PageServerLoad } from './$types'
import { db, creditPlans } from '$lib/server/db/index.js'
import { eq } from 'drizzle-orm'
import { fail, redirect, error } from '@sveltejs/kit'
import { isDemoModeEnabled, DEMO_MODE_MESSAGES } from '$lib/constants/demo-mode.js'

const ALLOWED_CREDIT_TYPES = ['text', 'image', 'video', 'audio'] as const
type CreditTypeValue = typeof ALLOWED_CREDIT_TYPES[number]

function parseCreditTypes(data: FormData): CreditTypeValue[] {
  const raw = data.getAll('creditTypes').map((v) => v.toString())
  const filtered = Array.from(new Set(raw)).filter((v): v is CreditTypeValue =>
    (ALLOWED_CREDIT_TYPES as readonly string[]).includes(v)
  )
  return filtered
}

export const load: PageServerLoad = async ({ params }) => {
  const planId = params.id

  if (!planId) {
    throw error(404, 'Credit plan not found')
  }

  const plan = await db
    .select()
    .from(creditPlans)
    .where(eq(creditPlans.id, planId))
    .limit(1)

  if (plan.length === 0) {
    throw error(404, 'Credit plan not found')
  }

  return {
    plan: plan[0],
    isDemoMode: isDemoModeEnabled()
  }
}

export const actions: Actions = {
  update: async ({ request, params }) => {
    if (isDemoModeEnabled()) {
      return fail(403, { error: DEMO_MODE_MESSAGES.ADMIN_SAVE_DISABLED });
    }

    const planId = params.id

    if (!planId) {
      throw error(404, 'Credit plan not found')
    }

    const data = await request.formData()

    const name = data.get('name')?.toString()
    const description = data.get('description')?.toString() || null
    const creditTypesArr = parseCreditTypes(data)
    const creditAmount = data.get('creditAmount')?.toString()
    const priceAmount = data.get('priceAmount')?.toString()
    const priceAmountBdt = data.get('priceAmountBdt')?.toString()
    const currency = data.get('currency')?.toString() || 'usd'
    const isActive = data.get('isActive') === 'on'

    const failBack = (status: number, errMsg: string) =>
      fail(status, {
        error: errMsg,
        name,
        description,
        creditTypes: creditTypesArr,
        creditAmount,
        priceAmount,
        priceAmountBdt,
        currency,
        isActive,
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
      await db
        .update(creditPlans)
        .set({
          name,
          description,
          // Keep the legacy column populated with the first selected type so
          // any reader still using `creditType` continues to work.
          creditType: creditTypesArr[0],
          creditTypes: creditTypesArr,
          creditAmount: creditAmountNum,
          priceAmount: priceAmountNum,
          priceAmountBdt: priceAmountBdtNum,
          currency,
          isActive,
          updatedAt: new Date()
        })
        .where(eq(creditPlans.id, planId))

      throw redirect(303, '/admin/settings/credit-plans')
    } catch (error) {
      if (error instanceof Response || (error && typeof error === 'object' && 'status' in error && error.status === 303)) {
        throw error
      }

      console.error('Error updating credit plan:', error)
      return failBack(500, 'Failed to update credit plan')
    }
  },

  delete: async ({ params }) => {
    if (isDemoModeEnabled()) {
      return fail(403, { error: DEMO_MODE_MESSAGES.ADMIN_SAVE_DISABLED });
    }

    const planId = params.id

    if (!planId) {
      throw error(404, 'Credit plan not found')
    }

    try {
      await db
        .delete(creditPlans)
        .where(eq(creditPlans.id, planId))

      throw redirect(303, '/admin/settings/credit-plans')
    } catch (error) {
      if (error instanceof Response || (error && typeof error === 'object' && 'status' in error && error.status === 303)) {
        throw error
      }

      console.error('Error deleting credit plan:', error)
      return fail(500, { error: 'Failed to delete credit plan' })
    }
  }
}
