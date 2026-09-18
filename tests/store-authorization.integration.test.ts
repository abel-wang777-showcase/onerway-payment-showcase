import { randomUUID } from 'node:crypto'
import { Pool } from '@neondatabase/serverless'
import { describe, expect, it } from 'vitest'
import { createAttempt } from '../shared/payment/attempt'
import { createAuthorizationState } from '../shared/payment/authorization'
import { createEvent } from '../shared/payment/event'
import { createOrder } from '../shared/payment/order'
import { createMerchantCustomer } from '../server/utils/customer'
import type { AuthorizationWebhook, PaymentWebhook } from '../server/utils/webhook'
import {
  claimStoredAuthorizationOperation,
  completePaymentRecord,
  createPaymentRecord,
  createPaymentRetry,
  getPaymentRecovery,
  getPaymentTimeline,
  recordAuthorizationOperationResponse,
  recordAuthorizationWebhookEvent,
  recordQueryEvent,
  recordWebhookEvent,
} from '../server/utils/store'
import { requireTestDatabaseUrl } from './db'

const databaseUrl = requireTestDatabaseUrl()
process.env.DATABASE_URL = databaseUrl

function fixture() {
  const suffix = randomUUID().replaceAll('-', '')
  const now = new Date().toISOString()
  const id = `HLD-TEST-AUTH-${suffix}`
  const merchantTxnId = `auth-${suffix}`
  const order = createOrder({ id, scene: 'ecommerce', item: {
    sku: 'auth-test', name: 'AUTH persistence test', variant: 'Test only', quantity: 1,
    unitAmount: { minor: 500, currency: 'USD' },
  }, amount: { minor: 500, currency: 'USD' }, createdAt: now })
  const attempt = createAttempt({
    id: `${id}-attempt`, orderId: id, integration: 'checkout', method: 'card', merchantTxnId,
    createdAt: now, authorization: createAuthorizationState({ merchantTxnId, amountMinor: 500, currency: 'USD', occurredAt: now }),
  })
  const sequence = BigInt(`0x${suffix.slice(0, 15)}`).toString().padStart(19, '0')
  const fact: AuthorizationWebhook = {
    kind: 'authorization', source: 'webhook', txnType: 'AUTH', merchantTxnId,
    paymentId: `1${sequence}`, transactionId: `2${sequence}`, amountMinor: 500, currency: 'USD',
    transactionStatus: 'S', paymentStatus: 'A', status: 'processing', fundsStatus: 'authorized', occurredAt: now,
  }
  return { order, attempt, fact, now, sequence }
}

async function cleanup(orderId: string) {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await pool.query("DELETE FROM payment_orders WHERE id = $1 AND id LIKE 'HLD-TEST-AUTH-%'", [orderId])
  }
  finally {
    await pool.end()
  }
}

async function insert(input: ReturnType<typeof fixture>) {
  await createPaymentRecord(input.order, input.attempt, createMerchantCustomer({
    profile: 'sandbox', merchantNo: 'test-merchant', appId: 'test-app',
  }))
}

describe('Neon authorization persistence', () => {
  it.each(['CAPTURE', 'VOID'] as const)('allows one winner for concurrent CAPTURE and %s, preserving notification-before-response truth', async (competingType) => {
    const data = fixture()
    try {
      await insert(data)
      await recordAuthorizationWebhookEvent(data.fact, data.now)
      // The Provider may deliver successful AUTH before the create request returns.
      const created = await completePaymentRecord(data.attempt.id, data.fact.paymentId, `3${data.sequence}`, createEvent({
        id: randomUUID(), attemptId: data.attempt.id, source: 'server', sourceKey: `create:${data.attempt.id}`,
        status: 'processing', rawStatus: 'U', transactionId: `3${data.sequence}`, occurredAt: data.now,
      }))
      expect(created.authorization?.authTransactionId).toBe(data.fact.transactionId)
      const claims = await Promise.all([
        claimStoredAuthorizationOperation(data.attempt.id, 'CAPTURE', `capture-${randomUUID()}`, data.now),
        claimStoredAuthorizationOperation(data.attempt.id, competingType, `operation-${randomUUID()}`, data.now),
      ])
      expect(claims.filter(result => result.claimed)).toHaveLength(1)
      const winner = claims.find(result => result.claimed)!
      const operation = winner.attempt.authorization!.operation!
      const captured = operation.type === 'CAPTURE'
      const completion: AuthorizationWebhook = { ...data.fact,
        txnType: operation.type, transactionId: `4${data.sequence}`,
        merchantTxnId: captured ? data.fact.merchantTxnId : operation.merchantTxnId,
        paymentStatus: captured ? 'S' : 'N', status: captured ? 'succeeded' : 'cancelled', fundsStatus: captured ? 'captured' : 'voided',
      }
      const notifications = await Promise.all([
        recordAuthorizationWebhookEvent(completion, data.now),
        recordAuthorizationWebhookEvent(completion, data.now),
      ])
      expect(notifications.filter(result => result.duplicate)).toHaveLength(1)
      await recordAuthorizationOperationResponse(data.attempt.id, operation.merchantTxnId, null, data.now)
      await recordAuthorizationWebhookEvent({ ...data.fact, transactionId: `5${data.sequence}`, transactionStatus: 'F', paymentStatus: 'O', fundsStatus: 'pending' }, data.now)
      const recovered = await getPaymentRecovery(data.order.id, data.attempt.id)
      expect(recovered?.attempt.authorization).toMatchObject({ fundsStatus: completion.fundsStatus,
        authTransactionId: data.fact.transactionId, operation: { status: 'confirmed', transactionId: completion.transactionId } })
      expect(recovered?.attempt.transactionId).not.toBe(completion.transactionId)
      expect(recovered?.attempts[0]?.authorization).toEqual(recovered?.attempt.authorization)
      expect(recovered?.events.filter(event => event.source === 'webhook' && event.transactionId === completion.transactionId)).toHaveLength(1)
      expect((await getPaymentTimeline(operation.merchantTxnId))?.attempt.authorization).toEqual(recovered?.attempt.authorization)
      await expect(createPaymentRetry(data.order.id, data.attempt.id, data.fact.paymentId, data.now)).rejects.toMatchObject({ code: 'PAYMENT_RETRY_NOT_ALLOWED' })
      // SALE looks up the original merchant request id, independently of which
      // operation won. Use a new event id so deduplication cannot hide the guard.
      const sale: PaymentWebhook = {
        merchantTxnId: data.fact.merchantTxnId, transactionId: `7${data.sequence}`,
        paymentId: data.fact.paymentId, amountMinor: data.fact.amountMinor, currency: data.fact.currency,
        transactionStatus: 'S', paymentStatus: 'S', status: 'succeeded', occurredAt: data.now,
      }
      await expect(recordWebhookEvent(sale)).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
      await expect(recordWebhookEvent({ ...sale, merchantTxnId: operation.merchantTxnId }))
        .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_NOT_FOUND' })
      await expect(recordQueryEvent(data.attempt.id, data.fact.paymentId, {
        merchantTxnId: data.fact.merchantTxnId, paymentId: data.fact.paymentId, transactionId: data.fact.transactionId, rawStatus: 'S', status: 'succeeded',
      }, data.now)).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
      const afterRejections = await getPaymentRecovery(data.order.id, data.attempt.id)
      expect(afterRejections?.attempt).toEqual(recovered?.attempt)
      expect(afterRejections?.events).toEqual(recovered?.events)
    }
    finally {
      await cleanup(data.order.id)
    }
  })

  it('serializes conflicting successful AUTH ids and closes operation claims', async () => {
    const data = fixture()
    try {
      await insert(data)
      const results = await Promise.all([
        recordAuthorizationWebhookEvent(data.fact, data.now),
        recordAuthorizationWebhookEvent({ ...data.fact, transactionId: `6${data.sequence}` }, data.now),
      ])
      expect(results.filter(result => result.event?.conflict)).toHaveLength(1)
      const recovery = await getPaymentRecovery(data.order.id, data.attempt.id)
      expect(recovery?.attempt.authorization?.conflict).toBe(true)
      expect(recovery?.events.filter(event => event.conflict)).toHaveLength(1)
      expect((await claimStoredAuthorizationOperation(data.attempt.id, 'CAPTURE', `blocked-${randomUUID()}`, data.now)).claimed).toBe(false)
    }
    finally {
      await cleanup(data.order.id)
    }
  })
})
