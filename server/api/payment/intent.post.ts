import { randomUUID } from 'node:crypto'
import { getJourney, isJourneyId, supportsSandboxMethod } from '../../../shared/payment/journey'
import { PAYMENT_METHODS, type PaymentMethodId } from '../../../shared/payment/capability'
import { createAttempt } from '../../../shared/payment/attempt'
import { createOrder } from '../../../shared/payment/order'
import {
  isTerminalStatus,
  type CreatePaymentIntentInput,
  type CreatePaymentIntentResponse,
} from '../../../shared/payment/sdk'
import { requireCanonicalPaymentOrigin, withPaymentLimit } from '../../utils/limit'
import { requireServerProfile } from '../../utils/profile'
import { readPaymentRecovery, setPaymentRecovery } from '../../utils/recovery'
import {
  createPaymentRecord,
  ensurePaymentCustomer,
  getPaymentRecovery,
  PaymentStoreError,
} from '../../utils/store'
import {
  createMerchantCustomer,
  isMerchantCustomerInScope,
} from '../../utils/customer'

function fail(error: unknown): never {
  if (error instanceof PaymentStoreError) {
    throw createError({ statusCode: 503, statusMessage: error.code })
  }

  throw error
}

function readInput(value: unknown): CreatePaymentIntentInput {
  const input = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  const journeyId = input?.journeyId
  const method = input?.method ?? 'card'
  const restart = input?.restart
  const keys = input ? Object.keys(input) : []

  if (
    !input
    || keys.some(key => !['journeyId', 'method', 'restart'].includes(key))
    || keys.length < 1
    || keys.length > 3
    || !isJourneyId(journeyId)
    || typeof method !== 'string'
    || !PAYMENT_METHODS.includes(method as PaymentMethodId)
    || (restart !== undefined && restart !== true)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_INPUT_INVALID' })
  }

  const journey = getJourney(journeyId)

  if (!supportsSandboxMethod(journey, method as PaymentMethodId)) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_JOURNEY_UNAVAILABLE' })
  }

  return Object.freeze({
    journeyId,
    method: method as PaymentMethodId,
    ...(restart ? { restart: true as const } : {}),
  })
}

export default defineEventHandler(async (event): Promise<CreatePaymentIntentResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const profile = requireServerProfile()

  if (profile.profile !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  }

  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)

  return withPaymentLimit(event, 'create', async () => {
    try {
      const input = readInput(await readBody<unknown>(event))
      const ref = readPaymentRecovery(event, profile.secret)
      const previous = ref
        ? await getPaymentRecovery(ref.orderId, ref.attemptId)
        : null
      const previousInScope = previous?.customer
        ? isMerchantCustomerInScope(previous.customer, profile)
        : null

      if (ref && !input.restart) {
        const existing = previous

        if (existing && !isTerminalStatus(existing.attempt.status)) {
          if (previousInScope === false) {
            throw createError({ statusCode: 409, statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
          }

          const claimed = existing.events.some(item =>
            item.source === 'server' && item.sourceKey === `create-claim:${existing.attempt.id}`,
          )

          return Object.freeze({
            orderId: existing.order.id,
            create: !existing.attempt.paymentId && !claimed,
          })
        }
      }

      const now = new Date().toISOString()
      const journey = getJourney(input.journeyId)
      const orderId = `HLD-${randomUUID().slice(0, 8).toUpperCase()}`
      const attemptId = `${orderId}-attempt-1`
      const order = createOrder({
        id: orderId,
        scene: 'ecommerce',
        item: {
          sku: journey.sku,
          name: journey.item,
          variant: journey.variant,
          quantity: 1,
          unitAmount: { minor: journey.amount, currency: journey.currency },
        },
        amount: { minor: journey.amount, currency: journey.currency },
        createdAt: now,
      })
      const attempt = createAttempt({
        id: attemptId,
        orderId,
        integration: 'web-js-sdk',
        method: input.method ?? 'card',
        merchantTxnId: `showcase-${randomUUID()}`,
        createdAt: now,
      })
      const customer = previousInScope
        ? previous!.customer!
        : previous?.customer === null
          ? await ensurePaymentCustomer(previous.order.id, createMerchantCustomer(profile))
          : createMerchantCustomer(profile)

      if (!isMerchantCustomerInScope(customer, profile)) {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
      }

      await createPaymentRecord(order, attempt, customer)
      setPaymentRecovery(event, profile.secret, orderId, attemptId)

      return Object.freeze({ orderId, create: true })
    }
    catch (error) {
      fail(error)
    }
  })
})
