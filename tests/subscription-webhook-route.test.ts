import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

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

vi.mock('../server/utils/webhook', async (importOriginal) => ({
  readPaymentWebhook: mocks.readPaymentWebhook,
  readSubscriptionPaymentWebhook: mocks.readSubscriptionPaymentWebhook,
  readWebhookBody: mocks.readWebhookBody,
  WebhookError: (await importOriginal<typeof import('../server/utils/webhook')>()).WebhookError,
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
  vi.stubGlobal('getHeader', vi.fn((_event, name) => name === 'x-rh-signature' ? 'v1=test-header' : undefined))
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
  it.each([undefined, null])('processes a signed ordinary notification with scenario %s through the payment boundary', async (scenarios) => {
    const body = {
      notifyType: 'TXN', txnType: 'SALE', merchantNo: 'merchant',
      transactionId: '2084000000000000001', paymentId: '2084000000000000002',
      merchantTxnId: 'showcase-ordinary-payment', orderAmount: '5.00', orderCurrency: 'USD',
      status: 'S', paymentStatus: 'S', txnTime: '2026-09-15 08:57:51', txnTimeZone: '+08:00',
      ...(scenarios === undefined ? {} : { scenarios }),
    }
    const digest = createHash('sha256').update(Object.entries(body)
      .filter(([, value]) => value !== null)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, value]) => value).join('') + 'secret').digest('hex')
    const real = await vi.importActual<typeof import('../server/utils/webhook')>('../server/utils/webhook')
    mocks.readWebhookBody.mockResolvedValue(real.parseWebhookBody(JSON.stringify(body)))
    mocks.readPaymentWebhook.mockImplementation(real.readPaymentWebhook)
    vi.mocked(getHeader).mockImplementation((_event, name) => name === 'x-rh-signature' ? `v1=${digest}` : undefined)
    mocks.recordWebhookEvent.mockResolvedValue({ duplicate: false })
    const { default: handler } = await import('../server/api/webhooks/onerway/payment.post')
    const result = await (handler as (event: { node: { req: unknown } }) => Promise<string>)({ node: { req: {} } })
    expect(result).toBe(body.transactionId)
    expect(mocks.recordWebhookEvent).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: body.transactionId, paymentId: body.paymentId, amountMinor: 500, status: 'succeeded',
    }))
    expect(mocks.readSubscriptionPaymentWebhook).not.toHaveBeenCalled()
    expect(mocks.recordSubscriptionWebhookEvent).not.toHaveBeenCalled()
    expect(mocks.querySubscription).not.toHaveBeenCalled()
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 200)
  })

  it('ACKs a locally processed retry without depending on Provider Query', async () => {
    mocks.isSubscriptionWebhookProcessed.mockResolvedValue(true)

    const { default: handler } = await import('../server/api/webhooks/onerway/payment.post')
    const result = await (handler as (event: { node: { req: unknown } }) => Promise<string>)({
      node: { req: {} },
    })

    expect(result).toBe(fact.transactionId)
    expect(mocks.readSubscriptionPaymentWebhook).toHaveBeenCalledWith(
      { scenarios: 'SUBSCRIPTION_INITIAL' }, 'secret', 'merchant', 'v1=test-header',
    )
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

  it.each(['', 'SUBSCRIPTION_RENEWAL', 'UNKNOWN'])('rejects scenario %s and keeps diagnostics only in server logs', async (scenarios) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rejectedBody = { scenarios, merchantTxnId: 'private-order', reason: 'private-reason' }
    mocks.readWebhookBody.mockResolvedValue(rejectedBody)
    const { WebhookError } = await import('../server/utils/webhook')
    mocks.readSubscriptionPaymentWebhook.mockImplementation(() => {
      throw Object.assign(new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'S01'), {
        payload: rejectedBody,
        signature: 'private-signature',
      })
    })
    const { default: handler } = await import('../server/api/webhooks/onerway/payment.post')
    let responseError: unknown
    try {
      await (handler as (event: { node: { req: unknown } }) => Promise<string>)({ node: { req: {} } })
    }
    catch (error) {
      responseError = error
    }
    expect(responseError).toMatchObject({ statusCode: 400, statusMessage: 'PAYMENT_WEBHOOK_FIELDS_INVALID' })
    expect(responseError).not.toHaveProperty('diagnosticCode')
    expect(warning).toHaveBeenCalledExactlyOnceWith('[payment-webhook] rejected', {
      code: 'PAYMENT_WEBHOOK_FIELDS_INVALID', diagnosticCode: 'S01',
    })
    expect(mocks.readPaymentWebhook).not.toHaveBeenCalled()
    expect(mocks.recordWebhookEvent).not.toHaveBeenCalled()
    expect(mocks.recordSubscriptionWebhookEvent).not.toHaveBeenCalled()
    expect(mocks.querySubscription).not.toHaveBeenCalled()
    expect(JSON.stringify(warning.mock.calls)).not.toMatch(/private-|merchantTxnId|payload|signature|reason/)
    expect(JSON.stringify(responseError)).not.toMatch(/S01|private-/)
  })
})
