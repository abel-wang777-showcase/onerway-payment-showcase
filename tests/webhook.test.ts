import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parseWebhookBody,
  readWebhookBody,
  readPaymentWebhook as readWebhook,
  readSubscriptionPaymentWebhook,
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

function readPaymentWebhook(body: Record<string, unknown>, secret: string, merchant: string) {
  return readWebhook(body, secret, merchant, `v1=${sign(body)}`)
}

describe('Onerway payment webhook boundary', () => {
  it.each([
    [{ notifyType: 'OTHER' }, 'E01'],
    [{ txnType: 'OTHER' }, 'E02'],
    [{ merchantNo: 'other-merchant' }, 'E03'],
    [{ transactionId: 'invalid-id' }, 'P01'],
    [{ paymentId: 123 }, 'P02'],
    [{ merchantTxnId: 'invalid id' }, 'P03'],
    [{ orderAmount: 5 }, 'P04'],
    [{ orderCurrency: 'EUR' }, 'P05'],
    [{ status: 'UNKNOWN' }, 'P06'],
    [{ paymentStatus: 'UNKNOWN' }, 'P07'],
    [{ orderAmount: '99999999999999.99' }, 'P08'],
    [{ txnTime: '2026-09-15T08:57:51' }, 'T01'],
    [{ txnTimeZone: 'UTC+8' }, 'T02'],
    [{ txnTime: '2026-02-30 08:57:51' }, 'T03'],
  ])('identifies a signed field rejection with a fixed internal code: %j', (overrides, diagnosticCode) => {
    const body = payload(overrides as Record<string, unknown>)
    let rejection: unknown
    try {
      readPaymentWebhook(body, secret, 'merchant')
    }
    catch (error) {
      rejection = error
    }
    expect(rejection).toMatchObject({
      code: 'PAYMENT_WEBHOOK_FIELDS_INVALID',
      message: 'PAYMENT_WEBHOOK_FIELDS_INVALID',
      diagnosticCode,
    })
    const serialized = JSON.stringify(rejection)
    expect(serialized).not.toContain(body.sign)
    expect(serialized).not.toContain('merchantTxnId')
    expect(serialized).not.toContain('orderAmount')
  })

  it('keeps signature rejection ahead of field diagnostics', () => {
    const body = payload({ merchantNo: 'other-merchant', orderAmount: 5 })
    let rejection: unknown
    try {
      readWebhook(body, secret, 'merchant', `v1=${'0'.repeat(64)}`)
    }
    catch (error) {
      rejection = error
    }
    expect(rejection).toMatchObject({ code: 'PAYMENT_WEBHOOK_SIGNATURE_INVALID' })
    expect(rejection).not.toHaveProperty('diagnosticCode', expect.any(String))
  })

  it.each([null, '', 'SUBSCRIPTION_RENEWAL'])('diagnoses an invalid subscription scenario without accepting it: %s', (scenarios) => {
    const body = payload({ scenarios })
    expect(() => readSubscriptionPaymentWebhook(body, secret, 'merchant', `v1=${body.sign}`))
      .toThrow(expect.objectContaining({ code: 'PAYMENT_WEBHOOK_FIELDS_INVALID', diagnosticCode: 'S01' }))
  })

  it('accepts any current-secret v1 item during key rotation and ignores body sign', () => {
    const body = payload()
    const header = `v1=${'0'.repeat(64)}, v1=${body.sign}`

    expect(verifyWebhookSignature({ ...body, sign: 'legacy-other-key' }, secret, header)).toBe(true)
    expect(readWebhook({ ...body, sign: undefined }, secret, 'merchant', header).status).toBe('succeeded')
  })

  it.each([undefined, '', 'v1=bad', `v2=${'0'.repeat(64)}`, `v1=${'A'.repeat(64)}`])(
    'rejects missing or malformed signature headers without body fallback: %s',
    (header) => {
      expect(verifyWebhookSignature(payload(), secret, header)).toBe(false)
    },
  )

  it('projects Checkout cancellation without inventing a Payment ID', () => {
    const result = readPaymentWebhook(payload({ paymentId: undefined, paymentStatus: undefined, status: 'N' }), secret, 'merchant')

    expect(result).toMatchObject({ transactionStatus: 'N', status: 'cancelled' })
    expect(result).not.toHaveProperty('paymentId')
    expect(result).not.toHaveProperty('paymentStatus')
  })

  it('verifies the observed Sandbox exclusion matrix', () => {
    const body = payload()

    expect(verifyWebhookSignature(body, secret, `v1=${body.sign}`)).toBe(true)
    expect(verifyWebhookSignature({ ...body, paymentMethod: 'OTHER' }, secret, `v1=${body.sign}`)).toBe(true)
    expect(verifyWebhookSignature({ ...body, walletTypeName: 'OtherWallet' }, secret, `v1=${body.sign}`)).toBe(true)
    expect(verifyWebhookSignature({
      ...body,
      paymentMethodDetails: '{"card":{"issuer":"Changed"}}',
    }, secret, `v1=${body.sign}`)).toBe(false)
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
    expect(() => readWebhook(payload(), secret, 'merchant', `v1=${'0'.repeat(64)}`))
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


describe('Direct Apple Pay webhook projection', () => {
  it.each([['S', 'succeeded'], ['F', 'failed'], ['N', 'cancelled']])('reads transaction %s independently from paymentStatus', (status, expected) => {
    const body = payload({ status, paymentStatus: 'unrecognized', paymentId: undefined })
    const result = readWebhook(body, secret, 'merchant', `v1=${sign(body)}`, true)
    expect(result).toMatchObject({ kind: 'direct', status: expected, transactionStatus: status })
    expect(result).not.toHaveProperty('paymentStatus')
    expect(result).not.toHaveProperty('paymentId')
  })
  it('still requires valid signature and known terminal notification status', () => {
    const pending = payload({ status: 'P' })
    expect(() => readWebhook(pending, secret, 'merchant', `v1=${sign(pending)}`, true)).toThrow('PAYMENT_WEBHOOK_FIELDS_INVALID')
    const body = payload({ status: 'X' })
    expect(() => readWebhook(body, secret, 'merchant', `v1=${sign(body)}`, true)).toThrow('PAYMENT_WEBHOOK_FIELDS_INVALID')
    expect(() => readWebhook(payload(), secret, 'merchant', 'invalid', true)).toThrow('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
  })
})
