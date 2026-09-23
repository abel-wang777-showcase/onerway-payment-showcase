import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSubscriptionPaymentRecord: vi.fn(),
  ensurePaymentCustomer: vi.fn(),
  enrichDirectPaymentMethod: vi.fn(),
  getPaymentRecovery: vi.fn(),
  getPaymentQueryContext: vi.fn(),
  getRetainedSubscriptionRecovery: vi.fn(),
  getSubscriptionForAttempt: vi.fn(),
  queryPayment: vi.fn(),
  queryCheckoutPayment: vi.fn(),
  recordReturnEvent: vi.fn(),
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
  queryCheckoutPayment: mocks.queryCheckoutPayment,
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
  subscriptionCreationRejectionKey: (attemptId: string) => `subscription-create-contract-rejected:${attemptId}`,
  subscriptionCreationRecoveryAllowedKey: (attemptId: string) => `subscription-create-recovery-allowed:${attemptId}`,
  createSubscriptionPaymentRecord: mocks.createSubscriptionPaymentRecord,
  ensurePaymentCustomer: mocks.ensurePaymentCustomer,
  getPaymentRecovery: mocks.getPaymentRecovery,
  getPaymentQueryContext: mocks.getPaymentQueryContext,
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
  recordReturnEvent: mocks.recordReturnEvent,
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
  initialIntegration: 'web-js-sdk',
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
  mocks.getPaymentRecovery.mockResolvedValue({
    order: { id: 'order-1', amount: { minor: 500, currency: 'USD' } },
    attempt: { id: 'attempt-1', orderId: 'order-1', integration: 'web-js-sdk', paymentId: 'payment-1' },
    events: [], subscription,
  })
  mocks.getPaymentQueryContext.mockResolvedValue({
    order: { id: 'order-1', amount: { minor: 500, currency: 'USD' } },
    attempt: { id: 'attempt-1', orderId: 'order-1', integration: 'web-js-sdk', paymentId: 'payment-1' },
  })
  mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: 'attempt-1' })
  mocks.verifyQueryToken.mockReturnValue(true)
  mocks.enrichDirectPaymentMethod.mockImplementation(async (_profile, attempt) => attempt)
  mocks.getRetainedSubscriptionRecovery.mockResolvedValue(null)
})

describe('subscription intent route', () => {
  it.each(['web-js-sdk', 'checkout'])('preserves the unknown Direct recovery cookie before a new %s subscription', async (integration) => {
    mocks.getPaymentRecovery.mockResolvedValue({
      order: { id: 'order-direct' },
      attempt: { id: 'attempt-direct', integration: 'direct-api', method: 'apple-pay', status: 'processing', transactionId: '12345' },
    })
    mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-direct', attemptId: 'attempt-direct' })
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ planId: 'halden-daily-essentials-v1', integration }))
    const { default: handler } = await import('../server/api/payment/subscription/intent.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusCode: 409, statusMessage: 'APPLE_PAY_RECOVERY_REQUIRED' })
    expect(mocks.createSubscriptionPaymentRecord).not.toHaveBeenCalled()
    expect(mocks.setPaymentRecovery).not.toHaveBeenCalled()
  })

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

    expect(result).toEqual({ orderId: 'order-1', integration: 'web-js-sdk', create: false, existing: true })
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
      attempt: { id: 'attempt-1', integration: 'web-js-sdk' },
      events: [],
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

    expect(result).toEqual({ orderId: 'order-1', integration: 'web-js-sdk', create: false, existing: true })
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
      attempt: { id: 'attempt-1', integration: 'web-js-sdk' },
      events: [],
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

it.each(['web-js-sdk', 'checkout'] as const)('persists a new %s subscription intent with the common customer-plan contract', async (integration) => {
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ planId: subscription.planId, integration }))
  mocks.readPaymentRecovery.mockReturnValue(null)
  mocks.createSubscriptionPaymentRecord.mockResolvedValue({ created: true })
  const { default: handler } = await import('../server/api/payment/subscription/intent.post')
  const result = await (handler as (event: unknown) => Promise<Record<string, unknown>>)({})
  expect(result).toMatchObject({ integration, create: true, existing: false })
  const [, attempt, customer, contract] = mocks.createSubscriptionPaymentRecord.mock.calls[0]!
  expect(attempt).toMatchObject({ integration, method: integration === 'checkout' ? 'all' : 'card' })
  expect(contract).toMatchObject({ initialIntegration: integration, state: 'pending', planId: subscription.planId })
  expect(customer.merchantCustId).toMatch(/^cust_/)
})

it('resumes the original unclaimed SDK placeholder when Checkout is selected for the same customer-plan', async () => {
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ planId: subscription.planId, integration: 'checkout' }))
  mocks.getPaymentRecovery.mockResolvedValue({
    order: { id: 'order-1' }, attempt: { id: 'attempt-1', integration: 'web-js-sdk' }, events: [],
    customer: { environment: 'sandbox', merchantNo: profile.merchantNo, appId: profile.appId, merchantCustId: 'Customer_1' },
    subscription: { ...subscription, contractId: undefined, tokenId: undefined },
  })
  const { default: handler } = await import('../server/api/payment/subscription/intent.post')
  expect(await (handler as (event: unknown) => Promise<unknown>)({})).toEqual({
    orderId: 'order-1', integration: 'web-js-sdk', create: true, existing: true,
  })
  expect(mocks.createSubscriptionPaymentRecord).not.toHaveBeenCalled()
})

it('keeps a claimed Checkout placeholder query-only after selecting SDK', async () => {
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ planId: subscription.planId }))
  mocks.getPaymentRecovery.mockResolvedValue({
    order: { id: 'order-1' }, attempt: { id: 'attempt-1', integration: 'checkout' },
    events: [{ source: 'server', sourceKey: 'create-claim:attempt-1' }],
    customer: { environment: 'sandbox', merchantNo: profile.merchantNo, appId: profile.appId, merchantCustId: 'Customer_1' },
    subscription: { ...subscription, initialIntegration: 'checkout', contractId: undefined, tokenId: undefined },
  })
  const { default: handler } = await import('../server/api/payment/subscription/intent.post')
  expect(await (handler as (event: unknown) => Promise<unknown>)({})).toEqual({
    orderId: 'order-1', integration: 'checkout', create: false, existing: true,
  })
})

it('rejects a client-selected unsupported subscription integration', async () => {
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ planId: subscription.planId, integration: 'direct-api' }))
  const { default: handler } = await import('../server/api/payment/subscription/intent.post')
  await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusMessage: 'PAYMENT_INPUT_INVALID' })
  expect(mocks.createSubscriptionPaymentRecord).not.toHaveBeenCalled()
})

it('queries a retained Checkout subscription by its merchant transaction and discovers the contract', async () => {
  const contract = { ...subscription, initialIntegration: 'checkout', contractId: undefined, tokenId: undefined }
  mocks.getPaymentRecovery.mockResolvedValue(null)
  mocks.getRetainedSubscriptionRecovery.mockResolvedValue({
    orderId: 'order-1', attemptId: 'attempt-1', merchantTxnId: 'txn-private', paymentId: 'payment-1', contract,
    customer: { environment: 'sandbox', merchantNo: profile.merchantNo, appId: profile.appId, merchantCustId: 'Customer_1' },
  })
  mocks.queryCheckoutPayment.mockResolvedValue({ status: 'succeeded', subscription: { contractId: 'discovered-contract', tokenId: 'discovered-token' } })
  mocks.querySubscription.mockResolvedValue({ contractId: 'discovered-contract', tokenId: 'discovered-token', state: 'active' })
  mocks.recordSubscriptionQueryDetails.mockResolvedValue({ ...contract, state: 'active' })
  const { default: handler } = await import('../server/api/payment/subscription/return.post')
  expect(await (handler as (event: unknown) => Promise<unknown>)({})).toEqual({ duplicate: false })
  expect(mocks.queryCheckoutPayment).toHaveBeenCalledWith(profile, {
    subscription: true, merchantTxnId: 'txn-private', amountMinor: 500, currency: 'USD', paymentId: 'payment-1',
  })
  expect(mocks.queryPayment).not.toHaveBeenCalled()
  expect(mocks.recordSubscriptionQueryDetails).toHaveBeenCalledWith('attempt-1', expect.objectContaining({ contractId: 'discovered-contract' }), expect.any(String))
})

describe.each([
  ['subscription return', '../server/api/payment/subscription/return.post'],
  ['ordinary return', '../server/api/payment/return.post'],
])('%s subscription creation recovery gate', (_name, modulePath) => {
  function unrecovered(events: { source: string, sourceKey: string }[]) {
    return {
      order: { id: 'order-1', amount: { minor: 500, currency: 'USD' } },
      attempt: { id: 'attempt-1', orderId: 'order-1', integration: 'checkout', merchantTxnId: 'merchant-txn-1', status: 'created' },
      events,
      subscription: { ...subscription, initialIntegration: 'checkout', contractId: undefined, tokenId: undefined },
    }
  }

  it.each([
    [[], 'SUBSCRIPTION_CREATE_RECOVERY_NOT_ALLOWED'],
    [[{ source: 'server', sourceKey: 'create-claim:attempt-1' }], 'SUBSCRIPTION_CREATE_RECOVERY_NOT_ALLOWED'],
    [[{ source: 'server', sourceKey: 'subscription-create-contract-rejected:attempt-1' }], 'SUBSCRIPTION_CREATE_CONTRACT_REJECTED'],
    [[
      { source: 'server', sourceKey: 'subscription-create-recovery-allowed:attempt-1' },
      { source: 'server', sourceKey: 'subscription-create-contract-rejected:attempt-1' },
    ], 'SUBSCRIPTION_CREATE_CONTRACT_REJECTED'],
  ] as const)('rejects discovery before any query or return event: %j', async (events, error) => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ orderId: 'order-1' }))
    mocks.getPaymentRecovery.mockResolvedValue(unrecovered([...events]))
    const { default: handler } = await import(modulePath!)
    await expect(handler({})).rejects.toMatchObject({ statusCode: 409, statusMessage: error })
    expect(mocks.queryCheckoutPayment).not.toHaveBeenCalled()
    expect(mocks.queryPayment).not.toHaveBeenCalled()
    expect(mocks.recordQueryEvent).not.toHaveBeenCalled()
    expect(mocks.recordReturnEvent).not.toHaveBeenCalled()
  })

  it('keeps explicit rejection above an early Webhook Payment ID', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ orderId: 'order-1' }))
    const recovery = unrecovered([{ source: 'server', sourceKey: 'subscription-create-contract-rejected:attempt-1' }])
    mocks.getPaymentRecovery.mockResolvedValue({ ...recovery, attempt: { ...recovery.attempt, paymentId: '1000' } })
    const { default: handler } = await import(modulePath!)
    await expect(handler({})).rejects.toMatchObject({ statusCode: 409, statusMessage: 'SUBSCRIPTION_CREATE_CONTRACT_REJECTED' })
    expect(mocks.queryCheckoutPayment).not.toHaveBeenCalled()
    expect(mocks.recordReturnEvent).not.toHaveBeenCalled()
    expect(mocks.recordQueryEvent).not.toHaveBeenCalled()
  })

  it('permits same-transaction discovery only after durable network-unknown recovery authorization', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ orderId: 'order-1' }))
    const recovery = unrecovered([{ source: 'server', sourceKey: 'subscription-create-recovery-allowed:attempt-1' }])
    mocks.getPaymentRecovery.mockResolvedValue(recovery)
    mocks.getSubscriptionForAttempt.mockResolvedValue(recovery.subscription)
    mocks.recordReturnEvent.mockResolvedValue({ duplicate: false })
    const payment = { merchantTxnId: 'merchant-txn-1', paymentId: '1000', transactionId: '1001', rawStatus: 'U', transactionStatus: 'U', status: 'processing' }
    mocks.queryCheckoutPayment.mockResolvedValue(payment)
    mocks.recordQueryEvent.mockResolvedValue({ attempt: { ...recovery.attempt, paymentId: '1000' } })
    const { default: handler } = await import(modulePath!)
    expect(await handler({})).toEqual({ duplicate: false })
    expect(mocks.queryCheckoutPayment).toHaveBeenCalledWith(profile, expect.objectContaining({ merchantTxnId: 'merchant-txn-1', subscription: true }))
    expect(mocks.recordQueryEvent).toHaveBeenCalledWith('attempt-1', undefined, payment, expect.any(String))
    expect(mocks.queryPayment).not.toHaveBeenCalled()
  })
})

it('rejects a previously issued query capability after an explicit subscription create rejection', async () => {
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ attemptId: 'attempt-1', paymentId: 'payment-1', token: 'q'.repeat(43), expiresAt: '2026-09-17T00:05:00.000Z' }))
  mocks.getSubscriptionForAttempt.mockResolvedValue({ ...subscription, initialIntegration: 'checkout' })
  mocks.getPaymentQueryContext.mockResolvedValue({
    order: { id: 'order-1', amount: { minor: 500, currency: 'USD' } },
    attempt: { id: 'attempt-1', orderId: 'order-1', integration: 'checkout', paymentId: 'payment-1', merchantTxnId: 'merchant-txn-1' },
  })
  mocks.getPaymentRecovery.mockResolvedValue({
    order: { id: 'order-1' }, attempt: { id: 'attempt-1', paymentId: 'payment-1' }, subscription,
    events: [{ source: 'server', sourceKey: 'subscription-create-contract-rejected:attempt-1' }],
  })
  const { default: handler } = await import('../server/api/payment/query.post')
  await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusCode: 409, statusMessage: 'SUBSCRIPTION_CREATE_CONTRACT_REJECTED' })
  expect(mocks.queryCheckoutPayment).not.toHaveBeenCalled()
  expect(mocks.queryPayment).not.toHaveBeenCalled()
  expect(mocks.recordQueryEvent).not.toHaveBeenCalled()
})

it('allows an existing Checkout Payment ID to query normally when no explicit rejection exists', async () => {
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ attemptId: 'attempt-1', paymentId: 'payment-1', token: 'q'.repeat(43), expiresAt: '2026-09-17T00:05:00.000Z' }))
  const contract = { ...subscription, initialIntegration: 'checkout', contractId: undefined, tokenId: undefined }
  const attempt = { id: 'attempt-1', orderId: 'order-1', integration: 'checkout', paymentId: 'payment-1', merchantTxnId: 'merchant-txn-1' }
  mocks.getSubscriptionForAttempt.mockResolvedValue(contract)
  mocks.getPaymentQueryContext.mockResolvedValue({ order: { id: 'order-1', amount: { minor: 500, currency: 'USD' } }, attempt })
  mocks.getPaymentRecovery.mockResolvedValue({ order: { id: 'order-1' }, attempt, subscription: contract, events: [] })
  mocks.queryCheckoutPayment.mockResolvedValue({ paymentId: 'payment-1', status: 'processing', rawStatus: 'U' })
  mocks.recordQueryEvent.mockResolvedValue({ attempt, event: { id: 'query-1' } })
  const { default: handler } = await import('../server/api/payment/query.post')
  await expect((handler as (event: unknown) => Promise<unknown>)({})).resolves.toMatchObject({ attempt, subscription: { state: 'pending' } })
  expect(mocks.queryCheckoutPayment).toHaveBeenCalledTimes(1)
  expect(mocks.queryPayment).not.toHaveBeenCalled()
})
