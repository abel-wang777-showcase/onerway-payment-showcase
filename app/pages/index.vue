<script setup lang="ts">
import { paymentAmountText } from '#shared/payment/amount'
import type { PublicProfile } from '#shared/profile'
import { supportsSandboxMethod } from '#shared/payment/journey'
import { isPaymentRestorationAction } from '#shared/payment/failure'
import { getCapability } from '#shared/payment/capability'

useSeoMeta({
  title: 'Demo Hub · Onerway Payment Showcase',
  description: 'Choose a customer-facing Sandbox payment journey and explore its capability, order and payment states.',
})

const { data: profile } = await useFetch<PublicProfile>('/api/profile')
const route = useRoute()
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
  selection, billingMode, subscriptionPlanId, subscriptionPlan, billingItems, amountInput, amountMinor, customAmount,
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
    if (amountMinor.value !== null) url.searchParams.set('amount', paymentAmountText(amountMinor.value))
  }
  url.hash = 'demo-launch'
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
const canStartSdk = computed(() =>
  !checkingRecovery.value
  && profile.value?.profile === 'sandbox'
  && (journey.value.integration !== 'web-js-sdk' || profile.value.sdk?.release === 'v4/latest')
  && (
    restoringSdk.value
    || billingMode.value === 'subscription'
    || (
      amountMinor.value !== null
      && selectedCapability.value.runnable
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
  && amountMinor.value !== null
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
    return 'Open Sandbox site'
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

  if (journey.value.id === 'hosted-authorization') return 'Start a Sandbox card authorization'

  if (journey.value.integration === 'checkout') return 'Start a new Sandbox Hosted Checkout'

  if (selectedWalletLabel.value) {
    return `Open ${selectedWalletLabel.value} Sandbox`
  }

  return !customAmount.value && journeyId.value === 'three-ds-success'
    ? 'Start a new real Sandbox 3DS'
    : 'Start a new real Sandbox checkout'
})

async function startSandbox(): Promise<void> {
  if (canStartSdk.value && !launching.value && !sdkRestoring.value) {
    if (canonicalSandboxHref.value) {
      await navigateTo(canonicalSandboxHref.value, { external: true })
      return
    }

    if (restoringSdk.value) return
    await startSdk(journeyId.value, true, selection.value.method, amountMinor.value ?? undefined)
  }
}

async function restoreSandbox(): Promise<void> {
  if (canStartSdk.value && !launching.value && !sdkRestoring.value && !canonicalSandboxHref.value) {
    await restoreSdk()
  }
}

async function startSeparateSandboxOrder(): Promise<void> {
  if (canStartSeparateSandboxOrder.value && !separateSandboxOrderPending.value) {
    await startSdk(journeyId.value, true, selection.value.method, amountMinor.value ?? undefined)
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
  <UContainer class="flex flex-1 flex-col pb-24 lg:max-w-7xl lg:justify-center lg:pb-0">
    <section class="py-4 sm:py-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-balance text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
            Explore payment experiences.
          </h1>
          <p class="mt-2 max-w-2xl text-pretty text-sm text-toned">
            Try Onerway payments in Sandbox.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            :label="profileLabel"
            color="neutral"
            variant="outline"
          />
        </div>

      </div>

      <HubWorkspace class="mt-4 lg:mt-6">
        <HubMatrix
          v-model="selection"
          :scenes="scenes"
          :integrations="integrations"
          :methods="methods"
          :subscription="billingMode === 'subscription'"
        >
          <UFormField label="Billing experience" name="billing-mode" class="min-w-0">
            <USelect
              v-model="billingMode"
              aria-label="Billing experience"
              :items="billingItems"
              size="lg"
              class="h-11 w-full"
              :ui="{ base: 'text-base md:text-sm', value: 'min-w-0 text-start', item: 'min-h-11', itemLabel: 'whitespace-normal' }"
            />
          </UFormField>
          <template #journey>
            <HubJourneyPicker
              v-if="billingMode === 'payment' && ((journey.integration === 'web-js-sdk' && selection.method === 'card') || journey.integration === 'checkout')"
              v-model="journeyId"
              :items="journeyItems"
              class="col-span-1"
            />
            <HubAmountField v-if="billingMode === 'payment'" v-model="amountInput" />
          </template>
        </HubMatrix>

        <template #summary>
          <HubPassport
            :title="billingMode === 'subscription' ? storeProductName(subscriptionPlan.productName) : customAmount ? 'Custom amount' : journey.label"
            :description="billingMode === 'subscription'
              ? 'Pay USD 5.00 today, authorize daily merchant-managed billing, and complete the required first-payment 3DS in Sandbox.'
              : customAmount ? 'Try a custom Sandbox amount. Payment outcome and authentication depend on the payment provider.' : journey.description"
            :amount="amount"
            :facts="passportFacts"
          >
            <UButton
              v-if="billingMode === 'payment' && restoringSdk && !canonicalSandboxHref"
              key="sandbox-restoration"
              :label="sdkLabel"
              trailing-icon="i-lucide-arrow-right"
              size="xl"
              block
              class="mt-3 min-h-11 lg:mt-5"
              :disabled="!canStartSdk || launching || sdkRestoring"
              :loading="checkingRecovery || launching || sdkRestoring"
              @click="restoreSandbox"
            />
            <UButton
              v-else-if="billingMode === 'payment'"
              key="sandbox-start"
              :label="sdkLabel"
              trailing-icon="i-lucide-arrow-right"
              size="xl"
              block
              class="mt-3 min-h-11 lg:mt-5"
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
              {{ selectedWalletLabel }} needs a supported device and test wallet. Authorize in your wallet, then Onerway Store checks the Direct API payment result.
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
            Conditional · Card authorization in Sandbox. Authorize the selected amount, then choose full capture or void. Missing confirmation keeps funds actions locked while you refresh the saved status.
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
            Payments run on the Sandbox site. Your selection carries over; confirm it there to keep checkout and return links on the same domain.
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
        </template>
      </HubWorkspace>
    </section>
    <nav aria-label="Quick demo navigation" class="demo-mobile-nav fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 border-t border-default bg-default px-3 py-2 lg:hidden">
      <UButton :to="{ query: route.query, hash: '#demo-selection' }" label="Edit selection" color="neutral" variant="ghost" size="sm" class="min-h-11 shrink-0 px-2 text-xs sm:text-sm" />
      <span class="shrink-0 text-xs font-medium text-highlighted tabular-nums sm:text-sm">{{ amount }}</span>
      <UButton :to="{ query: route.query, hash: '#demo-launch' }" label="View summary" color="neutral" variant="ghost" size="sm" class="min-h-11 shrink-0 px-2 text-xs sm:text-sm" icon="i-lucide-list-checks" />
    </nav>
  </UContainer>
</template>
