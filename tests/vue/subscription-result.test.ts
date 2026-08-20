import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaymentStatus } from '../../shared/payment/attempt'
import type {
  SubscriptionState,
  SubscriptionStatusSource,
  SubscriptionSummary,
} from '../../shared/payment/subscription'
import HaldenLayout from '../../app/layouts/halden.vue'
import ResultPage from '../../app/pages/halden/result/[order].vue'

const nuxt = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  useDemo: vi.fn(),
  useRoute: vi.fn(),
  useSdk: vi.fn(),
}))

mockNuxtImport('navigateTo', () => nuxt.navigateTo)
mockNuxtImport('useDemo', () => nuxt.useDemo)
mockNuxtImport('useRoute', () => nuxt.useRoute)
mockNuxtImport('useSdk', () => nuxt.useSdk)

function subscription(
  state: SubscriptionState,
  statusSource: SubscriptionStatusSource = 'query',
): SubscriptionSummary {
  return {
    planId: 'halden-daily-essentials-v1',
    productName: 'Halden Daily Essentials',
    amount: { minor: 500, currency: 'USD' },
    frequencyType: 'D',
    frequencyPoint: 1,
    expireDate: '2099-12-31',
    state,
    statusSource,
  }
}

function sdkState(
  state: SubscriptionState,
  statusSource: SubscriptionStatusSource = 'query',
) {
  const attempt = {
    id: 'attempt-1',
    orderId: 'order-1',
    integration: 'web-js-sdk' as const,
    method: 'card' as const,
    status: 'succeeded' as const,
    statusSource: 'query' as const,
    merchantTxnId: 'showcase-subscription-1',
    paymentId: 'payment-1',
    transactionId: 'transaction-1',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:01:00.000Z',
  }

  const session = {
      order: {
        id: 'order-1',
        scene: 'ecommerce' as const,
        item: {
          sku: 'HL-SUB-DAILY-005',
          name: 'Halden Daily Essentials',
          variant: 'Daily subscription',
          quantity: 1,
          unitAmount: { minor: 500, currency: 'USD' as const },
        },
        amount: { minor: 500, currency: 'USD' as const },
        fulfillment: 'pending' as const,
        createdAt: '2026-08-17T00:00:00.000Z',
      },
      attempt,
      attempts: [{ id: attempt.id, status: attempt.status }],
      events: [{
        id: 'event-1',
        attemptId: attempt.id,
        source: 'query' as const,
        status: 'succeeded' as const,
        rawStatus: 'S',
        occurredAt: '2026-08-17T00:01:00.000Z',
      }],
      paymentId: 'payment-1',
      query: { token: 'q'.repeat(43), expiresAt: '2026-08-17T00:05:00.000Z' },
    }

  return {
    session: shallowRef<typeof session | null>(session),
    subscription: shallowRef(subscription(state, statusSource)),
    retainedSubscriptionOrderId: shallowRef<string | null>(null),
    retainedSubscriptionPaymentStatus: shallowRef<PaymentStatus | null>(null),
    error: shallowRef(null),
    failure: shallowRef(null),
    restoring: shallowRef(false),
    retrying: shallowRef(false),
    recover: vi.fn(),
    verify: vi.fn(),
    retry: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  nuxt.useRoute.mockReturnValue({ params: { order: 'order-1' } })
  nuxt.useDemo.mockReturnValue({
    session: shallowRef(null),
    restored: shallowRef(true),
    restore: vi.fn(),
    retry: vi.fn(),
  })
})

describe('subscription result outcome', () => {
  it('renders a fresh retained two-axis status without exposing provider identifiers', async () => {
    const state = sdkState('active')
    state.session.value = null
    state.retainedSubscriptionOrderId.value = 'order-1'
    state.retainedSubscriptionPaymentStatus.value = 'succeeded'
    nuxt.useSdk.mockReturnValue(state)

    const wrapper = await mountSuspended(ResultPage)
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('Subscription status restored.')
    expect(wrapper.text()).toContain('Payment audit record has expired')
    expect(wrapper.text()).toContain('succeeded')
    expect(wrapper.text()).toContain('active')
    expect(wrapper.text()).not.toMatch(/payment-1|contract-private|token-private/)
    wrapper.unmount()
  })

  it('keeps a retained subscription result labeled as Sandbox', async () => {
    const state = sdkState('active')
    state.session.value = null
    state.retainedSubscriptionOrderId.value = 'order-1'
    state.retainedSubscriptionPaymentStatus.value = 'succeeded'
    nuxt.useSdk.mockReturnValue(state)
    nuxt.useRoute.mockReturnValue({
      path: '/halden/result/order-1',
      params: { order: 'order-1' },
    })

    const wrapper = await mountSuspended(HaldenLayout)

    expect(wrapper.text()).toContain('Sandbox')
    expect(wrapper.text()).toContain('card fields are hosted by Onerway Sandbox')
    expect(wrapper.text()).not.toContain('This journey is simulated')
    wrapper.unmount()
  })

  it.each([
    ['needs_attention', 'Payment verified · Subscription needs attention.'],
    ['terminal', 'Payment verified · Subscription ended.'],
  ] as const)('distinguishes %s from pending', async (state, title) => {
    nuxt.useSdk.mockReturnValue(sdkState(state))

    const wrapper = await mountSuspended(ResultPage)
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe(title)
    expect(wrapper.text()).not.toContain('Payment verified · Subscription pending.')
    expect(wrapper.text()).toContain(state === 'terminal' ? 'terminal' : 'needs attention')
    wrapper.unmount()
  })

  it('identifies a no-contract terminal state as Webhook verified', async () => {
    nuxt.useSdk.mockReturnValue(sdkState('terminal', 'webhook'))

    const wrapper = await mountSuspended(ResultPage)
    await flushPromises()

    expect(wrapper.text()).toContain('Verified by Subscription Webhook')
    expect(wrapper.text()).not.toContain('Verified by contract query')
    wrapper.unmount()
  })
})
