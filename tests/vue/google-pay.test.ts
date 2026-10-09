import type { DirectRecoveryResponse } from '../../shared/payment/apple-pay'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGooglePay } from '../../app/composables/useGooglePay'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), load: vi.fn(), ready: vi.fn(), authorize: vi.fn() }))
mockNuxtImport('$fetch', () => mocks.fetch)
vi.mock('../../app/utils/google-pay.client', async original => ({ ...await original<typeof import('../../app/utils/google-pay.client')>(), loadGooglePay: mocks.load }))
function payment() {
  const createdAt = '2026-10-09T00:00:00.000Z'
  const attempt = { id: 'attempt-google', orderId: 'order-google', integration: 'direct-api', method: 'google-pay', status: 'created', createdAt, updatedAt: createdAt }
  return { order: { id: 'order-google' }, attempt, attempts: [attempt], events: [], submitted: false, canAuthorize: true, config: { environment: 'TEST', gateway: 'synthetic', gatewayMerchantId: 'synthetic-merchant', allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], allowedCardNetworks: ['VISA'], countryCode: 'US', currencyCode: 'USD', totalPrice: '5.00' } }
}
let google: ReturnType<typeof useGooglePay>
const Harness = defineComponent({ setup() { google = useGooglePay('order-google'); return () => null } })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetch.mockResolvedValue(payment())
  mocks.ready.mockResolvedValue({ result: true })
  mocks.load.mockResolvedValue({ isReadyToPay: mocks.ready, loadPaymentData: mocks.authorize, createButton: vi.fn() })
  vi.stubGlobal('navigator', { language: 'en-US', locks: { request: vi.fn((_name, _options, run) => run()) } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('Google Pay client', () => {
  it('restores a paid order without depending on wallet configuration', async () => {
    const initial = payment()
    initial.submitted = true
    initial.attempt.status = 'succeeded'
    mocks.fetch.mockRejectedValue(new Error('consult unavailable'))
    const Restored = defineComponent({ setup() { google = useGooglePay('order-google', initial as unknown as DirectRecoveryResponse); return () => null } })
    const wrapper = await mountSuspended(Restored)
    await google.initialize()
    expect(google.session.value?.attempt.status).toBe('succeeded')
    expect(google.submitted.value).toBe(true)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
    await google.verify()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/payment/recover', expect.anything())
    expect(google.session.value?.attempt.status).toBe('succeeded')
    wrapper.unmount()
  })

  it('captures manual authorization without submission, polling or order changes', async () => {
    vi.useFakeTimers()
    mocks.authorize.mockResolvedValue({ paymentMethodData: { tokenizationData: { token: 'synthetic-token' } } })
    const wrapper = await mountSuspended(Harness)
    await google.prepare()
    google.setMode('manual')
    google.pay()
    expect(mocks.authorize).toHaveBeenCalledOnce()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(60000)
    expect(google.tokenDebug.value).toBe('synthetic-token')
    expect(google.session.value?.attempt.status).toBe('created')
    expect(google.submitted.value).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    google.setMode('automatic')
    expect(google.tokenDebug.value).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('separates an unsupported token from a deliberately cleared capture', async () => {
    const wrapper = await mountSuspended(Harness)
    await google.prepare()
    google.setMode('manual')
    mocks.authorize.mockResolvedValue({ paymentMethodData: { tokenizationData: { token: '{"unexpected":"synthetic"}' } } })
    google.pay()
    await flushPromises()
    expect(google.manualCaptured.value).toBe(false)
    expect(google.tokenDebugUnavailable.value).toBe(true)
    expect(google.tokenDebug.value).toBeNull()
    mocks.authorize.mockResolvedValue({ paymentMethodData: { tokenizationData: { token: 'synthetic-token' } } })
    google.pay()
    await flushPromises()
    expect(google.manualCaptured.value).toBe(true)
    expect(google.tokenDebugUnavailable.value).toBe(false)
    google.clearToken()
    expect(google.manualCaptured.value).toBe(true)
    expect(google.tokenDebugUnavailable.value).toBe(false)
    expect(google.tokenDebug.value).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('locks the mode during authorization and ignores results after pagehide', async () => {
    let resolve!: (value: unknown) => void
    mocks.authorize.mockImplementation(() => new Promise(done => { resolve = done }))
    const wrapper = await mountSuspended(Harness)
    await google.prepare()
    google.setMode('manual')
    google.pay()
    google.setMode('automatic')
    expect(google.mode.value).toBe('manual')
    window.dispatchEvent(new Event('pagehide'))
    resolve({ paymentMethodData: { tokenizationData: { token: 'synthetic-late-token' } } })
    await flushPromises()
    expect(google.tokenDebug.value).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('expires lock waiting without submitting the token later', async () => {
    vi.useFakeTimers()
    let acquire!: () => unknown
    vi.stubGlobal('navigator', { language: 'en-US', locks: { request: vi.fn((_name, options, run) => new Promise((_resolve, reject) => {
      acquire = run
      options.signal.addEventListener('abort', () => reject(new Error('aborted')))
    })) } })
    mocks.authorize.mockResolvedValue({ paymentMethodData: { tokenizationData: { token: 'synthetic-token' } } })
    const wrapper = await mountSuspended(Harness)
    await google.prepare()
    google.pay()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(30001)
    expect(google.sheetOpen.value).toBe(false)
    expect(google.submitted.value).toBe(false)
    acquire()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('never resubmits after an unknown submission result', async () => {
    mocks.authorize.mockResolvedValue({ paymentMethodData: { tokenizationData: { token: 'synthetic-token' } } })
    const wrapper = await mountSuspended(Harness)
    await google.prepare()
    mocks.fetch.mockRejectedValue(new Error('synthetic-timeout'))
    google.pay()
    await flushPromises()
    expect(google.submitted.value).toBe(true)
    google.pay()
    expect(mocks.authorize).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls.filter(([url]) => url === '/api/payment/google-pay/pay')).toHaveLength(1)
    wrapper.unmount()
  })
})
