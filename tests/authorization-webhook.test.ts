import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mergeAuthorization, type AuthorizationState } from '../shared/payment/authorization'
import { readAuthorizationWebhook, readPaymentWebhook } from '../server/utils/webhook'

const secret = 'authorization-test-secret'
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
  return {
    notifyType: 'TXN',
    txnType: 'AUTH',
    merchantNo: 'merchant',
    transactionId: '2000000000000000002',
    paymentId: '2000000000000000001',
    merchantTxnId: 'showcase-auth-1',
    orderAmount: '5.00',
    orderCurrency: 'USD',
    status: 'S',
    paymentStatus: 'A',
    txnTime: '2026-09-18 16:01:00',
    txnTimeZone: '+08:00',
    reason: '{"respCode":"20000","respMsg":"Success"}',
    paymentMethodDetails: '{"card":{"issuer":"Example"}}',
    ...overrides,
  }
}

function read(body: Record<string, unknown>) {
  return readAuthorizationWebhook(body, secret, 'merchant', `v1=${sign(body)}`)
}

describe('authorization webhook signature and whitelist', () => {
  it('returns only verified identifiers, amount, status and time', () => {
    const body = payload({
      originTransactionId: 'unsigned-origin-id',
      originMerchantTxnId: 'unsigned-origin-merchant-id',
      paymentMethod: 'VISA',
      walletTypeName: 'ExampleWallet',
      tokenId: 'opaque-test-token',
      extraProviderField: 'extra-value',
      sign: 'unused-body-signature',
    })
    const result = read(body)

    expect(result).toEqual({
      kind: 'authorization',
      source: 'webhook',
      txnType: 'AUTH',
      transactionId: '2000000000000000002',
      paymentId: '2000000000000000001',
      merchantTxnId: 'showcase-auth-1',
      amountMinor: 500,
      currency: 'USD',
      transactionStatus: 'S',
      paymentStatus: 'A',
      fundsStatus: 'authorized',
      status: 'processing',
      occurredAt: '2026-09-18T08:01:00.000Z',
    })
    expect(Object.isFrozen(result)).toBe(true)
  })

  it.each([undefined, '', 'v1=invalid', `v1=${'0'.repeat(64)}`])('rejects absent or invalid header even with a valid body signature', (header) => {
    const body = payload()
    body.sign = sign(body)
    expect(() => readAuthorizationWebhook(body, secret, 'merchant', header))
      .toThrow('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
  })

  it('accepts the matching v1 item during key rotation', () => {
    const body = payload()
    expect(readAuthorizationWebhook(body, secret, 'merchant', `v1=${'0'.repeat(64)}, v1=${sign(body)}`).fundsStatus)
      .toBe('authorized')
  })

  it.each(['txnType', 'transactionId', 'paymentId', 'merchantTxnId', 'orderAmount', 'orderCurrency', 'status', 'paymentStatus', 'reason'])('binds signed %s to the signature', (key) => {
    const body = payload()
    const header = `v1=${sign(body)}`
    expect(() => readAuthorizationWebhook({ ...body, [key]: 'tampered' }, secret, 'merchant', header))
      .toThrow('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
  })

  it('does not consume unsigned origin fields as correlation authority', () => {
    const body = payload({ txnType: 'CAPTURE', status: 'S', paymentStatus: 'S', transactionId: '2000000000000000003' })
    const header = `v1=${sign(body)}`
    const parsed = readAuthorizationWebhook({
      ...body,
      originTransactionId: '2000000000000000002',
      originMerchantTxnId: 'showcase-auth-1',
    }, secret, 'merchant', header)
    const original: AuthorizationState = {
      paymentId: '2000000000000000001',
      authTransactionId: '2000000000000000002',
      authMerchantTxnId: 'showcase-auth-1',
      amountMinor: 500,
      currency: 'USD',
      fundsStatus: 'authorized',
      updatedAt: '2026-09-18T08:00:00.000Z',
    }

    expect(parsed).not.toHaveProperty('originTransactionId')
    expect(parsed).not.toHaveProperty('originMerchantTxnId')
    expect(mergeAuthorization(original, parsed).accepted).toBe(false)

    const claimed: AuthorizationState = {
      ...original,
      operation: { type: 'CAPTURE', merchantTxnId: 'showcase-operation-1', status: 'pending' },
    }
    const unrelated = payload({
      ...body,
      merchantTxnId: 'different-merchant-request',
      originTransactionId: original.authTransactionId,
      originMerchantTxnId: original.authMerchantTxnId,
    })
    expect(mergeAuthorization(claimed, read(unrelated)).accepted).toBe(false)
  })

  it('keeps the SALE parser closed to authorization categories', () => {
    const body = payload()
    expect(() => readPaymentWebhook(body, secret, 'merchant', `v1=${sign(body)}`))
      .toThrow('PAYMENT_WEBHOOK_FIELDS_INVALID')
  })
})

describe('authorization webhook confirmed combinations', () => {
  it.each([
    ['AUTH', 'S', 'A', 'authorized', 'processing'],
    ['AUTH', 'F', 'O', 'pending', 'processing'],
    ['CAPTURE', 'S', 'S', 'captured', 'succeeded'],
    ['VOID', 'S', 'N', 'voided', 'cancelled'],
  ])('projects %s %s/%s without treating AUTH as collected funds', (txnType, status, paymentStatus, fundsStatus, paymentAttemptStatus) => {
    expect(read(payload({ txnType, status, paymentStatus }))).toMatchObject({ fundsStatus, status: paymentAttemptStatus })
  })

  it.each([
    [{ notifyType: 'OTHER' }, 'E01'],
    [{ txnType: 'SALE' }, 'E02'],
    [{ merchantNo: 'different-merchant' }, 'E03'],
    [{ transactionId: 'invalid' }, 'P01'],
    [{ paymentId: undefined }, 'P02'],
    [{ paymentId: '' }, 'P02'],
    [{ merchantTxnId: 'invalid id' }, 'P03'],
    [{ orderAmount: '5.000' }, 'P04'],
    [{ orderCurrency: 'EUR' }, 'P05'],
    [{ status: 'U' }, 'P06'],
    [{ paymentStatus: undefined }, 'P07'],
    [{ paymentStatus: 'U' }, 'P07'],
    [{ orderAmount: '99999999999999.99' }, 'P08'],
    [{ status: 'N', paymentStatus: 'N' }, 'A01'],
    [{ status: 'N', paymentStatus: 'A' }, 'A01'],
    [{ status: 'S', paymentStatus: 'S' }, 'A01'],
    [{ txnType: 'CAPTURE', status: 'F', paymentStatus: 'A' }, 'A01'],
    [{ txnType: 'VOID', status: 'F', paymentStatus: 'A' }, 'A01'],
    [{ txnTime: '2026-02-30 16:01:00' }, 'T03'],
  ])('rejects unknown or incomplete signed fields with fixed diagnostics: %j', (overrides, diagnosticCode) => {
    expect(() => read(payload(overrides as Record<string, unknown>))).toThrow(expect.objectContaining({
      code: 'PAYMENT_WEBHOOK_FIELDS_INVALID', diagnosticCode,
    }))
  })

  it('does not apply the SALE cancellation exception to an AUTH timeout', () => {
    expect(() => read(payload({ status: 'N', paymentStatus: undefined, paymentId: undefined })))
      .toThrow(expect.objectContaining({ code: 'PAYMENT_WEBHOOK_FIELDS_INVALID', diagnosticCode: 'P02' }))
  })
})
