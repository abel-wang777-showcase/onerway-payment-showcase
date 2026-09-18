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
  queryCheckoutPayment,
  type QueriedPayment,
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
  recordQueryEvent,
} from '../../utils/store'
import { isMerchantCustomerInScope } from '../../utils/customer'
import { toAuthorizationRecovery } from '../../utils/authorization'
import { refreshSubscription, subscriptionCreationRecoveryError } from '../../utils/subscription'

function readOrderId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(value)) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_RECOVERY_INVALID' })
  }

  return value
}

function fail(error: unknown): never {
  if (error instanceof GatewayError) {
    throw createError({
      statusCode: ['PAYMENT_CREATION_QUERY_NOT_FOUND', 'PAYMENT_QUERY_NOT_FOUND'].includes(error.code)
        ? 409
        : error.code === 'PAYMENT_NETWORK_ERROR' ? 504 : 502,
      statusMessage: ['PAYMENT_CREATION_QUERY_NOT_FOUND', 'PAYMENT_QUERY_NOT_FOUND'].includes(error.code)
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
      let queriedSubscriptionPayment: QueriedPayment | undefined
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

        const payment = retained.contract.initialIntegration === 'checkout'
          ? await queryCheckoutPayment(profile, {
              subscription: true,
              merchantTxnId: retained.merchantTxnId,
              amountMinor: retained.contract.amount.minor,
              currency: retained.contract.amount.currency,
              paymentId: retained.paymentId,
            })
          : await queryPayment(profile, retained.paymentId)
        const contract = await refreshSubscription(profile, retained.contract, payment, new Date().toISOString())

        return Object.freeze({
          retained: true,
          integration: contract.initialIntegration,
          orderId: retained.orderId,
          paymentStatus: payment.status,
          subscription: toSubscriptionSummary(contract),
        })
      }

      if (recovery.attempt.authorization) {
        if (!recovery.customer || !isMerchantCustomerInScope(recovery.customer, profile) || recovery.subscription) {
          throw createError({ statusCode: 409, statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
        }
        return toAuthorizationRecovery(recovery)
      }

      const recoveryError = subscriptionCreationRecoveryError(recovery)
      const knownCheckoutCancellation = recovery.attempt.integration === 'checkout'
        && recovery.attempt.transactionId && recovery.attempt.status === 'cancelled'
      // A persisted cancellation may be restored without discovering a Payment.
      // It never overrides an explicit runtime-contract rejection.
      if (recoveryError && !(recoveryError === 'SUBSCRIPTION_CREATE_RECOVERY_NOT_ALLOWED' && knownCheckoutCancellation)) {
        throw createError({ statusCode: 409, statusMessage: recoveryError })
      }

      if (!recovery.attempt.paymentId && !knownCheckoutCancellation) {
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

      if (!recovery.attempt.paymentId && !(recovery.attempt.integration === 'checkout' && recovery.attempt.transactionId && recovery.attempt.status === 'cancelled')) {
        const merchantTxnId = recovery.attempt.merchantTxnId

        if (!merchantTxnId) {
          throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
        }

        const checkout = recovery.attempt.integration === 'checkout'
        const found = checkout
          ? await queryCheckoutPayment(profile, {
              ...(recovery.subscription ? { subscription: true } : {}),
              merchantTxnId,
              amountMinor: recovery.order.amount.minor,
              currency: recovery.order.amount.currency,
              transactionId: recovery.attempt.transactionId,
            })
          : await queryPaymentCreation(
              profile,
              merchantTxnId,
              recovery.order.amount.minor,
              recovery.order.amount.currency,
            )
        if (checkout && recovery.subscription) queriedSubscriptionPayment = found
        const occurredAt = new Date().toISOString()

        await completePaymentRecord(
          recovery.attempt.id,
          found.paymentId,
          found.transactionId,
          createEvent({
            id: randomUUID(),
            attemptId: recovery.attempt.id,
            source: 'query',
            sourceKey: `creation:${merchantTxnId}:${found.transactionId}:${found.rawStatus}${checkout ? `:${found.paymentStatus ?? '-'}` : ''}`,
            status: found.status,
            rawStatus: found.rawStatus,
            ...(found.paymentStatus ? { paymentStatus: found.paymentStatus } : {}),
            ...(checkout || ['S', 'F', 'N'].includes(found.rawStatus)
              ? { transactionStatus: found.rawStatus }
              : {}),
            transactionId: found.transactionId,
            occurredAt,
          }),
        )
        recovery = await getPaymentRecovery(ref.orderId, ref.attemptId)
      }

      let paymentId = recovery?.attempt.paymentId

      if (!recovery || (!paymentId && !(recovery.attempt.integration === 'checkout' && recovery.attempt.transactionId && recovery.attempt.status === 'cancelled'))) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      if (recovery.subscription?.initialIntegration === 'checkout' && !recoveryError) {
        const queried = queriedSubscriptionPayment ?? await queryCheckoutPayment(profile, {
          subscription: true,
          merchantTxnId: recovery.attempt.merchantTxnId!,
          amountMinor: recovery.order.amount.minor,
          currency: recovery.order.amount.currency,
          transactionId: recovery.attempt.transactionId,
          paymentId,
        })
        await recordQueryEvent(recovery.attempt.id, paymentId, queried, new Date().toISOString())
        await refreshSubscription(profile, recovery.subscription, queried, new Date().toISOString())
        recovery = (await getPaymentRecovery(ref.orderId, ref.attemptId))!
        if (!recovery) throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
        paymentId = recovery.attempt.paymentId
      }

      const expiresAt = createQueryExpiry()

      return Object.freeze({
        order: recovery.order,
        attempt: recovery.attempt,
        attempts: Object.freeze(recovery.attempts.map(toPaymentAttemptSummary)),
        events: recovery.events,
        paymentId: paymentId ?? null,
        query: paymentId ? Object.freeze({
          token: createQueryToken(profile.secret, recovery.attempt.id, paymentId, expiresAt),
          expiresAt,
        }) : null,
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
