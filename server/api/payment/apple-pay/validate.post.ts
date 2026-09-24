import { validateApplePayMerchant } from '../../../utils/apple-pay'
import { directFailure, canAuthorizeDirect, requireDirectRecovery } from '../../../utils/direct'
import { requireCanonicalPaymentOrigin, withPaymentLimit } from '../../../utils/limit'
import { requireServerProfile } from '../../../utils/profile'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const profile = requireServerProfile()
  if (profile.profile !== 'sandbox') throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)
  return withPaymentLimit(event, 'submit', async () => {
    const input = await readBody<Record<string, unknown>>(event)
    const recovery = await requireDirectRecovery(event, profile, input, ['orderId', 'attemptId', 'validationURL'])
    if (!canAuthorizeDirect(recovery)) throw createError({ statusCode: 409, statusMessage: 'APPLE_PAY_ALREADY_SUBMITTED' })
    return { merchantSession: await validateApplePayMerchant(profile, input.validationURL) }
  }).catch(directFailure)
})
