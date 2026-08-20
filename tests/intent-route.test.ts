import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createPaymentRecord: vi.fn(),
  ensurePaymentCustomer: vi.fn(),
  getPaymentRecovery: vi.fn(),
  readPaymentRecovery: vi.fn(),
  requireCanonicalPaymentOrigin: vi.fn(),
  requireServerProfile: vi.fn(),
  setPaymentRecovery: vi.fn(),
}))

vi.mock('../server/utils/limit', () => ({
  requireCanonicalPaymentOrigin: mocks.requireCanonicalPaymentOrigin,
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
  PaymentStoreError: class PaymentStoreError extends Error {
    readonly code = 'PAYMENT_DATABASE_ERROR'
  },
  createPaymentRecord: mocks.createPaymentRecord,
  ensurePaymentCustomer: mocks.ensurePaymentCustomer,
  getPaymentRecovery: mocks.getPaymentRecovery,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))

  mocks.requireServerProfile.mockReturnValue({
    profile: 'sandbox',
    secret: 'test-secret',
    showcaseOrigin: 'https://showcase.example',
    merchantNo: 'test-merchant',
    appId: 'test-app',
  })
  mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: 'attempt-1' })
  mocks.getPaymentRecovery.mockResolvedValue({
    order: { id: 'order-1' },
    attempt: {
      id: 'attempt-1',
      orderId: 'order-1',
      status: 'processing',
      paymentId: '9000000000000000001',
    },
    events: [],
    customer: {
      environment: 'sandbox',
      merchantNo: 'test-merchant',
      appId: 'test-app',
      merchantCustId: 'Cust-Existing_9',
    },
  })
  mocks.ensurePaymentCustomer.mockResolvedValue({
    environment: 'sandbox',
    merchantNo: 'test-merchant',
    appId: 'test-app',
    merchantCustId: 'Cust-Legacy_1',
  })
})

describe('payment intent route', () => {
  it('reuses an existing non-terminal attempt by default', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ journeyId: 'three-ds-success' }))

    const { default: handler } = await import('../server/api/payment/intent.post')
    const event = {}
    const result = await (handler as (event: unknown) => Promise<unknown>)(event)

    expect(mocks.requireCanonicalPaymentOrigin).toHaveBeenCalledWith(event, 'https://showcase.example')
    expect(result).toEqual({ orderId: 'order-1', create: false })
    expect(mocks.createPaymentRecord).not.toHaveBeenCalled()
    expect(mocks.setPaymentRecovery).not.toHaveBeenCalled()
  })

  it('creates a separate Sandbox order only after explicit restart', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      journeyId: 'three-ds-success',
      restart: true,
    }))

    const { default: handler } = await import('../server/api/payment/intent.post')
    const result = await (handler as (event: unknown) => Promise<{ orderId: string, create: boolean }>)({})

    expect(result.create).toBe(true)
    expect(result.orderId).not.toBe('order-1')
    expect(mocks.getPaymentRecovery).toHaveBeenCalledWith('order-1', 'attempt-1')
    const createdAttempt = mocks.createPaymentRecord.mock.calls[0]?.[1]

    expect(mocks.createPaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: result.orderId }),
      expect.objectContaining({
        id: `${result.orderId}-attempt-1`,
        orderId: result.orderId,
      }),
      expect.objectContaining({
        environment: 'sandbox',
        merchantNo: 'test-merchant',
        appId: 'test-app',
        merchantCustId: 'Cust-Existing_9',
      }),
    )
    expect(createdAttempt).not.toHaveProperty('retryOf')
    expect(mocks.setPaymentRecovery).toHaveBeenCalledWith(
      expect.anything(),
      'test-secret',
      result.orderId,
      `${result.orderId}-attempt-1`,
    )
  })

  it('records Google Pay as the expected method while reusing the standard DIRECT fixture', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      journeyId: 'standard-success',
      method: 'google-pay',
      restart: true,
    }))

    const { default: handler } = await import('../server/api/payment/intent.post')
    await (handler as (event: unknown) => Promise<unknown>)({})

    expect(mocks.createPaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: { minor: 500, currency: 'USD' },
        item: expect.objectContaining({ sku: 'HL-SAMPLE-005' }),
      }),
      expect.objectContaining({
        integration: 'web-js-sdk',
        method: 'google-pay',
      }),
      expect.anything(),
    )
  })

  it('rejects Google Pay for journeys outside its server allowlist', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      journeyId: 'three-ds-success',
      method: 'google-pay',
      restart: true,
    }))

    const { default: handler } = await import('../server/api/payment/intent.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 400, statusMessage: 'PAYMENT_JOURNEY_UNAVAILABLE' })
    expect(mocks.createPaymentRecord).not.toHaveBeenCalled()
  })

  it('atomically establishes a customer before restarting a legacy order', async () => {
    mocks.getPaymentRecovery.mockResolvedValueOnce({
      order: { id: 'order-1' },
      attempt: {
        id: 'attempt-1',
        orderId: 'order-1',
        status: 'succeeded',
        paymentId: '9000000000000000001',
      },
      events: [],
      customer: null,
    })
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      journeyId: 'standard-success',
      restart: true,
    }))

    const { default: handler } = await import('../server/api/payment/intent.post')
    await (handler as (event: unknown) => Promise<unknown>)({})

    expect(mocks.ensurePaymentCustomer).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({
        environment: 'sandbox',
        merchantNo: 'test-merchant',
        appId: 'test-app',
      }),
    )
    expect(mocks.createPaymentRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ merchantCustId: 'Cust-Legacy_1' }),
    )
  })

  it('rejects a legacy customer established concurrently in another profile scope', async () => {
    mocks.getPaymentRecovery.mockResolvedValueOnce({
      order: { id: 'order-1' },
      attempt: {
        id: 'attempt-1',
        orderId: 'order-1',
        status: 'succeeded',
        paymentId: '9000000000000000001',
      },
      events: [],
      customer: null,
    })
    mocks.ensurePaymentCustomer.mockResolvedValueOnce({
      environment: 'sandbox',
      merchantNo: 'test-merchant',
      appId: 'other-app',
      merchantCustId: 'Cust-Other_2',
    })
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      journeyId: 'standard-success',
      restart: true,
    }))

    const { default: handler } = await import('../server/api/payment/intent.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 409, statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
    expect(mocks.createPaymentRecord).not.toHaveBeenCalled()
    expect(mocks.setPaymentRecovery).not.toHaveBeenCalled()
  })

  it('rejects reuse when the recovered customer belongs to another profile scope', async () => {
    mocks.getPaymentRecovery.mockResolvedValueOnce({
      order: { id: 'order-1' },
      attempt: {
        id: 'attempt-1',
        orderId: 'order-1',
        status: 'processing',
        paymentId: '9000000000000000001',
      },
      events: [],
      customer: {
        environment: 'sandbox',
        merchantNo: 'test-merchant',
        appId: 'other-app',
        merchantCustId: 'Cust-Other_1',
      },
    })
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ journeyId: 'standard-success' }))

    const { default: handler } = await import('../server/api/payment/intent.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 409, statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
    expect(mocks.createPaymentRecord).not.toHaveBeenCalled()
    expect(mocks.setPaymentRecovery).not.toHaveBeenCalled()
  })

  it('rejects restart values other than the explicit true flag', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      journeyId: 'three-ds-success',
      restart: false,
    }))

    const { default: handler } = await import('../server/api/payment/intent.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 400, statusMessage: 'PAYMENT_INPUT_INVALID' })
    expect(mocks.createPaymentRecord).not.toHaveBeenCalled()
  })

  it('rejects a journey outside the allowed Sandbox journey IDs', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      journeyId: 'merchant-defined-amount',
    }))

    const { default: handler } = await import('../server/api/payment/intent.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 400, statusMessage: 'PAYMENT_INPUT_INVALID' })
    expect(mocks.createPaymentRecord).not.toHaveBeenCalled()
  })

  it('rejects a client-supplied merchant customer identifier', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      journeyId: 'standard-success',
      merchantCustId: 'client-controlled',
    }))

    const { default: handler } = await import('../server/api/payment/intent.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 400, statusMessage: 'PAYMENT_INPUT_INVALID' })
    expect(mocks.createPaymentRecord).not.toHaveBeenCalled()
  })
})
