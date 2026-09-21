import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizationState } from '../../shared/payment/authorization'
import Authorization from '../../app/components/payment/Authorization.vue'
import ResultPage from '../../app/pages/halden/result/[order].vue'
import ReturnPage from '../../app/pages/halden/return/[order].vue'
import Hosted from '../../app/components/payment/Hosted.vue'
import { authorizationSession } from './authorization-fixture'

const nuxt = vi.hoisted(() => ({ navigateTo: vi.fn(), useDemo: vi.fn(), useRoute: vi.fn(), useSdk: vi.fn() }))
mockNuxtImport('navigateTo', () => nuxt.navigateTo)
mockNuxtImport('useDemo', () => nuxt.useDemo)
mockNuxtImport('useRoute', () => nuxt.useRoute)
mockNuxtImport('useSdk', () => nuxt.useSdk)

function state(overrides: Partial<AuthorizationState> = {}) {
  return {
    session: shallowRef(authorizationSession(overrides)), subscription: shallowRef(null),
    retainedSubscriptionOrderId: shallowRef(null), retainedSubscriptionPaymentStatus: shallowRef(null),
    authorizationRequest: shallowRef(null), authorizationSubmitting: shallowRef(false),
    error: shallowRef(null), failure: shallowRef(null), recoveryFailure: shallowRef(null), recoveryError: shallowRef(null),
    stage: shallowRef('not_completed'), restoring: shallowRef(false), retrying: shallowRef(false),
    canOpenCheckout: shallowRef(false), openCheckout: vi.fn(), start: vi.fn(),
    recover: vi.fn(), verify: vi.fn(), retry: vi.fn(), refreshAuthorization: vi.fn(), operateAuthorization: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  nuxt.useRoute.mockReturnValue({ params: { order: 'order-auth-1' }, path: '/halden/result/order-auth-1' })
  nuxt.useDemo.mockReturnValue({ session: shallowRef(null), restored: shallowRef(true), restore: vi.fn(), retry: vi.fn() })
})

describe('authorization funds presentation', () => {
  it('offers full capture or void only after funds are authorized', async () => {
    const wrapper = await mountSuspended(Authorization, { props: { authorization: authorizationSession().attempt.authorization!, amount: '$5.00' } })
    expect(wrapper.text()).toContain('Not charged')
    const capture = wrapper.findAll('button').find(button => button.text() === 'Capture $5.00')!
    const voidAction = wrapper.findAll('button').find(button => button.text() === 'Void authorization')!
    await capture.trigger('click')
    await voidAction.trigger('click')
    expect(wrapper.emitted('operate')).toEqual([['CAPTURE'], ['VOID']])
    wrapper.unmount()
  })

  it.each(['pending', 'unknown', 'confirmed'] as const)('keeps both actions unavailable for an existing %s operation', async (status) => {
    const authorization = authorizationSession({ operation: { type: 'CAPTURE', status, merchantTxnId: 'merchant-capture-1' } }).attempt.authorization!
    const wrapper = await mountSuspended(Authorization, { props: { authorization, amount: '$5.00' } })
    expect(wrapper.text()).toContain('Capture awaiting confirmation')
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Refresh status'])
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
    wrapper.unmount()
  })

  it('locks both actions during submission and while the browser awaits recovery', async () => {
    const wrapper = await mountSuspended(Authorization, { props: { authorization: authorizationSession().attempt.authorization!, amount: '$5.00', requestedOperation: 'VOID', submitting: true } })
    expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    await wrapper.setProps({ submitting: false })
    expect(wrapper.text()).toContain('Void awaiting confirmation')
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Refresh status'])
    wrapper.unmount()
  })

  it.each([
    ['pending', 'Authorization awaiting confirmation'],
    ['captured', 'Payment captured'],
    ['voided', 'Authorization released'],
  ] as const)('renders the %s funds state without ordinary Retry', async (fundsStatus, label) => {
    const sdk = state({ fundsStatus })
    nuxt.useSdk.mockReturnValue(sdk)
    const wrapper = await mountSuspended(ResultPage)
    await flushPromises()
    expect(wrapper.text()).toContain(label)
    expect(wrapper.text()).not.toContain('Payment was not completed')
    expect(wrapper.findAll('button').some(button => /Retry payment|Capture|Void authorization/.test(button.text()))).toBe(false)
    expect(sdk.verify).not.toHaveBeenCalled()
    expect(nuxt.navigateTo).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows a conflict instead of available merchant operations', async () => {
    const wrapper = await mountSuspended(Authorization, { props: { authorization: authorizationSession({ conflict: true }).attempt.authorization!, amount: '$5.00' } })
    expect(wrapper.text()).toContain('needs review')
    expect(wrapper.text()).not.toContain('Payment captured')
    expect(wrapper.text()).not.toContain('Authorization released')
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Refresh status'])
    wrapper.unmount()
  })

  it('refreshes pending hosted authorization through recovery', async () => {
    const sdk = state({ fundsStatus: 'pending', paymentId: undefined, authTransactionId: undefined })
    nuxt.useSdk.mockReturnValue(sdk)
    nuxt.useRoute.mockReturnValue({ params: { order: 'order-auth-1' }, path: '/halden/hosted/order-auth-1' })
    const wrapper = await mountSuspended(Hosted)
    await flushPromises()
    expect(wrapper.text()).toContain('Authorization awaiting confirmation')
    await wrapper.findAll('button').find(button => button.text() === 'Refresh status')!.trigger('click')
    expect(sdk.refreshAuthorization).toHaveBeenCalledOnce()
    expect(sdk.verify).not.toHaveBeenCalled()
    expect(sdk.start).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([
    ['pending', 'hosted'],
    ['authorized', 'result'],
    ['captured', 'result'],
    ['voided', 'result'],
  ] as const)('restores the %s browser return once and opens its %s page', async (fundsStatus, page) => {
    const sdk = state({ fundsStatus })
    sdk.recover.mockResolvedValue(true)
    nuxt.useSdk.mockReturnValue(sdk)
    nuxt.useRoute.mockReturnValue({ params: { order: 'order-auth-1' }, path: '/halden/return/order-auth-1', query: {} })
    const wrapper = await mountSuspended(ReturnPage)
    await flushPromises()
    expect(sdk.recover).toHaveBeenCalledExactlyOnceWith('order-auth-1', true)
    expect(sdk.verify).not.toHaveBeenCalled()
    expect(nuxt.navigateTo).toHaveBeenCalledExactlyOnceWith(`/halden/${page}/order-auth-1`, { replace: true })
    wrapper.unmount()
  })

  it('keeps ordinary payment verification after a nonterminal browser return', async () => {
    const sdk = state()
    sdk.session.value = { ...sdk.session.value, attempt: { ...sdk.session.value.attempt, authorization: undefined } }
    sdk.recover.mockResolvedValue(true)
    nuxt.useSdk.mockReturnValue(sdk)
    nuxt.useRoute.mockReturnValue({ params: { order: 'order-auth-1' }, path: '/halden/return/order-auth-1', query: {} })
    const wrapper = await mountSuspended(ReturnPage)
    await flushPromises()
    expect(sdk.verify).toHaveBeenCalledOnce()
    expect(nuxt.navigateTo).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
