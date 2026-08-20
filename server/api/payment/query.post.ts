import type {
  QuerySdkPaymentResponse,
  QuerySubscriptionPaymentResponse,
} from '../../../shared/payment/sdk'
import { isTerminalStatus } from '../../../shared/payment/sdk'
import { toSubscriptionSummary } from '../../../shared/payment/subscription'
import {
  GatewayError,
  queryPayment,
  querySubscription,
  verifyQueryToken,
} from '../../utils/gateway'
import { withPaymentLimit } from '../../utils/limit'
import { requireServerProfile } from '../../utils/profile'
import { enrichDirectPaymentMethod } from '../../utils/method'
import {
  getSubscriptionForAttempt,
  PaymentStoreError,
  recordQueryEvent,
  recordSubscriptionQueryDetails,
} from '../../utils/store'

interface QueryInput {
  attemptId: string
  paymentId: string
  token: string
  expiresAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readInput(value: unknown): QueryInput {
  if (!isRecord(value) || Object.keys(value).some(key => !['attemptId', 'paymentId', 'token', 'expiresAt'].includes(key))) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_QUERY_INVALID' })
  }

  const attemptId = value.attemptId
  const paymentId = value.paymentId
  const token = value.token
  const expiresAt = value.expiresAt

  if (
    typeof attemptId !== 'string'
    || !/^[A-Za-z0-9-]{1,128}$/.test(attemptId)
    || typeof paymentId !== 'string'
    || !/^[A-Za-z0-9-]{1,128}$/.test(paymentId)
    || typeof token !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || typeof expiresAt !== 'string'
    || expiresAt.length > 32
  ) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_QUERY_INVALID' })
  }

  return { attemptId, paymentId, token, expiresAt }
}

export default defineEventHandler(async (event): Promise<QuerySdkPaymentResponse | QuerySubscriptionPaymentResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const profile = requireServerProfile()

  if (profile.profile !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  }

  return withPaymentLimit(event, 'query', async () => {
    const input = readInput(await readBody<unknown>(event))

    if (!verifyQueryToken(
      profile.secret,
      input.attemptId,
      input.paymentId,
      input.expiresAt,
      input.token,
    )) {
      throw createError({ statusCode: 403, statusMessage: 'PAYMENT_QUERY_FORBIDDEN' })
    }

    try {
      const result = await queryPayment(profile, input.paymentId)
      const recorded = await recordQueryEvent(
        input.attemptId,
        input.paymentId,
        result,
        new Date().toISOString(),
      )
      const currentContract = await getSubscriptionForAttempt(input.attemptId)
      const attempt = currentContract || !isTerminalStatus(result.status) || !result.transactionId
        ? recorded.attempt
        : await enrichDirectPaymentMethod(
            profile,
            recorded.attempt,
            result.transactionId,
            new Date().toISOString(),
          )

      if (currentContract) {
        const contract = currentContract.contractId
          ? await recordSubscriptionQueryDetails(
              input.attemptId,
              await querySubscription(profile, currentContract.contractId),
              new Date().toISOString(),
            )
          : currentContract

        return Object.freeze({
          attempt,
          event: recorded.event,
          subscription: toSubscriptionSummary(contract),
        })
      }

      return Object.freeze({
        attempt,
        event: recorded.event,
      })
    }
    catch (error) {
      if (error instanceof GatewayError) {
        throw createError({
          statusCode: error.code === 'PAYMENT_NETWORK_ERROR' ? 504 : 502,
          statusMessage: error.code,
        })
      }

      if (error instanceof PaymentStoreError) {
        throw createError({
          statusCode: ['PAYMENT_ATTEMPT_NOT_FOUND', 'PAYMENT_ATTEMPT_MISMATCH'].includes(error.code) ? 403 : 503,
          statusMessage: error.code,
        })
      }

      throw error
    }
  })
})
