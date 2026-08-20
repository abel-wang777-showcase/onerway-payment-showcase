import { randomUUID } from 'node:crypto'
import { createEvent } from '../../../shared/payment/event'
import {
  toPaymentAttemptSummary,
  type CreateSdkPaymentResponse,
} from '../../../shared/payment/sdk'
import { readBrowserData } from '../../utils/browser'
import {
  createPayment,
  createQueryExpiry,
  createQueryToken,
  GatewayError,
} from '../../utils/gateway'
import {
  requireCanonicalPaymentOrigin,
  requireIp,
  withPaymentLimit,
} from '../../utils/limit'
import { requireServerProfile } from '../../utils/profile'
import { readPaymentRecovery, setPaymentRecovery } from '../../utils/recovery'
import {
  claimPaymentCreation,
  completePaymentRecord,
  ensurePaymentCustomer,
  getPaymentRecovery,
  PaymentStoreError,
} from '../../utils/store'
import {
  createMerchantCustomer,
  isMerchantCustomerInScope,
} from '../../utils/customer'

function gatewayFailure(error: unknown): never {
  if (error instanceof PaymentStoreError) {
    throw createError({
      statusCode: error.code === 'PAYMENT_RETRY_NOT_ALLOWED' ? 409 : 503,
      statusMessage: error.code,
    })
  }

  if (error instanceof GatewayError) {
    throw createError({
      statusCode: error.code === 'PAYMENT_NETWORK_ERROR' ? 504 : 502,
      statusMessage: error.code,
    })
  }

  throw error
}

export default defineEventHandler(async (event): Promise<CreateSdkPaymentResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const profile = requireServerProfile()

  if (profile.profile !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  }

  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)

  return withPaymentLimit(event, 'create', async (clientIp) => {
    let browser

    try {
      browser = readBrowserData(await readBody<unknown>(event))
    }
    catch {
      throw createError({ statusCode: 400, statusMessage: 'PAYMENT_INPUT_INVALID' })
    }
    const transactionIp = requireIp(profile.transactionIp ?? clientIp)

    try {
      const ref = readPaymentRecovery(event, profile.secret)

      if (!ref) {
        throw createError({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })
      }

      const recovery = await getPaymentRecovery(ref.orderId, ref.attemptId)
      const merchantTxnId = recovery?.attempt.merchantTxnId

      if (
        !recovery
        || !merchantTxnId
        || recovery.attempt.paymentId
      ) {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_ATTEMPT_ACTIVE' })
      }

      const customer = recovery.customer
        ?? await ensurePaymentCustomer(recovery.order.id, createMerchantCustomer(profile))

      if (!isMerchantCustomerInScope(customer, profile)) {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
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

      if (creation.outcome === 'retry_rejected') {
        setPaymentRecovery(event, profile.secret, recovery.order.id, creation.parentId)
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_RETRY_NOT_ALLOWED' })
      }

      if (creation.outcome === 'existing') {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_CREATE_IN_PROGRESS' })
      }

      const created = await createPayment(profile, {
        merchantTxnId,
        merchantCustId: customer.merchantCustId,
        order: recovery.order,
        returnUrl: `${profile.showcaseOrigin}/halden/return/${recovery.order.id}`,
        transactionIp,
        accept: getHeader(event, 'accept')?.slice(0, 512) || '*/*',
        userAgent: getHeader(event, 'user-agent')?.slice(0, 512) || 'unknown',
        ...browser,
      })
      const paymentEvent = createEvent({
        id: randomUUID(),
        attemptId: recovery.attempt.id,
        source: 'server',
        sourceKey: `create:${recovery.attempt.id}`,
        status: 'processing',
        rawStatus: created.rawStatus,
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
      })
    }
    catch (error) {
      gatewayFailure(error)
    }
  })
})
