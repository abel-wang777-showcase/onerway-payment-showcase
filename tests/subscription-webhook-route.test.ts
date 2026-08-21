import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isSubscriptionWebhookProcessed: vi.fn(),
  querySubscription: vi.fn(),
  readPaymentWebhook: vi.fn(),
  readSubscriptionPaymentWebhook: vi.fn(),
  readWebhookBody: vi.fn(),
  recordSubscriptionWebhookEvent: vi.fn(),
  recordWebhookEvent: vi.fn(),
  requireServerProfile: vi.fn(),
}))

vi.mock('../server/utils/gateway', () => ({
  GatewayError: class GatewayError extends Error {},
  querySubscription: mocks.querySubscription,
}))

vi.mock('../server/utils/profile', () => ({
  requireServerProfile: mocks.requireServerProfile,
}))

vi.mock('../server/utils/store', () => ({
  isSubscriptionWebhookProcessed: mocks.isSubscriptionWebhookProcessed,
  PaymentStoreError: class PaymentStoreError extends Error {},
  recordSubscriptionWebhookEvent: mocks.recordSubscriptionWebhookEvent,
  recordWebhookEvent: mocks.recordWebhookEvent,
}))

vi.mock('../server/utils/webhook', () => ({
  readPaymentWebhook: mocks.readPaymentWebhook,
  readSubscriptionPaymentWebhook: mocks.readSubscriptionPaymentWebhook,
  readWebhookBody: mocks.readWebhookBody,
  WebhookError: class WebhookError extends Error {
    readonly code: string

    constructor(code: string) {
      super(code)
      this.code = code
    }
  },
}))

const fact = {
  kind: 'subscription',
  scenario: 'SUBSCRIPTION_INITIAL',
  transactionId: '2084000000000000001',
  paymentId: '2084000000000000002',
  merchantTxnId: 'showcase-subscription-1',
  contractId: 'contract_1',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('setResponseStatus', vi.fn())
  vi.stubGlobal('getHeader', vi.fn())
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))

  mocks.requireServerProfile.mockReturnValue({
    profile: 'sandbox',
    merchantNo: 'merchant',
    secret: 'secret',
  })
  mocks.readWebhookBody.mockResolvedValue({ scenarios: 'SUBSCRIPTION_INITIAL' })
  mocks.readSubscriptionPaymentWebhook.mockReturnValue(fact)
  mocks.isSubscriptionWebhookProcessed.mockResolvedValue(false)
  mocks.querySubscription.mockResolvedValue({ contractId: 'contract_1' })
  mocks.recordSubscriptionWebhookEvent.mockResolvedValue({ duplicate: false })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('subscription webhook route', () => {
  it('ACKs a locally processed retry without depending on Provider Query', async () => {
    mocks.isSubscriptionWebhookProcessed.mockResolvedValue(true)

    const { default: handler } = await import('../server/api/webhooks/onerway/payment.post')
    const result = await (handler as (event: { node: { req: unknown } }) => Promise<string>)({
      node: { req: {} },
    })

    expect(result).toBe(fact.transactionId)
    expect(mocks.querySubscription).not.toHaveBeenCalled()
    expect(mocks.recordSubscriptionWebhookEvent).not.toHaveBeenCalled()
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 200)
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      'Content-Type',
      'text/plain; charset=utf-8',
    )
  })

  it('queries a newly discovered contract before atomically recording and ACKing', async () => {
    const { default: handler } = await import('../server/api/webhooks/onerway/payment.post')
    const event = { node: { req: {} } }
    const result = await (handler as (event: typeof event) => Promise<string>)(event)

    expect(mocks.querySubscription).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'sandbox' }),
      'contract_1',
    )
    expect(mocks.recordSubscriptionWebhookEvent).toHaveBeenCalledWith(
      fact,
      { contractId: 'contract_1' },
      expect.any(String),
    )
    expect(result).toBe(fact.transactionId)
  })

  it('logs only the bounded rejection code when a webhook is invalid', async () => {
    const rejectedBody = {
      merchantTxnId: 'must-not-be-logged',
      sign: 'must-not-be-logged',
    }
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mocks.readWebhookBody.mockResolvedValue(rejectedBody)
    const { WebhookError } = await import('../server/utils/webhook')
    mocks.readPaymentWebhook.mockImplementation(() => {
      throw new WebhookError('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
    })

    const { default: handler } = await import('../server/api/webhooks/onerway/payment.post')
    const request = (handler as (event: { node: { req: unknown } }) => Promise<string>)({
      node: { req: {} },
    })

    await expect(request).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'PAYMENT_WEBHOOK_SIGNATURE_INVALID',
    })
    expect(warning).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledWith(
      '[payment-webhook] rejected',
      { code: 'PAYMENT_WEBHOOK_SIGNATURE_INVALID' },
    )

    const logged = JSON.stringify(warning.mock.calls)
    expect(logged).not.toContain(rejectedBody.merchantTxnId)
    expect(logged).not.toContain(rejectedBody.sign)
  })
})
