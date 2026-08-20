import { describe, expect, it } from 'vitest'
import {
  createAttempt,
  getRetryDecision,
  setAttemptStatus,
} from '../shared/payment/attempt'
import {
  CAPABILITIES,
  getCapability,
  INTEGRATIONS,
  isAvailable,
  isRunnable,
  PAYMENT_METHODS,
  SCENES,
} from '../shared/payment/capability'
import { createEvent } from '../shared/payment/event'
import { mergeAttempt } from '../shared/payment/merge'
import { createOrder } from '../shared/payment/order'
import {
  applyQueryResult,
  canAcceptSdkResult,
  canVerifySdkPayment,
  mapQueryStatus,
  preserveTerminalStatus,
  readConfirmResult,
  readSdkResult,
  singleFlight,
} from '../shared/payment/sdk'
import { reduceStage } from '../shared/payment/state'

describe('capability matrix', () => {
  it('contains every scene, integration and method combination', () => {
    expect(CAPABILITIES).toHaveLength(
      SCENES.length * INTEGRATIONS.length * PAYMENT_METHODS.length,
    )
  })

  it('only opens the M0 card capability', () => {
    const available = CAPABILITIES.filter(item => item.status === 'available')

    expect(available).toEqual([{
      scene: 'ecommerce',
      integration: 'web-js-sdk',
      method: 'card',
      status: 'available',
      runnable: true,
    }])
    expect(isAvailable('ecommerce', 'web-js-sdk', 'card')).toBe(true)
    expect(getCapability('ecommerce', 'checkout', 'card').status).toBe('planned')
    expect(getCapability('game', 'web-js-sdk', 'card').status).toBe('planned')
  })

  it('documents wallet conditions instead of asserting unsupported combinations', () => {
    const wallet = getCapability('ecommerce', 'web-js-sdk', 'apple-pay')

    expect(wallet.status).toBe('conditional')
    expect(wallet.runnable).toBe(false)
    expect(wallet.condition).toContain('supported Apple device')
    expect(getCapability('ecommerce', 'web-js-sdk', 'google-pay')).toMatchObject({
      status: 'conditional',
      runnable: true,
    })
    expect(isRunnable('ecommerce', 'web-js-sdk', 'google-pay')).toBe(true)
    expect(isRunnable('ecommerce', 'web-js-sdk', 'apple-pay')).toBe(false)
    expect(CAPABILITIES.some(item => item.status === 'unavailable')).toBe(false)
  })
})

describe('payment model', () => {
  it('keeps amounts as integer minor units', () => {
    const order = createOrder({
      id: 'order-1',
      scene: 'ecommerce',
      item: {
        sku: 'item-1',
        name: 'Sample',
        variant: 'Travel size',
        quantity: 1,
        unitAmount: { minor: 500, currency: 'USD' },
      },
      amount: { minor: 500, currency: 'USD' },
      createdAt: '2026-07-28T14:32:00.000Z',
    })

    expect(order.amount).toEqual({ minor: 500, currency: 'USD' })
    expect(Object.isFrozen(order)).toBe(true)
    expect(Object.isFrozen(order.item)).toBe(true)
  })

  it('rejects floating point major-unit amounts', () => {
    expect(() => createOrder({
      id: 'order-1',
      scene: 'ecommerce',
      item: {
        sku: 'item-1',
        name: 'Sample',
        variant: 'Travel size',
        quantity: 1,
        unitAmount: { minor: 5.25, currency: 'USD' },
      },
      amount: { minor: 5.25, currency: 'USD' },
      createdAt: '2026-07-28T14:32:00.000Z',
    })).toThrow('minor units')
  })

  it('reduces UI stages to normalized payment status', () => {
    expect(reduceStage('created', 'loading')).toBe('created')
    expect(reduceStage('created', 'submitting')).toBe('processing')
    expect(reduceStage('processing', 'redirecting')).toBe('requires_action')
    expect(reduceStage('requires_action', 'verifying')).toBe('processing')
    expect(reduceStage('processing', 'succeeded')).toBe('succeeded')
    expect(() => reduceStage('succeeded', 'submitting')).toThrow('Invalid payment transition')
  })

  it('keeps provider events independent from demo UI stages', () => {
    expect(createEvent({
      id: 'event-1',
      attemptId: 'attempt-1',
      source: 'webhook',
      status: 'processing',
      occurredAt: '2026-07-28T14:32:00.000Z',
    })).toEqual({
      id: 'event-1',
      attemptId: 'attempt-1',
      source: 'webhook',
      status: 'processing',
      occurredAt: '2026-07-28T14:32:00.000Z',
    })
  })

  it('allows a new attempt only after a trusted retryable terminal result', () => {
    const created = createAttempt({
      id: 'attempt-1',
      orderId: 'order-1',
      integration: 'web-js-sdk',
      method: 'card',
      merchantTxnId: 'merchant-1',
      createdAt: '2026-08-10T00:00:00.000Z',
    })

    expect(getRetryDecision(created)).toEqual({ allowed: false, reason: 'pending' })
    expect(getRetryDecision({ ...created, status: 'processing', statusSource: 'query' }))
      .toEqual({ allowed: false, reason: 'pending' })
    expect(getRetryDecision({ ...created, status: 'succeeded', statusSource: 'query' }))
      .toEqual({ allowed: false, reason: 'succeeded' })
    expect(getRetryDecision({ ...created, status: 'cancelled', statusSource: 'client' }))
      .toEqual({ allowed: false, reason: 'untrusted_terminal' })
    expect(getRetryDecision({ ...created, status: 'cancelled', statusSource: 'query' }))
      .toEqual({ allowed: true, reason: 'eligible' })
    expect(getRetryDecision({ ...created, status: 'failed', statusSource: 'webhook' }))
      .toEqual({ allowed: true, reason: 'eligible' })
  })

  it('clears method attribution when a trusted event advances the transaction', () => {
    const attributed = {
      ...createAttempt({
        id: 'attempt-1',
        orderId: 'order-1',
        integration: 'web-js-sdk' as const,
        method: 'google-pay' as const,
        merchantTxnId: 'merchant-1',
        createdAt: '2026-08-19T00:00:00.000Z',
      }),
      status: 'processing' as const,
      transactionId: '9000000000000000001',
      actualWallet: 'google-pay' as const,
      fundingNetwork: 'VISA',
      attributionTransactionId: '9000000000000000001',
    }
    const merged = mergeAttempt(attributed, createEvent({
      id: 'query-1',
      attemptId: attributed.id,
      source: 'query',
      status: 'succeeded',
      transactionId: '9000000000000000002',
      occurredAt: '2026-08-19T00:01:00.000Z',
    }))

    expect(merged.attempt).toMatchObject({ transactionId: '9000000000000000002' })
    expect(merged.attempt.actualWallet).toBeUndefined()
    expect(merged.attempt.fundingNetwork).toBeUndefined()
    expect(merged.attempt.attributionTransactionId).toBeUndefined()
  })

  it('keeps SDK results non-final and discards raw provider data', () => {
    const result = readSdkResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'S',
      rawResult: {
        respCode: '20000',
        cardNumber: 'must-not-pass-through',
      },
    }, 'payment-1')

    expect(result).toEqual({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      rawStatus: 'S',
      cancelled: false,
    })
    expect(result).not.toHaveProperty('rawResult')
    expect(mapQueryStatus('S')).toBe('succeeded')
    expect(mapQueryStatus('U')).toBe('processing')
    expect(mapQueryStatus('A')).toBe('processing')
    expect(mapQueryStatus('O')).toBe('processing')
    expect(mapQueryStatus('R')).toBe('requires_action')
    expect(() => mapQueryStatus('X')).toThrow('PAYMENT_STATUS_UNKNOWN')
  })

  it('keeps submitted non-terminal SDK payments queryable after an unknown result', () => {
    expect(canVerifySdkPayment('not_completed', true, 'created')).toBe(true)
    expect(canVerifySdkPayment('not_completed', false, 'processing')).toBe(true)
    expect(canVerifySdkPayment('not_completed', false, 'requires_action')).toBe(true)
    expect(canVerifySdkPayment('ready', true, 'processing')).toBe(false)
    expect(canVerifySdkPayment('not_completed', true, 'succeeded')).toBe(false)
  })

  it('handles confirm R separately from payment_result and discards raw provider data', () => {
    const result = readConfirmResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'R',
      nextAction: { type: 'RedirectShopper', url: 'must-not-pass-through' },
      rawResult: { cardNumber: 'must-not-pass-through' },
    }, 'payment-1')

    expect(result).toEqual({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      rawStatus: 'R',
      cancelled: false,
      nextAction: 'RedirectShopper',
    })
    expect(result).not.toHaveProperty('rawResult')
    expect(result).not.toHaveProperty('url')
    expect(() => readSdkResult({
      paymentId: 'payment-1',
      paymentStatus: 'R',
    }, 'payment-1')).toThrow('SDK_RESULT_STATUS_UNKNOWN')
    expect(() => readConfirmResult({
      paymentId: 'payment-1',
      paymentStatus: 'R',
      nextAction: { type: 'UnknownAction' },
    }, 'payment-1')).toThrow('SDK_NEXT_ACTION_UNKNOWN')
    expect(readConfirmResult({
      paymentId: 'payment-1',
      paymentStatus: 'R',
    }, 'payment-1')).toEqual({
      paymentId: 'payment-1',
      rawStatus: 'R',
      cancelled: false,
    })
  })

  it('distinguishes client cancellation from provider N', () => {
    expect(readSdkResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      reason: { type: 'canceled', code: 'presenter_closed' },
    }, 'payment-1')).toEqual({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      reasonType: 'canceled',
      cancelled: true,
    })
  })

  it('projects bounded SDK diagnostics without retaining provider payloads', () => {
    const result = readSdkResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      reason: {
        type: 'validation_error',
        code: 'INVALID_CARD',
        message: 'The card details are invalid.',
      },
      rawResult: { cardNumber: 'must-not-pass-through' },
    }, 'payment-1')

    expect(result).toEqual({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      reasonType: 'validation_error',
      reasonCode: 'INVALID_CARD',
      reasonMessage: 'The card details are invalid.',
      cancelled: false,
    })
    expect(result).not.toHaveProperty('reason')
    expect(result).not.toHaveProperty('rawResult')
    expect(() => readSdkResult({ paymentId: 'payment-1' }, 'payment-1')).toThrow('SDK_RESULT_STATUS_MISSING')
    expect(() => readSdkResult({
      paymentId: 'payment-1',
      reason: { type: 'unknown_error' },
    }, 'payment-1')).toThrow('SDK_RESULT_REASON_UNKNOWN')
  })

  it('projects an SDK API error without retaining the raw result', () => {
    const result = readSdkResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      reason: {
        type: 'api_error',
        code: '40000',
        message: 'Invalid transaction URL',
      },
      rawResult: {
        respCode: 'RAW_CODE',
        respMsg: 'Raw diagnostic must not override reason',
        data: null,
      },
    }, 'payment-1')

    expect(result).toEqual({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      reasonType: 'api_error',
      reasonCode: '40000',
      reasonMessage: 'Invalid transaction URL',
      cancelled: false,
    })
    expect(JSON.stringify(result)).not.toContain('RAW_CODE')
    expect(JSON.stringify(result)).not.toContain('Raw diagnostic')
    expect(result).not.toHaveProperty('reason')
    expect(result).not.toHaveProperty('rawResult')
  })

  it('uses only allowlisted raw result fields when reason diagnostics are unavailable', () => {
    expect(readSdkResult({
      paymentId: 'payment-1',
      reason: {
        type: 'api_error',
        code: 'REASON_CODE',
      },
      rawResult: {
        respCode: 'RAW_CODE',
        respMsg: 'Invalid transaction URL',
        data: { secret: 'must-not-pass-through' },
      },
    }, 'payment-1')).toEqual({
      paymentId: 'payment-1',
      reasonType: 'api_error',
      reasonCode: 'REASON_CODE',
      reasonMessage: 'Invalid transaction URL',
      cancelled: false,
    })

    expect(readSdkResult({
      paymentId: 'payment-1',
      reason: {
        type: 'api_error',
        message: 'Reason message wins',
      },
      rawResult: {
        respCode: 'RAW_CODE',
        respMsg: 'Raw message must not override',
      },
    }, 'payment-1')).toEqual({
      paymentId: 'payment-1',
      reasonType: 'api_error',
      reasonCode: 'RAW_CODE',
      reasonMessage: 'Reason message wins',
      cancelled: false,
    })

    expect(readSdkResult({
      paymentId: 'payment-1',
      reason: {
        type: 'api_error',
        code: 'ACCESS_TOKEN_TEST_VALUE',
      },
      rawResult: {
        respCode: 'SAFE_RAW_CODE',
      },
    }, 'payment-1').reasonCode).toBe('SAFE_RAW_CODE')

    const rawOnly = readSdkResult({
      paymentId: 'payment-1',
      rawResult: {
        respCode: '40000',
        respMsg: 'Invalid transaction URL',
        data: { secret: 'must-not-pass-through' },
      },
    }, 'payment-1')

    expect(rawOnly).toEqual({
      paymentId: 'payment-1',
      reasonCode: '40000',
      reasonMessage: 'Invalid transaction URL',
      cancelled: false,
    })
    expect(JSON.stringify(rawOnly)).not.toContain('must-not-pass-through')
    expect(rawOnly).not.toHaveProperty('rawResult')
    expect(() => readSdkResult({
      paymentId: 'payment-1',
      rawResult: { data: { respCode: '40000', respMsg: 'must-not-be-read' } },
    }, 'payment-1')).toThrow('SDK_RESULT_STATUS_MISSING')
  })

  it('redacts URL, personal and executable content from SDK reason diagnostics', () => {
    const result = readSdkResult({
      paymentId: 'payment-1',
      reason: {
        type: 'sdk_error',
        code: 'bad code!',
        message: 'Card 4000 0209 5159 5032 for customer@test.com failed at /return?state=TEST_QUERY and example.com/result <script>alert(1)</script>',
      },
      rawResult: {
        secret: 'raw-secret',
      },
    }, 'payment-1')

    expect(result.reasonCode).toBeUndefined()
    expect(result.reasonMessage).toContain('[redacted-number]')
    expect(result.reasonMessage).toContain('[redacted-email]')
    expect(result.reasonMessage).toContain('[redacted-url]')
    expect(result.reasonMessage).not.toContain('4000 0209 5159 5032')
    expect(result.reasonMessage).not.toContain('customer@test.com')
    expect(result.reasonMessage).not.toContain('TEST_QUERY')
    expect(result.reasonMessage).not.toContain('/return')
    expect(result.reasonMessage).not.toContain('example.com')
    expect(result.reasonMessage).not.toContain('<script>')
    expect(result).not.toHaveProperty('reason')
    expect(result).not.toHaveProperty('rawResult')

    for (const message of [
      'Authorization: Digest username="u", response="TEST_DIGEST", nonce="TEST_NONCE"',
      'access token is Bearer TEST_ACCESS_TOKEN',
      'CVV 123 was rejected',
      'CVV2 123 was rejected',
      'credentials=TEST_CREDENTIALS',
      'authToken=TEST_AUTH_TOKEN',
      'id_token=TEST_ID_TOKEN',
      'merchantSecret=TEST_MERCHANT_SECRET',
      'signatureValue=TEST_SIGNATURE',
    ]) {
      expect(readSdkResult({
        paymentId: 'payment-1',
        reason: { type: 'api_error', message },
      }, 'payment-1').reasonMessage).toBe('[redacted-sensitive-details]')
    }

    expect(readSdkResult({
      paymentId: 'payment-1',
      reason: { type: 'validation_error', message: 'Invalid three-digit value 123' },
    }, 'payment-1').reasonMessage).toBe('Invalid three-digit value [redacted-number]')

    expect(readSdkResult({
      paymentId: 'payment-1',
      reason: { type: 'api_error', code: 'ACCESS_TOKEN_TEST_VALUE' },
    }, 'payment-1').reasonCode).toBeUndefined()

    expect(readSdkResult({
      paymentId: 'payment-1',
      rawResult: {
        respCode: 'ACCESS_TOKEN_TEST_VALUE',
        respMsg: 'Authorization: Bearer TEST_CREDENTIAL',
      },
    }, 'payment-1')).toEqual({
      paymentId: 'payment-1',
      reasonMessage: '[redacted-sensitive-details]',
      cancelled: false,
    })

    const longResult = readSdkResult({
      paymentId: 'payment-1',
      reason: { type: 'api_error', message: 'x'.repeat(500) },
    }, 'payment-1')

    expect(longResult.reasonMessage).toHaveLength(240)
    expect(longResult.reasonMessage).toMatch(/…$/)
  })

  it('deduplicates SDK results and never regresses a terminal attempt', () => {
    const attempt = createAttempt({
      id: 'attempt-1',
      orderId: 'order-1',
      integration: 'web-js-sdk',
      method: 'card',
      createdAt: '2026-08-03T00:00:00.000Z',
    })
    const succeeded = setAttemptStatus(attempt, 'succeeded', '2026-08-03T00:01:00.000Z')

    expect(canAcceptSdkResult(attempt, null)).toBe(true)
    expect(canAcceptSdkResult(attempt, attempt.id)).toBe(false)
    expect(canAcceptSdkResult(succeeded, null)).toBe(false)
    expect(preserveTerminalStatus('processing', 'succeeded')).toBe('succeeded')
    expect(preserveTerminalStatus('succeeded', 'processing')).toBe('succeeded')
  })

  it('projects the authoritative stored attempt while retaining the query fact', () => {
    const order = createOrder({
      id: 'order-1',
      scene: 'ecommerce',
      item: {
        sku: 'item-1',
        name: 'Sample',
        variant: 'Travel size',
        quantity: 1,
        unitAmount: { minor: 500, currency: 'USD' },
      },
      amount: { minor: 500, currency: 'USD' },
      createdAt: '2026-08-04T00:00:00.000Z',
    })
    const base = createAttempt({
      id: 'attempt-1',
      orderId: order.id,
      integration: 'web-js-sdk',
      method: 'card',
      paymentId: 'payment-1',
      createdAt: order.createdAt,
    })
    const processing = setAttemptStatus(base, 'processing', order.createdAt, 'server')
    const succeeded = setAttemptStatus(processing, 'succeeded', '2026-08-04T00:01:00.000Z', 'webhook')
    const query = createEvent({
      id: 'query-open',
      attemptId: base.id,
      source: 'query',
      status: 'processing',
      rawStatus: 'O',
      occurredAt: '2026-08-04T00:02:00.000Z',
    })
    const projected = applyQueryResult({
      order,
      attempt: processing,
      attempts: [processing],
      events: [],
      paymentId: 'payment-1',
      query: { token: 'a'.repeat(43), expiresAt: '2026-08-04T00:05:00.000Z' },
    }, { attempt: succeeded, event: query })

    expect(projected.attempt.status).toBe('succeeded')
    expect(projected.attempt.statusSource).toBe('webhook')
    expect(projected.events).toEqual([query])
  })

  it('runs concurrent submit calls through one active promise', async () => {
    let calls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = singleFlight(async () => {
      calls += 1
      await gate
      return 'done'
    })
    const first = run()
    const second = run()

    expect(first).toBe(second)
    expect(calls).toBe(1)
    release?.()
    await expect(first).resolves.toBe('done')
  })
})
