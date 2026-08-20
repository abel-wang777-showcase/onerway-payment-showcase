import { isTerminalStatus, type ObservePaymentReturnResponse } from '../../../shared/payment/sdk'
import { GatewayError, queryPayment, querySubscription } from '../../utils/gateway'
import { withPaymentLimit } from '../../utils/limit'
import { requireServerProfile } from '../../utils/profile'
import { enrichDirectPaymentMethod } from '../../utils/method'
import { readPaymentRecovery } from '../../utils/recovery'
import {
  getPaymentRecovery,
  getSubscriptionForAttempt,
  PaymentStoreError,
  recordQueryEvent,
  recordReturnEvent,
  recordSubscriptionQueryDetails,
} from '../../utils/store'

function readOrderId(value: unknown): string {
  const orderId = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>).orderId
    : undefined

  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || typeof orderId !== 'string'
    || !/^[A-Za-z0-9-]{1,128}$/.test(orderId)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_RETURN_INVALID' })
  }

  return orderId
}

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

  const orderId = readOrderId(await readBody<unknown>(event))
  const ref = readPaymentRecovery(event, profile.secret, orderId)

  if (!ref) {
    throw createError({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })
  }

  return withPaymentLimit(event, 'query', async () => {
    try {
      const recovery = await getPaymentRecovery(ref.orderId, ref.attemptId)

      if (!recovery) {
        throw createError({ statusCode: 404, statusMessage: 'PAYMENT_RECOVERY_NOT_FOUND' })
      }

      if (!recovery.attempt.paymentId) {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_RECOVERY_PENDING' })
      }

      const result = await recordReturnEvent(recovery.attempt.id, new Date().toISOString())
      const queried = await queryPayment(profile, recovery.attempt.paymentId)

      const recorded = await recordQueryEvent(
        recovery.attempt.id,
        recovery.attempt.paymentId,
        queried,
        new Date().toISOString(),
      )
      const contract = await getSubscriptionForAttempt(recovery.attempt.id)

      if (!contract && isTerminalStatus(queried.status) && queried.transactionId) {
        await enrichDirectPaymentMethod(
          profile,
          recorded.attempt,
          queried.transactionId,
          new Date().toISOString(),
        )
      }

      if (contract?.contractId) {
        await recordSubscriptionQueryDetails(
          recovery.attempt.id,
          await querySubscription(profile, contract.contractId),
          new Date().toISOString(),
        )
      }

      return Object.freeze({ duplicate: result.duplicate })
    }
    catch (error) {
      fail(error)
    }
  })
})
