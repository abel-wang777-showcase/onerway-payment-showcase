import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAuthorizationOperationPayload,
  buildCheckoutCreatePayload,
  executeAuthorizationOperation,
  queryAuthorization,
  readAuthorizationOperationResponse,
  signPayload,
  type AuthorizationOperationContext,
  type AuthorizationQueryContext,
} from '../server/utils/gateway'
import { getJourney } from '../shared/payment/journey'
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

afterEach(() => vi.unstubAllGlobals())

describe('authorization query compensation', () => {
  const queryContext: AuthorizationQueryContext = {
    txnType: 'CAPTURE', merchantTxnId: context.merchantTxnId,
    originTransactionId: context.originTransactionId,
    paymentId: context.paymentId, amountMinor: 500, currency: 'USD',
  }
  const transaction = (overrides: Record<string, unknown> = {}) => ({
    transactionId: '10002', paymentId: '20001', merchantTxnId: context.merchantTxnId,
    originTransactionId: '10001', appId: profile.appId, productType: 'CARD', subProductType: 'DIRECT',
    txnType: 'CAPTURE', status: 'S', orderAmount: '5.00', orderCurrency: 'USD', ...overrides,
  })
  const payment = (overrides: Record<string, unknown> = {}) => ({
    paymentId: '20001', lastTransactionId: '10002', merchantTxnId: context.merchantTxnId,
    appId: profile.appId, productType: 'CARD', subProductType: 'DIRECT',
    paymentStatus: 'S', orderAmount: '5.00', orderCurrency: 'USD', ...overrides,
  })
  const page = (record: Record<string, unknown>) => ({
    respCode: '20000', data: { content: [record], totalPages: 1, totalElements: 1 },
  })
  const mockQueries = (...responses: unknown[]) => {
    const fetch = vi.fn()
    for (const body of responses) fetch.mockResolvedValueOnce({ ok: true, json: async () => body })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it.each([
    ['AUTH', 'A'], ['CAPTURE', 'S'], ['VOID', 'N'],
  ] as const)('confirms %s only by matching transaction and current Payment facts', async (txnType, paymentStatus) => {
    const target = { ...queryContext, txnType, originTransactionId: txnType === 'AUTH' ? undefined : '10001' }
    const fetch = mockQueries(page(transaction({ txnType })), page(payment({ paymentStatus })))
    expect(await queryAuthorization(profile, target)).toEqual({
      source: 'query', txnType, transactionId: '10002', paymentId: '20001', merchantTxnId: target.merchantTxnId,
      amountMinor: 500, currency: 'USD', transactionStatus: 'S', paymentStatus,
    })
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      `${profile.apiBaseUrl}/v1/txn/list`, `${profile.apiBaseUrl}/v1/txn/queryPayments`,
    ])
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual(signPayload({
      current: '1', size: '10', merchantNo: profile.merchantNo, merchantTxnIds: target.merchantTxnId,
    }, profile.secret))
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual(signPayload({
      current: '1', size: '10', merchantNo: profile.merchantNo, paymentId: '20001',
    }, profile.secret))
  })

  it('discovers the AUTH identifiers after a lost create response, without a create or operation call', async () => {
    mockQueries(page(transaction({ txnType: 'AUTH' })), page(payment({ paymentStatus: 'A' })))
    expect(await queryAuthorization(profile, {
      ...queryContext, txnType: 'AUTH', paymentId: undefined, transactionId: undefined, originTransactionId: undefined,
    })).toMatchObject({ transactionId: '10002', paymentId: '20001', paymentStatus: 'A' })
  })

  it.each(['F', 'P', 'R', 'N', 'I', 'U'])('keeps transaction %s unresolved and sends no funding request', async (status) => {
    const fetch = mockQueries(page(transaction({ status })))
    expect(await queryAuthorization(profile, queryContext)).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['A', 'O', 'P', 'N'])('does not manufacture captured funds from Payment %s', async (paymentStatus) => {
    mockQueries(page(transaction()), page(payment({ paymentStatus })))
    expect(await queryAuthorization(profile, queryContext)).toBeUndefined()
  })

  it('does not revive a historic successful AUTH after its Payment moved on', async () => {
    mockQueries(page(transaction({ txnType: 'AUTH' })), page(payment({ lastTransactionId: '10003' })))
    await expect(queryAuthorization(profile, { ...queryContext, txnType: 'AUTH', originTransactionId: undefined }))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_QUERY_CONFLICT', target: {
        txnType: 'AUTH', merchantTxnId: context.merchantTxnId, paymentId: '20001', transactionId: '10002',
      } })
  })

  it.each([
    { paymentStatus: 'S' }, { paymentStatus: 'N' },
    { paymentStatus: 'A', lastTransactionId: '10003', merchantTxnId: 'external-operation' },
  ])('distinguishes a reliable loss of the current AUTH hold from an unavailable query: %j', async (current) => {
    mockQueries(page(transaction({ txnType: 'AUTH' })), page(payment(current)))
    await expect(queryAuthorization(profile, { ...queryContext, txnType: 'AUTH', originTransactionId: undefined }))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_QUERY_CONFLICT' })
  })

  it('never turns an unrelated Payment into an authorization conflict observation', async () => {
    mockQueries(page(transaction({ txnType: 'AUTH' })), page(payment({ paymentId: '20002', paymentStatus: 'N' })))
    await expect(queryAuthorization(profile, { ...queryContext, txnType: 'AUTH', originTransactionId: undefined }))
      .rejects.toMatchObject({ code: 'PAYMENT_QUERY_RESPONSE_INVALID' })
  })

  it.each([
    { transactionId: 'invalid' }, { paymentId: '20002' }, { merchantTxnId: 'other' },
    { originTransactionId: '10003' }, { txnType: 'SALE' }, { orderAmount: '6.00' },
    { orderCurrency: 'EUR' }, { appId: 'other-app' }, { subProductType: 'TOKEN' },
    { productType: 'LPMS' }, { merchantNo: 'other-merchant' }, { status: 'UNKNOWN' },
  ])('rejects an unrelated transaction before querying Payment: %j', async (overrides) => {
    const fetch = mockQueries(page(transaction(overrides)))
    await expect(queryAuthorization(profile, queryContext)).rejects.toMatchObject({ code: 'PAYMENT_QUERY_RESPONSE_INVALID' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    { paymentId: '20002' }, { lastTransactionId: '10001' }, { merchantTxnId: 'other' },
    { appId: 'other-app' }, { orderAmount: '4.00' }, { orderCurrency: 'EUR' },
    { paymentStatus: 'UNKNOWN' }, { paymentStatus: undefined },
  ])('rejects a mismatched current Payment: %j', async (overrides) => {
    mockQueries(page(transaction()), page(payment(overrides)))
    await expect(queryAuthorization(profile, queryContext)).rejects.toMatchObject({ code: 'PAYMENT_QUERY_RESPONSE_INVALID' })
  })

  it.each([
    { respCode: '50134' },
    { respCode: '20000', data: { content: [] } },
    { respCode: '20000', data: { content: [transaction()] } },
    { respCode: '20000', data: { content: [transaction(), transaction()] } },
    { respCode: '20000', data: { content: [transaction()], totalPages: 2 } },
  ])('rejects empty, denied, or ambiguous query results without claiming failure: %j', async (body) => {
    mockQueries(body)
    await expect(queryAuthorization(profile, queryContext)).rejects.toBeInstanceOf(Error)
  })

  it('requires known operation identity and preserves the known operation transaction ID', async () => {
    const fetch = mockQueries(page(transaction()))
    await expect(queryAuthorization(profile, { ...queryContext, originTransactionId: undefined })).rejects.toBeInstanceOf(Error)
    expect(fetch).not.toHaveBeenCalled()
    await expect(queryAuthorization(profile, { ...queryContext, transactionId: '10003' })).rejects.toBeInstanceOf(Error)
  })
})

it('creates only the fixed hosted authorization journey as CARD DIRECT AUTH', () => {
  const journey = getJourney('hosted-authorization')
  const payload = buildCheckoutCreatePayload(profile, {
    merchantTxnId: 'auth-1', merchantCustId: 'customer-1', returnUrl: `${profile.showcaseOrigin}/halden/return/order-1`,
    order: {
      id: 'order-1', scene: 'ecommerce', createdAt: '2026-09-18T00:00:00.000Z', fulfillment: 'pending',
      amount: { minor: 500, currency: 'USD' },
      item: { sku: journey.sku, name: journey.item, variant: journey.variant, quantity: 1, unitAmount: { minor: 500, currency: 'USD' } },
    },
  })
  expect(payload).toMatchObject({ productType: 'CARD', subProductType: 'DIRECT', txnType: 'AUTH', orderAmount: '5.00' })
})

it('signs and sends the persisted authorization operation exactly once', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response() })
  vi.stubGlobal('fetch', fetch)
  await executeAuthorizationOperation(profile, context)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]?.[0]).toBe(`${profile.apiBaseUrl}/v1/txn/authPayment`)
  expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual(signPayload(buildAuthorizationOperationPayload(profile, context), profile.secret))
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
