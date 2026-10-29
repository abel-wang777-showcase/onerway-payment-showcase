import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMobileCreatePayload, createMobilePayment } from '../server/utils/gateway'
import type { MobileCreateContext } from '../server/utils/gateway'
import type { SandboxProfile } from '../server/utils/demo/payment'

const profile = { profile: 'sandbox', merchantNo: 'test-merchant', appId: 'test-app', secret: 'synthetic-secret', apiBaseUrl: 'https://sandbox-acq.onerway.com', notifyUrl: 'https://demo.example.test/api/webhooks/onerway/payment' } as SandboxProfile
function context(platform: 'ANDROID' | 'IOS'): MobileCreateContext {
  return { platform, merchantTxnId: 'demo_transaction', merchantCustId: 'demo_customer', returnUrl: 'https://demo.example.test/mobile/return/android?merchantTxnId=demo_transaction',
    order: { id: 'order', scene: 'ecommerce', amount: { minor: 1234, currency: 'USD' }, fulfillment: 'pending', createdAt: '2026-10-27T00:00:00.000Z', item: { sku: 'demo-native-sale', name: 'Demo purchase', variant: 'Default', quantity: 1, unitAmount: { minor: 1234, currency: 'USD' } } } }
}
afterEach(() => vi.unstubAllGlobals())
describe('Native APP Provider adapter', () => {
  it.each(['ANDROID', 'IOS'] as const)('builds parameterized %s SALE without browser fields or card data', (platform) => {
    const payload = buildMobileCreatePayload(profile, context(platform))
    expect(payload).toMatchObject({ paymentMode: 'APP', osType: platform, txnType: 'SALE', subProductType: 'DIRECT', merchantCustId: 'demo_customer', orderAmount: '12.34', orderCurrency: 'USD' })
    expect(payload).not.toHaveProperty('billingInformation')
    expect(payload).not.toHaveProperty('secret')
    expect(payload.txnOrderMsg).toMatchObject({ notifyUrl: profile.notifyUrl, appId: profile.appId })
  })
  it('sends one signed request through the existing SDK endpoint and parses the local response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ respCode: '20000', data: { paymentId: '123', transactionId: '456', status: 'U' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await expect(createMobilePayment(profile, context('ANDROID'))).resolves.toMatchObject({ paymentId: '123', transactionId: '456', rawStatus: 'U' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]![0]).toBe('https://sandbox-acq.onerway.com/v1/sdkTxn/doTransaction')
    const body = JSON.parse(fetch.mock.calls[0]![1].body)
    expect(body.sign).toEqual(expect.any(String))
    expect(body).not.toHaveProperty('secret')
  })
})
