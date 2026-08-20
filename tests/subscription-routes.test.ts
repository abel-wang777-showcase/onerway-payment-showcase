import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSubscriptionPaymentRecord: vi.fn(),
  ensurePaymentCustomer: vi.fn(),
  enrichDirectPaymentMethod: vi.fn(),
  getPaymentRecovery: vi.fn(),
  getRetainedSubscriptionRecovery: vi.fn(),
  getSubscriptionForAttempt: vi.fn(),
  queryPayment: vi.fn(),
  querySubscription: vi.fn(),
  readPaymentRecovery: vi.fn(),
  recordQueryEvent: vi.fn(),
  recordSubscriptionQueryDetails: vi.fn(),
  requireCanonicalPaymentOrigin: vi.fn(),
  requireServerProfile: vi.fn(),
  setPaymentRecovery: vi.fn(),
  verifyQueryToken: vi.fn(),
}))

vi.mock('../server/utils/gateway', () => ({
  GatewayError: class GatewayError extends Error {},
  queryPayment: mocks.queryPayment,
  querySubscription: mocks.querySubscription,
  verifyQueryToken: mocks.verifyQueryToken,
}))

vi.mock('../server/utils/limit', () => ({
  requireCanonicalPaymentOrigin: mocks.requireCanonicalPaymentOrigin,
  withPaymentLimit: (_event: unknown, _kind: string, task: () => Promise<unknown>) => task(),
}))

vi.mock('../server/utils/method', () => ({
  enrichDirectPaymentMethod: mocks.enrichDirectPaymentMethod,
}))

vi.mock('../server/utils/profile', () => ({
  requireServerProfile: mocks.requireServerProfile,
}))

vi.mock('../server/utils/recovery', () => ({
  readPaymentRecovery: mocks.readPaymentRecovery,
  setPaymentRecovery: mocks.setPaymentRecovery,
}))

vi.mock('../server/utils/store', () => ({
  createSubscriptionPaymentRecord: mocks.createSubscriptionPaymentRecord,
  ensurePaymentCustomer: mocks.ensurePaymentCustomer,
  getPaymentRecovery: mocks.getPaymentRecovery,
  getRetainedSubscriptionRecovery: mocks.getRetainedSubscriptionRecovery,
  getSubscriptionForAttempt: mocks.getSubscriptionForAttempt,
  PaymentStoreError: class PaymentStoreError extends Error {
    readonly code: string

    constructor(code: string) {
      super(code)
      this.code = code
    }
  },
  recordQueryEvent: mocks.recordQueryEvent,
  recordSubscriptionQueryDetails: mocks.recordSubscriptionQueryDetails,
}))

const profile = {
  profile: 'sandbox',
  environment: 'Sandbox',
  secret: 'test-secret',
  showcaseOrigin: 'https://showcase.example',
  merchantNo: 'test-merchant',
  appId: 'test-app',
}

const subscription = {
  id: 'subscription-private-1',
  planId: 'halden-daily-essentials-v1',
  planVersion: 1,
  productName: 'Halden Daily Essentials',
  amount: { minor: 500, currency: 'USD' },
  frequencyType: 'D',
  frequencyPoint: 1,
  expireDate: '2099-12-31',
  initialOrderId: 'order-1',
  initialAttemptId: 'attempt-1',
  state: 'pending',
  statusSource: 'placeholder',
  dataStatus: '0',
  subscriptionStatus: 'paymentdue',
  contractId: 'contract-private-1',
  tokenId: 'token-private-1',
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))

  mocks.requireServerProfile.mockReturnValue(profile)
  mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: 'attempt-1' })
  mocks.verifyQueryToken.mockReturnValue(true)
  mocks.enrichDirectPaymentMethod.mockImplementation(async (_profile, attempt) => attempt)
  mocks.getRetainedSubscriptionRecovery.mockResolvedValue(null)
})

describe('subscription intent route', () => {
  it('reuses the retained customer and blocks the same active plan after Payment cleanup', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      planId: 'halden-daily-essentials-v1',
    }))
    mocks.getPaymentRecovery.mockResolvedValue(null)
    mocks.getRetainedSubscriptionRecovery.mockResolvedValue({
      orderId: 'order-1',
      attemptId: 'attempt-1',
      paymentId: 'payment-1',
      customer: {
        environment: 'sandbox',
        merchantNo: 'test-merchant',
        appId: 'test-app',
        merchantCustId: 'Customer_1',
      },
      contract: { ...subscription, state: 'active' },
    })

    const { default: handler } = await import('../server/api/payment/subscription/intent.post')
    const event = {}
    const result = await (handler as (event: unknown) => Promise<unknown>)(event)

    expect(result).toEqual({ orderId: 'order-1', create: false, existing: true })
    expect(mocks.createSubscriptionPaymentRecord).not.toHaveBeenCalled()
    expect(mocks.ensurePaymentCustomer).not.toHaveBeenCalled()
    expect(mocks.setPaymentRecovery).toHaveBeenCalledWith(
      event,
      'test-secret',
      'order-1',
      'attempt-1',
    )
  })

  it('reuses the same non-terminal customer-plan subscription before any Provider create', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      planId: 'halden-daily-essentials-v1',
    }))
    mocks.getPaymentRecovery.mockResolvedValue({
      order: { id: 'order-1' },
      attempt: { id: 'attempt-1' },
      customer: {
        environment: 'sandbox',
        merchantNo: 'test-merchant',
        appId: 'test-app',
        merchantCustId: 'Customer_1',
      },
      subscription,
    })

    const { default: handler } = await import('../server/api/payment/subscription/intent.post')
    const result = await (handler as (event: unknown) => Promise<unknown>)({})

    expect(result).toEqual({ orderId: 'order-1', create: false, existing: true })
    expect(mocks.createSubscriptionPaymentRecord).not.toHaveBeenCalled()
    expect(mocks.setPaymentRecovery).not.toHaveBeenCalled()
  })

  it('creates an independent Sandbox customer only after recovering the existing plan', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      planId: 'halden-daily-essentials-v1',
      newTestCustomer: true,
    }))
    const currentCustomer = {
      environment: 'sandbox',
      merchantNo: 'test-merchant',
      appId: 'test-app',
      merchantCustId: 'Customer_1',
    }
    mocks.getPaymentRecovery.mockResolvedValue({
      order: { id: 'order-1' },
      attempt: { id: 'attempt-1', paymentId: 'payment-1' },
      customer: currentCustomer,
      subscription: { ...subscription, state: 'active' },
    })
    mocks.createSubscriptionPaymentRecord.mockResolvedValue({
      created: true,
      contract: subscription,
    })

    const { default: handler } = await import('../server/api/payment/subscription/intent.post')
    const event = {}
    const result = await (handler as (event: unknown) => Promise<{
      orderId: string
      create: boolean
      existing: boolean
    }>)(event)
    const nextCustomer = mocks.createSubscriptionPaymentRecord.mock.calls[0]?.[2] as {
      merchantCustId: string
    }

    expect(result).toMatchObject({ create: true, existing: false })
    expect(nextCustomer).toMatchObject({
      environment: 'sandbox',
      merchantNo: 'test-merchant',
      appId: 'test-app',
    })
    expect(nextCustomer.merchantCustId).toMatch(/^cust_[a-f0-9]{32}$/)
    expect(nextCustomer.merchantCustId).not.toBe(currentCustomer.merchantCustId)
    expect(mocks.ensurePaymentCustomer).not.toHaveBeenCalled()
    expect(mocks.setPaymentRecovery).toHaveBeenCalledWith(
      event,
      'test-secret',
      result.orderId,
      `${result.orderId}-attempt-1`,
    )
  })

  it('rejects a new test customer without a recovered non-terminal subscription', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      planId: 'halden-daily-essentials-v1',
      newTestCustomer: true,
    }))
    mocks.getPaymentRecovery.mockResolvedValue(null)
    mocks.readPaymentRecovery.mockReturnValue(null)

    const { default: handler } = await import('../server/api/payment/subscription/intent.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'PAYMENT_SUBSCRIPTION_TEST_CUSTOMER_UNAVAILABLE',
    })
    expect(mocks.createSubscriptionPaymentRecord).not.toHaveBeenCalled()
  })

  it('rejects replay from a local placeholder without Provider payment evidence', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      planId: 'halden-daily-essentials-v1',
      newTestCustomer: true,
    }))
    mocks.getPaymentRecovery.mockResolvedValue({
      order: { id: 'order-1' },
      attempt: { id: 'attempt-1' },
      customer: {
        environment: 'sandbox',
        merchantNo: 'test-merchant',
        appId: 'test-app',
        merchantCustId: 'Customer_1',
      },
      subscription: {
        ...subscription,
        contractId: undefined,
        tokenId: undefined,
      },
    })

    const { default: handler } = await import('../server/api/payment/subscription/intent.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'PAYMENT_SUBSCRIPTION_TEST_CUSTOMER_UNAVAILABLE',
    })
    expect(mocks.createSubscriptionPaymentRecord).not.toHaveBeenCalled()
  })
})

describe('subscription query route', () => {
  it('returns server-enriched actual method metadata separately from Payment status truth', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      attemptId: 'attempt-1',
      paymentId: 'payment-1',
      token: 'q'.repeat(43),
      expiresAt: '2026-08-17T00:05:00.000Z',
    }))
    const queried = {
      paymentId: 'payment-1',
      transactionId: '9000000000000000002',
      rawStatus: 'S',
      status: 'succeeded',
    }
    const recordedAttempt = {
      id: 'attempt-1',
      orderId: 'order-1',
      paymentId: 'payment-1',
      transactionId: queried.transactionId,
      method: 'google-pay',
      status: 'succeeded',
    }
    mocks.queryPayment.mockResolvedValue(queried)
    mocks.recordQueryEvent.mockResolvedValue({
      attempt: recordedAttempt,
      event: { id: 'event-1', attemptId: 'attempt-1', source: 'query', status: 'succeeded' },
    })
    mocks.enrichDirectPaymentMethod.mockResolvedValue({
      ...recordedAttempt,
      actualWallet: 'google-pay',
      fundingNetwork: 'VISA',
    })
    mocks.getSubscriptionForAttempt.mockResolvedValue(null)

    const { default: handler } = await import('../server/api/payment/query.post')
    const result = await (handler as (event: unknown) => Promise<{
      attempt: Record<string, unknown>
    }>)({})

    expect(mocks.recordQueryEvent).toHaveBeenCalledBefore(mocks.enrichDirectPaymentMethod)
    expect(result.attempt).toMatchObject({
      method: 'google-pay',
      actualWallet: 'google-pay',
      fundingNetwork: 'VISA',
    })
  })

  it('returns a non-terminal direct query without waiting for method enrichment', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      attemptId: 'attempt-1',
      paymentId: 'payment-1',
      token: 'q'.repeat(43),
      expiresAt: '2026-08-17T00:05:00.000Z',
    }))
    const queried = {
      paymentId: 'payment-1',
      transactionId: '9000000000000000002',
      rawStatus: 'O',
      status: 'processing',
    }
    const recordedAttempt = {
      id: 'attempt-1',
      orderId: 'order-1',
      paymentId: 'payment-1',
      transactionId: queried.transactionId,
      method: 'google-pay',
      status: 'processing',
    }
    mocks.queryPayment.mockResolvedValue(queried)
    mocks.recordQueryEvent.mockResolvedValue({
      attempt: recordedAttempt,
      event: { id: 'event-1', attemptId: 'attempt-1', source: 'query', status: 'processing' },
    })
    mocks.getSubscriptionForAttempt.mockResolvedValue(null)

    const { default: handler } = await import('../server/api/payment/query.post')
    const result = await (handler as (event: unknown) => Promise<{ attempt: Record<string, unknown> }>)({})

    expect(result.attempt).toBe(recordedAttempt)
    expect(mocks.enrichDirectPaymentMethod).not.toHaveBeenCalled()
  })

  it('does not use a create transaction when a terminal query omits lastTransactionId', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      attemptId: 'attempt-1',
      paymentId: 'payment-1',
      token: 'q'.repeat(43),
      expiresAt: '2026-08-17T00:05:00.000Z',
    }))
    mocks.queryPayment.mockResolvedValue({
      paymentId: 'payment-1',
      rawStatus: 'S',
      status: 'succeeded',
    })
    const recordedAttempt = {
      id: 'attempt-1',
      orderId: 'order-1',
      paymentId: 'payment-1',
      transactionId: '9000000000000000001',
      method: 'google-pay',
      status: 'succeeded',
    }
    mocks.recordQueryEvent.mockResolvedValue({
      attempt: recordedAttempt,
      event: { id: 'event-1', attemptId: 'attempt-1', source: 'query', status: 'succeeded' },
    })
    mocks.getSubscriptionForAttempt.mockResolvedValue(null)

    const { default: handler } = await import('../server/api/payment/query.post')
    const result = await (handler as (event: unknown) => Promise<{ attempt: Record<string, unknown> }>)({})

    expect(result.attempt).toBe(recordedAttempt)
    expect(mocks.enrichDirectPaymentMethod).not.toHaveBeenCalled()
  })

  it('returns a public summary while keeping contractId and tokenId server-only', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      attemptId: 'attempt-1',
      paymentId: 'payment-1',
      token: 'q'.repeat(43),
      expiresAt: '2026-08-17T00:05:00.000Z',
    }))
    mocks.queryPayment.mockResolvedValue({ paymentId: 'payment-1', status: 'succeeded' })
    mocks.recordQueryEvent.mockResolvedValue({
      attempt: { id: 'attempt-1', orderId: 'order-1', status: 'succeeded' },
      event: { id: 'event-1', attemptId: 'attempt-1', source: 'query', status: 'succeeded' },
    })
    mocks.getSubscriptionForAttempt.mockResolvedValue(subscription)
    mocks.querySubscription.mockResolvedValue({ ...subscription, state: 'active' })
    mocks.recordSubscriptionQueryDetails.mockResolvedValue({
      ...subscription,
      state: 'active',
      statusSource: 'query',
    })

    const { default: handler } = await import('../server/api/payment/query.post')
    const result = await (handler as (event: unknown) => Promise<Record<string, unknown>>)({})
    const serialized = JSON.stringify(result)

    expect(mocks.enrichDirectPaymentMethod).not.toHaveBeenCalled()
    expect(result.subscription).toMatchObject({
      planId: 'halden-daily-essentials-v1',
      state: 'active',
      statusSource: 'query',
    })
    expect(serialized).not.toContain('contract-private-1')
    expect(serialized).not.toContain('token-private-1')
  })

  it('keeps the local paymentdue placeholder without querying an unknown contract', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      attemptId: 'attempt-1',
      paymentId: 'payment-1',
      token: 'q'.repeat(43),
      expiresAt: '2026-08-17T00:05:00.000Z',
    }))
    mocks.queryPayment.mockResolvedValue({ paymentId: 'payment-1', status: 'processing' })
    mocks.recordQueryEvent.mockResolvedValue({
      attempt: { id: 'attempt-1', orderId: 'order-1', status: 'processing' },
      event: { id: 'event-1', attemptId: 'attempt-1', source: 'query', status: 'processing' },
    })
    mocks.getSubscriptionForAttempt.mockResolvedValue({
      ...subscription,
      contractId: undefined,
      tokenId: undefined,
    })

    const { default: handler } = await import('../server/api/payment/query.post')
    const result = await (handler as (event: unknown) => Promise<{
      subscription: { state: string, statusSource: string }
    }>)({})

    expect(mocks.enrichDirectPaymentMethod).not.toHaveBeenCalled()
    expect(result.subscription).toMatchObject({ state: 'pending', statusSource: 'placeholder' })
    expect(mocks.querySubscription).not.toHaveBeenCalled()
    expect(mocks.recordSubscriptionQueryDetails).not.toHaveBeenCalled()
  })
})

describe('subscription return route', () => {
  it('queries retained payment and contract after the Payment record expires', async () => {
    mocks.getPaymentRecovery.mockResolvedValue(null)
    mocks.getRetainedSubscriptionRecovery.mockResolvedValue({
      orderId: 'order-1',
      attemptId: 'attempt-1',
      paymentId: 'payment-1',
      customer: {
        environment: 'sandbox',
        merchantNo: 'test-merchant',
        appId: 'test-app',
        merchantCustId: 'Customer_1',
      },
      contract: subscription,
    })
    mocks.queryPayment.mockResolvedValue({ paymentId: 'payment-1', status: 'succeeded' })
    mocks.querySubscription.mockResolvedValue({ contractId: 'contract-private-1' })
    mocks.recordSubscriptionQueryDetails.mockResolvedValue(subscription)

    const { default: handler } = await import('../server/api/payment/subscription/return.post')
    const result = await (handler as (event: unknown) => Promise<unknown>)({})

    expect(result).toEqual({ duplicate: false })
    expect(mocks.queryPayment).toHaveBeenCalledWith(profile, 'payment-1')
    expect(mocks.querySubscription).toHaveBeenCalledWith(profile, 'contract-private-1')
    expect(mocks.recordQueryEvent).not.toHaveBeenCalled()
    expect(mocks.enrichDirectPaymentMethod).not.toHaveBeenCalled()
  })
})
