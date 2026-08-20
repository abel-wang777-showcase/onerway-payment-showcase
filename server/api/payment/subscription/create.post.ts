import { randomUUID } from 'node:crypto'
import { createEvent } from '../../../../shared/payment/event'
import {
  getSubscriptionPlan,
  toSubscriptionSummary,
} from '../../../../shared/payment/subscription'
import {
  toPaymentAttemptSummary,
  type CreateSubscriptionPaymentResponse,
} from '../../../../shared/payment/sdk'
import { readBrowserData } from '../../../utils/browser'
import {
  createQueryExpiry,
  createQueryToken,
  createSubscriptionPayment,
  GatewayError,
} from '../../../utils/gateway'
import { requireCanonicalPaymentOrigin, requireIp, withPaymentLimit } from '../../../utils/limit'
import { requireServerProfile } from '../../../utils/profile'
import { readPaymentRecovery } from '../../../utils/recovery'
import {
  claimPaymentCreation,
  completePaymentRecord,
  getPaymentRecovery,
  PaymentStoreError,
  recordSubscriptionCreationRejection,
  recordSubscriptionCreationRecoveryAllowed,
} from '../../../utils/store'
import { isMerchantCustomerInScope } from '../../../utils/customer'

function fail(error: unknown): never {
  if (error instanceof PaymentStoreError) {
    throw createError({ statusCode: 503, statusMessage: error.code })
  }

  if (error instanceof GatewayError) {
    throw createError({
      statusCode: error.code === 'PAYMENT_NETWORK_ERROR' ? 504 : 502,
      statusMessage: error.code,
    })
  }

  throw error
}

export default defineEventHandler(async (event): Promise<CreateSubscriptionPaymentResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const profile = requireServerProfile()

  if (profile.profile !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  }

  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)

  return withPaymentLimit(event, 'create', async (clientIp) => {
    let browser
    let claimedAttemptId: string | null = null

    try {
      browser = readBrowserData(await readBody<unknown>(event))
    }
    catch {
      throw createError({ statusCode: 400, statusMessage: 'PAYMENT_INPUT_INVALID' })
    }

    try {
      const ref = readPaymentRecovery(event, profile.secret)

      if (!ref) {
        throw createError({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })
      }

      const recovery = await getPaymentRecovery(ref.orderId, ref.attemptId)
      const contract = recovery?.subscription
      const customer = recovery?.customer
      const merchantTxnId = recovery?.attempt.merchantTxnId

      if (
        !recovery
        || !contract
        || !customer
        || !merchantTxnId
        || recovery.attempt.paymentId
        || contract.state !== 'pending'
        || !isMerchantCustomerInScope(customer, profile)
      ) {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_ATTEMPT_ACTIVE' })
      }

      const plan = getSubscriptionPlan(contract.planId)

      if (
        contract.planVersion !== plan.version
        || contract.productName !== plan.productName
        || contract.amount.minor !== plan.amount.minor
        || contract.amount.currency !== plan.amount.currency
        || contract.frequencyType !== plan.frequencyType
        || contract.frequencyPoint !== plan.frequencyPoint
        || contract.expireDate !== plan.expireDate
      ) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      const now = new Date().toISOString()
      const claim = createEvent({
        id: randomUUID(),
        attemptId: recovery.attempt.id,
        source: 'server',
        sourceKey: `create-claim:${recovery.attempt.id}`,
        status: 'created',
        occurredAt: now,
      })
      const creation = await claimPaymentCreation(recovery.attempt.id, claim)

      if (creation.outcome !== 'claimed') {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_CREATE_IN_PROGRESS' })
      }

      claimedAttemptId = recovery.attempt.id

      const created = await createSubscriptionPayment(profile, {
        merchantTxnId,
        merchantCustId: customer.merchantCustId,
        order: recovery.order,
        plan,
        returnUrl: `${profile.showcaseOrigin}/halden/subscription/return`,
        transactionIp: requireIp(profile.transactionIp ?? clientIp),
        accept: getHeader(event, 'accept')?.slice(0, 512) || '*/*',
        userAgent: getHeader(event, 'user-agent')?.slice(0, 512) || 'unknown',
        ...browser,
      })
      await recordSubscriptionCreationRecoveryAllowed(recovery.attempt.id, now)
      const paymentEvent = createEvent({
        id: randomUUID(),
        attemptId: recovery.attempt.id,
        source: 'server',
        sourceKey: `create:${recovery.attempt.id}`,
        status: 'processing',
        rawStatus: created.rawPaymentStatus,
        transactionId: created.transactionId,
        occurredAt: now,
      })
      const attempt = await completePaymentRecord(
        recovery.attempt.id,
        created.paymentId,
        created.transactionId,
        paymentEvent,
      )
      const expiresAt = createQueryExpiry()

      return Object.freeze({
        order: recovery.order,
        attempt,
        attempts: Object.freeze(recovery.attempts.map(item =>
          toPaymentAttemptSummary(item.id === attempt.id ? attempt : item),
        )),
        event: paymentEvent,
        paymentId: created.paymentId,
        query: Object.freeze({
          token: createQueryToken(profile.secret, recovery.attempt.id, created.paymentId, expiresAt),
          expiresAt,
        }),
        subscription: toSubscriptionSummary(contract),
      })
    }
    catch (error) {
      if (
        claimedAttemptId
        && error instanceof GatewayError
        && ['SUBSCRIPTION_CREATE_RESPONSE_INVALID', 'PAYMENT_NETWORK_ERROR'].includes(error.code)
      ) {
        try {
          if (error.code === 'SUBSCRIPTION_CREATE_RESPONSE_INVALID') {
            await recordSubscriptionCreationRejection(
              claimedAttemptId,
              new Date().toISOString(),
            )
          }
          else {
            await recordSubscriptionCreationRecoveryAllowed(
              claimedAttemptId,
              new Date().toISOString(),
            )
          }
        }
        catch (rejectionError) {
          fail(rejectionError)
        }
      }

      fail(error)
    }
  })
})
