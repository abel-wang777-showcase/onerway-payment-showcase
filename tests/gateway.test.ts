import { describe, expect, it, vi } from 'vitest'
import { createOrder } from '../shared/payment/order'
import { getJourney, type JourneyId } from '../shared/payment/journey'
import {
  buildCreatePayload,
  buildCheckoutCreatePayload,
  readCheckoutCreateResponse,
  readCheckoutQueryResponse,
  queryCheckoutPayment,
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

const checkoutOrder = createOrder({
  ...fixtureOrder(500),
  item: { ...fixtureOrder(500).item, sku: 'HL-CHECKOUT-005', variant: 'Hosted checkout' },
})

function checkoutFixture(journeyId: JourneyId) {
  const journey = getJourney(journeyId)
  return createOrder({
    id: journey.orderId,
    scene: journey.scene,
    item: {
      sku: journey.sku, name: journey.item, variant: journey.variant, quantity: 1,
      unitAmount: { minor: journey.amount, currency: journey.currency },
    },
    amount: { minor: journey.amount, currency: journey.currency },
    createdAt: '2026-09-14T00:00:00.000Z',
  })
}
const checkoutContext = {
  merchantTxnId: 'showcase-checkout', amountMinor: 500, currency: 'USD',
  transactionId: '9000000000000000002', paymentId: '9000000000000000001',
}
function checkoutQuery(overrides: Record<string, unknown> = {}) {
  return {
    respCode: '20000',
    data: { content: [{
      merchantTxnId: checkoutContext.merchantTxnId,
      transactionId: checkoutContext.transactionId,
      paymentId: checkoutContext.paymentId,
      orderAmount: '5.00', orderCurrency: 'USD', status: 'S',
      ...overrides,
    }] },
  }
}

describe('Hosted Checkout gateway boundary', () => {
  it.each([
    ['hosted-checkout', '5.00'],
    ['hosted-checkout-three-ds', '50.00'],
  ] as const)('builds %s from its fixed persisted Order', (journeyId, amount) => {
    const order = checkoutFixture(journeyId)
    const payload = buildCheckoutCreatePayload(profile, {
      merchantTxnId: checkoutContext.merchantTxnId, merchantCustId: 'cust_checkout',
      order,
      returnUrl: `https://showcase.example/halden/return/${order.id}`,
    })

    expect(payload).toMatchObject({
      merchantCustId: 'cust_checkout', orderAmount: amount, orderCurrency: 'USD', productType: 'ALL', subProductType: 'DIRECT', txnType: 'SALE',
      txnOrderMsg: {
        products: [{ currency: 'USD', name: order.item.name, num: '1', price: amount }],
        returnUrl: `https://showcase.example/halden/return/${order.id}`,
        notifyUrl: profile.notifyUrl,
      },
    })
    expect(payload).not.toHaveProperty('lpmsInfo')
    expect(payload).not.toHaveProperty('risk3dsStrategy')
    expect(payload).not.toHaveProperty('paymentMode')
  })

  it.each(['hosted-checkout', 'hosted-checkout-three-ds'] as const)(
    'rejects amount and product mutations of %s even when totals balance', (journeyId) => {
      const order = checkoutFixture(journeyId)
      const otherAmount = order.amount.minor === 500 ? 5_000 : 500
      const context = { merchantTxnId: checkoutContext.merchantTxnId, merchantCustId: 'cust_checkout', returnUrl: 'https://showcase.example' }
      for (const invalid of [
        { ...order, amount: { minor: otherAmount, currency: 'USD' as const }, item: { ...order.item, unitAmount: { minor: otherAmount, currency: 'USD' as const } } },
        { ...order, item: { ...order.item, sku: 'merchant-defined-product' } },
        { ...order, item: { ...order.item, quantity: 2, unitAmount: { minor: order.amount.minor / 2, currency: 'USD' as const } } },
      ]) {
        expect(() => buildCheckoutCreatePayload(profile, { ...context, order: invalid })).toThrow('PAYMENT_ORDER_INVALID')
      }
    },
  )

  it.each([500, 5_000] as const)('does not accept a USD %s SDK order through the Checkout adapter', (amount) => {
    expect(() => buildCheckoutCreatePayload(profile, {
      merchantTxnId: checkoutContext.merchantTxnId, merchantCustId: 'cust_checkout', order: fixtureOrder(amount), returnUrl: 'https://showcase.example',
    })).toThrow('PAYMENT_ORDER_INVALID')
  })

  it.each(['hosted-checkout', 'hosted-checkout-three-ds'] as const)('does not accept %s through the SDK adapter', (journeyId) => {
    expect(() => buildCreatePayload(profile, {
      merchantTxnId: checkoutContext.merchantTxnId, merchantCustId: 'cust_test',
      order: checkoutFixture(journeyId), returnUrl: 'https://showcase.example',
      transactionIp: '203.0.113.10', accept: '*/*', javaEnabled: false,
      colorDepth: '24', screenHeight: '844', screenWidth: '390', timeZoneOffset: '-480',
      contentLength: '1234', language: 'en-US', userAgent: 'Browser',
    })).toThrow('PAYMENT_ORDER_INVALID')
  })

  it('builds an aggregate one-time payment with required addresses but without browser, IP or a selected method', () => {
    const payload = buildCheckoutCreatePayload(profile, {
      merchantTxnId: checkoutContext.merchantTxnId, merchantCustId: 'cust_checkout',
      order: checkoutOrder,
      returnUrl: 'https://showcase.example/halden/return/order-500',
    })
    expect(payload).toEqual({
      billingInformation: { country: 'US', email: 'customer@test.com', province: 'CA' },
      shippingInformation: { country: 'US', email: 'customer@test.com', province: 'CA' },
      merchantNo: profile.merchantNo, merchantTxnId: checkoutContext.merchantTxnId, merchantCustId: 'cust_checkout',
      orderAmount: '5.00', orderCurrency: 'USD', productType: 'ALL',
      subProductType: 'DIRECT', txnType: 'SALE',
      txnOrderMsg: {
        appId: profile.appId, products: [{ currency: 'USD', name: 'Halden sample', num: '1', price: '5.00' }],
        returnUrl: 'https://showcase.example/halden/return/order-500', notifyUrl: profile.notifyUrl,
      },
    })
    expect(() => buildCheckoutCreatePayload(profile, {
      merchantTxnId: checkoutContext.merchantTxnId, merchantCustId: 'cust_checkout', order: fixtureOrder(500), returnUrl: 'https://showcase.example',
    })).toThrow('PAYMENT_ORDER_INVALID')
  })

  it.each(['', 'a'.repeat(64), 'with space', 'with.dot', '客户'])(
    'rejects an invalid server customer id %s before sending a Checkout request', (merchantCustId) => {
      expect(() => buildCheckoutCreatePayload(profile, {
        merchantTxnId: checkoutContext.merchantTxnId, merchantCustId,
        order: checkoutOrder, returnUrl: 'https://showcase.example/halden/return/order-500',
      })).toThrow('PAYMENT_ORDER_INVALID')
    },
  )

  it('requires the confirmed Sandbox redirect boundary before returning a created payment', () => {
    const response = { respCode: '20000', data: {
      transactionId: checkoutContext.transactionId, paymentId: checkoutContext.paymentId, status: 'U',
      redirectUrl: 'https://sandbox-checkout.onerway.com/checkout?token=ephemeral',
    } }
    expect(readCheckoutCreateResponse(response).redirectUrl).toBe(response.data.redirectUrl)
    expect(() => readCheckoutCreateResponse({ ...response, data: { ...response.data, redirectUrl: 'https://evil.example/checkout' } }))
      .toThrow('PAYMENT_CREATE_RESPONSE_INVALID')
  })

  it.each([['S', 'succeeded'], ['N', 'cancelled'], ['F', 'processing'], ['R', 'requires_action']])(
    'uses transaction %s conservatively as %s', (rawStatus, status) => {
      expect(readCheckoutQueryResponse(checkoutQuery({ status: rawStatus }), profile.merchantNo, checkoutContext))
        .toMatchObject({ status, transactionStatus: rawStatus, merchantTxnId: checkoutContext.merchantTxnId })
    },
  )

  it('accepts a cancelled checkout without manufacturing a Payment ID', () => {
    const result = readCheckoutQueryResponse(checkoutQuery({ status: 'N', paymentId: undefined }), profile.merchantNo, {
      ...checkoutContext, paymentId: undefined,
    })
    expect(result.status).toBe('cancelled')
    expect(result).not.toHaveProperty('paymentId')
  })

  it('keeps a failed transaction with an open Payment processing', () => {
    expect(readCheckoutQueryResponse(checkoutQuery({ status: 'F', paymentStatus: 'O' }), profile.merchantNo, checkoutContext))
      .toMatchObject({ status: 'processing', transactionStatus: 'F', paymentStatus: 'O' })
  })

  it.each([
    { transactionId: '999' }, { paymentId: '999' }, { merchantNo: 'another-merchant' },
    { orderAmount: '50.00' }, { orderCurrency: 'EUR' }, { status: 'UNKNOWN' }, { txnType: 'REFUND' },
    { paymentId: undefined }, { paymentId: undefined, status: 'N', paymentStatus: 'S' },
    { paymentId: undefined, status: 'N', paymentStatus: 'N' },
    { paymentId: undefined, status: 'N', paymentStatus: 'O' }, { paymentId: 123, status: 'N' }, { paymentId: '', status: 'N' }, { paymentStatus: 123 },
  ])('rejects mismatched or unproven transaction data %#', (override) => {
    expect(() => readCheckoutQueryResponse(checkoutQuery(override), profile.merchantNo, checkoutContext))
      .toThrow('PAYMENT_QUERY_RESPONSE_INVALID')
  })

  it('rejects ambiguous merchant transaction matches and incomplete pagination', () => {
    const response = checkoutQuery()
    response.data.content.push(response.data.content[0]!)
    expect(() => readCheckoutQueryResponse(response, profile.merchantNo, checkoutContext))
      .toThrow('PAYMENT_QUERY_RESPONSE_INVALID')
    const paged = checkoutQuery()
    expect(() => readCheckoutQueryResponse({ ...paged, data: { ...paged.data, totalPages: 2 } }, profile.merchantNo, checkoutContext))
      .toThrow('PAYMENT_QUERY_RESPONSE_INVALID')
  })
})

it('fails closed before sending a Checkout query with a missing merchant transaction binding', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_FETCH'))
  try {
    await expect(queryCheckoutPayment(profile, { ...checkoutContext, merchantTxnId: '' }))
      .rejects.toThrow('PAYMENT_QUERY_RESPONSE_INVALID')
    expect(fetch).not.toHaveBeenCalled()
  }
  finally {
    fetch.mockRestore()
  }
})

it('discovers only bounded subscription references after exact Checkout transaction correlation', () => {
  const response = checkoutQuery({ contractId: 'contract-1', tokenId: 'opaque.subscription/token' })
  expect(readCheckoutQueryResponse(response, profile.merchantNo, { ...checkoutContext, subscription: true }))
    .toMatchObject({ status: 'succeeded', subscription: { contractId: 'contract-1', tokenId: 'opaque.subscription/token' } })
  expect(readCheckoutQueryResponse(response, profile.merchantNo, checkoutContext)).not.toHaveProperty('subscription')
  expect(() => readCheckoutQueryResponse(checkoutQuery({ contractId: 'bad contract' }), profile.merchantNo, { ...checkoutContext, subscription: true }))
    .toThrow('PAYMENT_QUERY_RESPONSE_INVALID')
  expect(() => readCheckoutQueryResponse(checkoutQuery({ tokenId: 'orphan-token' }), profile.merchantNo, { ...checkoutContext, subscription: true }))
    .toThrow('PAYMENT_QUERY_RESPONSE_INVALID')
})
