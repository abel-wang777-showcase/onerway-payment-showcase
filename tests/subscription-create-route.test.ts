import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class GatewayError extends Error {
    readonly code: string

    constructor(code: string) {
      super(code)
      this.code = code
    }
  }

  return {
    claimPaymentCreation: vi.fn(),
    completePaymentRecord: vi.fn(),
    createSubscriptionPayment: vi.fn(),
    GatewayError,
    getPaymentRecovery: vi.fn(),
    readBrowserData: vi.fn(),
    readPaymentRecovery: vi.fn(),
    recordSubscriptionCreationRejection: vi.fn(),
    recordSubscriptionCreationRecoveryAllowed: vi.fn(),
    requireCanonicalPaymentOrigin: vi.fn(),
    requireServerProfile: vi.fn(),
  }
})

vi.mock('../server/utils/browser', () => ({ readBrowserData: mocks.readBrowserData }))
vi.mock('../server/utils/gateway', () => ({
  createQueryExpiry: vi.fn(),
  createQueryToken: vi.fn(),
  createSubscriptionPayment: mocks.createSubscriptionPayment,
  GatewayError: mocks.GatewayError,
}))
vi.mock('../server/utils/limit', () => ({
  requireCanonicalPaymentOrigin: mocks.requireCanonicalPaymentOrigin,
  requireIp: (value: string) => value,
  withPaymentLimit: (_event: unknown, _kind: string, task: (ip: string) => Promise<unknown>) => task('203.0.113.10'),
}))
vi.mock('../server/utils/profile', () => ({ requireServerProfile: mocks.requireServerProfile }))
vi.mock('../server/utils/recovery', () => ({ readPaymentRecovery: mocks.readPaymentRecovery }))
vi.mock('../server/utils/store', () => ({
  claimPaymentCreation: mocks.claimPaymentCreation,
  completePaymentRecord: mocks.completePaymentRecord,
  getPaymentRecovery: mocks.getPaymentRecovery,
  PaymentStoreError: class PaymentStoreError extends Error {},
  recordSubscriptionCreationRejection: mocks.recordSubscriptionCreationRejection,
  recordSubscriptionCreationRecoveryAllowed: mocks.recordSubscriptionCreationRecoveryAllowed,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({}))
  vi.stubGlobal('getHeader', vi.fn())
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))

  mocks.requireServerProfile.mockReturnValue({
    profile: 'sandbox',
    environment: 'Sandbox',
    secret: 'secret',
    showcaseOrigin: 'https://showcase.example',
    merchantNo: 'merchant',
    appId: 'app',
    notifyUrl: 'https://showcase.example/api/webhooks/onerway/payment',
    transactionIp: '203.0.113.10',
  })
  mocks.readBrowserData.mockReturnValue({
    javaEnabled: false,
    colorDepth: '24',
    screenHeight: '844',
    screenWidth: '390',
    timeZoneOffset: '-480',
    contentLength: '1234',
    language: 'en-US',
  })
  mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: 'attempt-1' })
  mocks.getPaymentRecovery.mockResolvedValue({
    order: {
      id: 'order-1',
      scene: 'ecommerce',
      item: {
        sku: 'HL-SUB-DAILY-005',
        name: 'Halden Daily Essentials',
        variant: 'Daily subscription',
        quantity: 1,
        unitAmount: { minor: 500, currency: 'USD' },
      },
      amount: { minor: 500, currency: 'USD' },
      createdAt: '2026-08-17T00:00:00.000Z',
    },
    attempt: {
      id: 'attempt-1',
      orderId: 'order-1',
      status: 'created',
      merchantTxnId: 'showcase-subscription-1',
    },
    attempts: [],
    customer: {
      environment: 'sandbox',
      merchantNo: 'merchant',
      appId: 'app',
      merchantCustId: 'Customer_1',
    },
    subscription: {
      planId: 'halden-daily-essentials-v1',
      planVersion: 1,
      productName: 'Halden Daily Essentials',
      amount: { minor: 500, currency: 'USD' },
      frequencyType: 'D',
      frequencyPoint: 1,
      expireDate: '2099-12-31',
      state: 'pending',
    },
  })
  mocks.claimPaymentCreation.mockResolvedValue({ outcome: 'claimed' })
  mocks.createSubscriptionPayment.mockRejectedValue(
    new mocks.GatewayError('SUBSCRIPTION_CREATE_RESPONSE_INVALID'),
  )
  mocks.recordSubscriptionCreationRejection.mockResolvedValue(undefined)
  mocks.recordSubscriptionCreationRecoveryAllowed.mockResolvedValue(undefined)
})

describe('subscription create route', () => {
  it('durably blocks generic recovery after an observed create response contract drift', async () => {
    const { default: handler } = await import('../server/api/payment/subscription/create.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({
        statusCode: 502,
        statusMessage: 'SUBSCRIPTION_CREATE_RESPONSE_INVALID',
      })
    expect(mocks.recordSubscriptionCreationRejection).toHaveBeenCalledWith(
      'attempt-1',
      expect.any(String),
    )
    expect(mocks.recordSubscriptionCreationRecoveryAllowed).not.toHaveBeenCalled()
    expect(mocks.completePaymentRecord).not.toHaveBeenCalled()
  })

  it('keeps network-unknown creation eligible for same-merchantTxnId recovery', async () => {
    mocks.createSubscriptionPayment.mockRejectedValueOnce(
      new mocks.GatewayError('PAYMENT_NETWORK_ERROR'),
    )
    const { default: handler } = await import('../server/api/payment/subscription/create.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 504, statusMessage: 'PAYMENT_NETWORK_ERROR' })
    expect(mocks.recordSubscriptionCreationRejection).not.toHaveBeenCalled()
    expect(mocks.recordSubscriptionCreationRecoveryAllowed).toHaveBeenCalledWith(
      'attempt-1',
      expect.any(String),
    )
  })
})
