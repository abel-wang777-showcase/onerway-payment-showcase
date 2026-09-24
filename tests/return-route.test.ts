import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enrichDirectPaymentMethod: vi.fn(),
  queryCheckoutPayment: vi.fn(),
  getPaymentRecovery: vi.fn(),
  getSubscriptionForAttempt: vi.fn(),
  queryPayment: vi.fn(),
  querySubscription: vi.fn(),
  readPaymentRecovery: vi.fn(),
  recordQueryEvent: vi.fn(),
  recordReturnEvent: vi.fn(),
  recordSubscriptionQueryDetails: vi.fn(),
  requireServerProfile: vi.fn(),
}))

vi.mock('../server/utils/method', () => ({
  enrichDirectPaymentMethod: mocks.enrichDirectPaymentMethod,
}))

vi.mock('../server/utils/gateway', () => ({
  queryCheckoutPayment: mocks.queryCheckoutPayment,
  GatewayError: class GatewayError extends Error {},
  queryPayment: mocks.queryPayment,
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
}))

vi.mock('../server/utils/store', () => ({
  subscriptionCreationRejectionKey: (attemptId: string) => `subscription-create-contract-rejected:${attemptId}`,
  subscriptionCreationRecoveryAllowedKey: (attemptId: string) => `subscription-create-recovery-allowed:${attemptId}`,
  PaymentStoreError: class PaymentStoreError extends Error {},
  getPaymentRecovery: mocks.getPaymentRecovery,
  getSubscriptionForAttempt: mocks.getSubscriptionForAttempt,
  recordQueryEvent: mocks.recordQueryEvent,
  recordReturnEvent: mocks.recordReturnEvent,
  recordSubscriptionQueryDetails: mocks.recordSubscriptionQueryDetails,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ orderId: 'order-1' }))
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))

  mocks.requireServerProfile.mockReturnValue({
    profile: 'sandbox',
    secret: 'test-secret',
  })
  mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: 'attempt-1' })
  mocks.getPaymentRecovery.mockResolvedValue({
    order: { id: 'order-1' },
    attempt: {
      id: 'attempt-1',
      orderId: 'order-1',
      paymentId: '9000000000000000001',
      status: 'succeeded',
      statusSource: 'webhook',
    },
    events: [],
  })
  mocks.recordReturnEvent.mockResolvedValue({ duplicate: false })
  mocks.enrichDirectPaymentMethod.mockImplementation(async (_profile, attempt) => attempt)
  mocks.getSubscriptionForAttempt.mockResolvedValue(null)
  mocks.queryPayment.mockResolvedValue({
    paymentId: '9000000000000000001',
    transactionId: '9000000000000000002',
    rawStatus: 'N',
    status: 'cancelled',
  })
  mocks.recordQueryEvent.mockResolvedValue({
    attempt: {
      id: 'attempt-1',
      orderId: 'order-1',
      paymentId: '9000000000000000001',
      transactionId: '9000000000000000002',
      fundingNetwork: 'VISA',
      attributionTransactionId: '9000000000000000002',
      status: 'cancelled',
    },
    event: { id: 'query-event-1' },
  })
})

describe('payment return route', () => {
  it('does not dispatch Direct Apple Pay through the legacy Payment query', async () => {
    mocks.getPaymentRecovery.mockResolvedValue({ order: { id: 'order-1' }, attempt: { id: 'attempt-1', integration: 'direct-api', paymentId: '9001' } })
    const { default: handler } = await import('../server/api/payment/return.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusCode: 409, statusMessage: 'APPLE_PAY_USE_ORDER_RECOVERY' })
    expect(mocks.queryPayment).not.toHaveBeenCalled()
    expect(mocks.recordQueryEvent).not.toHaveBeenCalled()
  })

  it('records AUTH return as navigation only, without querying or treating it as authorization', async () => {
    mocks.requireServerProfile.mockReturnValue({ profile: 'sandbox', secret: 'test-secret', merchantNo: 'merchant-1', appId: 'app-1' })
    mocks.getPaymentRecovery.mockResolvedValue({
      order: { id: 'order-1' },
      attempt: { id: 'attempt-1', orderId: 'order-1', integration: 'checkout', authorization: { fundsStatus: 'pending' } },
      customer: { environment: 'sandbox', merchantNo: 'merchant-1', appId: 'app-1', merchantCustId: 'cust_1' },
      events: [],
    })
    const { default: handler } = await import('../server/api/payment/return.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({})).resolves.toEqual({ duplicate: false })
    expect(mocks.recordReturnEvent).toHaveBeenCalledWith('attempt-1', expect.any(String))
    expect(mocks.queryCheckoutPayment).not.toHaveBeenCalled()
    expect(mocks.queryPayment).not.toHaveBeenCalled()
    expect(mocks.recordQueryEvent).not.toHaveBeenCalled()
  })

  it('always performs a fresh query after an idempotent return, even after a Webhook terminal projection', async () => {
    const { default: handler } = await import('../server/api/payment/return.post')
    const result = await (handler as (event: unknown) => Promise<unknown>)({})

    expect(result).toEqual({ duplicate: false })
    expect(mocks.recordReturnEvent).toHaveBeenCalledWith('attempt-1', expect.any(String))
    expect(mocks.queryPayment).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'sandbox' }),
      '9000000000000000001',
    )
    expect(mocks.recordQueryEvent).toHaveBeenCalledWith(
      'attempt-1',
      '9000000000000000001',
      expect.objectContaining({ status: 'cancelled' }),
      expect.any(String),
    )
    expect(mocks.recordReturnEvent.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.queryPayment.mock.invocationCallOrder[0]!)
    expect(mocks.queryPayment.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.recordQueryEvent.mock.invocationCallOrder[0]!)
    expect(mocks.enrichDirectPaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'sandbox' }),
      expect.objectContaining({
        id: 'attempt-1',
        transactionId: '9000000000000000002',
      }),
      '9000000000000000002',
      expect.any(String),
    )
  })

  it('does not use the stored create transaction when fresh query omits lastTransactionId', async () => {
    mocks.queryPayment.mockResolvedValue({
      paymentId: '9000000000000000001',
      rawStatus: 'S',
      status: 'succeeded',
    })
    mocks.recordQueryEvent.mockResolvedValue({
      attempt: {
        id: 'attempt-1',
        orderId: 'order-1',
        paymentId: '9000000000000000001',
        transactionId: '9000000000000000001',
        status: 'succeeded',
      },
      event: { id: 'query-event-1' },
    })

    const { default: handler } = await import('../server/api/payment/return.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .resolves.toEqual({ duplicate: false })
    expect(mocks.enrichDirectPaymentMethod).not.toHaveBeenCalled()
  })

  it('does not enrich DIRECT method attribution for a subscription return', async () => {
    mocks.getSubscriptionForAttempt.mockResolvedValue({})

    const { default: handler } = await import('../server/api/payment/return.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .resolves.toEqual({ duplicate: false })

    expect(mocks.enrichDirectPaymentMethod).not.toHaveBeenCalled()
  })
})

it('freshly queries Checkout through its merchant transaction even after cancellation omitted Payment ID', async () => {
  mocks.getPaymentRecovery.mockResolvedValue({
    order: { id: 'order-1', amount: { minor: 500, currency: 'USD' } },
    attempt: { id: 'attempt-1', orderId: 'order-1', integration: 'checkout', merchantTxnId: 'merchant-txn-1', transactionId: '222', status: 'cancelled' },
    events: [],
  })
  mocks.queryCheckoutPayment.mockResolvedValue({ merchantTxnId: 'merchant-txn-1', transactionId: '222', rawStatus: 'N', transactionStatus: 'N', status: 'cancelled' })
  const { default: handler } = await import('../server/api/payment/return.post')
  await (handler as (event: unknown) => Promise<unknown>)({})
  expect(mocks.queryCheckoutPayment).toHaveBeenCalledWith(expect.anything(), {
    merchantTxnId: 'merchant-txn-1', transactionId: '222', paymentId: undefined, amountMinor: 500, currency: 'USD',
  })
  expect(mocks.queryPayment).not.toHaveBeenCalled()
  expect(mocks.enrichDirectPaymentMethod).not.toHaveBeenCalled()
  expect(mocks.recordQueryEvent).toHaveBeenCalledWith('attempt-1', undefined, expect.objectContaining({ status: 'cancelled' }), expect.any(String))
})
