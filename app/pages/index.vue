<script setup lang="ts">
import type { RadioGroupItem } from '@nuxt/ui'
import type { JourneyId } from '#shared/payment/journey'
import type { PublicProfile } from '#shared/profile'
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
import { isPaymentRestorationAction } from '#shared/payment/failure'
import {
  getCapability,
  INTEGRATIONS,
  PAYMENT_METHODS,
  SCENES,
  type CapabilityStatus,
  type IntegrationId,
  type PaymentMethodId,
  type SceneId,
} from '#shared/payment/capability'

useSeoMeta({
  title: 'Demo Hub · Onerway Payment Showcase',
  description: 'Choose a customer-facing payment simulation or confirmed Sandbox journey and explore its capability, order and payment states.',
})

const { data: profile } = await useFetch<PublicProfile>('/api/profile')
const route = useRoute()
const { start } = useDemo()
const {
  error: sdkError,
  session: sdkSession,
  subscription: recoveredSubscription,
  retainedSubscriptionOrderId,
  failure: sdkFailure,
  stage: sdkStage,
  restoring: sdkRestoring,
  start: startSdk,
  startSubscription,
  restore: restoreSdk,
  probeRecovery,
} = useSdk()

const billingMode = shallowRef<'payment' | 'subscription'>(
  route.query.mode === 'subscription' ? 'subscription' : 'payment',
)
const subscriptionPlanId = shallowRef<SubscriptionPlanId>(
  isSubscriptionPlanId(route.query.plan) ? route.query.plan : 'halden-daily-essentials-v1',
)
const subscriptionPlan = computed(() => getSubscriptionPlan(subscriptionPlanId.value))
const billingItems: RadioGroupItem[] = [
  { value: 'payment', label: 'One-time payment', description: 'Run a payment simulation or a real Sandbox SDK journey.' },
  { value: 'subscription', label: 'Subscription', description: 'Create one merchant-managed daily Sandbox subscription.' },
]

function readRoutePaymentMethod(value: unknown): PaymentMethodId {
  if (
    typeof value === 'string'
    && PAYMENT_METHODS.includes(value as PaymentMethodId)
    && getCapability('ecommerce', 'web-js-sdk', value as PaymentMethodId).runnable
  ) {
    return value as PaymentMethodId
  }

  return 'card'
}

const selection = ref({
  scene: 'ecommerce' as SceneId,
  integration: 'web-js-sdk' as IntegrationId,
  method: readRoutePaymentMethod(route.query.method),
})
const journeyId = shallowRef<JourneyId>(
  isJourneyId(route.query.journey) ? route.query.journey : 'standard-success',
)
const currentOrigin = shallowRef<string | null>(null)
const startingNewSubscriptionCustomer = shallowRef(false)

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
const methodLabels: Record<PaymentMethodId, string> = {
  card: 'Card',
  apm: 'APM',
  'google-pay': 'Google Pay',
  'apple-pay': 'Apple Pay',
}
const statusLabels: Record<CapabilityStatus, string> = {
  available: 'Available',
  conditional: 'Conditional',
  planned: 'Planned',
  unavailable: 'Unavailable',
}

function option(
  value: string,
  label: string,
  status: CapabilityStatus,
  runnable: boolean,
  condition?: string,
): RadioGroupItem {
  const description = condition
    ?? (status === 'available'
      ? 'Available in this showcase.'
      : status === 'planned'
        ? 'Planned for a future delivery.'
        : 'Not available for this combination.')

  return {
    value,
    label: `${label} · ${statusLabels[status]}`,
    description,
    disabled: !runnable,
  }
}

const scenes = computed<RadioGroupItem[]>(() => SCENES.map((scene) => {
  const capability = getCapability(scene, selection.value.integration, selection.value.method)
  return option(scene, sceneLabels[scene], capability.status, capability.runnable, capability.condition)
}))

const integrations = computed<RadioGroupItem[]>(() => INTEGRATIONS.map((integration) => {
  const capability = getCapability(selection.value.scene, integration, selection.value.method)
  return option(integration, integrationLabels[integration], capability.status, capability.runnable, capability.condition)
}))

const methods = computed<RadioGroupItem[]>(() => PAYMENT_METHODS.map((method) => {
  const capability = getCapability(selection.value.scene, selection.value.integration, method)
  return option(method, methodLabels[method], capability.status, capability.runnable, capability.condition)
}))

const journeyItems = computed<RadioGroupItem[]>(() => JOURNEY_IDS.map(id => ({
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
      ? 'SDK available methods'
      : methodLabels[selection.value.method],
  },
  { label: 'Country / currency', value: `${journey.value.country} / ${journey.value.currency}` },
])

const profileLabel = computed(() => {
  if (!profile.value) {
    return 'Profile unavailable'
  }

  return profile.value.transactionPolicy === 'locked'
    ? `${profile.value.environment} profile · Transactions locked`
    : `${profile.value.environment} profile · Sandbox only`
})

const restoringSdk = computed(() =>
  sdkRestoring.value || isPaymentRestorationAction(sdkFailure.value?.action),
)
const canonicalSandboxHref = computed(() => {
  const origin = profile.value?.canonicalOrigin

  if (!origin || !currentOrigin.value || origin === currentOrigin.value) {
    return null
  }

  const url = new URL(origin)
  if (billingMode.value === 'subscription') {
    url.searchParams.set('mode', 'subscription')
    url.searchParams.set('plan', subscriptionPlanId.value)
  }
  else {
    url.searchParams.set('journey', journeyId.value)
    url.searchParams.set('method', selection.value.method)
  }
  return url.toString()
})
const retryingRestoration = computed(() => sdkFailure.value?.action === 'retry_restoration')
const selectedCapability = computed(() => getCapability(
  selection.value.scene,
  selection.value.integration,
  selection.value.method,
))
const canStartSimulation = computed(() =>
  billingMode.value === 'payment'
  && selection.value.method === journey.value.method
  && journey.value.modes.includes('simulation'),
)
const canStartSdk = computed(() =>
  profile.value?.profile === 'sandbox'
  && profile.value.sdk?.release === 'v4/latest'
  && (
    restoringSdk.value
    || billingMode.value === 'subscription'
    || (
      selectedCapability.value.runnable
      && supportsSandboxMethod(journey.value, selection.value.method)
    )
  ),
)
const launching = computed(() => sdkStage.value === 'creating')
const sdkLabel = computed(() => {
  if (canonicalSandboxHref.value) {
    return 'Continue on canonical Production'
  }

  if (launching.value) {
    return restoringSdk.value
      ? 'Restoring existing Sandbox checkout…'
      : 'Creating a new Sandbox payment…'
  }

  if (restoringSdk.value) {
    return retryingRestoration.value
      ? 'Retry restoration'
      : 'Restore existing Sandbox checkout'
  }

  if (!journey.value.modes.includes('sandbox')) {
    return 'Real Sandbox unavailable for this fixture'
  }

  if (selection.value.method === 'google-pay') {
    return 'Open Google Pay Sandbox acceptance'
  }

  return journeyId.value === 'three-ds-success'
    ? 'Start a new real Sandbox 3DS'
    : 'Start a new real Sandbox checkout'
})

async function startDemo(): Promise<void> {
  if (canStartSimulation.value && !launching.value) {
    await start(journeyId.value)
  }
}

async function startSandbox(): Promise<void> {
  if (canStartSdk.value && !launching.value) {
    if (canonicalSandboxHref.value) {
      await navigateTo(canonicalSandboxHref.value, { external: true })
      return
    }

    if (restoringSdk.value) {
      await restoreSdk()
    }
    else {
      await startSdk(journeyId.value, true, selection.value.method)
    }
  }
}

async function startSandboxSubscription(): Promise<void> {
  if (canStartSdk.value && !launching.value && !canonicalSandboxHref.value) {
    await startSubscription(subscriptionPlanId.value)
  }
}

async function startNewSandboxSubscriptionCustomer(): Promise<void> {
  if (canStartSdk.value && !launching.value && !canonicalSandboxHref.value) {
    startingNewSubscriptionCustomer.value = true
    try {
      await startSubscription(subscriptionPlanId.value, true)
    }
    finally {
      startingNewSubscriptionCustomer.value = false
    }
  }
}

const resumableSubscription = computed(() => {
  const orderId = sdkSession.value?.order.id ?? retainedSubscriptionOrderId.value

  return recoveredSubscription.value && orderId
    ? {
        orderId,
        state: recoveredSubscription.value.state,
        replayAvailable: Boolean(sdkSession.value?.paymentId || retainedSubscriptionOrderId.value),
      }
    : null
})

onMounted(async () => {
  currentOrigin.value = window.location.origin

  if (profile.value?.profile === 'sandbox') {
    await probeRecovery()
  }
})

watch(() => selection.value.method, (method) => {
  const selected = getJourney(journeyId.value)

  if (method !== selected.method && !supportsSandboxMethod(selected, method)) {
    journeyId.value = JOURNEY_IDS.find(id =>
      method === JOURNEYS[id].method || supportsSandboxMethod(JOURNEYS[id], method),
    ) ?? 'standard-success'
  }
}, { immediate: true })
</script>

<template>
  <UContainer>
    <section class="py-14 sm:py-20">
      <div class="max-w-3xl">
        <div class="mb-6 flex flex-wrap items-center gap-2">
          <UBadge
            label="M0 · Simulation + Sandbox"
            color="primary"
            variant="soft"
          />
          <UBadge
            :label="profileLabel"
            color="neutral"
            variant="outline"
          />
        </div>

        <h1 class="text-balance text-4xl font-semibold tracking-tight text-highlighted sm:text-5xl lg:text-6xl">
          Choose a payment journey. See exactly what happens.
        </h1>
        <p class="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-toned sm:text-lg">
          Explore a customer-facing merchant flow while the shared payment model keeps capabilities, attempts and events explicit.
        </p>
      </div>

      <div class="mt-14 grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div class="min-w-0 space-y-14">
          <HubMatrix
            v-model="selection"
            :scenes="scenes"
            :integrations="integrations"
            :methods="methods"
          />

          <div
            aria-label="Capability status legend"
            class="flex flex-wrap gap-2"
          >
            <UBadge label="Available · Runs now" color="success" variant="soft" />
            <UBadge label="Conditional · SDK eligibility decides availability" color="warning" variant="soft" />
            <UBadge label="Planned · Not delivered" color="neutral" variant="soft" />
            <UBadge label="Unavailable · Explicitly unsupported" color="error" variant="soft" />
          </div>

          <HubJourneyPicker
            v-if="canStartSimulation"
            v-model="journeyId"
            :items="journeyItems"
          />

          <section aria-labelledby="billing-experience-title">
            <h2 id="billing-experience-title" class="text-xl font-semibold text-highlighted">
              Billing experience
            </h2>
            <URadioGroup v-model="billingMode" :items="billingItems" class="mt-4" />
          </section>
        </div>

        <HubPassport
          :title="billingMode === 'subscription' ? subscriptionPlan.productName : journey.label"
          :description="billingMode === 'subscription'
            ? 'Pay USD 5.00 today, authorize daily merchant-managed billing, and complete the required first-payment 3DS in Sandbox.'
            : journey.description"
          :amount="amount"
          :facts="passportFacts"
          :profile="profileLabel"
          :sandbox="billingMode === 'subscription' || journey.modes.includes('sandbox')"
        >
          <UButton
            v-if="canStartSimulation"
            label="Start simulated checkout"
            trailing-icon="i-lucide-arrow-right"
            size="xl"
            block
            class="mt-6 min-h-11"
            :disabled="launching"
            @click="startDemo"
          />
          <UButton
            v-if="billingMode === 'payment'"
            :label="sdkLabel"
            trailing-icon="i-lucide-circle-check"
            color="neutral"
            variant="outline"
            size="xl"
            block
            class="mt-3 min-h-11"
            :disabled="!canStartSdk || launching"
            :loading="launching"
            @click="startSandbox"
          />
          <p
            v-if="billingMode === 'payment' && selection.method === 'google-pay'"
            class="mt-3 text-xs leading-relaxed text-toned"
          >
            Google Pay remains Conditional until the Onerway SDK renders its own eligible wallet button. Card stays available in the same aggregated checkout; the result records what was actually used.
          </p>
          <SubscriptionLaunchActions
            v-if="billingMode === 'subscription'"
            :existing="resumableSubscription"
            :canonical-href="canonicalSandboxHref"
            :start-disabled="!canStartSdk"
            :loading="launching"
            :starting-new-customer="startingNewSubscriptionCustomer"
            @start="startSandboxSubscription"
            @start-new-customer="startNewSandboxSubscriptionCustomer"
          />
          <p
            v-if="canonicalSandboxHref"
            class="mt-3 text-xs leading-relaxed text-toned"
          >
            Real Sandbox starts on canonical Production so the recovery cookie, return path and Webhook evidence share one origin. Review the selected journey there before creating payment.
          </p>
          <p
            v-if="launching"
            role="status"
            aria-live="polite"
            class="mt-3 text-xs leading-relaxed text-toned"
          >
            {{ startingNewSubscriptionCustomer
              ? 'Creating a separate Sandbox customer and signed Order. The existing subscription is not cancelled or modified.'
              : restoringSdk
              ? 'Restoring the existing authorized PaymentAttempt. No new Order or provider create will be requested unless the server confirms the original create never started.'
              : 'Creating and persisting a separate signed Sandbox order. This may take several seconds; the previous payment is not cancelled or overwritten.' }}
          </p>
          <UAlert
            v-if="sdkError"
            role="alert"
            :title="sdkFailure?.title"
            :description="sdkError"
            color="warning"
            variant="subtle"
            icon="i-lucide-circle-alert"
            class="mt-4"
          />
        </HubPassport>
      </div>
    </section>
  </UContainer>
</template>
