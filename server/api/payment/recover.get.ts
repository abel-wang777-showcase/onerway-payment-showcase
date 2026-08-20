import { randomUUID } from 'node:crypto'
import {
  getRetryDecision,
} from '../../../shared/payment/attempt'
import {
  toPaymentAttemptSummary,
  type RecoverSdkPaymentResponse,
  type RecoverRetainedSubscriptionResponse,
  type RecoverSubscriptionPaymentResponse,
} from '../../../shared/payment/sdk'
import { toSubscriptionSummary } from '../../../shared/payment/subscription'
import { createEvent } from '../../../shared/payment/event'
import {
  createQueryExpiry,
  createQueryToken,
  GatewayError,
  queryPayment,
  queryPaymentCreation,
  querySubscription,
} from '../../utils/gateway'
import { withPaymentLimit } from '../../utils/limit'
import { requireServerProfile } from '../../utils/profile'
import { readPaymentRecovery, setPaymentRecovery } from '../../utils/recovery'
import {
  completePaymentRecord,
  getPaymentRecovery,
  getRetainedSubscriptionRecovery,
  paymentRetryRejectionKey,
  PaymentStoreError,
  recordSubscriptionQueryDetails,
  subscriptionCreationRejectionKey,
  subscriptionCreationRecoveryAllowedKey,
} from '../../utils/store'
import { isMerchantCustomerInScope } from '../../utils/customer'

function readOrderId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_RECOVERY_INVALID' })
  }

  return value
}

function fail(error: unknown): never {
  if (error instanceof GatewayError) {
    throw createError({
      statusCode: error.code === 'PAYMENT_CREATION_QUERY_NOT_FOUND'
        ? 409
        : error.code === 'PAYMENT_NETWORK_ERROR' ? 504 : 502,
      statusMessage: error.code === 'PAYMENT_CREATION_QUERY_NOT_FOUND'
        ? 'PAYMENT_RECOVERY_PENDING'
        : error.code,
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

export default defineEventHandler(async (event): Promise<
  RecoverSdkPaymentResponse
  | RecoverSubscriptionPaymentResponse
  | RecoverRetainedSubscriptionResponse
> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const profile = requireServerProfile()

  if (profile.profile !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  }

  const query = getQuery(event)

  if (Object.keys(query).some(key => key !== 'orderId')) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_RECOVERY_INVALID' })
  }

  const orderId = query.orderId === undefined ? undefined : readOrderId(query.orderId)
  const ref = orderId === undefined
    ? readPaymentRecovery(event, profile.secret)
    : readPaymentRecovery(event, profile.secret, orderId)

  if (!ref) {
    throw createError({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })
  }

  return withPaymentLimit(event, 'query', async () => {
    try {
      let recovery = await getPaymentRecovery(ref.orderId, ref.attemptId)

      if (!recovery) {
        const retained = await getRetainedSubscriptionRecovery(ref.orderId, ref.attemptId)

        if (
          !retained
          || !retained.paymentId
          || !isMerchantCustomerInScope(retained.customer, profile)
        ) {
          throw createError({ statusCode: 404, statusMessage: 'PAYMENT_RECOVERY_NOT_FOUND' })
        }

        const payment = await queryPayment(profile, retained.paymentId)
        const contract = retained.contract.contractId
          ? await recordSubscriptionQueryDetails(
              retained.attemptId,
              await querySubscription(profile, retained.contract.contractId),
              new Date().toISOString(),
            )
          : retained.contract

        return Object.freeze({
          retained: true,
          orderId: retained.orderId,
          paymentStatus: payment.status,
          subscription: toSubscriptionSummary(contract),
        })
      }

      if (!recovery.attempt.paymentId) {
        if (
          recovery.subscription
          && recovery.events.some(item =>
            item.source === 'server'
            && item.sourceKey === subscriptionCreationRejectionKey(recovery!.attempt.id),
          )
        ) {
          throw createError({
            statusCode: 409,
            statusMessage: 'SUBSCRIPTION_CREATE_CONTRACT_REJECTED',
          })
        }

        if (
          recovery.subscription
          && !recovery.events.some(item =>
            item.source === 'server'
            && item.sourceKey === subscriptionCreationRecoveryAllowedKey(recovery!.attempt.id),
          )
        ) {
          throw createError({
            statusCode: 409,
            statusMessage: 'SUBSCRIPTION_CREATE_RECOVERY_NOT_ALLOWED',
          })
        }

        const retryOf = recovery.attempt.retryOf
        const rejected = recovery.events.some(item =>
          item.source === 'server'
          && item.sourceKey === paymentRetryRejectionKey(recovery!.attempt.id),
        )

        if (rejected) {
          if (!retryOf) {
            throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
          }

          const child = recovery.attempt
          const parentRecovery = await getPaymentRecovery(ref.orderId, retryOf)
          const parent = parentRecovery?.attempt

          if (
            !parentRecovery
            || !parent
            || parent.id !== retryOf
            || parent.orderId !== child.orderId
            || parent.integration !== child.integration
            || parent.method !== child.method
            || !parent.paymentId
            || getRetryDecision(parent).allowed
          ) {
            throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
          }

          setPaymentRecovery(event, profile.secret, parent.orderId, parent.id)
          recovery = parentRecovery
        }
      }

      if (!recovery.attempt.paymentId) {
        const merchantTxnId = recovery.attempt.merchantTxnId

        if (!merchantTxnId) {
          throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
        }

        const found = await queryPaymentCreation(
          profile,
          merchantTxnId,
          recovery.order.amount.minor,
          recovery.order.amount.currency,
        )
        const occurredAt = new Date().toISOString()

        await completePaymentRecord(
          recovery.attempt.id,
          found.paymentId,
          found.transactionId,
          createEvent({
            id: randomUUID(),
            attemptId: recovery.attempt.id,
            source: 'query',
            sourceKey: `creation:${merchantTxnId}:${found.transactionId}:${found.rawStatus}`,
            status: found.status,
            rawStatus: found.rawStatus,
            ...( ['S', 'F', 'N'].includes(found.rawStatus)
              ? { transactionStatus: found.rawStatus }
              : {}),
            transactionId: found.transactionId,
            occurredAt,
          }),
        )
        recovery = await getPaymentRecovery(ref.orderId, ref.attemptId)
      }

      const paymentId = recovery?.attempt.paymentId

      if (!recovery || !paymentId) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      const expiresAt = createQueryExpiry()

      return Object.freeze({
        order: recovery.order,
        attempt: recovery.attempt,
        attempts: Object.freeze(recovery.attempts.map(toPaymentAttemptSummary)),
        events: recovery.events,
        paymentId,
        query: Object.freeze({
          token: createQueryToken(profile.secret, recovery.attempt.id, paymentId, expiresAt),
          expiresAt,
        }),
        submitted: Boolean(recovery.attempt.submissionStartedAt),
        ...(recovery.subscription
          ? { subscription: toSubscriptionSummary(recovery.subscription) }
          : {}),
      })
    }
    catch (error) {
      fail(error)
    }
  })
})
