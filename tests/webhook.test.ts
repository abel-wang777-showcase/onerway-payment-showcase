import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parseWebhookBody,
  readWebhookBody,
  readPaymentWebhook,
  verifyWebhookSignature,
} from '../server/utils/webhook'

const secret = 'sandbox-test-secret'
const excluded = new Set([
  'originTransactionId',
  'originMerchantTxnId',
  'customsDeclarationAmount',
  'customsDeclarationCurrency',
  'paymentMethod',
  'walletTypeName',
  'periodValue',
  'tokenExpireTime',
  'sign',
])

function sign(body: Record<string, unknown>): string {
  const canonical = Object.entries(body)
    .filter(([key, value]) => !excluded.has(key) && value !== null && value !== undefined && value !== '')
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, value]) => String(value))
    .join('')

  return createHash('sha256').update(`${canonical}${secret}`, 'utf8').digest('hex')
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body = {
    notifyType: 'TXN',
    transactionId: '2084000000000000001',
    paymentId: '2084000000000000000',
    txnType: 'SALE',
    merchantNo: 'merchant',
    merchantTxnId: 'showcase-attempt-1',
    responseTime: '2026-08-04 15:05:33',
    txnTime: '2026-08-04 15:05:15',
    txnTimeZone: '+08:00',
    orderAmount: '5.00',
    orderCurrency: 'USD',
    status: 'S',
    paymentStatus: 'S',
    reason: '{"respCode":"20000","respMsg":"Success"}',
    paymentMethod: 'VISA',
    walletTypeName: 'ExampleWallet',
    paymentMethodDetails: '{"card":{"issuer":"Example"}}',
    ...overrides,
  }

  return { ...body, sign: sign(body) }
}

describe('Onerway payment webhook boundary', () => {
  it('verifies the observed Sandbox exclusion matrix', () => {
    const body = payload()

    expect(verifyWebhookSignature(body, secret)).toBe(true)
    expect(verifyWebhookSignature({ ...body, paymentMethod: 'OTHER' }, secret)).toBe(true)
    expect(verifyWebhookSignature({ ...body, walletTypeName: 'OtherWallet' }, secret)).toBe(true)
    expect(verifyWebhookSignature({
      ...body,
      paymentMethodDetails: '{"card":{"issuer":"Changed"}}',
    }, secret)).toBe(false)
  })

  it('projects only the identifiers and dual-axis status needed for persistence', () => {
    expect(readPaymentWebhook(payload(), secret, 'merchant')).toEqual({
      transactionId: '2084000000000000001',
      paymentId: '2084000000000000000',
      merchantTxnId: 'showcase-attempt-1',
      amountMinor: 500,
      currency: 'USD',
      transactionStatus: 'S',
      paymentStatus: 'S',
      status: 'succeeded',
      occurredAt: '2026-08-04T07:05:15.000Z',
    })
  })

  it('keeps a failed transaction non-terminal while the Payment remains open', () => {
    const body = payload({ status: 'F', paymentStatus: 'O' })

    expect(readPaymentWebhook(body, secret, 'merchant').status).toBe('processing')
  })

  it('fails closed for invalid signatures, merchants and provider statuses', () => {
    expect(() => readPaymentWebhook({ ...payload(), sign: '0'.repeat(64) }, secret, 'merchant'))
      .toThrow('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
    expect(() => readPaymentWebhook(payload(), secret, 'other-merchant'))
      .toThrow('PAYMENT_WEBHOOK_FIELDS_INVALID')
    expect(() => readPaymentWebhook(payload({ paymentStatus: 'X' }), secret, 'merchant'))
      .toThrow('PAYMENT_WEBHOOK_FIELDS_INVALID')
  })

  it('rejects malformed, non-object and oversized request bodies', () => {
    expect(() => parseWebhookBody('{')).toThrow('PAYMENT_WEBHOOK_BODY_INVALID')
    expect(() => parseWebhookBody('[]')).toThrow('PAYMENT_WEBHOOK_BODY_INVALID')
    expect(() => parseWebhookBody(JSON.stringify({ value: 'x'.repeat(65 * 1024) })))
      .toThrow('PAYMENT_WEBHOOK_BODY_INVALID')
  })

  it('stops reading request streams at the hard body limit', async () => {
    async function* chunks(...values: string[]): AsyncGenerator<string> {
      yield* values
    }

    await expect(readWebhookBody(chunks('{}'), String(65 * 1024)))
      .rejects.toThrow('PAYMENT_WEBHOOK_BODY_INVALID')
    await expect(readWebhookBody(chunks('x'.repeat(32 * 1024), 'x'.repeat(33 * 1024))))
      .rejects.toThrow('PAYMENT_WEBHOOK_BODY_INVALID')
    await expect(readWebhookBody(chunks(JSON.stringify(payload()))))
      .resolves.toMatchObject({ notifyType: 'TXN' })
  })

  it('rejects normalized calendar dates and impossible timezone offsets', () => {
    expect(() => readPaymentWebhook(payload({ txnTime: '2026-02-31 15:05:15' }), secret, 'merchant'))
      .toThrow('PAYMENT_WEBHOOK_FIELDS_INVALID')
    expect(() => readPaymentWebhook(payload({ txnTimeZone: '+14:01' }), secret, 'merchant'))
      .toThrow('PAYMENT_WEBHOOK_FIELDS_INVALID')
  })
})
