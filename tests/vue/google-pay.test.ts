import type { DirectRecoveryResponse } from '../../shared/payment/apple-pay'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GooglePay from '../../app/components/payment/GooglePay.vue'
import { useGooglePay } from '../../app/composables/useGooglePay'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), load: vi.fn(), ready: vi.fn(), authorize: vi.fn(), navigate: vi.fn() }))
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('navigateTo', () => mocks.navigate)
vi.mock('../../app/utils/google-pay.client', async original => ({ ...await original<typeof import('../../app/utils/google-pay.client')>(), loadGooglePay: mocks.load }))
function payment() {
  const createdAt = '2026-10-09T00:00:00.000Z'
  const attempt = { id: 'attempt-google', orderId: 'order-google', integration: 'direct-api', method: 'google-pay', status: 'created', createdAt, updatedAt: createdAt }
  return { order: { id: 'order-google', item: { name: 'Halden sample' }, amount: { minor: 500, currency: 'USD' } }, attempt, attempts: [attempt], events: [], submitted: false, canAuthorize: true, config: { environment: 'TEST', gateway: 'synthetic', gatewayMerchantId: 'synthetic-merchant', allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], allowedCardNetworks: ['VISA'], countryCode: 'US', currencyCode: 'USD', totalPrice: '5.00' } }
}
let google: ReturnType<typeof useGooglePay>
const Harness = defineComponent({ setup() { google = useGooglePay('order-google'); return () => null } })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.navigate.mockResolvedValue(undefined)
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
    expect(google.steps.value.find(step => step.id === 'result')?.evidence?.source).toBe('stored')
    expect(google.steps.value.filter(step => step.id !== 'result').every(step => step.state === 'waiting' && !step.evidence)).toBe(true)
    await google.verify()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/payment/recover', expect.anything())
    expect(google.session.value?.attempt.status).toBe('succeeded')
    wrapper.unmount()
  })


  it.each([false, true])('opens hosted verification without retaining its URL or racing a query (navigation fails: %s)', async (fails) => {
    vi.useFakeTimers()
    const redirectUrl = `https://sandbox-checkout.onerway.com/additional-information?key=synthetic-hosted-key&returnUrl=${encodeURIComponent(`${window.location.origin}/halden/direct/order-google`)}`
    const response = { ...payment(), submitted: true, redirectUrl }
    response.attempt.status = 'requires_action'
    mocks.authorize.mockResolvedValue({ paymentMethodData: { tokenizationData: { token: 'synthetic-token' } } })
    if (fails) mocks.navigate.mockRejectedValue(new Error('navigation blocked'))
    const wrapper = await mountSuspended(Harness)
    await google.prepare()
    mocks.fetch.mockResolvedValue(response)
    google.pay()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(redirectUrl, { external: true })
    expect(google.session.value?.attempt.status).toBe('requires_action')
    expect(google.tokenDebug.value).toBeNull()
    expect(JSON.stringify({ session: google.session.value, steps: google.steps.value })).not.toContain('synthetic-hosted-key')
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/payment/google-pay/prepare', '/api/payment/google-pay/pay'])
    google.pay()
    expect(mocks.authorize).toHaveBeenCalledOnce()
    expect(google.steps.value.find(step => step.id === 'action')?.state).toBe(fails ? 'interrupted' : 'active')
    if (fails) {
      expect(google.error.value).toContain('could not be opened')
      await google.verify()
      expect(mocks.fetch).toHaveBeenLastCalledWith('/api/payment/recover', expect.anything())
    }
    wrapper.unmount()
  })

  it.each([
    ['requires_action', undefined],
    ['requires_action', 'https://untrusted.example/additional-information?key=synthetic'],
    ['requires_action', `https://sandbox-checkout.onerway.com/additional-information?key=synthetic&returnUrl=${encodeURIComponent('https://wrong.example/order')}`],
    ['succeeded', `https://sandbox-checkout.onerway.com/additional-information?key=synthetic&returnUrl=${encodeURIComponent(`${window.location.origin}/halden/direct/order-google`)}`],
  ])('does not navigate for an invalid destination or non-action state: %s', async (status, redirectUrl) => {
    vi.useFakeTimers()
    const response = { ...payment(), submitted: true, redirectUrl }
    response.attempt.status = status!
    mocks.authorize.mockResolvedValue({ paymentMethodData: { tokenizationData: { token: 'synthetic-token' } } })
    const wrapper = await mountSuspended(Harness)
    await google.prepare()
    mocks.fetch.mockImplementation(async (url) => url === '/api/payment/google-pay/pay' ? response : { ...response, redirectUrl: undefined })
    google.pay()
    await flushPromises()
    expect(mocks.navigate).not.toHaveBeenCalled()
    if (redirectUrl) expect(JSON.stringify(google.session.value)).not.toContain(redirectUrl)
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.fetch.mock.calls.filter(([url]) => url === '/api/payment/recover')).toHaveLength(0)
    expect(google.submitted.value).toBe(true)
    wrapper.unmount()
  })

  it('uses the recovered hosted order without an immediate duplicate query, then allows a manual check', async () => {
    const initial = payment()
    initial.submitted = true
    initial.attempt.status = 'requires_action'
    const recovered = { ...payment(), submitted: true }
    recovered.attempt.status = 'succeeded'
    mocks.fetch.mockResolvedValue(recovered)
    const Restored = defineComponent({ setup() { google = useGooglePay('order-google', initial as unknown as DirectRecoveryResponse); return () => null } })
    const wrapper = await mountSuspended(Restored)
    await google.initialize()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(google.session.value?.attempt.status).toBe('requires_action')
    await google.verify()
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('/api/payment/recover', { query: { orderId: 'order-google' }, retry: 0 })
    expect(google.session.value?.attempt.status).toBe('succeeded')
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows processing after authorization while the payment response is pending', async () => {
    mocks.authorize.mockResolvedValue({ paymentMethodData: { tokenizationData: { token: 'synthetic-token' } } })
    const wrapper = await mountSuspended(Harness)
    await google.prepare()
    let resolve!: (value: unknown) => void
    mocks.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    google.pay()
    await flushPromises()
    expect(google.phase.value).toBe('submit')
    expect(google.sheetOpen.value).toBe(true)
    expect(google.message.value).toContain('Processing your payment')
    expect(google.message.value).not.toContain('Continue in Google Pay')
    google.pay()
    expect(mocks.authorize).toHaveBeenCalledOnce()
    const result = { ...payment(), submitted: true }
    result.attempt.status = 'succeeded'
    resolve(result)
    await flushPromises()
    expect(google.phase.value).toBe('result')
    expect(google.sheetOpen.value).toBe(false)
    expect(google.session.value?.attempt.status).toBe('succeeded')
    wrapper.unmount()
  })

  it('keeps an initial recovery failure visible without immediately repeating the query', async () => {
    const initial = { ...payment(), submitted: true, verificationPending: true }
    initial.attempt.status = 'requires_action'
    const Restored = defineComponent({ setup() { google = useGooglePay('order-google', initial as unknown as DirectRecoveryResponse); return () => null } })
    const wrapper = await mountSuspended(Restored)
    await google.initialize()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(google.error.value).toContain('fresh result is unavailable')
    expect(google.steps.value.find(step => step.id === 'result')?.state).toBe('interrupted')
    wrapper.unmount()
  })

  it.each(['requires_action', 'processing'])('does not immediately query a recovered %s order and preserves its polling policy', async (status) => {
    vi.useFakeTimers()
    const initial = { ...payment(), submitted: true }
    initial.attempt.status = status
    mocks.fetch.mockResolvedValue(initial)
    const Restored = defineComponent({ setup() { google = useGooglePay('order-google', initial as unknown as DirectRecoveryResponse); return () => null } })
    const wrapper = await mountSuspended(Restored)
    await google.initialize()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(google.checking.value).toBe(false)
    await vi.advanceTimersByTimeAsync(1250)
    expect(mocks.fetch).toHaveBeenCalledTimes(status === 'processing' ? 1 : 0)
    wrapper.unmount()
  })

  it.each(['requires_action', 'processing'])('keeps a missing transaction neutral and stops polling for %s, then allows manual convergence', async (status) => {
    vi.useFakeTimers()
    const initial = { ...payment(), submitted: true }
    initial.attempt.status = status
    mocks.fetch.mockResolvedValue({ ...initial, verificationPending: true, transactionNotFound: true })
    const Restored = defineComponent({ setup() { google = useGooglePay('order-google', initial as unknown as DirectRecoveryResponse); return () => null } })
    const wrapper = await mountSuspended(Restored)
    await google.initialize()
    await google.verify()
    expect(google.error.value).toBeNull()
    expect(google.message.value).toContain(status === 'requires_action' ? 'Complete hosted card verification first' : 'If hosted card verification is still open')
    expect(google.steps.value.find(step => step.id === 'result')).toMatchObject({ state: 'active', evidence: { source: 'stored' } })
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.fetch).toHaveBeenCalledOnce()
    const confirmed = { ...payment(), submitted: true }
    confirmed.attempt.status = 'succeeded'
    mocks.fetch.mockResolvedValue(confirmed)
    await google.verify()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(google.session.value?.attempt.status).toBe('succeeded')
    expect(google.steps.value.find(step => step.id === 'result')?.state).toBe('completed')
    expect(google.message.value).not.toContain('No transaction')
    google.pay()
    expect(mocks.authorize).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not infer an absent transaction from an empty query for requires_action with a Provider ID', async () => {
    const base = payment()
    const initial = { ...base, submitted: true, verificationPending: true, transactionNotFound: true, attempt: { ...base.attempt, status: 'requires_action', transactionId: 'synthetic-existing-transaction' } }
    const Restored = defineComponent({ setup() { google = useGooglePay('order-google', initial as unknown as DirectRecoveryResponse); return () => null } })
    const wrapper = await mountSuspended(Restored)
    await google.initialize()
    expect(google.message.value).toContain('No transaction was found')
    expect(google.message.value).toContain('Complete hosted card verification')
    expect(google.message.value).not.toContain('has been created')
    expect(google.session.value?.attempt.transactionId).toBe('synthetic-existing-transaction')
    expect(google.steps.value.find(step => step.id === 'result')).toMatchObject({ state: 'active', evidence: { source: 'stored' } })
    wrapper.unmount()
  })

  it('preserves a known terminal result when a later query finds no transaction', async () => {
    const initial = { ...payment(), submitted: true }
    initial.attempt.status = 'succeeded'
    mocks.fetch.mockResolvedValue({ ...initial, verificationPending: true, transactionNotFound: true })
    const Restored = defineComponent({ setup() { google = useGooglePay('order-google', initial as unknown as DirectRecoveryResponse); return () => null } })
    const wrapper = await mountSuspended(Restored)
    await google.initialize()
    await google.verify()
    expect(google.session.value?.attempt.status).toBe('succeeded')
    expect(google.message.value).toContain('saved payment result is preserved')
    expect(google.message.value).not.toContain('No transaction has been created')
    expect(google.error.value).toBeNull()
    expect(google.steps.value.find(step => step.id === 'result')).toMatchObject({ state: 'completed', evidence: { source: 'stored' } })
    wrapper.unmount()
  })

  it('does not repeat the page recovery query when initial recovery already found no transaction', async () => {
    vi.useFakeTimers()
    const initial = { ...payment(), submitted: true, verificationPending: true, transactionNotFound: true }
    initial.attempt.status = 'requires_action'
    const Restored = defineComponent({ setup() { google = useGooglePay('order-google', initial as unknown as DirectRecoveryResponse); return () => null } })
    const wrapper = await mountSuspended(Restored)
    await google.initialize()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(google.error.value).toBeNull()
    expect(google.message.value).toContain('No transaction was found')
    expect(google.message.value).not.toContain('has been created')
    expect(google.steps.value.find(step => step.id === 'result')).toMatchObject({ state: 'active', evidence: { source: 'stored' } })
    wrapper.unmount()
  })

  it.each(['network', 'pending'])('preserves real query errors during hosted recovery: %s', async (failure) => {
    vi.useFakeTimers()
    const initial = { ...payment(), submitted: true }
    initial.attempt.status = 'requires_action'
    if (failure === 'network') mocks.fetch.mockRejectedValue(new Error('synthetic network failure'))
    else mocks.fetch.mockResolvedValue({ ...initial, verificationPending: true })
    const Restored = defineComponent({ setup() { google = useGooglePay('order-google', initial as unknown as DirectRecoveryResponse); return () => null } })
    const wrapper = await mountSuspended(Restored)
    await google.initialize()
    await google.verify()
    expect(google.error.value).not.toBeNull()
    expect(google.steps.value.find(step => step.id === 'result')?.state).toBe('interrupted')
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.fetch).toHaveBeenCalledOnce()
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
    expect(google.sheetOpen.value).toBe(false)
    expect(google.phase.value).toBe('captured')
    expect(google.tokenDebug.value).toBe('synthetic-token')
    expect(google.session.value?.attempt.status).toBe('created')
    expect(google.submitted.value).toBe(false)
    expect(google.steps.value.find(step => step.id === 'authorize')).toMatchObject({ state: 'completed', evidence: { source: 'live', durationMs: expect.any(Number), occurredAt: expect.any(String) } })
    expect(google.steps.value.filter(step => ['submit', 'result'].includes(step.id)).every(step => step.state === 'waiting' && !step.evidence)).toBe(true)
    expect(JSON.stringify(google.steps.value)).not.toContain('synthetic-token')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.navigate).not.toHaveBeenCalled()
    google.setMode('automatic')
    expect(google.tokenDebug.value).toBeNull()
    expect(google.steps.value.find(step => step.id === 'authorize')?.state).toBe('waiting')
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
    expect(google.steps.value.find(step => step.id === 'authorize')?.state).toBe('completed')
    expect(JSON.stringify(google.steps.value)).not.toContain('synthetic-token')
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
    expect(google.phase.value).toBe('submit')
    expect(google.message.value).toContain('Processing your payment')
    expect(google.submitted.value).toBe(false)
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
    expect(google.steps.value.find(step => step.id === 'submit')?.state).toBe('interrupted')
    expect(JSON.stringify(google.steps.value)).not.toContain('synthetic-token')
    expect(mocks.fetch.mock.calls.filter(([url]) => url === '/api/payment/google-pay/pay')).toHaveLength(1)
    wrapper.unmount()
  })
  it('records interruption without inventing a Provider cancellation', async () => {
    mocks.authorize.mockRejectedValue({ statusCode: 'CANCELED', message: 'SECRET_UPSTREAM_ERROR' })
    const wrapper = await mountSuspended(Harness)
    await google.prepare()
    google.pay()
    await flushPromises()
    expect(google.steps.value.find(step => step.id === 'authorize')?.state).toBe('interrupted')
    expect(google.steps.value.find(step => step.id === 'cancel')?.state).toBe('completed')
    expect(google.session.value?.attempt.status).toBe('created')
    expect(google.submitted.value).toBe(false)
    expect(JSON.stringify(google.steps.value)).not.toContain('SECRET_UPSTREAM_ERROR')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

})


describe('Google Pay independent Sandbox orders', () => {
  async function mountOrder(status: string) {
    const initial = payment()
    initial.submitted = true
    initial.attempt.status = status
    mocks.fetch.mockImplementation(async (url) => url === '/api/payment/intent' ? { orderId: 'new-order-google' } : initial)
    const wrapper = await mountSuspended(GooglePay, { props: { orderId: 'order-google', initial: initial as unknown as DirectRecoveryResponse }, global: { stubs: { PaymentGooglePaySteps: true, PaymentGooglePayToken: true } } })
    await flushPromises()
    return wrapper
  }
  it.each(['created', 'requires_action'])('opens an independent order from submitted %s without paying the old order', async (status) => {
    const wrapper = await mountOrder(status)
    const action = wrapper.findAll('button').find(button => button.text() === 'Start a new Sandbox order')!
    expect(action.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('does not cancel this order or resend its token')
    expect(wrapper.text()).toContain('This browser will restore the new order')
    await action.trigger('click')
    await flushPromises()
    expect(mocks.fetch).toHaveBeenCalledWith('/api/payment/intent', { method: 'POST', body: { journeyId: 'google-pay-direct', method: 'google-pay', restart: true }, retry: 0 })
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/halden/direct/new-order-google')
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.fetch.mock.calls.some(([url]) => url === '/api/payment/google-pay/pay')).toBe(false)
    wrapper.unmount()
  })
  it('preserves the old order and its query action when creating a new order fails', async () => {
    const wrapper = await mountOrder('requires_action')
    mocks.fetch.mockRejectedValueOnce(new Error('intent unavailable'))
    await wrapper.findAll('button').find(button => button.text() === 'Start a new Sandbox order')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Your original order is preserved')
    expect(wrapper.text()).toContain('order-google')
    expect(mocks.navigate).not.toHaveBeenCalled()
    const check = wrapper.findAll('button').find(button => button.text() === 'Check this order')!
    expect(check.attributes('disabled')).toBeUndefined()
    await check.trigger('click')
    await flushPromises()
    expect(mocks.fetch).toHaveBeenLastCalledWith('/api/payment/recover', { query: { orderId: 'order-google' }, retry: 0 })
    expect(mocks.authorize).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('prevents duplicate new-order creation while the request is in flight', async () => {
    const wrapper = await mountOrder('created')
    let resolve!: (value: unknown) => void
    mocks.fetch.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const action = wrapper.findAll('button').find(button => button.text() === 'Start a new Sandbox order')!
    await action.trigger('click')
    expect(action.attributes('disabled')).toBeDefined()
    await action.trigger('click')
    expect(mocks.fetch.mock.calls.filter(([url]) => url === '/api/payment/intent')).toHaveLength(1)
    resolve({ orderId: 'new-order-google' })
    await flushPromises()
    wrapper.unmount()
  })
})
