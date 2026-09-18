import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAttempt, getRetryDecision } from '../shared/payment/attempt'
import { createAuthorizationState, type AuthorizationState } from '../shared/payment/authorization'
import { createEvent } from '../shared/payment/event'
import { createOrder } from '../shared/payment/order'
import { createMerchantCustomer } from '../server/utils/customer'
import type { AuthorizationWebhook } from '../server/utils/webhook'
import {
  claimStoredAuthorizationOperation,
  completePaymentRecord,
  createPaymentRecord,
  createPaymentRetry,
  getPaymentTimeline,
  recordAuthorizationOperationResponse,
  recordAuthorizationWebhookEvent,
  recordQueryEvent,
  recordReturnEvent,
  recordWebhookEvent,
} from '../server/utils/store'

const database = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
vi.mock('@neondatabase/serverless', () => ({ Pool: class {
  on() {}
  connect() { return database }
} }))

const now = '2026-09-18T08:00:00.000Z'
const merchantTxnId = 'merchant-auth-1'
const pending = createAuthorizationState({ merchantTxnId, amountMinor: 500, currency: 'USD', occurredAt: now })
const authorized: AuthorizationState = { ...pending, fundsStatus: 'authorized', paymentId: '1000', authTransactionId: '1002' }

function row(authorization: AuthorizationState | null = authorized) {
  return {
    id: 'attempt-1', order_id: 'order-1', integration: 'checkout', method: 'card',
    merchant_txn_id: merchantTxnId, payment_id: authorization?.paymentId ?? null,
    transaction_id: '1001', status: 'processing', status_source: 'webhook', retry_of: null,
    authorization_state: authorization, amount_minor: 500, currency: 'USD', created_at: now, updated_at: now,
  }
}

function mockRow(authorization: AuthorizationState | null = authorized) {
  const saved: Record<string, unknown> = row(authorization)
  const events: Record<string, unknown>[] = []
  database.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('SELECT') && sql.includes('payment_attempts')) return { rows: [saved] }
    if (sql.includes('SELECT') && sql.includes('payment_events')) return { rows: events.filter(e => e.source === values[0] && e.source_key === values[1]) }
    if (sql.includes('UPDATE payment_attempts')) Object.assign(saved, {
      status: values[1], status_source: values[2], payment_id: values[3] ?? saved.payment_id,
      transaction_id: values[4] ?? saved.transaction_id, updated_at: values[8],
      authorization_state: values[9] ? JSON.parse(values[9] as string) : null,
    })
    if (sql.includes('INSERT INTO payment_events')) events.push({
      id: values[0], attempt_id: values[1], source: values[2], source_key: values[3],
      status: values[4], raw_status: values[5], transaction_id: values[6], transaction_status: values[7],
      payment_status: values[8], conflict: values[9], occurred_at: values[10],
    })
    return { rows: [] }
  })
  return { saved, events }
}

function fact(overrides: Partial<AuthorizationWebhook> = {}): AuthorizationWebhook {
  return {
    kind: 'authorization', source: 'webhook', txnType: 'AUTH', transactionId: '1002', paymentId: '1000',
    merchantTxnId, amountMinor: 500, currency: 'USD', transactionStatus: 'S', paymentStatus: 'A',
    fundsStatus: 'authorized', status: 'processing', occurredAt: now, ...overrides,
  }
}

function createResult() {
  return createEvent({
    id: 'create-event', attemptId: 'attempt-1', source: 'server', sourceKey: 'create:attempt-1',
    status: 'processing', rawStatus: 'U', transactionId: '1001', occurredAt: now,
  })
}

describe('authorization persistence', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://mock-only.invalid/test')
    database.query.mockReset()
    mockRow()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('persists and restores only the authorization whitelist', async () => {
    const order = createOrder({ id: 'order-1', scene: 'ecommerce', item: {
      sku: 'auth', name: 'Authorization', variant: 'Test', quantity: 1, unitAmount: { minor: 500, currency: 'USD' },
    }, amount: { minor: 500, currency: 'USD' }, createdAt: now })
    const attempt = createAttempt({ id: 'attempt-1', orderId: order.id, integration: 'checkout', method: 'card',
      merchantTxnId, createdAt: now, authorization: { ...pending, extra: 'private-value' } as AuthorizationState })
    await createPaymentRecord(order, attempt, createMerchantCustomer({ profile: 'sandbox', merchantNo: 'merchant', appId: 'app' }))
    const insert = database.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO payment_attempts'))!
    expect(JSON.parse(insert[1][8])).toEqual(pending)
    mockRow({ ...authorized, extra: 'private-value' } as AuthorizationState)
    expect((await getPaymentTimeline(merchantTxnId))?.attempt.authorization).toEqual(authorized)
  })

  it('accepts success before create completes and never replaces its AUTH anchor with the create id', async () => {
    const { events } = mockRow(pending)
    const result = await recordAuthorizationWebhookEvent(fact(), now)
    expect(result).toMatchObject({ correlated: true, duplicate: false, attempt: { status: 'processing', authorization: authorized } })
    const completed = await completePaymentRecord('attempt-1', '1000', '1001', createResult())
    expect(completed.authorization?.authTransactionId).toBe('1002')
    expect(completed.statusSource).toBe('webhook')
    expect(events.map(event => event.source)).toEqual(['webhook', 'server'])
  })

  it('does not treat the create response as a successful authorization', async () => {
    mockRow(pending)
    const completed = await completePaymentRecord('attempt-1', '1000', '1001', createResult())
    expect(completed.authorization).toEqual({ ...pending, paymentId: '1000' })
    expect((await claimStoredAuthorizationOperation('attempt-1', 'CAPTURE', 'capture-1', now)).claimed).toBe(false)
  })

  it('uses a row lock and keeps same/opposite claims excluded once a winner is saved', async () => {
    const { events } = mockRow()
    expect((await claimStoredAuthorizationOperation('attempt-1', 'CAPTURE', 'operation-1', now)).claimed).toBe(true)
    expect((await claimStoredAuthorizationOperation('attempt-1', 'CAPTURE', 'operation-2', now)).claimed).toBe(false)
    expect((await claimStoredAuthorizationOperation('attempt-1', 'VOID', 'operation-3', now)).claimed).toBe(false)
    expect(events).toHaveLength(1)
    expect(database.query.mock.calls.some(([sql]) => sql.includes('payment_attempts WHERE id = $1 FOR UPDATE'))).toBe(true)
  })

  it.each([null, { paymentId: '1000', transactionId: '1003', transactionStatus: 'S', paymentStatus: 'S' }])('keeps funds frozen and operation locked for synchronous result %j', async (response) => {
    const { saved } = mockRow()
    await claimStoredAuthorizationOperation('attempt-1', 'CAPTURE', 'operation-1', now)
    const result = await recordAuthorizationOperationResponse('attempt-1', 'operation-1', response, now)
    expect(result.attempt.authorization).toMatchObject({ fundsStatus: 'authorized', operation: { status: 'unknown' } })
    expect(saved.status).toBe('processing')
    expect((await claimStoredAuthorizationOperation('attempt-1', 'VOID', 'other', now)).claimed).toBe(false)
  })

  it.each(['CAPTURE', 'VOID'] as const)('persists early %s notification, duplicate and late response without downgrading truth', async (type) => {
    const { events } = mockRow()
    await claimStoredAuthorizationOperation('attempt-1', type, 'operation-1', now)
    const notification = fact({ txnType: type, merchantTxnId: type === 'VOID' ? 'operation-1' : merchantTxnId,
      transactionId: '1003', paymentStatus: type === 'VOID' ? 'N' : 'S' })
    const received = await recordAuthorizationWebhookEvent(notification, now)
    expect(received.attempt?.authorization).toMatchObject({ fundsStatus: type === 'VOID' ? 'voided' : 'captured', operation: { status: 'confirmed', transactionId: '1003' } })
    expect(received.attempt?.transactionId).toBe('1001')
    expect((await recordAuthorizationWebhookEvent(notification, now)).duplicate).toBe(true)
    const late = await recordAuthorizationOperationResponse('attempt-1', 'operation-1', null, now)
    expect(late.attempt.authorization?.operation?.status).toBe('confirmed')
    expect(events.filter(event => event.source === 'webhook')).toHaveLength(1)
  })

  it('rejects unclaimed operation notifications before persisting any event', async () => {
    const { events } = mockRow()
    await expect(recordAuthorizationWebhookEvent(fact({ txnType: 'CAPTURE', transactionId: '1003', paymentStatus: 'S' }), now))
      .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
    expect(events).toHaveLength(0)
  })

  it('persists a conflicting successful AUTH id and prevents future operations', async () => {
    const { events } = mockRow()
    const result = await recordAuthorizationWebhookEvent(fact({ transactionId: '1004' }), now)
    expect(result.event?.conflict).toBe(true)
    expect(result.attempt?.authorization).toMatchObject({ authTransactionId: '1002', conflict: true })
    expect((await claimStoredAuthorizationOperation('attempt-1', 'VOID', 'operation-1', now)).claimed).toBe(false)
    expect(events).toHaveLength(1)
  })

  it('keeps late conflicting response ids separate from the verified operation id', async () => {
    mockRow({ ...authorized, fundsStatus: 'captured', operation: {
      type: 'CAPTURE', merchantTxnId: 'operation-1', transactionId: '1003', status: 'confirmed',
    } })
    const result = await recordAuthorizationOperationResponse('attempt-1', 'operation-1', {
      paymentId: '1000', transactionId: '1004', transactionStatus: 'S',
    }, now)
    expect(result.attempt.authorization).toMatchObject({ conflict: true, fundsStatus: 'captured', operation: { transactionId: '1003', status: 'confirmed' } })
    expect(result.event?.conflict).toBe(true)
  })

  it('rejects ordinary query, SALE notifications and retry for AUTH records', async () => {
    const { events } = mockRow()
    await expect(recordQueryEvent('attempt-1', '1000', { paymentId: '1000', transactionId: '1001', merchantTxnId, status: 'succeeded', rawStatus: 'S' }, now))
      .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
    await expect(recordWebhookEvent({ ...fact(), status: 'succeeded', paymentStatus: 'S' }))
      .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
    await expect(createPaymentRetry('order-1', 'attempt-1', '1000', now)).rejects.toMatchObject({ code: 'PAYMENT_RETRY_NOT_ALLOWED' })
    await expect(completePaymentRecord('attempt-1', '1000', '1001', { ...createResult(), source: 'query', status: 'succeeded' }))
      .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
    expect(getRetryDecision(createAttempt({ id: 'attempt-1', orderId: 'order-1', integration: 'checkout', method: 'card', createdAt: now, authorization: authorized })))
      .toEqual({ allowed: false, reason: 'authorization' })
    expect(events).toHaveLength(0)
  })

  it('records return recovery without projecting any funds status', async () => {
    const { saved } = mockRow()
    await recordReturnEvent('attempt-1', now)
    expect(saved.authorization_state).toEqual(authorized)
    expect(database.query.mock.calls.some(([sql]) => sql.includes('UPDATE payment_attempts'))).toBe(false)
  })

  it('rolls back instead of acknowledging when the state write fails after event insertion', async () => {
    mockRow(pending)
    const query = database.query.getMockImplementation()!
    database.query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (sql.includes('UPDATE payment_attempts')) throw new Error('simulated write failure')
      return query(sql, values)
    })
    await expect(recordAuthorizationWebhookEvent(fact(), now)).rejects.toMatchObject({ code: 'PAYMENT_DATABASE_ERROR' })
    expect(database.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true)
    expect(database.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false)
  })
})
