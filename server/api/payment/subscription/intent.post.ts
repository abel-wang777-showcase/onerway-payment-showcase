import { randomUUID } from 'node:crypto'
import { createAttempt } from '../../../../shared/payment/attempt'
import { createOrder } from '../../../../shared/payment/order'
import {
  getSubscriptionPlan,
  isSubscriptionPlanId,
  isSubscriptionIntegration,
  createSubscriptionPlaceholder,
} from '../../../../shared/payment/subscription'
import type {
  CreateSubscriptionIntentInput,
  CreateSubscriptionIntentResponse,
} from '../../../../shared/payment/sdk'
import {
  createMerchantCustomer,
  isMerchantCustomerInScope,
} from '../../../utils/customer'
import { requireCanonicalPaymentOrigin, withPaymentLimit } from '../../../utils/limit'
import { requireServerProfile } from '../../../utils/profile'
import { readPaymentRecovery, setPaymentRecovery } from '../../../utils/recovery'
import {
  createSubscriptionPaymentRecord,
  ensurePaymentCustomer,
  getPaymentRecovery,
  getRetainedSubscriptionRecovery,
  PaymentStoreError,
  type PaymentRecovery,
} from '../../../utils/store'

function readInput(value: unknown): CreateSubscriptionIntentInput {
  const input = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  const keys = input ? Object.keys(input) : []

  if (
    !input
    || keys.length < 1
    || keys.length > 3
    || keys.some(key => !['planId', 'integration', 'newTestCustomer'].includes(key))
    || (input.integration !== undefined && !isSubscriptionIntegration(input.integration))
    || (input.newTestCustomer !== undefined && input.newTestCustomer !== true)
    || !isSubscriptionPlanId(input.planId)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_INPUT_INVALID' })
  }

  return Object.freeze({
    planId: input.planId,
    integration: input.integration ?? 'web-js-sdk',
    ...(input.newTestCustomer === true ? { newTestCustomer: true as const } : {}),
  })
}

function existingIntent(recovery: PaymentRecovery): CreateSubscriptionIntentResponse {
  const integration = recovery.subscription?.initialIntegration
  if (!integration || recovery.attempt.integration !== integration) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }

  const claimed = recovery.events.some(item =>
    item.source === 'server' && item.sourceKey === `create-claim:${recovery.attempt.id}`,
  )
  return Object.freeze({
    orderId: recovery.order.id,
    integration,
    create: recovery.subscription?.state === 'pending' && !recovery.subscription.contractId
      && !recovery.attempt.paymentId && !recovery.attempt.transactionId && !claimed,
    existing: true,
  })
}

function fail(error: unknown): never {
  if (error instanceof PaymentStoreError) {
    throw createError({
      statusCode: error.code === 'PAYMENT_SUBSCRIPTION_CONFLICT' ? 409 : 503,
      statusMessage: error.code,
    })
  }

  throw error
}

export default defineEventHandler(async (event): Promise<CreateSubscriptionIntentResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const profile = requireServerProfile()

  if (profile.profile !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  }

  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)

  return withPaymentLimit(event, 'create', async () => {
    try {
      const input = readInput(await readBody<unknown>(event))
      const plan = getSubscriptionPlan(input.planId)
      const ref = readPaymentRecovery(event, profile.secret)
      const previous = ref ? await getPaymentRecovery(ref.orderId, ref.attemptId) : null
      const retained = ref && !previous
        ? await getRetainedSubscriptionRecovery(ref.orderId, ref.attemptId)
        : null
      const previousInScope = previous?.customer
        ? isMerchantCustomerInScope(previous.customer, profile)
        : null
      const retainedInScope = retained
        ? isMerchantCustomerInScope(retained.customer, profile)
        : null

      if (previousInScope === false || retainedInScope === false) {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
      }

      const previousHasPlan = Boolean(
        previous?.subscription?.planId === plan.id
        && previous.subscription.state !== 'terminal',
      )
      const retainedHasPlan = Boolean(
        retained?.contract.planId === plan.id
        && retained.contract.state !== 'terminal',
      )
      const canStartNewTestCustomer = Boolean(
        (previousHasPlan && (previous?.attempt.paymentId || previous?.subscription?.contractId))
        || (retainedHasPlan && retained?.paymentId),
      )

      if (input.newTestCustomer && !canStartNewTestCustomer) {
        throw createError({
          statusCode: 409,
          statusMessage: 'PAYMENT_SUBSCRIPTION_TEST_CUSTOMER_UNAVAILABLE',
        })
      }

      if (!input.newTestCustomer && previousHasPlan) {
        return existingIntent(previous!)
      }

      if (!input.newTestCustomer && retainedHasPlan) {
        setPaymentRecovery(event, profile.secret, retained!.orderId, retained!.attemptId)
        return Object.freeze({
          orderId: retained!.orderId,
          integration: retained!.contract.initialIntegration,
          create: false,
          existing: true,
        })
      }

      const customer = input.newTestCustomer
        ? createMerchantCustomer(profile)
        : previousInScope
          ? previous!.customer!
          : retainedInScope
            ? retained!.customer
            : previous?.customer === null
              ? await ensurePaymentCustomer(previous.order.id, createMerchantCustomer(profile))
              : createMerchantCustomer(profile)

      if (!isMerchantCustomerInScope(customer, profile)) {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
      }

      const now = new Date().toISOString()
      const orderId = `HLD-SUB-${randomUUID().slice(0, 8).toUpperCase()}`
      const attemptId = `${orderId}-attempt-1`
      const order = createOrder({
        id: orderId,
        scene: 'ecommerce',
        item: {
          sku: 'HL-SUB-DAILY-005',
          name: plan.productName,
          variant: 'Daily subscription',
          quantity: 1,
          unitAmount: plan.amount,
        },
        amount: plan.amount,
        createdAt: now,
      })
      const attempt = createAttempt({
        id: attemptId,
        orderId,
        integration: input.integration!,
        method: input.integration === 'checkout' ? 'all' : 'card',
        merchantTxnId: `showcase-${randomUUID()}`,
        createdAt: now,
      })
      const contract = createSubscriptionPlaceholder({
        id: `subscription-${randomUUID()}`,
        plan,
        initialOrderId: orderId,
        initialAttemptId: attemptId,
        initialIntegration: input.integration!,
        createdAt: now,
      })
      const record = await createSubscriptionPaymentRecord(order, attempt, customer, contract)

      if (!record.created) {
        setPaymentRecovery(event, profile.secret, record.orderId, record.attemptId)
        const existing = await getPaymentRecovery(record.orderId, record.attemptId)
        return existing
          ? existingIntent(existing)
          : Object.freeze({ orderId: record.orderId, integration: record.contract.initialIntegration, create: false, existing: true })
      }

      setPaymentRecovery(event, profile.secret, orderId, attemptId)
      return Object.freeze({ orderId, integration: contract.initialIntegration, create: true, existing: false })
    }
    catch (error) {
      fail(error)
    }
  })
})
