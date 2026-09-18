import { describe, expect, it } from 'vitest'
import {
  buildAuthorizationOperationPayload,
  readAuthorizationOperationResponse,
  signPayload,
  type AuthorizationOperationContext,
} from '../server/utils/gateway'
import type { ServerProfile } from '../server/utils/profile'

const profile = {
  profile: 'sandbox',
  apiBaseUrl: 'https://sandbox-acq.onerway.com',
  sdkUrl: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js',
  showcaseOrigin: 'https://showcase.example',
  notifyUrl: 'https://showcase.example/api/webhooks/onerway/payment',
  transactionIp: null,
  merchantNo: 'test-merchant',
  appId: 'test-app',
  secret: 'test-secret',
  transactionPolicy: 'sandbox-only',
} satisfies ServerProfile

const context: AuthorizationOperationContext = {
  type: 'CAPTURE',
  merchantTxnId: 'showcase-capture-fixture',
  originTransactionId: '10001',
  paymentId: '20001',
  amountMinor: 500,
  currency: 'USD',
}

const response = (data: Record<string, unknown> = {}) => ({
  respCode: '20000',
  data: {
    transactionId: '10002',
    paymentId: '20001',
    orderAmount: '5.00',
    orderCurrency: 'USD',
    status: 'S',
    paymentStatus: 'S',
    ...data,
  },
})

describe('full-amount authorization operation protocol', () => {
  it.each(['CAPTURE', 'VOID'] as const)('builds %s against the original AUTH without an amount override', (type) => {
    const payload = buildAuthorizationOperationPayload(profile, { ...context, type })
    expect(payload).toEqual({
      merchantNo: profile.merchantNo,
      merchantTxnId: context.merchantTxnId,
      originTransactionId: context.originTransactionId,
      txnType: type,
    })
    expect(signPayload(payload, profile.secret)).toMatchObject({ txnType: type, sign: expect.stringMatching(/^[a-f0-9]{64}$/) })
  })

  it('keeps the new operation ID separate and returns no final funds or payment projection', () => {
    expect(readAuthorizationOperationResponse(response({ redirectUrl: 'https://untrusted.example', tokenId: 'private', merchantTxnId: 'undocumented', txnType: 'undocumented' }), context)).toEqual({
      transactionId: '10002', paymentId: '20001', transactionStatus: 'S', paymentStatus: 'S',
    })
  })

  it('does not turn a processed request or operation failure into funds truth', () => {
    expect(readAuthorizationOperationResponse(response({ status: 'F', paymentStatus: undefined }), context)).toEqual({
      transactionId: '10002', paymentId: '20001', transactionStatus: 'F',
    })
    expect(() => readAuthorizationOperationResponse({ respCode: '20000' }, context)).toThrow('AUTHORIZATION_OPERATION_RESPONSE_INVALID')
    expect(() => readAuthorizationOperationResponse({ respCode: '40000' }, context)).toThrow('AUTHORIZATION_OPERATION_REJECTED')
  })

  it.each([
    { transactionId: '10001' }, { transactionId: undefined }, { paymentId: 'other' },
    { status: 'UNKNOWN' }, { paymentStatus: 'UNKNOWN' }, { orderAmount: '4.00' },
    { orderCurrency: 'EUR' },
  ])('rejects mismatched or uncorrelatable responses: %j', (data) => {
    expect(() => readAuthorizationOperationResponse(response(data), context)).toThrow('AUTHORIZATION_OPERATION_RESPONSE_INVALID')
  })

  it('requires only the fields needed for correlation and validates other fields when supplied', () => {
    expect(readAuthorizationOperationResponse(response({ orderAmount: undefined, orderCurrency: undefined, paymentStatus: undefined }), context)).toEqual({
      transactionId: '10002', paymentId: '20001', transactionStatus: 'S',
    })
  })

  it.each([
    { type: 'SALE' }, { originTransactionId: 'foreign-id' }, { paymentId: '' },
    { merchantTxnId: '' }, { merchantTxnId: 'x'.repeat(65) }, { amountMinor: 0 }, { currency: 'EUR' },
  ])('rejects an invalid persisted operation context: %j', (value) => {
    expect(() => buildAuthorizationOperationPayload(profile, { ...context, ...value } as AuthorizationOperationContext)).toThrow('AUTHORIZATION_OPERATION_INVALID')
  })
})
