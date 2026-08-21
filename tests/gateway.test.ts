import { describe, expect, it } from 'vitest'
import { createOrder } from '../shared/payment/order'
import {
  buildCreatePayload,
  buildCreationQueryPayload,
  buildPaymentMethodQueryPayload,
  buildQueryPayload,
  createQueryExpiry,
  createQueryToken,
  normalizePayload,
  QUERY_TOKEN_TTL_MS,
  readCreateResponse,
  readCreationQueryResponse,
  readPaymentMethodQueryResponse,
  readQueryResponse,
  signPayload,
  verifyQueryToken,
} from '../server/utils/gateway'
import type { ServerProfile } from '../server/utils/profile'

const profile = {
  profile: 'sandbox',
  apiBaseUrl: 'https://sandbox-acq.onerway.com',
  sdkUrl: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js',
  showcaseOrigin: 'https://showcase.example',
  notifyUrl: 'https://showcase.example/api/webhooks/onerway/payment',
  transactionIp: null,
  merchantNo: 'merchant',
  appId: 'app',
  secret: 'secret',
  transactionPolicy: 'sandbox-only',
} satisfies ServerProfile

function fixtureOrder(amount: 500 | 5_000) {
  return createOrder({
    id: `order-${amount}`,
    scene: 'ecommerce',
    item: {
      sku: amount === 500 ? 'HL-SAMPLE-005' : 'HL-SAMPLE-050',
      name: 'Halden sample',
      variant: amount === 500 ? 'Travel size' : 'Full size',
      quantity: 1,
      unitAmount: { minor: amount, currency: 'USD' },
    },
    amount: { minor: amount, currency: 'USD' },
    createdAt: '2026-08-04T00:00:00.000Z',
  })
}

describe('Onerway gateway boundary', () => {
  it('normalizes nested fields inside-out and signs the exact wire values', () => {
    const payload = {
      z: 'last',
      a: 'first',
      nested: {
        appId: 'app',
        products: [{ currency: 'USD', price: '5.00' }],
      },
      empty: '',
      nil: null,
      sign: 'ignored',
    }

    expect(normalizePayload(payload)).toEqual({
      z: 'last',
      a: 'first',
      nested: '{"appId":"app","products":"[{\\"currency\\":\\"USD\\",\\"price\\":\\"5.00\\"}]"}',
    })
    expect(signPayload(payload, 'secret').sign).toBe(
      '7037dfbd20a6e54890f8e0a1f947ef6568dc17a80e67ef6aed5142259e700ff0',
    )
  })

  it('builds the fixed USD 5.00 create fixture without an SDK redirectUrl', () => {
    const payload = buildCreatePayload(profile, {
      merchantTxnId: 'showcase-id',
      merchantCustId: 'cust_AbC_123-x',
      order: fixtureOrder(500),
      returnUrl: 'https://showcase.example/',
      transactionIp: '203.0.113.10',
      accept: '*/*',
      javaEnabled: false,
      colorDepth: '24',
      screenHeight: '844',
      screenWidth: '390',
      timeZoneOffset: '-480',
      contentLength: '1234',
      language: 'en-US',
      userAgent: 'Browser',
    })
    const order = payload.txnOrderMsg as Record<string, unknown>

    expect(payload).toMatchObject({
      orderAmount: '5.00',
      orderCurrency: 'USD',
      merchantCustId: 'cust_AbC_123-x',
      paymentMode: 'WEB',
      productType: 'ALL',
      subProductType: 'DIRECT',
      txnType: 'SALE',
    })
    expect(order).toMatchObject({
      returnUrl: 'https://showcase.example/',
      notifyUrl: profile.notifyUrl,
      appId: profile.appId,
    })
    expect(order).not.toHaveProperty('redirectUrl')
    expect(JSON.stringify(payload)).not.toContain('TOKEN')
    expect(JSON.stringify(payload)).not.toContain(profile.secret)
  })

  it('builds the server-selected USD 50.00 3DS fixture with the same DEFAULT strategy', () => {
    const payload = buildCreatePayload(profile, {
      merchantTxnId: 'showcase-3ds',
      merchantCustId: 'cust_3DS_123',
      order: fixtureOrder(5_000),
      returnUrl: 'https://showcase.example/halden/return/order-5000',
      transactionIp: '203.0.113.10',
      accept: '*/*',
      javaEnabled: false,
      colorDepth: '24',
      screenHeight: '844',
      screenWidth: '390',
      timeZoneOffset: '-480',
      contentLength: '1234',
      language: 'en-US',
      userAgent: 'Browser',
    })
    const message = payload.txnOrderMsg as Record<string, unknown>

    expect(payload).toMatchObject({
      orderAmount: '50.00',
      orderCurrency: 'USD',
      risk3dsStrategy: 'DEFAULT',
    })
    expect(message.returnUrl).toBe('https://showcase.example/halden/return/order-5000')
    expect(message.products).toEqual([{
      currency: 'USD',
      name: 'Halden sample',
      num: '1',
      price: '50.00',
    }])
  })

  it('rejects self-consistent orders outside the server journey allowlist', () => {
    const context = {
      merchantTxnId: 'showcase-unlisted',
      merchantCustId: 'cust_unlisted',
      order: createOrder({
        id: 'order-700',
        scene: 'ecommerce',
        item: {
          sku: 'HL-SAMPLE-007',
          name: 'Halden sample',
          variant: 'Merchant defined',
          quantity: 1,
          unitAmount: { minor: 700, currency: 'USD' },
        },
        amount: { minor: 700, currency: 'USD' },
        createdAt: '2026-08-04T00:00:00.000Z',
      }),
      returnUrl: 'https://showcase.example/halden/return/order-700',
      transactionIp: '203.0.113.10',
      accept: '*/*',
      javaEnabled: false,
      colorDepth: '24',
      screenHeight: '844',
      screenWidth: '390',
      timeZoneOffset: '-480',
      contentLength: '1234',
      language: 'en-US',
      userAgent: 'Browser',
    } as const

    expect(() => buildCreatePayload(profile, context)).toThrow('PAYMENT_ORDER_INVALID')
    expect(() => buildCreatePayload(profile, {
      ...context,
      order: { ...fixtureOrder(5_000), item: { ...fixtureOrder(5_000).item, sku: 'wrong' } },
    })).toThrow('PAYMENT_ORDER_INVALID')
  })

  it('accepts only an initial U create response and a matched Payment query record', () => {
    expect(readCreateResponse({
      respCode: '20000',
      data: {
        transactionId: '9000000000000000001',
        paymentId: '9000000000000000002',
        status: 'U',
        cardInfo: { number: 'must-not-pass-through' },
      },
    })).toEqual({
      transactionId: '9000000000000000001',
      paymentId: '9000000000000000002',
      rawStatus: 'U',
    })

    expect(readQueryResponse({
      respCode: '20000',
      data: {
        content: [
          { paymentId: 'other', paymentStatus: 'N' },
          {
            paymentId: '9000000000000000002',
            paymentStatus: 'S',
            lastTransactionId: '9000000000000000003',
            cardInfo: 'ignored',
          },
        ],
      },
    }, '9000000000000000002')).toEqual({
      paymentId: '9000000000000000002',
      transactionId: '9000000000000000003',
      rawStatus: 'S',
      status: 'succeeded',
    })
  })

  it('rejects malformed provider identifiers at the create and query boundaries', () => {
    expect(() => readCreateResponse({
      respCode: '20000',
      data: {
        transactionId: 'transaction-1',
        paymentId: '9000000000000000002',
        status: 'U',
      },
    })).toThrow('PAYMENT_CREATE_RESPONSE_INVALID')

    expect(() => readQueryResponse({
      respCode: '20000',
      data: {
        content: [{
          paymentId: '9000000000000000002',
          paymentStatus: 'S',
          lastTransactionId: 'transaction-2',
        }],
      },
    }, '9000000000000000002')).toThrow('PAYMENT_QUERY_RESPONSE_INVALID')
  })

  it('whitelists an exact merchant transaction when recovering an unknown create result', () => {
    expect(buildCreationQueryPayload(profile, 'showcase-id')).toEqual({
      current: '1',
      merchantNo: 'merchant',
      merchantTxnIds: 'showcase-id',
      size: '10',
    })
    expect(readCreationQueryResponse({
      respCode: '20000',
      data: {
        content: [{
          merchantTxnId: 'showcase-id',
          paymentId: '9000000000000000001',
          transactionId: '9000000000000000002',
          status: 'U',
          orderAmount: '5.00',
          orderCurrency: 'USD',
          cardNumber: 'must-not-pass-through',
        }],
      },
    }, 'showcase-id', 500, 'USD')).toEqual({
      paymentId: '9000000000000000001',
      transactionId: '9000000000000000002',
      rawStatus: 'U',
      status: 'processing',
    })
  })

  it('rejects ambiguous or mismatched creation recovery records', () => {
    const record = {
      merchantTxnId: 'showcase-id',
      paymentId: '9000000000000000001',
      transactionId: '9000000000000000002',
      status: 'U',
      orderAmount: '5.00',
      orderCurrency: 'USD',
    }

    expect(() => readCreationQueryResponse({
      respCode: '20000',
      data: { content: [{ ...record, orderAmount: '50.00' }] },
    }, 'showcase-id', 500, 'USD')).toThrow('PAYMENT_CREATION_QUERY_RESPONSE_INVALID')
    expect(() => readCreationQueryResponse({
      respCode: '20000',
      data: { content: [record, record] },
    }, 'showcase-id', 500, 'USD')).toThrow('PAYMENT_CREATION_QUERY_RESPONSE_INVALID')
  })

  it('never treats transaction-list terminal status as Payment terminal truth', () => {
    const record = {
      merchantTxnId: 'showcase-id',
      paymentId: '9000000000000000001',
      transactionId: '9000000000000000002',
      orderAmount: '5.00',
      orderCurrency: 'USD',
    }

    expect(readCreationQueryResponse({
      respCode: '20000',
      data: { content: [{ ...record, status: 'S' }] },
    }, 'showcase-id', 500, 'USD').status).toBe('processing')
    expect(readCreationQueryResponse({
      respCode: '20000',
      data: { content: [{ ...record, status: 'N' }] },
    }, 'showcase-id', 500, 'USD').status).toBe('processing')
  })

  it('strictly attributes a DIRECT Google Pay transaction without retaining provider payload', () => {
    const transactionId = '9000000000000000003'
    const paymentId = '9000000000000000002'

    expect(buildPaymentMethodQueryPayload(profile, transactionId)).toEqual({
      current: '1',
      merchantNo: 'merchant',
      size: '10',
      transactionIds: transactionId,
    })
    expect(readPaymentMethodQueryResponse({
      respCode: '20000',
      data: {
        content: [{
          transactionId,
          paymentId,
          subProductType: 'DIRECT',
          txnType: 'SALE',
          walletTypeName: 'GooglePay',
          paymentMethod: 'Visa',
          cardNumber: '411111******1111',
          paymentMethodDetails: { card: { number: 'must-not-pass-through' } },
        }],
      },
    }, paymentId, transactionId)).toEqual({
      paymentId,
      transactionId,
      actualWallet: 'google-pay',
      fundingNetwork: 'VISA',
    })
  })

  it('strictly attributes a DIRECT Apple Pay transaction and allows partial facts to converge later', () => {
    const transactionId = '9000000000000000004'
    const paymentId = '9000000000000000005'
    const base = {
      transactionId,
      paymentId,
      subProductType: 'DIRECT',
      txnType: 'SALE',
    }

    expect(readPaymentMethodQueryResponse({
      respCode: '20000',
      data: {
        content: [{
          ...base,
          walletTypeName: 'ApplePay',
          paymentMethod: 'Visa',
          paymentMethodDetails: { wallet: 'must-not-pass-through' },
        }],
      },
    }, paymentId, transactionId)).toEqual({
      paymentId,
      transactionId,
      actualWallet: 'apple-pay',
      fundingNetwork: 'VISA',
    })

    expect(readPaymentMethodQueryResponse({
      respCode: '20000',
      data: { content: [{ ...base, walletTypeName: 'ApplePay' }] },
    }, paymentId, transactionId)).toEqual({
      paymentId,
      transactionId,
      actualWallet: 'apple-pay',
    })
  })

  it('rejects ambiguous, cross-Payment and non-DIRECT method attribution', () => {
    const record = {
      transactionId: '9000000000000000003',
      paymentId: '9000000000000000002',
      subProductType: 'DIRECT',
      txnType: 'SALE',
      walletTypeName: 'GooglePay',
      paymentMethod: 'VISA',
    }

    expect(() => readPaymentMethodQueryResponse({
      respCode: '20000',
      data: { content: [record, record] },
    }, record.paymentId, record.transactionId)).toThrow('PAYMENT_METHOD_QUERY_RESPONSE_INVALID')
    expect(() => readPaymentMethodQueryResponse({
      respCode: '20000',
      data: { content: [{ ...record, paymentId: '9000000000000000009' }] },
    }, record.paymentId, record.transactionId)).toThrow('PAYMENT_METHOD_QUERY_RESPONSE_INVALID')
    expect(() => readPaymentMethodQueryResponse({
      respCode: '20000',
      data: { content: [{ ...record, subProductType: 'SUBSCRIBE' }] },
    }, record.paymentId, record.transactionId)).toThrow('PAYMENT_METHOD_QUERY_RESPONSE_INVALID')
    expect(() => readPaymentMethodQueryResponse({
      respCode: '20000',
      data: { content: [{ ...record, walletTypeName: 'UnknownWallet' }] },
    }, record.paymentId, record.transactionId)).toThrow('PAYMENT_METHOD_QUERY_RESPONSE_INVALID')
  })

  it('fails closed for unknown query statuses and rejected transport responses', () => {
    expect(() => readQueryResponse({
      respCode: '20000',
      data: { content: [{ paymentId: '9000000000000000002', paymentStatus: 'X' }] },
    }, '9000000000000000002')).toThrow('PAYMENT_QUERY_RESPONSE_INVALID')
    expect(() => readCreateResponse({ respCode: '20001' })).toThrow('PAYMENT_CREATE_REJECTED')
  })

  it('binds query capability to both attempt and Payment identifiers', () => {
    const now = Date.parse('2026-08-03T08:00:00.000Z')
    const expiresAt = createQueryExpiry(now)
    const token = createQueryToken(profile.secret, 'attempt-1', 'payment-1', expiresAt)

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(expiresAt).toBe('2026-08-03T08:05:00.000Z')
    expect(verifyQueryToken(profile.secret, 'attempt-1', 'payment-1', expiresAt, token, now)).toBe(true)
    expect(verifyQueryToken(profile.secret, 'attempt-2', 'payment-1', expiresAt, token, now)).toBe(false)
    expect(verifyQueryToken(
      profile.secret,
      'attempt-1',
      'payment-1',
      '2026-08-03T08:04:59.999Z',
      token,
      now,
    )).toBe(false)
    expect(buildQueryPayload(profile, 'payment-1')).toEqual({
      current: '1',
      merchantNo: 'merchant',
      paymentId: 'payment-1',
      size: '10',
    })
  })

  it('rejects expired, malformed and abnormally future query capabilities', () => {
    const now = Date.parse('2026-08-03T08:00:00.000Z')
    const expiredAt = new Date(now).toISOString()
    const futureAt = new Date(now + QUERY_TOKEN_TTL_MS + 31_000).toISOString()

    expect(verifyQueryToken(
      profile.secret,
      'attempt-1',
      'payment-1',
      expiredAt,
      createQueryToken(profile.secret, 'attempt-1', 'payment-1', expiredAt),
      now,
    )).toBe(false)
    expect(verifyQueryToken(
      profile.secret,
      'attempt-1',
      'payment-1',
      futureAt,
      createQueryToken(profile.secret, 'attempt-1', 'payment-1', futureAt),
      now,
    )).toBe(false)
    expect(verifyQueryToken(
      profile.secret,
      'attempt-1',
      'payment-1',
      'not-a-date',
      'a'.repeat(43),
      now,
    )).toBe(false)
  })
})
