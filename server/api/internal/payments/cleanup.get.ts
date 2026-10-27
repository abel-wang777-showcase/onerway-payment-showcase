import { runDemoMaintenance } from '../../../utils/demo/maintenance'
import { requireServerProfile } from '../../../utils/profile'
import { verifyBearerToken } from '../../../utils/access'
import {
  PaymentStoreError,
  purgeExpiredPayments,
  purgeExpiredSubscriptions,
} from '../../../utils/store'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  if (!verifyBearerToken(getHeader(event, 'authorization'), process.env.CRON_SECRET)) {
    throw createError({ statusCode: 401, statusMessage: 'PAYMENT_CLEANUP_UNAUTHORIZED' })
  }

  try {
    const profile = requireServerProfile()
    const demo = profile.profile === 'sandbox' ? await runDemoMaintenance(profile) : null
    const [payments, subscriptions] = await Promise.all([
      purgeExpiredPayments(),
      purgeExpiredSubscriptions(),
    ])

    return Object.freeze({ deleted: payments, subscriptions, demo })
  }
  catch (error) {
    if (error instanceof PaymentStoreError) {
      throw createError({ statusCode: 503, statusMessage: error.code })
    }

    throw error
  }
})
