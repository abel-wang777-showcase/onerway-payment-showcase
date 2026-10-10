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
  it('captures in manual mode without locks, submission, polling, or a successful sheet result', async () => {
    vi.useFakeTimers()
    mocks.fetch.mockResolvedValue(payment())
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    expect(apple.mode.value).toBe('automatic')
    expect(apple.submitting.value).toBe(false)
    apple.setMode('manual')
    vi.stubGlobal('navigator', { language: 'en-US' })
    apple.pay()
    const cancel = sheet.oncancel!
    const authorize = sheet.onpaymentauthorized!
    const token = { paymentData: { data: 'synthetic-manual-token' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-manual-id' }
    const serialized = JSON.stringify(token)
    await authorize({ payment: { token } })
    token.paymentData.data = 'synthetic-later-change'
    expect(apple.tokenDebug.value).toBe(serialized)
    expect(apple.manualCaptured.value).toBe(true)
    expect(apple.submitted.value).toBe(false)
    expect(apple.submitting.value).toBe(false)
    expect(apple.session.value?.attempt.status).toBe('created')
    const submissionStep = apple.steps.value.find(step => step.id === 'submit')
    expect(submissionStep?.state).toBe('waiting')
    expect(submissionStep?.evidence).toBeUndefined()
    expect(apple.steps.value.find(step => step.id === 'authorize')?.evidence?.fields).toContainEqual({ label: 'Submission', value: 'Not submitted' })
    expect(apple.sheetOpen.value).toBe(false)
    expect(sheet.abort).toHaveBeenCalledOnce()
    expect(sheet.completePayment).not.toHaveBeenCalled()
    cancel()
    await authorize({ payment: { token } })
    await vi.advanceTimersByTimeAsync(35_000)
    expect(apple.tokenDebug.value).toBe(serialized)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(sheet.abort).toHaveBeenCalledOnce()
    expect(JSON.stringify(apple.steps.value)).not.toContain('synthetic-manual-token')
    expect(JSON.stringify(apple.session.value)).not.toContain('synthetic-manual-token')
    wrapper.unmount()
    expect(apple.tokenDebug.value).toBeNull()
    expect(apple.manualCaptured.value).toBe(false)
  })

  it('freezes the mode while the sheet is open and requires fresh authorization after a mode switch', async () => {
    mocks.fetch.mockResolvedValueOnce(payment()).mockResolvedValueOnce(payment('succeeded'))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.setMode('manual')
    apple.pay()
    apple.setMode('automatic')
    expect(apple.mode.value).toBe('manual')
    await sheet.onpaymentauthorized!({ payment: { token: { paymentData: { data: 'synthetic-old-manual' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-old-id' } } })
    apple.clearToken()
    expect(apple.manualCaptured.value).toBe(true)
    expect(apple.submitted.value).toBe(false)
    apple.setMode('automatic')
    expect(apple.manualCaptured.value).toBe(false)
    expect(apple.tokenDebug.value).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    apple.pay()
    const freshToken = { paymentData: { data: 'synthetic-fresh-automatic' } }
    await sheet.onpaymentauthorized!({ payment: { token: freshToken } })
    expect(mocks.fetch.mock.calls[1]?.[1].body.token).toEqual(freshToken)
    expect(apple.submitted.value).toBe(true)
    apple.setMode('manual')
    expect(apple.mode.value).toBe('automatic')
    wrapper.unmount()
  })

  it('rejects unsafe manual debugging without falling back to payment submission', async () => {
    mocks.fetch.mockResolvedValue(payment())
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.setMode('manual')
    apple.pay()
    await sheet.onpaymentauthorized!({ payment: { token: { paymentData: { data: 'synthetic-private' }, billingContact: { email: 'synthetic-contact' } } } })
    expect(apple.tokenDebug.value).toBeNull()
    expect(apple.tokenDebugUnavailable.value).toBe(true)
    expect(apple.manualCaptured.value).toBe(false)
    expect(apple.error.value).not.toBeNull()
    expect(apple.submitted.value).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(sheet.abort).toHaveBeenCalledOnce()
    expect(sheet.completePayment).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('pagehide'))
    expect(apple.tokenDebugUnavailable.value).toBe(false)
    wrapper.unmount()
  })

  it('clears a manual token when leaving or starting another Wallet authorization', async () => {
    mocks.fetch.mockResolvedValue(payment())
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.setMode('manual')
    apple.pay()
    await sheet.onpaymentauthorized!({ payment: { token: { paymentData: { data: 'synthetic-first' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-first-id' } } })
    apple.pay()
    expect(apple.tokenDebug.value).toBeNull()
    expect(apple.manualCaptured.value).toBe(false)
    await sheet.onpaymentauthorized!({ payment: { token: { paymentData: { data: 'synthetic-second' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-second-id' } } })
    expect(apple.tokenDebug.value).not.toBeNull()
    window.dispatchEvent(new Event('pagehide'))
    expect(apple.tokenDebug.value).toBeNull()
    expect(apple.manualCaptured.value).toBe(false)
    expect(apple.submitted.value).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('snapshots the submitted token for this visit and clears it without adding it to safe evidence', async () => {
    mocks.fetch.mockResolvedValueOnce(payment()).mockResolvedValueOnce(payment('succeeded'))
    const wrapper = await mountSuspended(Harness)
    expect(apple.tokenDebug.value).toBeNull()
    await apple.prepare()
    apple.pay()
    const token = { paymentData: { data: 'synthetic-private-token' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-id' }
    const serialized = JSON.stringify(token)
    sheet.onpaymentauthorized!({ payment: { token } })
    token.paymentData.data = 'synthetic-later-mutation'
    await flushPromises()
    expect(apple.tokenDebug.value).toBe(serialized)
    expect(mocks.fetch.mock.calls[1]?.[1].body.token).toEqual(JSON.parse(serialized))
    expect(JSON.stringify(apple.steps.value)).not.toContain('synthetic-private-token')
    expect(JSON.stringify(apple.session.value)).not.toContain('synthetic-private-token')
    apple.clearToken()
    expect(apple.tokenDebug.value).toBeNull()
    sheet.onpaymentauthorized!({ payment: { token } })
    expect(apple.tokenDebug.value).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('clears debugging on pagehide and never submits a token still waiting for a lock', async () => {
    mocks.fetch.mockResolvedValue(payment())
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.pay()
    let run!: () => unknown
    let release!: (value: unknown) => void
    const request = vi.fn((_name, _options, callback) => {
      run = callback
      return new Promise(resolve => { release = resolve })
    })
    vi.stubGlobal('navigator', { locks: { request } })
    const authorize = sheet.onpaymentauthorized!
    authorize({ payment: { token: { paymentData: { data: 'synthetic-private-token' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-id' } } })
    expect(apple.tokenDebug.value).not.toBeNull()
    window.dispatchEvent(new Event('pagehide'))
    expect(apple.tokenDebug.value).toBeNull()
    expect(apple.submitted.value).toBe(false)
    expect(request.mock.calls[0]?.[1].signal.aborted).toBe(true)
    expect(sheet.abort).toHaveBeenCalledOnce()
    await apple.verify()
    expect(apple.canPay.value).toBe(true)
    release(run())
    await flushPromises()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    authorize({ payment: { token: { paymentData: { data: 'synthetic-late-token' } } } })
    expect(apple.tokenDebug.value).toBeNull()
    wrapper.unmount()
  })

  it('preserves an already sent payment across pagehide and accepts its late result without restoring the token', async () => {
    let resolvePayment!: (value: unknown) => void
    mocks.fetch.mockResolvedValueOnce(payment()).mockImplementationOnce(() => new Promise(resolve => { resolvePayment = resolve }))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.pay()
    sheet.onpaymentauthorized!({ payment: { token: { paymentData: { data: 'synthetic-private-token' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-id' } } })
    await flushPromises()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event('pagehide'))
    expect(apple.tokenDebug.value).toBeNull()
    expect(apple.submitted.value).toBe(true)
    expect(apple.canPay.value).toBe(false)
    resolvePayment(payment('succeeded'))
    await flushPromises()
    expect(apple.session.value?.attempt.status).toBe('succeeded')
    expect(apple.tokenDebug.value).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it.each(['processing', 'succeeded'] as const)('preserves server submission truth when cancelling this tab’s unstarted request after recovery to %s', async (status) => {
    mocks.fetch.mockResolvedValueOnce(payment()).mockResolvedValueOnce(payment(status))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.pay()
    vi.stubGlobal('navigator', { locks: { request: vi.fn((_name, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) } })
    sheet.onpaymentauthorized!({ payment: { token: { paymentData: { data: 'synthetic-private-token' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-id' } } })
    await apple.verify()
    window.dispatchEvent(new Event('pagehide'))
    await flushPromises()
    expect(apple.session.value?.attempt.status).toBe(status)
    expect(apple.submitted.value).toBe(true)
    expect(apple.canPay.value).toBe(false)
    expect(apple.tokenDebug.value).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('ignores old sheet callbacks after leaving and opening a new sheet from BFCache', async () => {
    mocks.fetch.mockResolvedValue(payment())
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.pay()
    const oldCancel = sheet.oncancel!
    const oldValidate = sheet.onvalidatemerchant!
    const oldAuthorize = sheet.onpaymentauthorized!
    window.dispatchEvent(new Event('pagehide'))
    expect(sheet.oncancel).toBeNull()
    const nextSheet = { begin: vi.fn(), abort: vi.fn(), completeMerchantValidation: vi.fn(), completePayment: vi.fn(), onvalidatemerchant: null, onpaymentauthorized: null, oncancel: null }
    mocks.constructor.mockReturnValue(Object.assign(function ApplePay() { return nextSheet }, { STATUS_SUCCESS: 0, STATUS_FAILURE: 1 }))
    apple.pay()
    oldCancel()
    await oldValidate({ validationURL: 'https://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession' })
    oldAuthorize({ payment: { token: { paymentData: { data: 'synthetic-old-token' } } } })
    await flushPromises()
    expect(apple.sheetOpen.value).toBe(true)
    expect(apple.canPay.value).toBe(false)
    expect(apple.tokenDebug.value).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('clears the snapshot on cancellation and disposal, and blocks unexpected fields only in debugging', async () => {
    mocks.fetch.mockResolvedValueOnce(payment()).mockResolvedValueOnce(payment('succeeded'))
    const wrapper = await mountSuspended(Harness)
    await apple.prepare()
    apple.pay()
    const token = { paymentData: { data: 'synthetic-private-token' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-id', billingContact: { email: 'synthetic-contact' } }
    sheet.onpaymentauthorized!({ payment: { token } })
    await flushPromises()
    expect(apple.tokenDebug.value).toBeNull()
    expect(apple.tokenDebugUnavailable.value).toBe(true)
    expect(mocks.fetch.mock.calls[1]?.[1].body.token).toEqual(token)
    sheet.oncancel!()
    expect(apple.tokenDebugUnavailable.value).toBe(false)
    wrapper.unmount()
    expect(apple.tokenDebug.value).toBeNull()
  })

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
    expect(apple.submitting.value).toBe(true)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(sheet.completePayment).toHaveBeenCalledExactlyOnceWith({ status: 1 })
    expect(apple.session.value?.attempt.status).toBe('processing')
    expect(apple.canPay.value).toBe(false)
    expect(apple.sheetOpen.value).toBe(false)
    expect(apple.submitting.value).toBe(true)
    finish(payment('succeeded'))
    await vi.advanceTimersByTimeAsync(0)
    expect(apple.session.value?.attempt.status).toBe('succeeded')
    expect(apple.submitting.value).toBe(false)
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
    expect(apple.submitting.value).toBe(true)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(sheet.completePayment).toHaveBeenCalledExactlyOnceWith({ status: 1 })
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.fetch.mock.calls.filter(([url]) => url.endsWith('/pay'))).toHaveLength(0)
    expect(apple.submitting.value).toBe(false)
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
