import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPaymentFailure } from '../../shared/payment/failure'
import type { SdkSession } from '../../shared/payment/sdk'
import type { SubscriptionSummary } from '../../shared/payment/subscription'
import { advanceSession, createSession } from '../../shared/demo/session'
import HubPage from '../../app/pages/index.vue'
import CheckoutPage from '../../app/pages/halden/checkout/[order].vue'
import ResultPage from '../../app/pages/halden/result/[order].vue'
import SdkPage from '../../app/pages/halden/sdk/[order].vue'

const nuxt = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  useDemo: vi.fn(),
  useFetch: vi.fn(),
  useRoute: vi.fn(),
  useSdk: vi.fn(),
}))

mockNuxtImport('navigateTo', () => nuxt.navigateTo)
mockNuxtImport('useDemo', () => nuxt.useDemo)
mockNuxtImport('useFetch', () => nuxt.useFetch)
mockNuxtImport('useRoute', () => nuxt.useRoute)
mockNuxtImport('useSdk', () => nuxt.useSdk)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

function payment(status: 'cancelled' | 'processing' = 'cancelled'): SdkSession {
  const attempt = {
    id: 'attempt-1',
    orderId: 'order-1',
    integration: 'web-js-sdk' as const,
    method: 'card' as const,
    status,
    ...(status === 'cancelled' ? { statusSource: 'query' as const } : {}),
    paymentId: 'payment-1',
    submissionStartedAt: '2026-08-10T00:00:30.000Z',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:01:00.000Z',
  }

  return {
    order: {
      id: 'order-1',
      scene: 'ecommerce',
      item: {
        sku: 'halden-field-jacket',
        name: 'Halden Field Jacket',
        variant: 'Slate / M',
        quantity: 1,
        unitAmount: { minor: 500, currency: 'USD' },
      },
      amount: { minor: 500, currency: 'USD' },
      createdAt: '2026-08-10T00:00:00.000Z',
    },
    attempt,
    attempts: [attempt],
    events: [],
    paymentId: 'payment-1',
    query: {
      token: 'a'.repeat(43),
      expiresAt: '2026-08-10T00:05:00.000Z',
    },
  }
}

function subscription(): SubscriptionSummary {
  return {
    planId: 'halden-daily-essentials-v1',
    productName: 'Halden Daily Essentials',
    amount: { minor: 500, currency: 'USD' },
    frequencyType: 'D',
    frequencyPoint: 1,
    expireDate: '2099-12-31',
    state: 'pending',
    statusSource: 'placeholder',
  }
}

function sdkState(overrides: Record<string, unknown> = {}) {
  return {
    session: shallowRef<SdkSession | null>(null),
    subscription: shallowRef(null),
    retainedSubscriptionOrderId: shallowRef(null),
    retainedSubscriptionPaymentStatus: shallowRef(null),
    stage: shallowRef('not_completed'),
    error: shallowRef<string | null>(null),
    failure: shallowRef<ReturnType<typeof getPaymentFailure> | null>(null),
    submitted: shallowRef(false),
    elementRevision: shallowRef(0),
    restoring: shallowRef(false),
    retrying: shallowRef(false),
    start: vi.fn(),
    startSubscription: vi.fn(),
    restore: vi.fn(),
    recover: vi.fn(),
    probeRecovery: vi.fn().mockResolvedValue(false),
    loading: vi.fn(),
    ready: vi.fn(),
    loadFailed: vi.fn(),
    reloadElement: vi.fn(),
    submit: vi.fn(),
    acceptResult: vi.fn(),
    verify: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  nuxt.useRoute.mockReturnValue({ params: { order: 'order-1' }, query: {} })
  nuxt.useFetch.mockResolvedValue({
    data: shallowRef({
      profile: 'sandbox',
      environment: 'Sandbox',
      transactionPolicy: 'sandbox-only',
      canonicalOrigin: window.location.origin,
      sdk: {
        release: 'v4/latest',
        url: 'https://sdk.test/v4.js',
      },
    }),
  })
  nuxt.useDemo.mockReturnValue({
    session: shallowRef(null),
    restored: shallowRef(true),
    restore: vi.fn(),
    start: vi.fn(),
    retry: vi.fn(),
  })
})

describe('payment restoration pages', () => {
  it('keeps Retry restoration available after the first checkout recovery fails', async () => {
    const request = deferred<boolean>()
    const failure = shallowRef<ReturnType<typeof getPaymentFailure> | null>(
      getPaymentFailure('recovery', { status: 503 }),
    )
    const error = shallowRef<string | null>(failure.value.description)
    const restoring = shallowRef(false)
    const recover = vi.fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => {
        restoring.value = true
        failure.value = null
        error.value = null
        return request.promise.finally(() => {
          restoring.value = false
        })
      })
    nuxt.useSdk.mockReturnValue(sdkState({ error, failure, recover, restoring }))

    const wrapper = await mountSuspended(SdkPage, { attachTo: document.body })
    await flushPromises()
    const action = wrapper.findAll('button').find(button => button.text().includes('Retry restoration'))!

    expect(action.exists()).toBe(true)
    action.element.focus()
    action.element.click()
    await nextTick()

    expect(wrapper.text()).toContain('Retry restoration')
    expect(wrapper.text()).toContain('Restoring Sandbox checkout')

    failure.value = getPaymentFailure('recovery', { status: 503 })
    error.value = 'Restoration is still unavailable. Retry this same order.'
    request.resolve(false)
    await flushPromises()

    expect(wrapper.text()).toContain('Restoration is still unavailable')
    expect(document.activeElement).toBe(wrapper.get('h1').element)
    wrapper.unmount()
  })

  it('keeps a current Sandbox session recovery-only when create is unknown', async () => {
    const request = deferred<undefined>()
    const session = shallowRef<SdkSession | null>(payment('processing'))
    const stage = shallowRef('not_completed')
    const error = shallowRef<string | null>(null)
    const failure = shallowRef<ReturnType<typeof getPaymentFailure> | null>(getPaymentFailure('create'))
    const restoring = shallowRef(false)
    const recover = vi.fn()
    const verify = vi.fn()
    const start = vi.fn()
    const restore = vi.fn(() => {
      stage.value = 'creating'
      restoring.value = true
      failure.value = null
      return request.promise.finally(() => {
        restoring.value = false
      })
    })
    nuxt.useSdk.mockReturnValue(sdkState({
      error,
      failure,
      recover,
      restore,
      restoring,
      session,
      stage,
      start,
      submitted: shallowRef(true),
      verify,
    }))

    const wrapper = await mountSuspended(SdkPage, { attachTo: document.body })
    await flushPromises()
    const action = wrapper.findAll('button').find(button => button.text().includes('Restore existing Sandbox checkout'))!
    action.element.focus()
    action.element.click()
    await nextTick()

    expect(restore).toHaveBeenCalledOnce()
    expect(recover).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Restoring existing Sandbox checkout')
    expect(wrapper.text()).not.toContain('Creating Sandbox checkout')
    expect(document.activeElement).toBe(wrapper.get('[data-focus-target="payment-status"]').element)

    failure.value = getPaymentFailure('recovery', { status: 503 })
    error.value = 'The existing Sandbox checkout is still unavailable.'
    request.resolve(undefined)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('existing Sandbox checkout is still unavailable')
    wrapper.unmount()
  })

  it('moves focus to checkout after an empty-state restoration succeeds', async () => {
    const request = deferred<boolean>()
    const session = shallowRef<SdkSession | null>(null)
    const failure = shallowRef<ReturnType<typeof getPaymentFailure> | null>(getPaymentFailure('recovery', { status: 503 }))
    const restoring = shallowRef(false)
    const recover = vi.fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => {
        restoring.value = true
        failure.value = null
        return request.promise.finally(() => {
          restoring.value = false
        })
      })
    nuxt.useSdk.mockReturnValue(sdkState({ failure, recover, restoring, session }))

    const wrapper = await mountSuspended(SdkPage, { attachTo: document.body })
    await flushPromises()
    const action = wrapper.findAll('button').find(button => button.text().includes('Retry restoration'))!
    action.element.focus()
    action.element.click()
    session.value = payment('processing')
    request.resolve(true)
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('h1').element)
    wrapper.unmount()
  })

  it('keeps restoration and Retry mutually exclusive while result recovery is pending', async () => {
    const request = deferred<boolean>()
    const current = payment()
    const session = shallowRef<SdkSession | null>(current)
    const failure = shallowRef<ReturnType<typeof getPaymentFailure> | null>(getPaymentFailure('retry'))
    const restoring = shallowRef(false)
    const retry = vi.fn()
    const recover = vi.fn(() => {
      restoring.value = true
      failure.value = null
      return request.promise.finally(() => {
        restoring.value = false
      })
    })
    nuxt.useSdk.mockReturnValue(sdkState({ failure, recover, restoring, retry, session }))

    const wrapper = await mountSuspended(ResultPage)
    await flushPromises()
    const action = wrapper.findAll('button').find(button => button.text().includes('Restore this order'))

    expect(action?.exists()).toBe(true)
    action?.element.click()
    await nextTick()

    expect(wrapper.text()).toContain('Restore this order')
    expect(wrapper.text()).not.toContain('Retry payment')
    expect(retry).not.toHaveBeenCalled()

    request.resolve(true)
    await flushPromises()
  })

  it('keeps the Retry intent and button stable during child recovery', async () => {
    const request = deferred<undefined>()
    const session = shallowRef<SdkSession | null>(payment())
    const retrying = shallowRef(false)
    const restoring = shallowRef(false)
    const failure = shallowRef<ReturnType<typeof getPaymentFailure> | null>(null)
    const error = shallowRef<string | null>(null)
    const retry = vi.fn(() => {
      retrying.value = true
      restoring.value = true
      return request.promise.finally(() => {
        failure.value = getPaymentFailure('retry')
        error.value = failure.value.description
        restoring.value = false
        retrying.value = false
      })
    })
    nuxt.useSdk.mockReturnValue(sdkState({ error, failure, restoring, retry, retrying, session }))

    const wrapper = await mountSuspended(ResultPage, { attachTo: document.body })
    await flushPromises()
    const action = wrapper.findAll('button').find(button => button.text().includes('Retry payment'))!
    action.element.focus()
    action.element.click()
    await nextTick()
    const pending = wrapper.findAll('button').find(button => button.text().includes('Retry payment'))!

    expect(pending.element).toBe(action.element)
    expect(wrapper.text()).not.toContain('Restore this order')

    request.resolve(undefined)
    await flushPromises()
    const restore = wrapper.findAll('button').find(button => button.text().includes('Restore this order'))!

    expect(wrapper.get('[role="alert"]').text()).toContain('Retry result unknown')
    expect(document.activeElement).toBe(restore.element)
    wrapper.unmount()
  })

  it('moves focus to the result after an empty-state restoration succeeds', async () => {
    const request = deferred<boolean>()
    const session = shallowRef<SdkSession | null>(null)
    const failure = shallowRef<ReturnType<typeof getPaymentFailure> | null>(getPaymentFailure('recovery', { status: 503 }))
    const restoring = shallowRef(false)
    const recover = vi.fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => {
        restoring.value = true
        failure.value = null
        return request.promise.finally(() => {
          restoring.value = false
        })
      })
    nuxt.useSdk.mockReturnValue(sdkState({ failure, recover, restoring, session }))

    const wrapper = await mountSuspended(ResultPage, { attachTo: document.body })
    await flushPromises()
    const action = wrapper.findAll('button').find(button => button.text().includes('Retry restoration'))!
    action.element.focus()
    action.element.click()
    session.value = payment('cancelled')
    request.resolve(true)
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('h1').element)
    wrapper.unmount()
  })

  it('announces a repeated result restoration failure by returning focus to its title', async () => {
    const request = deferred<boolean>()
    const failure = shallowRef<ReturnType<typeof getPaymentFailure> | null>(getPaymentFailure('recovery', { status: 503 }))
    const error = shallowRef<string | null>(failure.value.description)
    const restoring = shallowRef(false)
    const recover = vi.fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => {
        restoring.value = true
        failure.value = null
        error.value = null
        return request.promise.finally(() => {
          restoring.value = false
        })
      })
    nuxt.useSdk.mockReturnValue(sdkState({ error, failure, recover, restoring }))

    const wrapper = await mountSuspended(ResultPage, { attachTo: document.body })
    await flushPromises()
    const action = wrapper.findAll('button').find(button => button.text().includes('Retry restoration'))!
    action.element.focus()
    action.element.click()
    failure.value = getPaymentFailure('recovery', { status: 503 })
    error.value = 'Result restoration is still unavailable.'
    request.resolve(false)
    await flushPromises()

    expect(wrapper.text()).toContain('Result restoration is still unavailable')
    expect(document.activeElement).toBe(wrapper.get('h1').element)
    wrapper.unmount()
  })

  it('focuses the result when initial verification becomes terminal in place', async () => {
    const session = shallowRef<SdkSession | null>(payment('processing'))
    const verify = vi.fn(() => {
      session.value = payment('cancelled')
    })
    nuxt.useSdk.mockReturnValue(sdkState({ session, verify }))

    const wrapper = await mountSuspended(ResultPage, { attachTo: document.body })
    await flushPromises()

    expect(verify).toHaveBeenCalledWith(1, false)
    expect(document.activeElement).toBe(wrapper.get('h1').element)
    wrapper.unmount()
  })

  it('separates expected method, actual wallet, funding network and SDK callback facts', async () => {
    const current = payment()
    const attempt = {
      ...current.attempt,
      method: 'google-pay' as const,
      actualWallet: 'google-pay' as const,
      fundingNetwork: 'VISA',
      transactionId: '9000000000000000002',
      attributionTransactionId: '9000000000000000002',
    }
    const session = shallowRef<SdkSession | null>({
      ...current,
      attempt,
      attempts: [attempt],
      paymentMethod: 'GooglePay',
    })
    nuxt.useSdk.mockReturnValue(sdkState({ session }))

    const wrapper = await mountSuspended(ResultPage)
    await flushPromises()
    wrapper.findAll('button').find(button => button.text().includes('Show Technical details'))
      ?.element.click()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('expectedMethod')
    expect(text).toContain('actualWallet')
    expect(text).toContain('Google Pay')
    expect(text).toContain('fundingNetwork')
    expect(text).toContain('VISA')
    expect(text).toContain('server-side transaction query')
    expect(text).toContain('sdkCallbackMethod')
  })

  it('labels wallet-only transaction attribution as server-verified', async () => {
    const current = payment()
    const attempt = {
      ...current.attempt,
      method: 'google-pay' as const,
      actualWallet: 'google-pay' as const,
      attributionTransactionId: '9000000000000000002',
      transactionId: '9000000000000000002',
    }
    const session = shallowRef<SdkSession | null>({
      ...current,
      attempt,
      attempts: [attempt],
    })
    nuxt.useSdk.mockReturnValue(sdkState({ session }))

    const wrapper = await mountSuspended(ResultPage)
    await flushPromises()
    wrapper.findAll('button').find(button => button.text().includes('Show Technical details'))
      ?.element.click()
    await flushPromises()

    expect(wrapper.text()).toContain('server-side transaction query')
    expect(wrapper.text()).toContain('Google Pay')
  })

  it('keeps DIRECT method attribution out of subscription checkout and result UI', async () => {
    const current = payment('processing')
    const subscriptionState = shallowRef<SubscriptionSummary | null>(subscription())
    nuxt.useSdk.mockReturnValue(sdkState({
      session: shallowRef<SdkSession | null>(current),
      stage: shallowRef('ready'),
      subscription: subscriptionState,
    }))

    const checkout = await mountSuspended(SdkPage)
    await flushPromises()
    expect(checkout.text()).not.toContain('Expected · Card')
    expect(checkout.text()).toContain('Pay by card')
    checkout.unmount()

    const result = await mountSuspended(ResultPage)
    await flushPromises()
    result.findAll('button').find(button => button.text().includes('Show Technical details'))
      ?.element.click()
    await flushPromises()

    expect(result.text()).not.toContain('expectedMethod')
    expect(result.text()).not.toContain('actualWallet')
    expect(result.text()).not.toContain('fundingNetwork')
    result.unmount()
  })

  it('moves focus to Sandbox status after reloading the same Element', async () => {
    const current = payment('processing')
    const { submissionStartedAt: _submissionStartedAt, ...attempt } = current.attempt
    const session = shallowRef<SdkSession | null>({ ...current, attempt, attempts: [attempt] })
    const stage = shallowRef('not_completed')
    const failure = shallowRef<ReturnType<typeof getPaymentFailure> | null>(getPaymentFailure('load'))
    const reloadElement = vi.fn(() => {
      stage.value = 'loading'
      failure.value = null
    })
    nuxt.useSdk.mockReturnValue(sdkState({ failure, reloadElement, session, stage }))

    const wrapper = await mountSuspended(SdkPage, { attachTo: document.body })
    await flushPromises()
    const action = wrapper.findAll('button').find(button => button.text().includes('Reload secure form'))!
    action.element.focus()
    action.element.click()
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('[data-focus-target="payment-status"]').element)
    wrapper.unmount()
  })

  it('routes Element events only for the current paymentId and generation', async () => {
    const current = payment('processing')
    const { submissionStartedAt: _submissionStartedAt, ...baseAttempt } = current.attempt
    const attempt = { ...baseAttempt, method: 'google-pay' as const }
    const session = shallowRef<SdkSession | null>({ ...current, attempt, attempts: [attempt] })
    const ready = vi.fn()
    const loadFailed = vi.fn()
    const acceptResult = vi.fn()
    const ElementProbe = defineComponent({
      name: 'PaymentElement',
      props: {
        generation: { type: Number, required: true },
        paymentId: { type: String, required: true },
        url: { type: String, required: true },
        expectedMethod: { type: String, required: true },
      },
      emits: ['ready', 'error', 'result'],
      template: '<div data-element-probe />',
    })
    nuxt.useSdk.mockReturnValue(sdkState({
      acceptResult,
      loadFailed,
      ready,
      session,
      stage: shallowRef('ready'),
    }))

    const wrapper = await mountSuspended(SdkPage, {
      global: { stubs: { PaymentElement: ElementProbe } },
    })
    await flushPromises()
    const element = wrapper.findComponent(ElementProbe)
    expect(element.props('expectedMethod')).toBe('google-pay')
    expect(wrapper.text()).toContain('Pay by card')
    expect(wrapper.text()).toContain('use the Google Pay button only if the SDK renders it')
    const nextAttempt = {
      ...attempt,
      id: 'attempt-2',
      paymentId: 'payment-2',
      retryOf: attempt.id,
    }

    session.value = {
      ...current,
      attempt: nextAttempt,
      attempts: [attempt, nextAttempt],
      paymentId: 'payment-2',
    }
    element.vm.$emit('ready', 'payment-1', 0)
    element.vm.$emit('error', 'payment-1', 0)
    element.vm.$emit('result', 'payment-1', 0, { paymentId: 'payment-1' })
    element.vm.$emit('ready', 'payment-2', -1)
    element.vm.$emit('error', 'payment-2', -1)
    element.vm.$emit('result', 'payment-2', -1, { paymentId: 'payment-2' })

    expect(ready).not.toHaveBeenCalled()
    expect(loadFailed).not.toHaveBeenCalled()
    expect(acceptResult).not.toHaveBeenCalled()

    const result = { paymentId: 'payment-2', paymentStatus: 'P' }
    element.vm.$emit('ready', 'payment-2', 0)
    element.vm.$emit('error', 'payment-2', 0)
    element.vm.$emit('result', 'payment-2', 0, result)

    expect(ready).toHaveBeenCalledOnce()
    expect(loadFailed).toHaveBeenCalledOnce()
    expect(acceptResult).toHaveBeenCalledWith(result)
  })

  it('moves focus to Sandbox status before verification finishes', async () => {
    const request = deferred<undefined>()
    const session = shallowRef<SdkSession | null>(payment('processing'))
    const stage = shallowRef('not_completed')
    const failure = shallowRef<ReturnType<typeof getPaymentFailure> | null>(getPaymentFailure('query'))
    const verify = vi.fn(() => {
      stage.value = 'verifying'
      failure.value = null
      return request.promise
    })
    nuxt.useSdk.mockReturnValue(sdkState({
      failure,
      session,
      stage,
      submitted: shallowRef(true),
      verify,
    }))

    const wrapper = await mountSuspended(SdkPage, { attachTo: document.body })
    await flushPromises()
    const action = wrapper.findAll('button').find(button => button.text().includes('Verify existing payment'))!
    action.element.focus()
    action.element.click()
    await nextTick()

    expect(verify).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(wrapper.get('[data-focus-target="payment-status"]').element)

    request.resolve(undefined)
    await flushPromises()
    wrapper.unmount()
  })

  it('moves focus to simulated status after form reload', async () => {
    const initial = createSession('form-load-recovery')
    const session = shallowRef(advanceSession(initial))
    const reload = vi.fn(() => {
      session.value = advanceSession(session.value)
    })
    nuxt.useRoute.mockReturnValue({ params: { order: session.value.order.id } })
    nuxt.useDemo.mockReturnValue({
      session,
      restored: shallowRef(true),
      resume: vi.fn(),
      pay: vi.fn(),
      verify: vi.fn(),
      reload,
    })

    const wrapper = await mountSuspended(CheckoutPage, { attachTo: document.body })
    await flushPromises()
    const action = wrapper.findAll('button').find(button => button.text().includes('Reload simulated secure form'))!
    action.element.focus()
    action.element.click()
    await flushPromises()

    expect(reload).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(wrapper.get('[data-focus-target="payment-status"]').element)
    wrapper.unmount()
  })

  it('announces restoration instead of payment creation while Hub recovery is pending', async () => {
    const request = deferred<undefined>()
    const failure = shallowRef<ReturnType<typeof getPaymentFailure> | null>(getPaymentFailure('create'))
    const restoring = shallowRef(false)
    const stage = shallowRef('not_completed')
    const error = shallowRef<string | null>(null)
    const restore = vi.fn(() => {
      stage.value = 'creating'
      restoring.value = true
      failure.value = null
      return request.promise.finally(() => {
        failure.value = getPaymentFailure('recovery', { status: 503 })
        error.value = 'Sandbox restoration is still unavailable.'
        restoring.value = false
        stage.value = 'not_completed'
      })
    })
    nuxt.useSdk.mockReturnValue(sdkState({ error, failure, restore, restoring, stage }))

    const wrapper = await mountSuspended(HubPage)
    const action = wrapper.findAll('button').find(button => button.text().includes('Restore existing'))

    expect(action?.exists()).toBe(true)
    action?.element.click()
    await nextTick()

    expect(wrapper.text()).toContain('Restoring existing Sandbox checkout…')
    expect(wrapper.text()).not.toContain('Creating a new Sandbox payment…')

    request.resolve(undefined)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Sandbox restoration is still unavailable')
  })

  it('moves a Preview Sandbox start to canonical Production before create', async () => {
    const start = vi.fn()
    nuxt.useFetch.mockResolvedValue({
      data: shallowRef({
        profile: 'sandbox',
        environment: 'Sandbox',
        transactionPolicy: 'sandbox-only',
        canonicalOrigin: 'https://showcase.example',
        sdk: {
          release: 'v4/latest',
          url: 'https://sdk.test/v4.js',
        },
      }),
    })
    nuxt.useRoute.mockReturnValue({
      params: {},
      query: { journey: 'three-ds-success' },
    })
    nuxt.useSdk.mockReturnValue(sdkState({ start, stage: shallowRef('ready') }))

    const wrapper = await mountSuspended(HubPage)
    await flushPromises()
    const action = wrapper.findAll('button')
      .find(button => button.text().includes('Continue on canonical Production'))

    expect(action?.exists()).toBe(true)
    action?.element.click()
    await flushPromises()

    expect(nuxt.navigateTo).toHaveBeenCalledWith(
      'https://showcase.example/?journey=three-ds-success&method=card',
      { external: true },
    )
    expect(start).not.toHaveBeenCalled()
  })

  it('does not probe payment recovery from a locked Production Hub', async () => {
    const probeRecovery = vi.fn()
    nuxt.useFetch.mockResolvedValue({
      data: shallowRef({
        profile: 'production',
        environment: 'Production',
        transactionPolicy: 'locked',
        canonicalOrigin: window.location.origin,
        sdk: null,
      }),
    })
    nuxt.useSdk.mockReturnValue(sdkState({ probeRecovery }))

    const wrapper = await mountSuspended(HubPage)
    await flushPromises()

    expect(probeRecovery).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
