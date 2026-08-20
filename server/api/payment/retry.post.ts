import type {
  CreatePaymentRetryResponse,
  PaymentAttemptInput,
} from '../../../shared/payment/sdk'
import { requireCanonicalPaymentOrigin, withPaymentLimit } from '../../utils/limit'
import { requireServerProfile } from '../../utils/profile'
import { readPaymentRecovery, setPaymentRecovery } from '../../utils/recovery'
import {
  createPaymentRetry,
  getPaymentRecovery,
  PaymentStoreError,
} from '../../utils/store'

function readInput(value: unknown): PaymentAttemptInput {
  const input = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

  if (
    !input
    || Object.keys(input).length !== 3
    || typeof input.orderId !== 'string'
    || !/^[A-Za-z0-9-]{1,128}$/.test(input.orderId)
    || typeof input.attemptId !== 'string'
    || !/^[A-Za-z0-9-]{1,128}$/.test(input.attemptId)
    || typeof input.paymentId !== 'string'
    || !/^\d{1,20}$/.test(input.paymentId)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_INPUT_INVALID' })
  }

  return Object.freeze({
    orderId: input.orderId,
    attemptId: input.attemptId,
    paymentId: input.paymentId,
  })
}

function fail(error: unknown): never {
  if (error instanceof PaymentStoreError) {
    throw createError({
      statusCode: error.code === 'PAYMENT_ATTEMPT_NOT_FOUND'
        ? 404
        : ['PAYMENT_ATTEMPT_MISMATCH', 'PAYMENT_RETRY_NOT_ALLOWED'].includes(error.code)
          ? 409
          : 503,
      statusMessage: error.code,
    })
  }

  throw error
}

export default defineEventHandler(async (event): Promise<CreatePaymentRetryResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const profile = requireServerProfile()

  if (profile.profile !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  }

  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)

  return withPaymentLimit(event, 'retry', async () => {
    try {
      const input = readInput(await readBody<unknown>(event))
      const ref = readPaymentRecovery(event, profile.secret)
      const boundToParent = ref?.orderId === input.orderId
        && ref.attemptId === input.attemptId
      const boundToChild = !boundToParent
        && ref?.orderId === input.orderId
        ? await getPaymentRecovery(ref.orderId, ref.attemptId)
        : null

      if (
        !ref
        || ref.orderId !== input.orderId
        || (!boundToParent && boundToChild?.attempt.retryOf !== input.attemptId)
      ) {
        throw createError({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })
      }

      const now = new Date().toISOString()
      const retry = await createPaymentRetry(
        input.orderId,
        input.attemptId,
        input.paymentId,
        now,
      )

      setPaymentRecovery(event, profile.secret, input.orderId, retry.attempt.id)
      return Object.freeze({
        orderId: input.orderId,
        attemptId: retry.attempt.id,
        create: retry.create,
        reused: !retry.created,
      })
    }
    catch (error) {
      fail(error)
    }
  })
})
