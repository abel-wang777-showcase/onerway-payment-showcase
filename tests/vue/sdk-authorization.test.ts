import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, shallowRef, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSdk } from '../../app/composables/useSdk'
import { authorizationSession } from './authorization-fixture'

const nuxt = vi.hoisted(() => ({ navigateTo: vi.fn(), useState: vi.fn(), fetch: vi.fn() }))
mockNuxtImport('navigateTo', () => nuxt.navigateTo)
mockNuxtImport('useState', () => nuxt.useState)
mockNuxtImport('$fetch', () => nuxt.fetch)
const state = new Map<string, Ref>()
let sdk: ReturnType<typeof useSdk>
const Harness = defineComponent({
  setup() { sdk = useSdk(); return () => null },
})

beforeEach(() => {
  vi.clearAllMocks()
  nuxt.fetch.mockReset()
  state.clear()
  state.set('sdk-session', shallowRef(authorizationSession()))
  nuxt.useState.mockImplementation((key: string, init: () => unknown) => {
    if (!state.has(key)) state.set(key, shallowRef(init()))
    return state.get(key)
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('authorization request ownership', () => {
  it('opens the result directly when AUTH confirmation arrives before the create response', async () => {
    const confirmed = authorizationSession()
    nuxt.fetch
      .mockResolvedValueOnce({ orderId: confirmed.order.id, integration: 'checkout', create: true })
      .mockResolvedValueOnce({
        ...confirmed,
        event: { id: 'create-auth', attemptId: confirmed.attempt.id, source: 'server', status: 'processing', occurredAt: confirmed.attempt.createdAt },
        redirectUrl: 'https://sandbox-checkout.onerway.com/checkout?session=mock-auth',
      })
    const wrapper = await mountSuspended(Harness)
    vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown, run: () => Promise<unknown>) => run() } })
    await sdk.start('hosted-authorization')
    expect(nuxt.navigateTo).toHaveBeenCalledExactlyOnceWith('/halden/result/order-auth-1')
    expect(sdk.canOpenCheckout.value).toBe(false)
    wrapper.unmount()
  })

  it('sends only the action for the page order and coalesces opposite concurrent actions', async () => {
    let complete!: (value: unknown) => void
    const fetch = nuxt.fetch.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const wrapper = await mountSuspended(Harness)
    const capture = sdk.operateAuthorization('CAPTURE')
    const voidAction = sdk.operateAuthorization('VOID')
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/payment/authorization/order-auth-1', { method: 'POST', body: { type: 'CAPTURE' } })
    expect(sdk.authorizationSubmitting.value).toBe(true)
    complete(authorizationSession({ operation: { type: 'CAPTURE', merchantTxnId: 'capture-1', status: 'pending' } }))
    await Promise.all([capture, voidAction])
    await sdk.operateAuthorization('VOID')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(sdk.session.value?.attempt.authorization?.operation?.type).toBe('CAPTURE')
    wrapper.unmount()
  })

  it('recovers a persisted unknown operation after a lost response without replaying', async () => {
    const fetch = nuxt.fetch
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(authorizationSession({ operation: { type: 'VOID', merchantTxnId: 'void-1', status: 'unknown' } }))
    const wrapper = await mountSuspended(Harness)
    await sdk.operateAuthorization('VOID')
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/payment/authorization/order-auth-1', '/api/payment/recover'])
    expect(sdk.session.value?.attempt.authorization?.operation?.status).toBe('unknown')
    await sdk.operateAuthorization('CAPTURE')
    expect(fetch).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('keeps the browser lock if the operation response and recovery are both unavailable', async () => {
    const fetch = nuxt.fetch.mockRejectedValue(new Error('network unavailable'))
    const wrapper = await mountSuspended(Harness)
    await sdk.operateAuthorization('CAPTURE')
    expect(sdk.authorizationRequest.value).toEqual({ attemptId: 'attempt-auth-1', type: 'CAPTURE' })
    expect(sdk.authorizationSubmitting.value).toBe(false)
    expect(sdk.error.value).toContain('awaiting confirmation')
    await sdk.operateAuthorization('VOID')
    expect(fetch).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('refreshes pending AUTH with no payment id through recovery, never through query or create', async () => {
    const pending = authorizationSession({ fundsStatus: 'pending', paymentId: undefined, authTransactionId: undefined })
    state.set('sdk-session', shallowRef(pending))
    const fetch = nuxt.fetch.mockResolvedValue(pending)
    const wrapper = await mountSuspended(Harness)
    await sdk.verify(12, false)
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/payment/recover', { query: { orderId: 'order-auth-1' } })
    expect(sdk.recoveryFailure.value).toBeNull()
    expect(sdk.session.value?.paymentId).toBeNull()
    expect(nuxt.navigateTo).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each(['CAPTURE', 'VOID'] as const)('accepts queried %s confirmation through recovery without replaying the operation', async (type) => {
    state.set('sdk-session', shallowRef(authorizationSession({ operation: { type, merchantTxnId: 'operation-1', status: 'unknown' } })))
    const confirmed = authorizationSession({
      fundsStatus: type === 'CAPTURE' ? 'captured' : 'voided',
      operation: { type, merchantTxnId: 'operation-1', transactionId: 'operation-transaction-1', status: 'confirmed' },
    })
    const fetch = nuxt.fetch.mockResolvedValue({
      ...confirmed,
      attempt: { ...confirmed.attempt, statusSource: 'query' },
      events: confirmed.events.map(event => ({ ...event, source: 'query' })),
    })
    const wrapper = await mountSuspended(Harness)
    await sdk.refreshAuthorization()
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/payment/recover', { query: { orderId: 'order-auth-1' } })
    expect(sdk.session.value?.attempt.authorization?.fundsStatus).toBe(type === 'CAPTURE' ? 'captured' : 'voided')
    expect(sdk.session.value?.attempt.statusSource).toBe('query')
    expect(nuxt.navigateTo).toHaveBeenCalledExactlyOnceWith('/halden/result/order-auth-1', { replace: true })
    await sdk.operateAuthorization(type)
    expect(fetch).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('prevents ordinary Retry after a voided authorization', async () => {
    state.set('sdk-session', shallowRef(authorizationSession({ fundsStatus: 'voided' })))
    const fetch = nuxt.fetch
    const wrapper = await mountSuspended(Harness)
    await sdk.retry()
    expect(fetch).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
