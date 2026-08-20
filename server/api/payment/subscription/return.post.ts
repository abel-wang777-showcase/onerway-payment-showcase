import type { ObservePaymentReturnResponse } from '../../../../shared/payment/sdk'
import { GatewayError, queryPayment, querySubscription } from '../../../utils/gateway'
import { isMerchantCustomerInScope } from '../../../utils/customer'
import { withPaymentLimit } from '../../../utils/limit'
import { requireServerProfile } from '../../../utils/profile'
import { readPaymentRecovery } from '../../../utils/recovery'
import {
  getPaymentRecovery,
  getRetainedSubscriptionRecovery,
  getSubscriptionForAttempt,
  PaymentStoreError,
  recordQueryEvent,
  recordReturnEvent,
  recordSubscriptionQueryDetails,
} from '../../../utils/store'

function fail(error: unknown): never {
  if (error instanceof GatewayError) {
    throw createError({
      statusCode: error.code === 'PAYMENT_NETWORK_ERROR' ? 504 : 502,
      statusMessage: error.code,
    })
  }

  if (error instanceof PaymentStoreError) {
    throw createError({
      statusCode: error.code === 'PAYMENT_ATTEMPT_NOT_FOUND' ? 404 : 503,
      statusMessage: error.code,
    })
  }

  throw error
}

export default defineEventHandler(async (event): Promise<ObservePaymentReturnResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const profile = requireServerProfile()

  if (profile.profile !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  }

  const ref = readPaymentRecovery(event, profile.secret)

  if (!ref) {
    throw createError({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })
  }

  return withPaymentLimit(event, 'query', async () => {
    try {
      const recovery = await getPaymentRecovery(ref.orderId, ref.attemptId)

      if (!recovery) {
        const retained = await getRetainedSubscriptionRecovery(ref.orderId, ref.attemptId)

        if (
          !retained
          || !retained.paymentId
          || !isMerchantCustomerInScope(retained.customer, profile)
        ) {
          throw createError({ statusCode: 404, statusMessage: 'PAYMENT_RECOVERY_NOT_FOUND' })
        }

        await queryPayment(profile, retained.paymentId)

        if (retained.contract.contractId) {
          await recordSubscriptionQueryDetails(
            retained.attemptId,
            await querySubscription(profile, retained.contract.contractId),
            new Date().toISOString(),
          )
        }

        return Object.freeze({ duplicate: false })
      }

      if (!recovery.subscription) {
        throw createError({ statusCode: 404, statusMessage: 'PAYMENT_RECOVERY_NOT_FOUND' })
      }

      const paymentId = recovery.attempt.paymentId

      if (!paymentId) {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_RECOVERY_PENDING' })
      }

      const returned = await recordReturnEvent(recovery.attempt.id, new Date().toISOString())
      await recordQueryEvent(
        recovery.attempt.id,
        paymentId,
        await queryPayment(profile, paymentId),
        new Date().toISOString(),
      )

      const contract = await getSubscriptionForAttempt(recovery.attempt.id)

      if (contract?.contractId) {
        await recordSubscriptionQueryDetails(
          recovery.attempt.id,
          await querySubscription(profile, contract.contractId),
          new Date().toISOString(),
        )
      }

      return Object.freeze({ duplicate: returned.duplicate })
    }
    catch (error) {
      fail(error)
    }
  })
})
