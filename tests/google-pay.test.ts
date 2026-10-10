import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildGooglePayPayload, createGooglePayPayment, readGooglePayCreateResponse, readGooglePayQueryResponse, consultGooglePay, readGooglePayConfiguration } from '../server/utils/google-pay'
import { signPayload } from '../server/utils/gateway'
import { readProfile } from '../server/utils/profile'
import { googlePayTokenInfo, readGooglePayToken, readGooglePayRedirectUrl } from '../shared/payment/google-pay'
import type { Order } from '../shared/payment/order'

const profile = readProfile({
  ONERWAY_PROFILE: 'sandbox', ONERWAY_SANDBOX_BASE_URL: 'https://sandbox-acq.onerway.com',
  ONERWAY_SANDBOX_SDK_URL: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js',
  ONERWAY_SHOWCASE_ORIGIN: 'https://showcase.example',
  ONERWAY_SANDBOX_NOTIFY_URL: 'https://showcase.example/api/webhooks/onerway/payment',
  ONERWAY_SANDBOX_MERCHANT_NO: 'synthetic-merchant', ONERWAY_SANDBOX_APP_ID: 'synthetic-app',
  ONERWAY_SANDBOX_SECRET: 'synthetic-secret',
})
const order: Order = {
  id: 'order', scene: 'ecommerce', amount: { minor: 500, currency: 'USD' },
  item: { sku: 'test', name: 'Test', variant: 'test', quantity: 1, unitAmount: { minor: 500, currency: 'USD' } },
  fulfillment: 'pending', createdAt: '2026-10-09T00:00:00Z',
}
const method = { paymentMethod: 'GooglePay', countryCode: 'US', gatewayName: 'synthetic', gatewayMerchantId: 'synthetic-gateway-merchant', subCardTypes: ['VISA', 'MASTERCARD'] }
const response = (data: unknown) => ({ respCode: '20000', data })
afterEach(() => vi.unstubAllGlobals())

describe('Google Pay gateway preparation', () => {
  it('uses the unique actual gateway record and excludes unrelated response fields', () => {
    const config = readGooglePayConfiguration(response([{ ...method, secret: 'do-not-expose', merchantId: 'do-not-infer-google-account', paymentMethodDetail: { token: 'do-not-expose' } }]), profile, order)
    expect(config).toEqual({ environment: 'TEST', gateway: method.gatewayName, gatewayMerchantId: method.gatewayMerchantId,
      allowedCardNetworks: method.subCardTypes, allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], countryCode: 'US', currencyCode: 'USD', totalPrice: '5.00' })
  })

  it.each([[], [method, method], [{ ...method, paymentMethod: 'ApplePay' }]].map(data => ({ data })))('rejects absent or ambiguous Google Pay records', ({ data }) => {
    expect(() => readGooglePayConfiguration(response(data), profile, order)).toThrow('GOOGLE_PAY_UNAVAILABLE')
  })

  it.each([{ countryCode: 'GB' }, { gatewayName: 'example' }, { gatewayName: 'https://example.test' },
    { gatewayMerchantId: '' }, { subCardTypes: [] }, { subCardTypes: ['VISA', 'UNKNOWN'] }])('rejects unusable configuration', (change) => {
    expect(() => readGooglePayConfiguration(response([{ ...method, ...change }]), profile, order)).toThrow('GOOGLE_PAY_CONFIGURATION_INVALID')
  })

  it('rejects production and changed order amounts before any upstream call', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const production = readProfile({ ONERWAY_PROFILE: 'production', ONERWAY_PRODUCTION_BASE_URL: 'https://acq.onerway.com' })
    await expect(consultGooglePay(production, order)).rejects.toThrow('PROFILE_PRODUCTION_LOCKED')
    await expect(consultGooglePay(profile, { ...order, amount: { minor: 501, currency: 'USD' } })).rejects.toThrow('PAYMENT_ORDER_INVALID')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('queries only the fixed Sandbox context with existing signing and no create request', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response([method]) })
    vi.stubGlobal('fetch', fetch)
    await consultGooglePay(profile, order)
    expect(fetch).toHaveBeenCalledOnce()
    const [url, options] = fetch.mock.calls[0]!
    expect(url).toBe('https://sandbox-acq.onerway.com/v1/txn/consultPaymentMethod')
    expect(options.redirect).toBe('error')
    expect(JSON.parse(options.body)).toEqual(signPayload({ merchantNo: 'synthetic-merchant', appId: 'synthetic-app',
      country: 'US', orderAmount: '5.00', orderCurrency: 'USD', paymentMode: 'WEB', subProductType: 'DIRECT' }, 'synthetic-secret'))
  })

  it('never exposes upstream error bodies or raw transport errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sensitive-upstream-material')))
    await expect(consultGooglePay(profile, order)).rejects.toThrow(/^GOOGLE_PAY_NETWORK_ERROR$/)
  })
})

describe('Google Pay wire token', () => {
  it.each(['opaque-synthetic-token', '  { "signature": "synthetic", "message": "中文" }  ', 'synthetic "quote" \\ slash\nline'])('retains original string bytes through signing', (token) => {
    const wire = signPayload({ tokenInfo: googlePayTokenInfo(token) }, 'synthetic-secret')
    expect(JSON.parse(wire.tokenInfo!)).toEqual({ provider: 'GooglePay', tokenId: token })
    expect(readGooglePayToken(token)).toBe(token)
  })

  it.each([null, {}, 123, '', '  ', 'é'.repeat(32_769)])('rejects invalid and oversized tokens', (token) => {
    expect(() => googlePayTokenInfo(token)).toThrow(/^GOOGLE_PAY_TOKEN_INVALID$/)
  })

  it('measures the token limit in UTF-8 bytes', () => {
    const token = 'é'.repeat(32_768)
    expect(readGooglePayToken(token)).toBe(token)
  })
})

const createContext = { merchantTxnId: 'merchant-txn', merchantCustId: 'customer', order, returnUrl: 'https://showcase.example/return', transactionIp: '203.0.113.1', accept: '*/*', javaEnabled: false, colorDepth: '24', screenHeight: '800', screenWidth: '1200', timeZoneOffset: '0', contentLength: '0', language: 'en', userAgent: 'Test', token: '  {"signedMessage":"sensitive-token"}  ' }
const queryContext = { appId: 'synthetic-app', merchantTxnId: 'merchant-txn', amountMinor: 500, currency: 'USD' }
const txn = { merchantTxnId: 'merchant-txn', transactionId: 'txn', orderAmount: '5.00', orderCurrency: 'USD', status: 'S', txnType: 'SALE', subProductType: 'DIRECT' }
const sandboxProfile = profile as Extract<typeof profile, { profile: 'sandbox' }>


const hostedUrl = (returnUrl = createContext.returnUrl) => `https://sandbox-checkout.onerway.com/additional-information?name=%7B%7D&returnUrl=${encodeURIComponent(returnUrl)}&key=synthetic-hosted-key`

describe('Google Pay hosted action URL', () => {
  it('preserves the opaque link only for the exact hosted route and expected return URL', () => {
    expect(readGooglePayRedirectUrl(hostedUrl(), createContext.returnUrl)).toBe(hostedUrl())
    expect(readGooglePayRedirectUrl(hostedUrl())).toBe(hostedUrl())
  })
  it.each([
    undefined, '', 'javascript:alert(1)', hostedUrl().replace('https:', 'http:'),
    hostedUrl().replace('.com/', '.com.evil.example/'), hostedUrl().replace('.com/', '.com:8443/'),
    hostedUrl().replace('sandbox-checkout', 'user:password@sandbox-checkout'),
    hostedUrl().replace('/additional-information?', '/additional-information/other?'),
    hostedUrl() + '#fragment', hostedUrl() + '&returnUrl=https%3A%2F%2Fevil.example',
    hostedUrl() + '&key=another', hostedUrl().replace('key=synthetic-hosted-key', 'key='),
    hostedUrl().replace('&key=synthetic-hosted-key', ''), hostedUrl('https://other.example/return'),
    hostedUrl('javascript:alert(1)'), hostedUrl('https://user:password@showcase.example/return'),
    hostedUrl('https://showcase.example/return#fragment'), hostedUrl().replace('https:', 'https:\n'),
  ])('rejects invalid or mismatched links without throwing or echoing them', (url) => {
    expect(readGooglePayRedirectUrl(url, createContext.returnUrl)).toBeUndefined()
  })
})

describe('Google Pay Direct transaction', () => {
  it('sends Google token string verbatim and exposes only a safe request projection', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => response(txn) })
    vi.stubGlobal('fetch', fetch)
    const result = await createGooglePayPayment(sandboxProfile, createContext)
    const sent = JSON.parse(fetch.mock.calls[0]![1].body)
    expect(JSON.parse(sent.tokenInfo)).toEqual({ provider: 'GooglePay', tokenId: createContext.token })
    expect(sent).toMatchObject({ productType: 'CARD', subProductType: 'DIRECT', txnType: 'SALE', orderAmount: '5.00' })
    expect(result.evidence.request).not.toContain('sensitive-token')
    expect(result.evidence.request).not.toContain(sandboxProfile.secret)
    expect(result.evidence.request).not.toContain(sent.sign)
    expect(result.evidence.request).not.toContain(createContext.transactionIp)
    expect(() => buildGooglePayPayload(sandboxProfile, { ...createContext, token: {} })).toThrow()
  })
  it('retains R without provider IDs and drops all action and token material', () => {
    const result = readGooglePayCreateResponse(response({ merchantTxnId: 'merchant-txn', status: 'R', actionType: 'RedirectURL', transactionId: null, paymentId: null, actionURL: 'https://unverified.example/secret', token: 'secret' }), 'synthetic-merchant', queryContext)
    expect(result).toEqual({ merchantTxnId: 'merchant-txn', rawStatus: 'R', status: 'requires_action' })
    for (const change of [{ status: 'S' }, { merchantTxnId: 'other' }, { paymentId: 'payment' }]) {
      expect(() => readGooglePayCreateResponse(response({ merchantTxnId: 'merchant-txn', status: 'R', actionType: 'RedirectURL', transactionId: null, paymentId: null, ...change }), 'synthetic-merchant', queryContext)).toThrow('GOOGLE_PAY_RESPONSE_INVALID')
    }
  })
  it.each([undefined, 'RedirectURL', 'Other'])('accepts R plus redirectUrl without depending on actionType %s', (actionType) => {
    const value = response({ merchantTxnId: 'merchant-txn', status: 'R', redirectUrl: hostedUrl(), actionType })
    expect(readGooglePayCreateResponse(value, 'synthetic-merchant', queryContext, createContext.returnUrl)).toEqual({ merchantTxnId: 'merchant-txn', rawStatus: 'R', status: 'requires_action', redirectUrl: hostedUrl() })
    expect(readGooglePayCreateResponse(value, 'synthetic-merchant', queryContext)).not.toHaveProperty('redirectUrl')
    expect(readGooglePayCreateResponse(value, 'synthetic-merchant', queryContext, 'https://wrong.example')).not.toHaveProperty('redirectUrl')
  })
  it('forwards a verified hosted URL transiently but excludes it from evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => response({ merchantTxnId: 'merchant-txn', status: 'R', redirectUrl: hostedUrl() }) }))
    const result = await createGooglePayPayment(sandboxProfile, createContext)
    expect(result.redirectUrl).toBe(hostedUrl())
    expect(result.evidence.request).not.toContain('synthetic-hosted-key')
    expect(result.evidence.request).not.toContain('additional-information')
  })
  it('never exposes a redirect on a non-action response', () => {
    expect(readGooglePayCreateResponse(response({ ...txn, redirectUrl: hostedUrl() }), 'synthetic-merchant', queryContext, createContext.returnUrl)).not.toHaveProperty('redirectUrl')
  })
  it('requires unique correlated query and attributes only Google Pay', () => {
    const query = (rows: unknown[]) => response({ content: rows })
    expect(readGooglePayQueryResponse(query([{ ...txn, walletTypeName: 'GooglePay', paymentMethod: 'VISA' }]), 'synthetic-merchant', queryContext)).toMatchObject({ status: 'succeeded', actualWallet: 'google-pay', fundingNetwork: 'VISA' })
    expect(readGooglePayQueryResponse(query([{ ...txn, walletTypeName: 'ApplePay', paymentMethod: 'VISA' }]), 'synthetic-merchant', queryContext)).not.toHaveProperty('actualWallet')
    for (const change of [{ merchantNo: 'other' }, { appId: 'other' }, { orderAmount: '6.00' }, { orderCurrency: 'EUR' }, { txnType: 'AUTH' }, { subProductType: 'TOKEN' }, { transactionId: null }]) {
      expect(() => readGooglePayQueryResponse(query([{ ...txn, ...change }]), 'synthetic-merchant', queryContext)).toThrow('GOOGLE_PAY_RESPONSE_INVALID')
    }
    expect(() => readGooglePayQueryResponse(query([txn, txn]), 'synthetic-merchant', queryContext)).toThrow('GOOGLE_PAY_RESPONSE_INVALID')
    expect(() => readGooglePayQueryResponse(query([txn]), 'synthetic-merchant', { ...queryContext, transactionId: 'other' })).toThrow('GOOGLE_PAY_RESPONSE_INVALID')
  })
  it.each([['S', 'succeeded'], ['F', 'failed'], ['N', 'cancelled'], ['R', 'requires_action'], ['P', 'processing'], ['U', 'processing'], ['I', 'processing']])('maps transaction %s independently of Payment status', (status, mapped) => {
    expect(readGooglePayCreateResponse(response({ ...txn, status, paymentStatus: 'S' }), 'synthetic-merchant', queryContext).status).toBe(mapped)
  })
})
