import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createOrder } from '../shared/payment/order'
import {
  createSubscriptionPlaceholder,
  getSubscriptionPlan,
  projectSubscriptionState,
  toSubscriptionSummary,
} from '../shared/payment/subscription'
import {
  buildSubscriptionCreatePayload,
  readSubscriptionCreateResponse,
  readSubscriptionQueryResponse,
} from '../server/utils/gateway'
import type { ServerProfile } from '../server/utils/profile'
import { readSubscriptionPaymentWebhook } from '../server/utils/webhook'

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

const plan = getSubscriptionPlan('halden-daily-essentials-v1')
const order = createOrder({
  id: 'HLD-SUB-ORDER',
  scene: 'ecommerce',
  item: {
    sku: 'HL-SUB-DAILY-005',
    name: plan.productName,
    variant: 'Daily subscription',
    quantity: 1,
    unitAmount: plan.amount,
  },
  amount: plan.amount,
  createdAt: '2026-08-17T00:00:00.000Z',
})

const browser = {
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
}

describe('subscription contract', () => {
  it('freezes the versioned server-owned plan and pending placeholder', () => {
    expect(plan).toEqual({
      id: 'halden-daily-essentials-v1',
      version: 1,
      productName: 'Halden Daily Essentials',
      amount: { minor: 500, currency: 'USD' },
      frequencyType: 'D',
      frequencyPoint: 1,
      expireDate: '2099-12-31',
    })

    const contract = createSubscriptionPlaceholder({
      id: 'subscription-1',
      plan,
      initialOrderId: order.id,
      initialAttemptId: 'attempt-1',
      createdAt: '2026-08-17T00:00:00.000Z',
    })

    expect(contract).toMatchObject({
      state: 'pending',
      statusSource: 'placeholder',
      dataStatus: '0',
      subscriptionStatus: 'paymentdue',
    })
    expect(toSubscriptionSummary({ ...contract, contractId: 'private', tokenId: 'private-token' }))
      .not.toHaveProperty('contractId')
  })

  it('keeps payment and contract status independent', () => {
    expect(projectSubscriptionState('0', 'paymentdue')).toBe('pending')
    expect(projectSubscriptionState('1', 'active')).toBe('active')
    expect(projectSubscriptionState('2', 'paused')).toBe('needs_attention')
    expect(projectSubscriptionState('3', 'canceled')).toBe('terminal')
  })

  it('builds the only allowed ALL + SUBSCRIBE initial wire contract', () => {
    const payload = buildSubscriptionCreatePayload(profile, {
      merchantTxnId: 'showcase-subscription-1',
      merchantCustId: 'cust_Subscription_1',
      order,
      plan,
      returnUrl: 'https://showcase.example/halden/subscription/return',
      ...browser,
    })

    expect(payload).toMatchObject({
      merchantCustId: 'cust_Subscription_1',
      orderAmount: '5.00',
      orderCurrency: 'USD',
      productType: 'ALL',
      subProductType: 'SUBSCRIBE',
      txnType: 'SALE',
      subscription: {
        requestType: '0',
        merchantCustId: 'cust_Subscription_1',
        selfExecute: '2',
        mode: '2',
        productName: 'Halden Daily Essentials',
        frequencyType: 'D',
        frequencyPoint: '1',
        expireDate: '2099-12-31',
      },
    })
    expect(JSON.stringify(payload)).not.toContain('cycleCount')
    expect(JSON.stringify(payload)).not.toContain('bindCard')
  })

  it('accepts only the observed U/U create response with null contract identifiers', () => {
    expect(readSubscriptionCreateResponse({
      respCode: '20000',
      data: {
        transactionId: '2084000000000000001',
        paymentId: '2084000000000000002',
        status: 'U',
        paymentStatus: 'U',
        contractId: null,
        tokenId: null,
      },
    })).toEqual({
      transactionId: '2084000000000000001',
      paymentId: '2084000000000000002',
      rawStatus: 'U',
      rawPaymentStatus: 'U',
    })

    expect(() => readSubscriptionCreateResponse({
      respCode: '20000',
      data: {
        transactionId: '2084000000000000001',
        paymentId: '2084000000000000002',
        status: 'U',
        paymentStatus: 'U',
        contractId: 'unexpected',
        tokenId: null,
      },
    })).toThrow('SUBSCRIPTION_CREATE_RESPONSE_INVALID')
  })

  it('parses actual subscription query field names and opaque tokens', () => {
    expect(readSubscriptionQueryResponse({
      respCode: '20000',
      data: {
        contractId: 'contract_1',
        merchantNo: 'merchant',
        merchantCustomerId: 'cust_Subscription_1',
        products: '[{"name":"Halden Daily Essentials","price":"5.00","num":"1","currency":"USD"}]',
        orderAmount: '5.00',
        orderCurrency: 'USD',
        expireDate: '2099-12-31',
        frequencyType: 'D',
        frequencyPoint: '1',
        dataStatus: '1',
        subscriptionStatus: 'active',
        tokenId: 'opaque.subscription-token/value',
      },
    }, 'contract_1', 'merchant')).toMatchObject({
      merchantCustomerId: 'cust_Subscription_1',
      state: 'active',
      tokenId: 'opaque.subscription-token/value',
    })

    expect(() => readSubscriptionQueryResponse({
      respCode: '20000',
      data: { contractId: 'contract_1', products: '{' },
    }, 'contract_1', 'merchant')).toThrow('SUBSCRIPTION_QUERY_RESPONSE_INVALID')

    expect(() => readSubscriptionQueryResponse({
      respCode: '20000',
      data: {
        contractId: 'contract_1',
        merchantNo: 'merchant',
        merchantCustomerId: 'cust_Subscription_1',
        products: '[{"name":"Halden Daily Essentials","price":"6.00","num":"1","currency":"USD"}]',
        orderAmount: '5.00',
        orderCurrency: 'USD',
        expireDate: '2099-12-31',
        frequencyType: 'D',
        frequencyPoint: '1',
        dataStatus: '1',
        subscriptionStatus: 'active',
        tokenId: 'opaque.subscription-token/value',
      },
    }, 'contract_1', 'merchant')).toThrow('SUBSCRIPTION_QUERY_RESPONSE_INVALID')

    expect(() => readSubscriptionQueryResponse({
      respCode: '20000',
      data: {
        contractId: 'contract_1',
        merchantNo: 'other-merchant',
        merchantCustomerId: 'cust_Subscription_1',
        products: '[{"name":"Halden Daily Essentials","price":"5.00","num":"1","currency":"USD"}]',
        orderAmount: '5.00',
        orderCurrency: 'USD',
        expireDate: '2099-12-31',
        frequencyType: 'D',
        frequencyPoint: '1',
        dataStatus: '1',
        subscriptionStatus: 'active',
        tokenId: 'opaque.subscription-token/value',
      },
    }, 'contract_1', 'merchant')).toThrow('SUBSCRIPTION_QUERY_RESPONSE_INVALID')
  })
})

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

function signedSubscriptionWebhook(): Record<string, unknown> {
  const body = {
    notifyType: 'TXN',
    transactionId: '2084000000000000001',
    paymentId: '2084000000000000002',
    txnType: 'SALE',
    merchantNo: 'merchant',
    merchantTxnId: 'showcase-subscription-1',
    txnTime: '2026-08-17 12:00:00',
    txnTimeZone: '+08:00',
    orderAmount: '5.00',
    orderCurrency: 'USD',
    status: 'S',
    paymentStatus: 'S',
    contractId: 'contract_1',
    tokenId: 'opaque.subscription-token/value',
    subscriptionStatus: 'active',
    dataStatus: '1',
    products: '[{"name":"Halden Daily Essentials","price":"5.00","num":"1","currency":"USD"}]',
    scenarios: 'SUBSCRIPTION_INITIAL',
    paymentMethod: 'VISA',
  }
  const canonical = Object.entries(body)
    .filter(([key, value]) => !excluded.has(key) && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => String(value))
    .join('')

  return {
    ...body,
    sign: createHash('sha256').update(`${canonical}secret`, 'utf8').digest('hex'),
  }
}

describe('subscription webhook', () => {
  it('uses the shared exclusion contract and projects no raw card payload', () => {
    const fact = readSubscriptionPaymentWebhook(signedSubscriptionWebhook(), 'secret', 'merchant')

    expect(fact).toMatchObject({
      scenario: 'SUBSCRIPTION_INITIAL',
      paymentId: '2084000000000000002',
      contractId: 'contract_1',
      tokenId: 'opaque.subscription-token/value',
      productName: 'Halden Daily Essentials',
      status: 'succeeded',
      subscriptionState: 'active',
    })
    expect(fact).not.toHaveProperty('paymentMethod')
  })
})
