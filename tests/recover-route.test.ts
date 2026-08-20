import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createQueryExpiry: vi.fn(),
  createQueryToken: vi.fn(),
  queryPayment: vi.fn(),
  queryPaymentCreation: vi.fn(),
  querySubscription: vi.fn(),
  completePaymentRecord: vi.fn(),
  getPaymentRecovery: vi.fn(),
  getRetainedSubscriptionRecovery: vi.fn(),
  readPaymentRecovery: vi.fn(),
  recordSubscriptionQueryDetails: vi.fn(),
  requireServerProfile: vi.fn(),
  setPaymentRecovery: vi.fn(),
}))

vi.mock('../server/utils/gateway', () => ({
  createQueryExpiry: mocks.createQueryExpiry,
  createQueryToken: mocks.createQueryToken,
  GatewayError: class GatewayError extends Error {},
  queryPayment: mocks.queryPayment,
  queryPaymentCreation: mocks.queryPaymentCreation,
  querySubscription: mocks.querySubscription,
}))

vi.mock('../server/utils/limit', () => ({
  withPaymentLimit: (_event: unknown, _kind: string, task: () => Promise<unknown>) => task(),
}))

vi.mock('../server/utils/profile', () => ({
  requireServerProfile: mocks.requireServerProfile,
}))

vi.mock('../server/utils/recovery', () => ({
  readPaymentRecovery: mocks.readPaymentRecovery,
  setPaymentRecovery: mocks.setPaymentRecovery,
}))

vi.mock('../server/utils/store', () => ({
  completePaymentRecord: mocks.completePaymentRecord,
  getPaymentRecovery: mocks.getPaymentRecovery,
  getRetainedSubscriptionRecovery: mocks.getRetainedSubscriptionRecovery,
  paymentRetryRejectionKey: (attemptId: string) => `retry-create-rejected:${attemptId}`,
  subscriptionCreationRejectionKey: (attemptId: string) => `subscription-create-contract-rejected:${attemptId}`,
  subscriptionCreationRecoveryAllowedKey: (attemptId: string) => `subscription-create-recovery-allowed:${attemptId}`,
  PaymentStoreError: class PaymentStoreError extends Error {
    readonly code: string

    constructor(code: string) {
      super(code)
      this.code = code
    }
  },
  recordSubscriptionQueryDetails: mocks.recordSubscriptionQueryDetails,
}))

function recovery(submissionStartedAt?: string) {
  const attempt = {
    id: 'attempt-1',
    orderId: 'order-1',
    status: 'processing',
    paymentId: '9000000000000000001',
    ...(submissionStartedAt ? { submissionStartedAt } : {}),
  }

  return {
    order: {
      id: 'order-1',
      amount: { minor: 500, currency: 'USD' },
    },
    attempt,
    attempts: [attempt],
    events: [],
    customer: {
      environment: 'sandbox',
      merchantNo: 'private-merchant',
      appId: 'private-app',
      merchantCustId: 'Private_Customer-9',
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('getQuery', vi.fn().mockReturnValue({ orderId: 'order-1' }))
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))

  mocks.requireServerProfile.mockReturnValue({ profile: 'sandbox', secret: 'test-secret' })
  mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: 'attempt-1' })
  mocks.createQueryExpiry.mockReturnValue('2026-08-10T08:05:00.000Z')
  mocks.createQueryToken.mockReturnValue('q'.repeat(43))
  mocks.getRetainedSubscriptionRecovery.mockResolvedValue(null)
})

describe('payment recovery route', () => {
  it('queries the same retained payment and known contract after Payment audit cleanup', async () => {
    mocks.getPaymentRecovery.mockResolvedValue(null)
    mocks.getRetainedSubscriptionRecovery.mockResolvedValue({
      orderId: 'order-1',
      attemptId: 'attempt-1',
      paymentId: '9000000000000000001',
      customer: {
        environment: 'sandbox',
        merchantNo: 'private-merchant',
        appId: 'private-app',
        merchantCustId: 'Private_Customer-9',
      },
      contract: {
        planId: 'halden-daily-essentials-v1',
        productName: 'Halden Daily Essentials',
        amount: { minor: 500, currency: 'USD' },
        frequencyType: 'D',
        frequencyPoint: 1,
        expireDate: '2099-12-31',
        state: 'active',
        statusSource: 'query',
        contractId: 'contract-private-1',
      },
    })
    mocks.requireServerProfile.mockReturnValue({
      profile: 'sandbox',
      secret: 'test-secret',
      merchantNo: 'private-merchant',
      appId: 'private-app',
    })
    mocks.queryPayment.mockResolvedValue({ status: 'succeeded' })
    mocks.querySubscription.mockResolvedValue({ contractId: 'contract-private-1' })
    mocks.recordSubscriptionQueryDetails.mockResolvedValue({
      planId: 'halden-daily-essentials-v1',
      productName: 'Halden Daily Essentials',
      amount: { minor: 500, currency: 'USD' },
      frequencyType: 'D',
      frequencyPoint: 1,
      expireDate: '2099-12-31',
      state: 'active',
      statusSource: 'query',
    })

    const { default: handler } = await import('../server/api/payment/recover.get')
    const result = await (handler as (event: unknown) => Promise<Record<string, unknown>>)({})

    expect(result).toMatchObject({
      retained: true,
      orderId: 'order-1',
      paymentStatus: 'succeeded',
      subscription: { state: 'active' },
    })
    expect(JSON.stringify(result)).not.toMatch(/9000000000000000001|contract-private-1|Private_Customer/)
    expect(mocks.queryPayment).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'sandbox' }),
      '9000000000000000001',
    )
    expect(mocks.querySubscription).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'sandbox' }),
      'contract-private-1',
    )
  })

  it('does not recover a subscription after a durable create contract rejection', async () => {
    mocks.getPaymentRecovery.mockResolvedValue({
      order: { id: 'order-1', amount: { minor: 500, currency: 'USD' } },
      attempt: {
        id: 'attempt-1',
        orderId: 'order-1',
        status: 'created',
        merchantTxnId: 'showcase-subscription-1',
      },
      attempts: [],
      events: [{
        id: 'event-rejected',
        attemptId: 'attempt-1',
        source: 'server',
        sourceKey: 'subscription-create-contract-rejected:attempt-1',
        status: 'created',
        occurredAt: '2026-08-17T00:00:00.000Z',
      }],
      subscription: { planId: 'halden-daily-essentials-v1' },
    })

    const { default: handler } = await import('../server/api/payment/recover.get')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({
        statusCode: 409,
        statusMessage: 'SUBSCRIPTION_CREATE_CONTRACT_REJECTED',
      })
    expect(mocks.queryPaymentCreation).not.toHaveBeenCalled()
    expect(mocks.completePaymentRecord).not.toHaveBeenCalled()
  })

  it('restores the cookie-bound attempt without a journey or order query', async () => {
    mocks.getPaymentRecovery.mockResolvedValue(recovery())
    vi.stubGlobal('getQuery', vi.fn().mockReturnValue({}))

    const { default: handler } = await import('../server/api/payment/recover.get')
    const result = await (handler as (event: unknown) => Promise<{ order: { id: string } }>)({})

    expect(result.order.id).toBe('order-1')
    expect(mocks.readPaymentRecovery).toHaveBeenCalledWith({}, 'test-secret')
  })

  it.each([
    [undefined, false],
    ['2026-08-10T08:00:00.000Z', true],
  ])('derives submitted only from the durable latch %#', async (startedAt, submitted) => {
    mocks.getPaymentRecovery.mockResolvedValue(recovery(startedAt))

    const { default: handler } = await import('../server/api/payment/recover.get')
    const result = await (handler as (event: unknown) => Promise<{
      submitted: boolean
      attempts: readonly { id: string }[]
    }>)({})

    expect(result.submitted).toBe(submitted)
    expect(result.attempts).toEqual([{
      id: 'attempt-1',
      status: 'processing',
    }])
    expect(result.attempts[0]).not.toHaveProperty('paymentId')
    expect(JSON.stringify(result)).not.toMatch(/Private_Customer|private-merchant|private-app/)
    expect(mocks.createQueryToken).toHaveBeenCalledWith(
      'test-secret',
      'attempt-1',
      '9000000000000000001',
      '2026-08-10T08:05:00.000Z',
    )
  })

  it('restores the direct parent after a retry child create was durably rejected', async () => {
    const parent = {
      id: 'attempt-1',
      orderId: 'order-1',
      integration: 'web-js-sdk',
      method: 'card',
      status: 'succeeded',
      statusSource: 'query',
      paymentId: '9000000000000000001',
    }
    const child = {
      id: 'attempt-2',
      orderId: 'order-1',
      integration: 'web-js-sdk',
      method: 'card',
      status: 'created',
      retryOf: parent.id,
      merchantTxnId: 'showcase-child',
    }
    const order = { id: 'order-1', amount: { minor: 500, currency: 'USD' } }
    const attempts = [parent, child]

    mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: child.id })
    mocks.getPaymentRecovery
      .mockResolvedValueOnce({
        order,
        attempt: child,
        attempts,
        events: [{
          id: 'event-rejected',
          attemptId: child.id,
          source: 'server',
          sourceKey: `retry-create-rejected:${child.id}`,
          status: 'created',
          occurredAt: '2026-08-10T08:00:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ order, attempt: parent, attempts, events: [] })

    const { default: handler } = await import('../server/api/payment/recover.get')
    const event = {}
    const result = await (handler as (event: unknown) => Promise<{
      attempt: { id: string, status: string }
      attempts: readonly { id: string }[]
    }>)(event)

    expect(result.attempt).toMatchObject({ id: parent.id, status: 'succeeded' })
    expect(result.attempts.map(item => item.id)).toEqual([parent.id, child.id])
    expect(mocks.setPaymentRecovery).toHaveBeenCalledWith(
      event,
      'test-secret',
      'order-1',
      parent.id,
    )
    expect(mocks.queryPaymentCreation).not.toHaveBeenCalled()
    expect(mocks.completePaymentRecord).not.toHaveBeenCalled()
    expect(mocks.createQueryToken).toHaveBeenCalledWith(
      'test-secret',
      parent.id,
      parent.paymentId,
      '2026-08-10T08:05:00.000Z',
    )
  })

  it('fails closed when a rejected retry child does not match its parent', async () => {
    const child = {
      id: 'attempt-2',
      orderId: 'order-1',
      integration: 'web-js-sdk',
      method: 'card',
      status: 'created',
      retryOf: 'attempt-1',
      merchantTxnId: 'showcase-child',
    }
    const order = { id: 'order-1', amount: { minor: 500, currency: 'USD' } }
    const events = [{
      id: 'event-rejected',
      attemptId: child.id,
      source: 'server',
      sourceKey: `retry-create-rejected:${child.id}`,
      status: 'created',
      occurredAt: '2026-08-10T08:00:00.000Z',
    }]

    mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: child.id })
    mocks.getPaymentRecovery
      .mockResolvedValueOnce({ order, attempt: child, attempts: [child], events })
      .mockResolvedValueOnce({
        order,
        attempt: {
          id: 'attempt-1',
          orderId: 'order-1',
          integration: 'direct-api',
          method: 'card',
          status: 'succeeded',
          paymentId: '9000000000000000001',
        },
        attempts: [child],
        events: [],
      })

    const { default: handler } = await import('../server/api/payment/recover.get')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 503, statusMessage: 'PAYMENT_ATTEMPT_MISMATCH' })
    expect(mocks.setPaymentRecovery).not.toHaveBeenCalled()
    expect(mocks.queryPaymentCreation).not.toHaveBeenCalled()
  })
})
