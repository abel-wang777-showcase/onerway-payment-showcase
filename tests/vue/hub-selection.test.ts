import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { useRouter } from '#app'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick, reactive } from 'vue'
import type { LocationQuery } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHubSelection } from '../../app/composables/useHubSelection'

const navigation = vi.hoisted(() => ({
  route: null as unknown as { path: string, query: LocationQuery, hash: string },
  replace: vi.fn(),
}))
mockNuxtImport('useRoute', () => () => navigation.route)

let hub: ReturnType<typeof useHubSelection>
let restoreRoute: (() => void) | undefined
const Harness = defineComponent({
  setup() {
    const router = useRouter()
    const initialRoute = router.currentRoute.value
    Object.assign(navigation.route, { ...initialRoute, ...navigation.route })
    router.currentRoute.value = navigation.route as typeof initialRoute
    restoreRoute = () => { router.currentRoute.value = initialRoute }
    vi.spyOn(router, 'replace').mockImplementation(navigation.replace)
    hub = useHubSelection()
    return () => null
  },
})
let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

async function mount(query: LocationQuery = {}) {
  navigation.route.query = query
  wrapper = await mountSuspended(Harness)
}

async function settle() {
  await nextTick()
  await flushPromises()
  await nextTick()
}

beforeEach(() => {
  navigation.route = reactive({ path: '/', query: {}, hash: '' })
  navigation.replace.mockReset()
  navigation.replace.mockImplementation(async (location: { path: string, query: LocationQuery }) => {
    navigation.route.path = location.path
    navigation.route.query = location.query
  })
})
afterEach(() => {
  wrapper?.unmount()
  restoreRoute?.()
  vi.restoreAllMocks()
})

describe('Demo Hub selection', () => {
  it.each(['google-pay', 'apple-pay'] as const)('keeps %s when switching between supported integrations', async (method) => {
    await mount({ journey: 'standard-success', method })
    hub.selection.value = { ...hub.selection.value, integration: 'direct-api' }
    expect(hub.selection.value.method).toBe(method)
    expect(hub.journeyId.value).toBe(`${method}-direct`)
    await settle()
    expect(navigation.route.query).toMatchObject({ journey: `${method}-direct`, method })

    hub.selection.value = { ...hub.selection.value, integration: 'web-js-sdk' }
    expect(hub.selection.value.method).toBe(method)
    expect(hub.journeyId.value).toBe('standard-success')
    await settle()
    expect(navigation.route.query).toMatchObject({ journey: 'standard-success', method })
  })

  it('does not restore an older Direct URL while a newer SDK subscription choice is being saved', async () => {
    const pending: { complete: () => void }[] = []
    navigation.replace.mockImplementation((location: { path: string, query: LocationQuery }) => new Promise<void>((resolve) => {
      pending.push({ complete: () => {
        navigation.route.path = location.path
        navigation.route.query = location.query
        resolve()
      } })
    }))
    await mount({ journey: 'standard-success', method: 'google-pay', mode: 'payment' })

    hub.selection.value = { ...hub.selection.value, integration: 'direct-api' }
    await settle()
    hub.selection.value = { ...hub.selection.value, integration: 'web-js-sdk' }
    hub.billingMode.value = 'subscription'
    await settle()
    expect(pending).toHaveLength(2)

    // The first router.replace now completes after the visitor has already selected SDK.
    pending[0]!.complete()
    await settle()
    expect(hub.selection.value.integration).toBe('web-js-sdk')
    expect(hub.selection.value.method).toBe('google-pay')
    expect(hub.billingMode.value).toBe('subscription')
    expect(hub.billingItems.value).toContainEqual(expect.objectContaining({ value: 'subscription', disabled: false }))

    pending[1]!.complete()
    await settle()
    expect(navigation.route.query).toMatchObject({ journey: 'standard-success', method: 'google-pay', mode: 'subscription' })
    expect(navigation.replace).toHaveBeenCalledTimes(2)

    // After persistence has settled, actual history navigation remains authoritative.
    navigation.route.query = { journey: 'google-pay-direct', method: 'google-pay', mode: 'payment' }
    await settle()
    expect(hub.selection.value.integration).toBe('direct-api')
    expect(hub.billingMode.value).toBe('payment')
    expect(navigation.replace).toHaveBeenCalledTimes(2)
  })

  it('falls back to the hosted method and journey when the chosen wallet is unsupported', async () => {
    await mount({ journey: 'google-pay-direct', method: 'google-pay' })
    hub.selection.value = { ...hub.selection.value, integration: 'checkout' }
    expect(hub.selection.value.method).toBe('all')
    expect(hub.journeyId.value).toBe('hosted-checkout')
    await settle()
    expect(navigation.route.query).toMatchObject({ journey: 'hosted-checkout', method: 'all' })
  })

  it('keeps subscription across supported integrations and exits it for Direct', async () => {
    await mount({ mode: 'subscription', plan: 'halden-daily-essentials-v1' })
    expect(hub.billingMode.value).toBe('subscription')
    hub.selection.value = { ...hub.selection.value, integration: 'checkout' }
    expect(hub.billingMode.value).toBe('subscription')
    expect(hub.passportFacts.value).toContainEqual({ label: 'Initial checkout', value: 'Choose on Checkout' })
    await settle()
    expect(navigation.route.query).toMatchObject({ journey: 'hosted-checkout', mode: 'subscription', plan: 'halden-daily-essentials-v1' })

    hub.selection.value = { ...hub.selection.value, integration: 'direct-api' }
    expect(hub.billingMode.value).toBe('payment')
    hub.billingMode.value = 'subscription'
    expect(hub.billingMode.value).toBe('payment')
    await settle()
    expect(navigation.route.query).not.toHaveProperty('plan')
  })

  it('reads history navigation atomically without rewriting already valid URL choices', async () => {
    const standard = { journey: 'standard-success', method: 'card', mode: 'payment' }
    const subscription = { journey: 'hosted-checkout', method: 'all', mode: 'subscription', plan: 'halden-daily-essentials-v1' }
    await mount(standard)
    navigation.route.query = subscription
    await settle()
    expect(hub.selection.value).toEqual({ scene: 'ecommerce', integration: 'checkout', method: 'all' })
    expect(hub.journeyId.value).toBe('hosted-checkout')
    expect(hub.billingMode.value).toBe('subscription')

    navigation.route.query = standard
    await settle()
    expect(hub.selection.value).toEqual({ scene: 'ecommerce', integration: 'web-js-sdk', method: 'card' })
    expect(hub.journeyId.value).toBe('standard-success')
    expect(hub.billingMode.value).toBe('payment')
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it('normalizes incompatible URL choices and writes only allowlisted display parameters', async () => {
    await mount({ journey: 'three-ds-success', method: 'google-pay', mode: 'payment', token: 'must-not-copy' })
    expect(hub.journeyId.value).toBe('standard-success')
    hub.selection.value = { ...hub.selection.value, integration: 'direct-api' }
    await settle()
    expect(navigation.replace).toHaveBeenCalledTimes(1)
    expect(navigation.route.query).toEqual({ journey: 'google-pay-direct', method: 'google-pay', mode: 'payment' })

    navigation.route.query = { journey: ['invalid', 'array'], method: 'unknown', mode: 'subscription', plan: 'unknown' }
    await settle()
    expect(hub.journeyId.value).toBe('standard-success')
    expect(hub.selection.value.method).toBe('card')
    expect(hub.subscriptionPlanId.value).toBe('halden-daily-essentials-v1')
    expect(navigation.replace).toHaveBeenCalledTimes(2)
  })

  it('does not overwrite payment-page navigation after leaving the Hub', async () => {
    await mount()
    navigation.route.path = '/halden/sdk/order-1'
    navigation.route.query = {}
    hub.billingMode.value = 'subscription'
    await settle()
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})
