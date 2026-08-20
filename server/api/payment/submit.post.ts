import type {
  ClaimPaymentSubmissionResponse,
  PaymentAttemptInput,
} from '../../../shared/payment/sdk'
import { requireCanonicalPaymentOrigin, withPaymentLimit } from '../../utils/limit'
import { requireServerProfile } from '../../utils/profile'
import { readPaymentRecovery } from '../../utils/recovery'
import {
  claimPaymentSubmission,
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
        : [
            'PAYMENT_ATTEMPT_MISMATCH',
            'PAYMENT_SUBMISSION_NOT_ALLOWED',
          ].includes(error.code)
          ? 409
          : 503,
      statusMessage: error.code,
    })
  }

  throw error
}

export default defineEventHandler(async (event): Promise<ClaimPaymentSubmissionResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const profile = requireServerProfile()

  if (profile.profile !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  }

  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)

  return withPaymentLimit(event, 'submit', async () => {
    try {
      const input = readInput(await readBody<unknown>(event))
      const ref = readPaymentRecovery(event, profile.secret)

      if (
        !ref
        || ref.orderId !== input.orderId
        || ref.attemptId !== input.attemptId
      ) {
        throw createError({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })
      }

      const claimed = await claimPaymentSubmission(
        input.attemptId,
        input.paymentId,
      )
      return Object.freeze(claimed)
    }
    catch (error) {
      fail(error)
    }
  })
})
