import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApplePayPayload, createApplePayPayment, mapApplePayStatus, readApplePayConfiguration, readApplePayCreateResponse, readApplePayQueryResponse, readApplePayValidationUrl, validateApplePayMerchant } from '../server/utils/apple-pay'
import { signPayload } from '../server/utils/gateway'
import { readProfile, toPublicProfile } from '../server/utils/profile'
import type { Order } from '../shared/payment/order'

const { httpsRequest } = vi.hoisted(() => ({ httpsRequest: vi.fn() }))
vi.mock('node:https', () => ({ request: httpsRequest }))

const env = { ONERWAY_PROFILE: 'sandbox', ONERWAY_SANDBOX_BASE_URL: 'https://sandbox-acq.onerway.com', ONERWAY_SANDBOX_SDK_URL: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js', ONERWAY_SHOWCASE_ORIGIN: 'https://showcase.example', ONERWAY_SANDBOX_NOTIFY_URL: 'https://showcase.example/api/webhooks/onerway/payment', ONERWAY_SANDBOX_MERCHANT_NO: 'merchant', ONERWAY_SANDBOX_APP_ID: 'app', ONERWAY_SANDBOX_SECRET: 'secret', ONERWAY_SANDBOX_APPLE_PAY_MERCHANT_ID: 'merchant.example', ONERWAY_SANDBOX_APPLE_PAY_CERTIFICATE_PEM: '-----BEGIN CERTIFICATE-----\nsynthetic', ONERWAY_SANDBOX_APPLE_PAY_PRIVATE_KEY_PEM: '-----BEGIN PRIVATE KEY-----\nsynthetic' }
const profile = readProfile(env) as Extract<ReturnType<typeof readProfile>, { profile: 'sandbox' }>
const order: Order = { id: 'order', scene: 'ecommerce', item: { sku: 'test', name: 'Test', variant: 'test', quantity: 1, unitAmount: { minor: 500, currency: 'USD' } }, amount: { minor: 500, currency: 'USD' }, fulfillment: 'pending', createdAt: '2026-09-23T00:00:00Z' }
const token = { paymentData: { data: 'synthetic-encrypted', signature: 'synthetic', header: {}, version: 'EC_v1' }, paymentMethod: { network: 'Visa', type: 'debit', displayName: 'synthetic' }, transactionIdentifier: 'synthetic-id' }
const context = { merchantTxnId: 'merchant-txn', merchantCustId: 'customer', order, returnUrl: 'https://showcase.example/return', transactionIp: '203.0.113.1', accept: '*/*', javaEnabled: false, colorDepth: '24', screenHeight: '800', screenWidth: '1200', timeZoneOffset: '0', contentLength: '0', language: 'en', userAgent: 'Test', token }
const query = { appId: 'app', merchantTxnId: context.merchantTxnId, amountMinor: 500, currency: 'USD' }
const row = { merchantTxnId: context.merchantTxnId, transactionId: 'txn', orderAmount: '5.00', orderCurrency: 'USD', status: 'S', txnType: 'SALE', subProductType: 'DIRECT' }
const response = (content: unknown[]) => ({ respCode: '20000', data: { content } })
afterEach(() => vi.unstubAllGlobals())

describe('Apple Pay Direct gateway', () => {
  it('encodes the complete token exactly once at each required level', () => {
    const wire = signPayload(buildApplePayPayload(profile, context), 'secret')
    expect(wire).toMatchObject({ productType: 'CARD', subProductType: 'DIRECT', txnType: 'SALE', orderAmount: '5.00' })
    const info = JSON.parse(wire.tokenInfo!)
    expect(info.provider).toBe('ApplePay')
    expect(JSON.parse(info.tokenId)).toEqual(token)
    expect(JSON.parse(wire.txnOrderMsg!).transactionIp).toBe(context.transactionIp)
    expect(() => buildApplePayPayload(profile, { ...context, token: token.paymentData })).toThrow('APPLE_PAY_REQUEST_INVALID')
    expect(() => buildApplePayPayload(profile, { ...context, order: { ...order, amount: { minor: 501, currency: 'USD' } } })).toThrow('PAYMENT_ORDER_INVALID')
  })
  it.each([['S', 'succeeded'], ['F', 'failed'], ['N', 'cancelled'], ['P', 'processing'], ['I', 'processing'], ['U', 'processing'], ['R', 'requires_action']])('maps transaction %s independently of paymentStatus', (raw, status) => {
    expect(mapApplePayStatus(raw)).toBe(status)
    expect(readApplePayQueryResponse(response([{ ...row, status: raw, paymentStatus: 'S' }]), 'merchant', query).status).toBe(status)
  })
  it('rejects unknown statuses and never projects a redirect or raw payload', () => {
    expect(() => mapApplePayStatus('A')).toThrow('APPLE_PAY_RESPONSE_INVALID')
    expect(() => mapApplePayStatus('toString')).toThrow('APPLE_PAY_RESPONSE_INVALID')
    const result = readApplePayCreateResponse({ respCode: '20000', data: { ...row, status: 'R', redirectUrl: 'https://example.com', token } }, 'merchant', query)
    expect(result).toEqual({ merchantTxnId: query.merchantTxnId, transactionId: 'txn', rawStatus: 'R', status: 'requires_action' })
  })
  it('recovers without paymentId and requires a unique exact merchant transaction', () => {
    expect(readApplePayQueryResponse(response([row]), 'merchant', query).status).toBe('succeeded')
    expect(() => readApplePayQueryResponse(response([]), 'merchant', query)).toThrow('PAYMENT_QUERY_NOT_FOUND')
    expect(() => readApplePayQueryResponse(response([row, row]), 'merchant', query)).toThrow('APPLE_PAY_RESPONSE_INVALID')
    for (const change of [{ merchantNo: 'other' }, { appId: 'other' }, { productType: 'ALL' }, { txnType: undefined }, { subProductType: undefined }, { orderAmount: '6.00' }, { orderCurrency: 'EUR' }, { txnType: 'AUTH' }, { subProductType: 'SUBSCRIBE' }]) {
      expect(() => readApplePayQueryResponse(response([{ ...row, ...change }]), 'merchant', query)).toThrow('APPLE_PAY_RESPONSE_INVALID')
    }
    expect(() => readApplePayQueryResponse(response([row]), 'merchant', { ...query, transactionId: 'other' })).toThrow('APPLE_PAY_RESPONSE_INVALID')
  })
  it('uses provider country/networks and its own Merchant ID', () => {
    const config = readApplePayConfiguration({ respCode: '20000', data: [{ paymentMethod: 'ApplePay', productType: 'LPMS', countryCode: 'GB', subCardTypes: ['visa', 'masterCard'], merchantId: 'provider-merchant' }] }, profile, order)
    expect(config).toEqual({ merchantIdentifier: 'merchant.example', countryCode: 'GB', supportedNetworks: ['visa', 'masterCard'], currencyCode: 'USD', amount: '5.00' })
    expect(() => readApplePayConfiguration({ respCode: '20000', data: [] }, profile, order)).toThrow('APPLE_PAY_UNAVAILABLE')
  })
  it('does not retry a timed-out creation or expose the transport error', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('sensitive token'))
    vi.stubGlobal('fetch', fetch)
    await expect(createApplePayPayment(profile, context)).rejects.toThrow('APPLE_PAY_NETWORK_ERROR')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]![0]).toBe('https://sandbox-acq.onerway.com/v1/txn/doTransaction')
  })
})

describe('Apple merchant validation boundary', () => {
  it.each(['apple-pay-gateway-cert.apple.com', 'cn-apple-pay-gateway-cert.apple.com'])('accepts documented sandbox host %s', (host) => {
    for (const path of ['startSession', 'paymentSession']) expect(readApplePayValidationUrl(`https://${host}/paymentservices/${path}`).hostname).toBe(host)
  })
  it.each([
    'https://apple-pay-gateway.apple.com/paymentservices/paymentSession',
    'https://apple-pay-gateway-cert.apple.com.evil.test/paymentservices/paymentSession',
    'http://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession',
    'https://apple-pay-gateway-cert.apple.com:443/paymentservices/paymentSession',
    'https://apple-pay-gateway-cert.apple.com:8443/paymentservices/paymentSession',
    'https://user@apple-pay-gateway-cert.apple.com/paymentservices/paymentSession',
    'https://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession?x=1',
    'https://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession#x',
    'https://apple-pay-gateway-cert.apple.com/paymentservices/../paymentservices/paymentSession',
    'https://127.0.0.1/paymentservices/paymentSession',
    'https://apple-pay-gateway-cert.apple.com/other',
  ])('rejects URL %s before transport', async (url) => {
    expect(() => readApplePayValidationUrl(url)).toThrow('APPLE_PAY_VALIDATION_URL_INVALID')
    await expect(validateApplePayMerchant(profile, url)).rejects.toThrow('APPLE_PAY_VALIDATION_URL_INVALID')
  })
  it('keeps identity material private and rejects incomplete configuration', () => {
    expect(JSON.stringify(toPublicProfile(profile))).not.toMatch(/synthetic|merchant.example|certificate|privateKey/)
    expect(() => readProfile({ ...env, ONERWAY_SANDBOX_APPLE_PAY_PRIVATE_KEY_PEM: '' })).toThrow('PROFILE_APPLE_PAY_INVALID')
  })
})


describe('Apple mTLS transport', () => {
  const url = 'https://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession'
  function transport(statusCode: number, chunks: string[]) {
    const req = Object.assign(new EventEmitter(), { end: vi.fn() })
    httpsRequest.mockImplementation((_url, _options, callback) => {
      queueMicrotask(() => {
        const res = Object.assign(new EventEmitter(), { statusCode, destroy: vi.fn() })
        callback(res)
        for (const chunk of chunks) res.emit('data', Buffer.from(chunk))
        res.emit('end')
      })
      return req
    })
    return req
  }
  it('uses its configured identity, canonical domain and an absolute deadline', async () => {
    const session = { merchantSessionIdentifier: 'synthetic-session', signature: 'synthetic' }
    const req = transport(200, [JSON.stringify(session)])
    expect(await validateApplePayMerchant(profile, url)).toEqual(session)
    expect(httpsRequest.mock.lastCall?.[1]).toMatchObject({ cert: profile.applePay!.certificatePem, key: profile.applePay!.privateKeyPem, rejectUnauthorized: true, minVersion: 'TLSv1.2', signal: expect.any(AbortSignal) })
    expect(JSON.parse(req.end.mock.calls[0]![0])).toEqual({ merchantIdentifier: 'merchant.example', displayName: 'Halden', initiative: 'web', initiativeContext: 'showcase.example' })
  })
  it.each([301, 302, 307, 308, 500])('rejects HTTP %s without redirecting', async (status) => {
    transport(status, [])
    await expect(validateApplePayMerchant(profile, url)).rejects.toThrow('APPLE_PAY_VALIDATION_FAILED')
  })
  it.each(['x'.repeat(65_537), 'not-json', '[]', '{}'])('rejects oversized or malformed sessions', async (body) => {
    transport(200, [body])
    await expect(validateApplePayMerchant(profile, url)).rejects.toThrow('APPLE_PAY_VALIDATION_FAILED')
  })
  it('sanitizes certificate and network exceptions', async () => {
    httpsRequest.mockImplementation(() => { throw new Error('secret private key material') })
    await expect(validateApplePayMerchant(profile, url)).rejects.toThrow('APPLE_PAY_VALIDATION_FAILED')
  })
})
