import type { JourneyId } from '#shared/payment/journey'
import type { LocationQuery } from 'vue-router'
import {
  getSubscriptionPlan,
  isSubscriptionPlanId,
  type SubscriptionPlanId,
} from '#shared/payment/subscription'
import {
  getJourney,
  isJourneyId,
  JOURNEY_IDS,
  JOURNEYS,
  supportsSandboxMethod,
} from '#shared/payment/journey'
import {
  getCapability,
  PAYMENT_METHODS,
  SCENES,
  type CapabilityStatus,
  type IntegrationId,
  type PaymentMethodId,
  type SceneId,
} from '#shared/payment/capability'

const sceneLabels: Record<SceneId, string> = {
  ecommerce: 'E-commerce',
  game: 'Game',
  live: 'Live',
  ai: 'AI',
}
const integrationLabels: Record<IntegrationId, string> = {
  'web-js-sdk': 'Web JS SDK',
  'checkout': 'Checkout',
  'direct-api': 'Direct API',
}
const integrationOrder: IntegrationId[] = ['checkout', 'web-js-sdk', 'direct-api']
const integrationDescriptions: Record<IntegrationId, string> = {
  'web-js-sdk': 'Pay with an embedded payment form on the merchant page.',
  'checkout': 'Continue to Onerway Checkout, then return to the merchant.',
  'direct-api': 'Authorize with your wallet, then follow the result on the merchant page.',
}
const methodLabels: Record<PaymentMethodId, string> = {
  card: 'Card',
  apm: 'APM',
  all: 'Choose on Checkout',
  'google-pay': 'Google Pay',
  'apple-pay': 'Apple Pay',
}
const statusLabels: Record<CapabilityStatus, string> = {
  available: 'Available',
  conditional: 'Conditional',
  planned: 'Planned',
  unavailable: 'Unavailable',
}

export interface HubOption {
  value: string
  label: string
  title?: string
  status?: CapabilityStatus
  description?: string
  disabled?: boolean
}

function option(
  value: string,
  label: string,
  status: CapabilityStatus,
  runnable: boolean,
  condition?: string,
): HubOption {
  const description = condition
    ?? (status === 'available'
      ? 'Available in this showcase.'
      : status === 'planned'
        ? 'Planned for a future delivery.'
        : 'Not available for this combination.')

  return {
    value,
    label: `${label} · ${statusLabels[status]}`,
    title: label,
    status,
    description,
    disabled: !runnable,
  }
}

interface Selection {
  scene: SceneId
  integration: IntegrationId
  method: PaymentMethodId
}

interface HubState {
  selection: Selection
  journeyId: JourneyId
  billingMode: 'payment' | 'subscription'
  subscriptionPlanId: SubscriptionPlanId
}

function defaultMethod(integration: IntegrationId): PaymentMethodId {
  return integration === 'direct-api' ? 'apple-pay' : integration === 'checkout' ? 'all' : 'card'
}

function isSandboxJourney(value: unknown): value is JourneyId {
  return isJourneyId(value) && getJourney(value).modes.includes('sandbox')
}

function matchesJourney(id: JourneyId, selection: Selection): boolean {
  const journey = getJourney(id)
  return journey.modes.includes('sandbox')
    && journey.scene === selection.scene && journey.integration === selection.integration
    && (journey.method === selection.method || supportsSandboxMethod(journey, selection.method))
}

function matchingJourney(selection: Selection, preferred: JourneyId): JourneyId {
  return matchesJourney(preferred, selection)
    ? preferred
    : JOURNEY_IDS.find(id => matchesJourney(id, selection)) ?? 'standard-success'
}

function readQuery(query: LocationQuery): HubState {
  const requested = isSandboxJourney(query.journey) ? query.journey : 'standard-success'
  const journey = getJourney(requested)
  const method = typeof query.method === 'string'
    && PAYMENT_METHODS.includes(query.method as PaymentMethodId)
    && getCapability(journey.scene, journey.integration, query.method as PaymentMethodId).runnable
    ? query.method as PaymentMethodId
    : journey.method
  const selection: Selection = { scene: journey.scene, integration: journey.integration, method }
  return {
    selection,
    journeyId: matchingJourney(selection, requested),
    billingMode: query.mode === 'subscription' && journey.integration !== 'direct-api' ? 'subscription' : 'payment',
    subscriptionPlanId: isSubscriptionPlanId(query.plan) ? query.plan : 'halden-daily-essentials-v1',
  }
}

export function useHubSelection() {
  const router = useRouter()
  const route = router.currentRoute
  const state = shallowRef<HubState>(readQuery(useRoute().query))
  const pendingQueries = new Set<Record<string, string>>()

  function matchesQuery(query: LocationQuery, expected: Record<string, string>): boolean {
    const keys = Object.keys(expected)
    return Object.keys(query).length === keys.length && keys.every(key => query[key] === expected[key])
  }

  const selection = computed({
    get: () => state.value.selection,
    set: (next: Selection) => {
      const integrationChanged = next.integration !== state.value.selection.integration
      const wallet = next.method === 'apple-pay' || next.method === 'google-pay'
      const keepMethod = (!integrationChanged || wallet)
        && getCapability(next.scene, next.integration, next.method).runnable
      const selected = { ...next, method: keepMethod ? next.method : defaultMethod(next.integration) }
      if (!getCapability(selected.scene, selected.integration, selected.method).runnable) return
      state.value = {
        ...state.value,
        selection: selected,
        journeyId: matchingJourney(selected, state.value.journeyId),
        billingMode: selected.integration === 'direct-api' ? 'payment' : state.value.billingMode,
      }
    },
  })
  const journeyId = computed({
    get: () => state.value.journeyId,
    set: (id: JourneyId) => {
      if (matchesJourney(id, selection.value)) state.value = { ...state.value, journeyId: id }
    },
  })
  const billingMode = computed({
    get: () => state.value.billingMode,
    set: (mode: HubState['billingMode']) => {
      state.value = { ...state.value, billingMode: selection.value.integration === 'direct-api' ? 'payment' : mode }
    },
  })
  const subscriptionPlanId = computed({
    get: () => state.value.subscriptionPlanId,
    set: (plan: SubscriptionPlanId) => {
      if (isSubscriptionPlanId(plan)) state.value = { ...state.value, subscriptionPlanId: plan }
    },
  })

  // Read the router immediately: Nuxt's deferred route can replay an older query after a new selection.
  // Our own replace is only URL persistence; only external navigation restores selection state.
  watch(() => route.value.query, (query) => {
    if (route.value.path !== '/' || [...pendingQueries].some(pending => matchesQuery(query, pending))) return
    state.value = readQuery(query)
  }, { flush: 'sync' })
  watch(state, () => {
    if (!import.meta.client || route.value.path !== '/') return
    const query: Record<string, string> = {
      journey: journeyId.value,
      method: selection.value.method,
      mode: billingMode.value,
      ...(billingMode.value === 'subscription' ? { plan: subscriptionPlanId.value } : {}),
    }
    if (matchesQuery(route.value.query, query)) return
    // Only allowlisted demo choices enter the URL, never provider or capability parameters.
    pendingQueries.add(query)
    void router.replace({ path: '/', query, hash: route.value.hash }).finally(() => {
      pendingQueries.delete(query)
    })
  }, { flush: 'post' })

  onMounted(() => {
    // Retire bookmarked simulation-only Hub choices without changing the retained test fixtures.
    if (route.value.path === '/' && isJourneyId(route.value.query.journey) && !isSandboxJourney(route.value.query.journey)) {
      state.value = readQuery(route.value.query)
    }
  })

  const subscriptionPlan = computed(() => getSubscriptionPlan(subscriptionPlanId.value))
  const billingItems = computed<HubOption[]>(() => [
    { value: 'payment', label: 'One-time payment', description: 'Try a one-time payment in Sandbox.' },
    { value: 'subscription', label: 'Subscription', description: 'Create one merchant-managed daily Sandbox subscription with the selected integration.', disabled: selection.value.integration === 'direct-api' },
  ])
  const scenes = computed<HubOption[]>(() => SCENES.map((scene) => {
    const capability = getCapability(scene, selection.value.integration, selection.value.method)
    return option(scene, sceneLabels[scene], capability.status, capability.runnable, capability.condition)
  }))

  const integrations = computed<HubOption[]>(() => integrationOrder.map((integration) => {
    const method = (selection.value.method === 'apple-pay' || selection.value.method === 'google-pay')
      && getCapability(selection.value.scene, integration, selection.value.method).runnable
      ? selection.value.method : defaultMethod(integration)
    const capability = getCapability(selection.value.scene, integration, method)
    return option(integration, integrationLabels[integration], capability.status, capability.runnable, integrationDescriptions[integration])
  }))

  const methods = computed<HubOption[]>(() => PAYMENT_METHODS.map((method) => {
    const capability = getCapability(selection.value.scene, selection.value.integration, method)
    return option(method, methodLabels[method], capability.status, capability.runnable, capability.condition)
  }))

  const journeyItems = computed<HubOption[]>(() => JOURNEY_IDS
    .filter(id => isSandboxJourney(id) && JOURNEYS[id].integration === selection.value.integration)
    .map(id => ({
    value: id,
    label: JOURNEYS[id].label,
    description: JOURNEYS[id].description,
    disabled: selection.value.method !== JOURNEYS[id].method
      && !supportsSandboxMethod(JOURNEYS[id], selection.value.method),
  })))

  const journey = computed(() => getJourney(journeyId.value))
  const amount = computed(() => formatMoney({
    minor: billingMode.value === 'subscription' ? subscriptionPlan.value.amount.minor : journey.value.amount,
    currency: billingMode.value === 'subscription' ? subscriptionPlan.value.amount.currency : journey.value.currency,
  }))

  const passportFacts = computed(() => [
    ...(billingMode.value === 'subscription'
      ? [
          { label: 'Billing', value: 'Merchant-managed subscription' },
          { label: 'Frequency', value: 'Every day' },
          { label: 'Ends', value: 'Dec 31, 2099' },
          { label: 'First payment', value: '3DS required' },
        ]
      : []),
    { label: 'Scene', value: sceneLabels[journey.value.scene] },
    { label: 'Integration', value: integrationLabels[journey.value.integration] },
    {
      label: billingMode.value === 'subscription' ? 'Initial checkout' : 'Expected method',
      value: billingMode.value === 'subscription'
        ? selection.value.integration === 'checkout' ? 'Choose on Checkout' : 'SDK available methods'
        : methodLabels[selection.value.method],
    },
    { label: 'Country / currency', value: `${journey.value.country} / ${journey.value.currency}` },
  ])

  return {
    selection, billingMode, subscriptionPlanId, subscriptionPlan, billingItems,
    scenes, integrations, methods, journeyId, journeyItems, journey, amount, passportFacts,
    sceneLabels, integrationLabels, methodLabels, statusLabels,
  }
}
