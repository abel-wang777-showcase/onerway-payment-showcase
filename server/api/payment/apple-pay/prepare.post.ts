import type { PrepareApplePayResponse } from '../../../../shared/payment/apple-pay'
import { consultApplePay } from '../../../utils/apple-pay'
import { directFailure, canAuthorizeDirect, requireDirectRecovery, toDirectRecovery } from '../../../utils/direct'
import { requireCanonicalPaymentOrigin, withPaymentLimit } from '../../../utils/limit'
import { requireServerProfile } from '../../../utils/profile'

export default defineEventHandler(async (event): Promise<PrepareApplePayResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const profile = requireServerProfile()
  if (profile.profile !== 'sandbox') throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)
  return withPaymentLimit(event, 'query', async () => {
    const recovery = await requireDirectRecovery(event, profile, await readBody(event), ['orderId'])
    const config = await consultApplePay(profile, recovery.order)
    return {
      ...toDirectRecovery(recovery),
      merchantIdentifier: config.merchantIdentifier,
      canAuthorize: canAuthorizeDirect(recovery),
      paymentRequest: {
        countryCode: config.countryCode,
        currencyCode: recovery.order.amount.currency,
        supportedNetworks: config.supportedNetworks,
        merchantCapabilities: ['supports3DS'],
        total: { label: 'Halden', amount: (recovery.order.amount.minor / 100).toFixed(2), type: 'final' as const },
      },
    }
  }).catch(directFailure)
})
