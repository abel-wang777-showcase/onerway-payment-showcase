import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApplePay } from '../../app/composables/useApplePay'
import type { PrepareApplePayResponse } from '../../shared/payment/apple-pay'
import type { AppleSession } from '../../app/utils/apple-pay.client'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), load: vi.fn(), eligible: vi.fn(), constructor: vi.fn() }))
mockNuxtImport('$fetch', () => mocks.fetch)
vi.mock('../../app/utils/apple-pay.client', async (original) => ({
  ...await original<typeof import('../../app/utils/apple-pay.client')>(),
  loadApplePay: mocks.load,
  checkApplePay: mocks.eligible,
  appleSessionConstructor: mocks.constructor,
}))

function payment(status: PrepareApplePayResponse['attempt']['status'] = 'created'): PrepareApplePayResponse {
  const createdAt = '2026-09-23T00:00:00.000Z'
  const attempt = { id: 'attempt-direct', orderId: 'order-direct', integration: 'direct-api' as const, method: 'apple-pay' as const, status, merchantTxnId: 'merchant-direct', createdAt, updatedAt: createdAt }
  return {
    order: { id: 'order-direct', scene: 'ecommerce', item: { sku: 'direct', name: 'Halden', variant: 'Apple Pay', quantity: 1, unitAmount: { minor: 500, currency: 'USD' } }, amount: { minor: 500, currency: 'USD' }, fulfillment: 'pending', createdAt },
    attempt, attempts: [attempt], events: [], paymentId: null, query: null, submitted: status !== 'created',
    canAuthorize: status === 'created', merchantIdentifier: 'merchant.example', paymentRequest: { countryCode: 'US', currencyCode: 'USD', supportedNetworks: ['visa'], merchantCapabilities: ['supports3DS'], total: { label: 'Halden', amount: '5.00' } },
  }
}
let apple: ReturnType<typeof useApplePay>
let sheet: AppleSession
const Harness = defineComponent({ setup() { apple = useApplePay('order-direct'); return () => null } })

function installLocks() {
  let previous: Promise<unknown> = Promise.resolve()
  const request = vi.fn((_name: string, _options: unknown, run: () => unknown) => {
    const next = previous.then(run)
    previous = next.catch(() => {})
    return next
  })
  vi.stubGlobal('navigator', { language: 'en-US', locks: { request } })
  return request
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetch.mockReset()
  mocks.load.mockResolvedValue(undefined)
  mocks.eligible.mockResolvedValue(true)
  sheet = { begin: vi.fn(), abort: vi.fn(), completeMerchantValidation: vi.fn(), completePayment: vi.fn(), onvalidatemerchant: null, onpaymentauthorized: null, oncancel: null }
  const ApplePay = Object.assign(function ApplePay() { return sheet }, { STATUS_SUCCESS: 0, STATUS_FAILURE: 1 })
  mocks.constructor.mockReturnValue(ApplePay)
  installLocks()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Apple Pay direct client', () => {
  it('keeps safe live evidence after completion without retaining wallet/session credentials', async () => {
    mocks.fetch.mockResolvedValueOnce(payment()).mockResolvedValueOnce({ merchantSession: { epochTimestamp: 1790168840000, expiresAt: 1790169140000, signature: 'SECRET_SESSION_SIGNATURE', nonce: 'SECRET_NONCE' } }).mockResolvedValueOnce({ ...payment('succeeded'), evidence: { request: '{"method":"POST","path":"/v1/txn/doTransaction"}' } })
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.pay()
    await sheet.onvalidatemerchant!({ validationURL: 'https://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession' })
    sheet.onpaymentauthorized!({ payment: { token: { paymentMethod: { network: 'MasterCard', type: 'credit', displayName: 'SECRET_CARD_LABEL' }, paymentData: { data: 'SECRET_TOKEN', version: 'EC_v1' }, transactionIdentifier: 'SECRET_WALLET_ID' } } })
    await flushPromises()
    const evidence = JSON.stringify(apple.steps.value)
    expect(evidence).not.toContain('SECRET_')
    expect(evidence).toContain('MasterCard')
    expect(evidence).toContain('/v1/txn/doTransaction')
    expect(apple.steps.value.find(item => item.id === 'validate')?.evidence?.durationMs).toBeTypeOf('number')
    expect(apple.steps.value.find(item => item.id === 'result')?.evidence?.source).toBe('live')
    wrapper.unmount()
  })

  it('restores server evidence without claiming earlier wallet interaction was observed', async () => {
    const value = payment('succeeded')
    const restored = { ...value, events: [{ id: 'event', attemptId: value.attempt.id, source: 'server' as const, status: 'succeeded' as const, rawStatus: 'S', occurredAt: value.attempt.updatedAt }] }
    mocks.fetch.mockResolvedValue(restored)
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    for (const id of ['begin', 'validate', 'authorize']) {
      expect(apple.steps.value.find(item => item.id === id)?.evidence).toBeUndefined()
      expect(apple.steps.value.find(item => item.id === id)?.state).toBe('waiting')
    }
    expect(apple.steps.value.find(item => item.id === 'submit')?.evidence?.request).toBeUndefined()
    expect(apple.steps.value.find(item => item.id === 'submit')?.evidence?.source).toBe('stored')
    expect(apple.steps.value.find(item => item.id === 'result')?.evidence?.source).toBe('stored')
    wrapper.unmount()
  })

  it('begins synchronously on click, forwards the full token once and accepts server success', async () => {
    mocks.fetch.mockResolvedValueOnce(payment()).mockResolvedValueOnce(payment('succeeded'))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.pay()
    expect(sheet.begin).toHaveBeenCalledOnce()
    const token = { paymentData: { data: 'synthetic' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-id' }
    sheet.onpaymentauthorized!({ payment: { token } })
    sheet.onpaymentauthorized!({ payment: { token } })
    await flushPromises()
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/pay'))).toHaveLength(1)
    expect(mocks.fetch.mock.calls[1]?.[1]).toMatchObject({ retry: 0, body: { token, orderId: 'order-direct', attemptId: 'attempt-direct' } })
    expect(sheet.completePayment).toHaveBeenCalledExactlyOnceWith({ status: 0 })
    expect(apple.session.value?.attempt.status).toBe('succeeded')
    expect(JSON.stringify(apple.session.value)).not.toContain('synthetic')
    wrapper.unmount()
  })

  it('keeps a timeout unknown, then accepts late success without completing the sheet twice', async () => {
    let finish!: (value: unknown) => void
    mocks.fetch.mockImplementation((url: string) => url.endsWith('/prepare') ? Promise.resolve(payment()) : url.endsWith('/pay') ? new Promise(resolve => { finish = resolve }) : Promise.resolve(payment('processing')))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    vi.useFakeTimers()
    apple.pay()
    sheet.onpaymentauthorized!({ payment: { token: { paymentData: 'synthetic' } } })
    await vi.advanceTimersByTimeAsync(25_000)
    expect(sheet.completePayment).toHaveBeenCalledExactlyOnceWith({ status: 1 })
    expect(apple.session.value?.attempt.status).toBe('processing')
    expect(apple.canPay.value).toBe(false)
    finish(payment('succeeded'))
    await vi.advanceTimersByTimeAsync(0)
    expect(apple.session.value?.attempt.status).toBe('succeeded')
    expect(sheet.completePayment).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('restores an existing result even when payment preparation is unavailable', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('configuration unavailable')).mockResolvedValueOnce(payment('succeeded'))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    expect(apple.session.value?.attempt.status).toBe('succeeded')
    expect(apple.canPay.value).toBe(false)
    expect(mocks.load).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([
    [{ data: { statusMessage: 'APPLE_PAY_NOT_CONFIGURED' } }, 'merchant identity is not configured'],
    [{ statusMessage: 'APPLE_PAY_NETWORK_ERROR' }, 'payment service is temporarily unavailable'],
    [{ data: { statusMessage: 'PRIVATE_UNKNOWN_ERROR', message: 'synthetic-private-diagnostic' } }, 'Apple Pay could not be prepared'],
  ])('maps controlled preparation errors without exposing their payload: %j', async (reason, message) => {
    mocks.fetch.mockRejectedValueOnce(reason).mockResolvedValueOnce(payment('processing'))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    expect(apple.error.value).toContain(message)
    expect(apple.error.value).not.toContain('PRIVATE_UNKNOWN_ERROR')
    expect(apple.error.value).not.toContain('synthetic-private-diagnostic')
    expect(apple.session.value?.attempt.merchantTxnId).toBe('merchant-direct')
    expect(apple.canPay.value).toBe(false)
    wrapper.unmount()
  })

  it('keeps stored references and explicitly marks a pending fresh verification', async () => {
    mocks.fetch.mockResolvedValueOnce(payment('processing')).mockResolvedValueOnce({ ...payment('processing'), verificationPending: true })
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    expect(apple.session.value?.attempt.merchantTxnId).toBe('merchant-direct')
    expect(apple.error.value).toContain('fresh payment result is not available')
    expect(apple.canPay.value).toBe(false)
    expect(apple.steps.value.find(step => step.id === 'result')?.state).not.toBe('completed')
    wrapper.unmount()
  })

  it('ignores late merchant validation after sheet cancellation and allows a new unsubmitted sheet', async () => {
    let finish!: (value: unknown) => void
    mocks.fetch.mockResolvedValueOnce(payment()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.pay()
    sheet.onvalidatemerchant!({ validationURL: 'https://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession' })
    sheet.oncancel!()
    finish({ merchantSession: { synthetic: true } })
    await flushPromises()
    expect(sheet.completeMerchantValidation).not.toHaveBeenCalled()
    expect(apple.steps.value.some(item => item.state === 'active')).toBe(false)
    expect(apple.steps.value.find(item => item.id === 'validate')?.state).toBe('interrupted')
    expect(apple.session.value?.attempt.status).toBe('created')
    expect(apple.canPay.value).toBe(true)
    wrapper.unmount()
  })

  it('never submits a token when the authorization expires while waiting for another tab', async () => {
    let release!: () => void
    const request = installLocks()
    void request('onerway-payment-intent', { mode: 'exclusive' }, () => new Promise<void>(resolve => { release = resolve }))
    mocks.fetch.mockImplementation(() => Promise.resolve(payment()))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    vi.useFakeTimers()
    apple.pay()
    sheet.onpaymentauthorized!({ payment: { token: { paymentData: 'synthetic' } } })
    await vi.advanceTimersByTimeAsync(25_000)
    expect(sheet.completePayment).toHaveBeenCalledExactlyOnceWith({ status: 1 })
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/pay'))).toHaveLength(0)
    expect(apple.steps.value.find(item => item.id === 'submit')?.evidence?.request).toBeUndefined()
    wrapper.unmount()
  })

  it('holds the shared intent lock until the payment submission finishes', async () => {
    const request = installLocks()
    let finish!: (value: unknown) => void
    mocks.fetch.mockResolvedValueOnce(payment()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.pay()
    sheet.onpaymentauthorized!({ payment: { token: { paymentData: 'synthetic' } } })
    await flushPromises()
    const intent = vi.fn()
    const waiting = request('onerway-payment-intent', { mode: 'exclusive' }, intent)
    await flushPromises()
    expect(intent).not.toHaveBeenCalled()
    expect(request.mock.calls.map(([name]) => name)).toEqual(['onerway-payment-intent', 'onerway-payment-intent'])
    finish(payment('succeeded'))
    await waiting
    expect(intent).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it.each(['2026-09-23T00:00:05.000Z', '2026-09-23T00:00:00.000Z'])('preserves a query failure over an older or same-time server snapshot (%s)', async (updatedAt) => {
    let finish!: (value: unknown) => void
    const base = payment('failed')
    const queried = { ...base, attempt: { ...base.attempt, statusSource: 'query' as const, updatedAt } }
    mocks.fetch.mockResolvedValueOnce(payment()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(queried)
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.pay()
    sheet.onpaymentauthorized!({ payment: { token: { paymentData: 'synthetic' } } })
    await flushPromises()
    await apple.verify()
    finish(payment('succeeded'))
    await flushPromises()
    expect(apple.session.value?.attempt.status).toBe('failed')
    expect(apple.session.value?.attempt.statusSource).toBe('query')
    expect(sheet.completePayment).toHaveBeenCalledExactlyOnceWith({ status: 1 })
    wrapper.unmount()
  })

  it('does not submit payment when browser locks are unavailable', async () => {
    mocks.fetch.mockResolvedValueOnce(payment())
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    vi.stubGlobal('navigator', { language: 'en-US' })
    apple.pay()
    sheet.onpaymentauthorized!({ payment: { token: { paymentData: 'synthetic' } } })
    await flushPromises()
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/pay'))).toHaveLength(0)
    expect(apple.steps.value.find(item => item.id === 'submit')?.evidence?.request).toBeUndefined()
    expect(sheet.completePayment).toHaveBeenCalledExactlyOnceWith({ status: 1 })
    expect(apple.submitted.value).toBe(false)
    wrapper.unmount()
  })
})
