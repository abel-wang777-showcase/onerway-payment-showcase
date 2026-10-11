<script setup lang="ts">
import type { PublicProfile } from '#shared/profile'
import { supportsSandboxMethod } from '#shared/payment/journey'
import { isPaymentRestorationAction } from '#shared/payment/failure'
import { getCapability } from '#shared/payment/capability'

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

const {
  selection, billingMode, subscriptionPlanId, subscriptionPlan, billingItems,
  scenes, integrations, methods, journeyId, journeyItems, journey, amount, passportFacts,
  methodLabels,
} = useHubSelection()
const currentOrigin = shallowRef<string | null>(null)
const startingNewSubscriptionCustomer = shallowRef(false)
const checkingRecovery = shallowRef(profile.value?.profile === 'sandbox')

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
    url.searchParams.set('journey', journeyId.value)
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
const selectedWalletLabel = computed(() => {
  const method = selection.value.method

  return method === 'google-pay' || method === 'apple-pay'
    ? methodLabels[method]
    : null
})
const canStartSimulation = computed(() =>
  billingMode.value === 'payment'
  && selection.value.method === journey.value.method
  && journey.value.modes.includes('simulation'),
)
const canStartSdk = computed(() =>
  !checkingRecovery.value
  && profile.value?.profile === 'sandbox'
  && (journey.value.integration !== 'web-js-sdk' || profile.value.sdk?.release === 'v4/latest')
  && (
    restoringSdk.value
    || billingMode.value === 'subscription'
    || (
      selectedCapability.value.runnable
      && supportsSandboxMethod(journey.value, selection.value.method)
    )
  ),
)
const canStartSeparateSandboxOrder = computed(() =>
  billingMode.value === 'payment'
  && !checkingRecovery.value
  && restoringSdk.value
  && !canonicalSandboxHref.value
  && profile.value?.profile === 'sandbox'
  && (billingMode.value === 'payment' && journey.value.integration !== 'web-js-sdk' || profile.value.sdk?.release === 'v4/latest')
  && selectedCapability.value.runnable
  && supportsSandboxMethod(journey.value, selection.value.method),
)
const launching = computed(() => sdkStage.value === 'creating')
const separateSandboxOrderPending = computed(() => launching.value || sdkRestoring.value)
const sdkLabel = computed(() => {
  if (checkingRecovery.value) {
    return 'Checking for an existing Sandbox checkout…'
  }

  if (canonicalSandboxHref.value) {
    return 'Continue to Sandbox demo'
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

  if (journey.value.id === 'hosted-authorization') return 'Start a Sandbox card authorization'

  if (journey.value.integration === 'checkout') return 'Start a new Sandbox Hosted Checkout'

  if (selectedWalletLabel.value) {
    return `Open ${selectedWalletLabel.value} Sandbox`
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
  if (canStartSdk.value && !launching.value && !sdkRestoring.value) {
    if (canonicalSandboxHref.value) {
      await navigateTo(canonicalSandboxHref.value, { external: true })
      return
    }

    if (restoringSdk.value) return
    await startSdk(journeyId.value, true, selection.value.method)
  }
}

async function restoreSandbox(): Promise<void> {
  if (canStartSdk.value && !launching.value && !sdkRestoring.value && !canonicalSandboxHref.value) {
    await restoreSdk()
  }
}

async function startSeparateSandboxOrder(): Promise<void> {
  if (canStartSeparateSandboxOrder.value && !separateSandboxOrderPending.value) {
    await startSdk(journeyId.value, true, selection.value.method)
  }
}

async function startSandboxSubscription(): Promise<void> {
  if (canStartSdk.value && !launching.value && !canonicalSandboxHref.value) {
    await startSubscription(subscriptionPlanId.value, false, selection.value.integration === 'checkout' ? 'checkout' : 'web-js-sdk')
  }
}

async function startNewSandboxSubscriptionCustomer(): Promise<void> {
  if (canStartSdk.value && !launching.value && !canonicalSandboxHref.value) {
    startingNewSubscriptionCustomer.value = true
    try {
      await startSubscription(subscriptionPlanId.value, true, selection.value.integration === 'checkout' ? 'checkout' : 'web-js-sdk')
    }
    finally {
      startingNewSubscriptionCustomer.value = false
    }
  }
}

const resumableSubscription = computed(() => {
  const orderId = sdkSession.value?.order.id ?? retainedSubscriptionOrderId.value

  return recoveredSubscription.value && recoveredSubscription.value.state !== 'terminal' && orderId
    ? {
        orderId,
        state: recoveredSubscription.value.state,
        replayAvailable: Boolean(sdkSession.value?.paymentId || retainedSubscriptionOrderId.value),
      }
    : null
})

onMounted(async () => {
  currentOrigin.value = window.location.origin

  try {
    if (profile.value?.profile === 'sandbox') {
      await probeRecovery()
    }
  }
  finally {
    checkingRecovery.value = false
  }
})

</script>

<template>
  <UContainer class="pb-24 lg:pb-0">
    <section class="py-8 sm:py-12">
      <div class="max-w-3xl">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <UBadge
            label="Payment demo"
            color="primary"
            variant="soft"
          />
          <UBadge
            :label="profileLabel"
            color="neutral"
            variant="outline"
          />
        </div>

        <h1 class="text-balance text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl lg:text-5xl">
          From checkout to confirmation.
        </h1>
        <p class="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-toned">
          Experience a Halden purchase as your customer would. Start with a simulation, or choose an integration to try in Sandbox.
        </p>
        <nav aria-label="Demo sections" class="mt-5 flex flex-wrap gap-3">
          <UButton :to="{ query: route.query, hash: '#demo-selection' }" label="Customize your demo" color="neutral" variant="outline" class="min-h-11" />
          <UButton :to="{ query: route.query, hash: '#demo-launch' }" label="Review & start" color="neutral" variant="ghost" class="min-h-11" trailing-icon="i-lucide-arrow-down" />
        </nav>
      </div>

      <div class="mt-8 grid min-w-0 gap-8 border-t border-default pt-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div class="min-w-0 space-y-8 lg:col-start-1 lg:row-start-1">
          <HubMatrix
            v-model="selection"
            :scenes="scenes"
            :integrations="integrations"
            :methods="methods"
            :subscription="billingMode === 'subscription'"
          >
            <URadioGroup
              v-model="billingMode"
              legend="Billing experience"
              :items="billingItems"
              variant="card"
              :ui="{ fieldset: 'grid gap-3 sm:grid-cols-2', description: 'text-toned' }"
            />
          </HubMatrix>

          <HubJourneyPicker
            v-if="billingMode === 'payment' && (canStartSimulation || journey.integration === 'checkout')"
            v-model="journeyId"
            :items="journeyItems"
            :hosted="journey.integration === 'checkout'"
          />

        </div>

        <HubPassport
          class="row-start-1 lg:col-start-2"
          :title="billingMode === 'subscription' ? subscriptionPlan.productName : journey.label"
          :description="billingMode === 'subscription'
            ? 'Pay USD 5.00 today, authorize daily merchant-managed billing, and complete the required first-payment 3DS in Sandbox.'
            : journey.description"
          :amount="amount"
          :facts="passportFacts"
          :profile="profileLabel"
          :sandbox="billingMode === 'subscription' || journey.modes.includes('sandbox')"
          :simulation="canStartSimulation"
        >
          <UButton
            v-if="canStartSimulation"
            label="Start simulated checkout"
            trailing-icon="i-lucide-arrow-right"
            size="xl"
            block
            class="mt-5 min-h-11"
            :disabled="launching"
            @click="startDemo"
          />
          <UButton
            v-if="billingMode === 'payment' && restoringSdk && !canonicalSandboxHref"
            key="sandbox-restoration"
            :label="sdkLabel"
            trailing-icon="i-lucide-circle-check"
            color="neutral"
            variant="outline"
            size="xl"
            block
            class="mt-3 min-h-11"
            :disabled="!canStartSdk || launching || sdkRestoring"
            :loading="checkingRecovery || launching || sdkRestoring"
            @click="restoreSandbox"
          />
          <UButton
            v-else-if="billingMode === 'payment'"
            key="sandbox-start"
            :label="sdkLabel"
            trailing-icon="i-lucide-circle-check"
            color="neutral"
            variant="outline"
            size="xl"
            block
            class="mt-3 min-h-11"
            :disabled="!canStartSdk || launching || sdkRestoring"
            :loading="checkingRecovery || launching || sdkRestoring"
            @click="startSandbox"
          />
          <UButton
            v-if="canStartSeparateSandboxOrder"
            label="Start a Separate Sandbox Order"
            trailing-icon="i-lucide-arrow-right"
            color="neutral"
            variant="ghost"
            size="lg"
            block
            class="mt-2 min-h-11"
            :disabled="separateSandboxOrderPending"
            @click="startSeparateSandboxOrder"
          />
          <p
            v-if="canStartSeparateSandboxOrder"
            class="mt-2 text-xs leading-relaxed text-toned"
          >
            This creates a new Sandbox Order. The existing PaymentAttempt is not cancelled or overwritten and may still settle through Query or Webhook.
          </p>
          <p
            v-if="billingMode === 'payment' && selectedWalletLabel"
            class="mt-3 text-xs leading-relaxed text-toned"
          >
            <template v-if="selection.integration === 'web-js-sdk'">
              {{ selectedWalletLabel }} remains Conditional until the Onerway SDK renders its own eligible wallet button. Card stays available in the same aggregated checkout; the result records what was actually used.
            </template>
            <template v-else>
              {{ selectedWalletLabel }} needs a supported device and test wallet. Authorize in your wallet, then Halden checks the Direct API payment result.
            </template>
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
            v-if="billingMode === 'payment' && journey.id === 'hosted-authorization'"
            class="mt-3 text-xs leading-relaxed text-toned"
          >
            Conditional · Card authorization in Sandbox. Authorize USD 5.00, then choose full capture or void. Missing confirmation keeps funds actions locked while you refresh the saved status.
          </p>
          <p
            v-if="billingMode === 'subscription' && selection.integration === 'checkout'"
            class="mt-3 text-xs leading-relaxed text-toned"
          >
            Conditional · Select Card on Checkout for this initial subscription demonstration. Merchant enablement and Sandbox verification are required. This showcase only completes the first payment and does not schedule later charges.
          </p>
          <p
            v-if="canonicalSandboxHref"
            class="mt-3 text-xs leading-relaxed text-toned"
          >
            Continue on the configured demo site to keep payment and return links together. Review your selection there before starting a Sandbox payment.
          </p>
          <p
            v-else-if="profile?.transactionPolicy === 'locked'"
            class="mt-3 text-sm leading-relaxed text-toned"
          >
            Sandbox payments are disabled in this preview. Open a demo configured for Sandbox to try a real test payment.
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
              ? 'Restoring the existing authorized PaymentAttempt. No new Order or provider create will be requested.'
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
    <nav aria-label="Quick demo navigation" class="demo-mobile-nav fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-default bg-default px-4 py-3 lg:hidden">
      <span class="min-w-0 text-sm font-medium text-highlighted tabular-nums">{{ amount }}</span>
      <UButton :to="{ query: route.query, hash: '#demo-launch' }" label="Review & start" color="neutral" size="lg" class="min-h-11" icon="i-lucide-arrow-up" />
    </nav>
  </UContainer>
</template>
