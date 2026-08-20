import { describe, expect, it } from 'vitest'
import { createAttempt } from '../shared/payment/attempt'
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
