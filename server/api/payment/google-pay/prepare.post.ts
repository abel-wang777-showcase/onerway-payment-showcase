import type { PrepareGooglePayResponse } from '../../../../shared/payment/google-pay'
import { consultGooglePay } from '../../../utils/google-pay'
import { directFailure, canAuthorizeDirect, requireDirectRecovery, toDirectRecovery } from '../../../utils/direct'
import { requireCanonicalPaymentOrigin, withPaymentLimit } from '../../../utils/limit'
import { requireServerProfile } from '../../../utils/profile'

export default defineEventHandler(async (event): Promise<PrepareGooglePayResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const profile = requireServerProfile()
  if (profile.profile !== 'sandbox') throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)
  return withPaymentLimit(event, 'query', async () => {
    const recovery = await requireDirectRecovery(event, profile, await readBody(event), ['orderId'], 'google-pay')
    const config = await consultGooglePay(profile, recovery.order)
    return { ...toDirectRecovery(recovery), config, canAuthorize: canAuthorizeDirect(recovery) }
  }).catch(directFailure)
})
