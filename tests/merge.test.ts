import { describe, expect, it } from 'vitest'
import { createAttempt } from '../shared/payment/attempt'
import { createAuthorizationState } from '../shared/payment/authorization'
import { createEvent } from '../shared/payment/event'
import { findProjectionEvent, mapWebhookStatus, mergeAttempt } from '../shared/payment/merge'

function attempt(status: 'created' | 'requires_action' | 'processing' | 'succeeded' | 'cancelled', source?: 'query' | 'webhook') {
  return Object.freeze({
    ...createAttempt({
      id: 'attempt-1',
      orderId: 'order-1',
      integration: 'web-js-sdk',
      method: 'card',
      createdAt: '2026-08-04T07:00:00.000Z',
    }),
    status,
    ...(source ? { statusSource: source } : {}),
  })
}

function event(
  status: 'processing' | 'succeeded' | 'cancelled',
  source: 'query' | 'webhook' = 'webhook',
) {
  return createEvent({
    id: `event-${source}-${status}`,
    attemptId: 'attempt-1',
    source,
    status,
    transactionId: 'transaction-1',
    occurredAt: '2026-08-04T07:01:00.000Z',
  })
}

describe('payment state convergence', () => {
  it('preserves transaction and Payment dual-axis semantics', () => {
    expect(mapWebhookStatus('S', 'S')).toBe('succeeded')
    expect(mapWebhookStatus('F', 'O')).toBe('processing')
    expect(mapWebhookStatus('N', 'N')).toBe('cancelled')
    expect(mapWebhookStatus('F')).toBe('processing')
    expect(mapWebhookStatus('N')).toBe('cancelled')
    expect(() => mapWebhookStatus('X')).toThrow('PAYMENT_WEBHOOK_STATUS_UNKNOWN')
  })

  it('advances a non-terminal attempt from trusted facts', () => {
    const merged = mergeAttempt(attempt('processing'), event('succeeded'))

    expect(merged.conflict).toBe(false)
    expect(merged.attempt).toMatchObject({
      status: 'succeeded',
      statusSource: 'webhook',
      transactionId: 'transaction-1',
    })
  })

  it('never regresses a terminal attempt to processing', () => {
    const current = attempt('succeeded', 'webhook')
    const merged = mergeAttempt(current, event('processing', 'query'))

    expect(merged).toEqual({ attempt: current, conflict: false })
  })

  it('selects the event that established the current projection after late facts', () => {
    const current = attempt('succeeded', 'query')
    const succeeded = createEvent({
      id: 'event-query-succeeded',
      attemptId: current.id,
      source: 'query',
      status: 'succeeded',
      rawStatus: 'S',
      occurredAt: '2026-08-04T07:01:00.000Z',
    })
    const lateProcessing = createEvent({
      id: 'event-query-processing',
      attemptId: current.id,
      source: 'query',
      status: 'processing',
      rawStatus: 'P',
      occurredAt: '2026-08-04T07:02:00.000Z',
    })

    expect(findProjectionEvent(current, [succeeded, lateProcessing])).toBe(succeeded)
  })

  it('does not let an older non-terminal webhook replace a query projection', () => {
    const current = attempt('requires_action', 'query')
    const merged = mergeAttempt(current, event('processing', 'webhook'))

    expect(merged).toEqual({ attempt: current, conflict: false })
  })

  it('does not let a delayed create completion replace a webhook projection', () => {
    const current = attempt('succeeded', 'webhook')
    const merged = mergeAttempt(current, createEvent({
      id: 'event-server-processing',
      attemptId: 'attempt-1',
      source: 'server',
      status: 'processing',
      occurredAt: '2026-08-04T07:02:00.000Z',
    }))

    expect(merged).toEqual({ attempt: current, conflict: false })
  })

  it('lets a fresh query reconcile a conflicting webhook terminal state', () => {
    const merged = mergeAttempt(
      attempt('cancelled', 'webhook'),
      event('succeeded', 'query'),
    )

    expect(merged.conflict).toBe(true)
    expect(merged.attempt.status).toBe('succeeded')
    expect(merged.attempt.statusSource).toBe('query')
  })

  it('does not let a later webhook overwrite a terminal query projection', () => {
    const current = attempt('succeeded', 'query')
    const merged = mergeAttempt(current, event('cancelled', 'webhook'))

    expect(merged).toEqual({ attempt: current, conflict: true })
  })

  it('rejects terminal client evidence', () => {
    expect(() => mergeAttempt(attempt('processing'), createEvent({
      id: 'event-client',
      attemptId: 'attempt-1',
      source: 'client',
      status: 'succeeded',
      occurredAt: '2026-08-04T07:01:00.000Z',
    }))).toThrow('PAYMENT_EVENT_TERMINAL_UNTRUSTED')
  })
})

describe('authorization projection evidence', () => {
  const pending = createAuthorizationState({ merchantTxnId: 'auth-merchant', amountMinor: 500, currency: 'USD', occurredAt: '2026-09-21T00:00:00.000Z' })

  it.each(['query', 'webhook'] as const)('keeps the successful AUTH %s evidence after failure or conflicting same-source facts', (source) => {
    const current = { ...attempt('processing', source), authorization: { ...pending, fundsStatus: 'authorized' as const, paymentId: '1000', authTransactionId: '1001' } }
    const authorized = createEvent({ ...event('processing', source), transactionId: '1001', rawStatus: 'AUTH:S:A', transactionStatus: 'S', paymentStatus: 'A' })
    const failure = createEvent({ ...authorized, id: 'failure', transactionId: '1002', rawStatus: 'AUTH:F:O', transactionStatus: 'F', paymentStatus: 'O' })
    const conflict = createEvent({ ...authorized, id: 'conflict', transactionId: '1003', conflict: true })
    const otherTransaction = createEvent({ ...authorized, id: 'other-transaction', transactionId: '1004' })
    expect(findProjectionEvent(current, [authorized, failure, conflict, otherTransaction])).toBe(authorized)
    expect(findProjectionEvent(current, [failure, conflict, otherTransaction])).toBeUndefined()
  })

  it.each(['CAPTURE', 'VOID'] as const)('requires the confirmed %s operation id and exact funds tuple', (type) => {
    const captured = type === 'CAPTURE'
    const status = captured ? 'succeeded' as const : 'cancelled' as const
    const paymentStatus = captured ? 'S' : 'N'
    const authorization = { ...pending, fundsStatus: captured ? 'captured' as const : 'voided' as const,
      paymentId: '1000', authTransactionId: '1001',
      operation: { type, merchantTxnId: 'operation-merchant', transactionId: '1002', status: 'confirmed' as const } }
    const current = { ...attempt(status, 'query'), authorization }
    const completion = createEvent({ ...event(status, 'query'), transactionId: '1002', rawStatus: `${type}:S:${paymentStatus}`, transactionStatus: 'S', paymentStatus })
    const conflict = createEvent({ ...completion, id: 'conflict', conflict: true })
    const wrongId = createEvent({ ...completion, id: 'wrong-id', transactionId: '1001' })
    const wrongType = createEvent({ ...completion, id: 'wrong-type', rawStatus: `AUTH:S:${paymentStatus}` })
    expect(findProjectionEvent(current, [completion, conflict, wrongId, wrongType])).toBe(completion)
    expect(findProjectionEvent({ ...current, authorization: { ...authorization,
      operation: { ...authorization.operation, status: 'unknown' } } }, [completion])).toBeUndefined()
  })

  it('excludes conflicts from pending AUTH evidence without changing ordinary SALE selection', () => {
    const initial = event('processing', 'query')
    const conflict = createEvent({ ...initial, id: 'conflict', conflict: true })
    expect(findProjectionEvent({ ...attempt('processing', 'query'), authorization: pending }, [initial, conflict])).toBe(initial)
    expect(findProjectionEvent(attempt('processing', 'query'), [initial, conflict])).toBe(conflict)
  })
})
