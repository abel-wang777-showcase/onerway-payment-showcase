<script setup lang="ts">
import { findOrderJourney } from '#shared/payment/journey'
import {
  getSdkPaymentActions,
  isPaymentRestorationAction,
  type PaymentAction,
  type SdkPaymentAction,
} from '#shared/payment/failure'
import {
  canVerifySdkPayment,
  isCurrentSdkElementEvent,
  isTerminalStatus,
} from '#shared/payment/sdk'
import type { PublicProfile } from '#shared/profile'
import type { PaymentMethodId } from '#shared/payment/capability'

interface ElementRef {
  confirm(): Promise<unknown>
}

interface PaymentReference {
  label: string
  value: string
}

definePageMeta({
  layout: 'halden',
})

useSeoMeta({
  title: 'Sandbox checkout · Halden',
  description: 'Complete a controlled payment in the Onerway v4 Sandbox hosted payment form.',
})

const route = useRoute()
const { data: profile } = await useFetch<PublicProfile>('/api/profile')
const {
  session,
  subscription,
  stage,
  error,
  failure,
  submitted,
  elementRevision,
  restoring,
  start,
  restore: restoreSdk,
  recover,
  loading,
  ready,
  loadFailed,
  reloadElement,
  submit,
  acceptResult,
  verify,
} = useSdk()
const mounted = shallowRef(false)
const restoreAction = shallowRef<PaymentAction | null>(null)
const title = useTemplateRef<HTMLElement>('title')
const status = useTemplateRef<HTMLElement>('status')
const element = useTemplateRef<ElementRef>('element')
const orderId = computed(() => String(route.params.order))
const current = computed(() => session.value?.order.id === orderId.value ? session.value : null)
const currentSubscription = computed(() => current.value ? subscription.value : null)
const sdkUrl = computed(() => profile.value?.profile === 'sandbox' ? profile.value.sdk?.url : null)
const canRestoreEmpty = computed(() => Boolean(
  sdkUrl.value
  && (restoring.value || isPaymentRestorationAction(failure.value?.action)),
))
const emptyTitle = computed(() => canRestoreEmpty.value
  ? failure.value?.title ?? 'Restoring Sandbox checkout'
  : 'Sandbox checkout not available')
const emptyDescription = computed(() => canRestoreEmpty.value
  ? error.value ?? 'Restoring the existing authorized PaymentAttempt without creating a new payment.'
  : 'No authorized Sandbox attempt could be restored for this order in the current browser.')
const emptyActionLabel = computed(() => (restoreAction.value ?? failure.value?.action) === 'retry_restoration'
  ? 'Retry restoration'
  : 'Restore existing Sandbox checkout')
const collecting = computed(() => !submitted.value || ['submitting', 'awaiting_action', 'redirecting'].includes(stage.value))
const canVerify = computed(() => current.value
  ? canVerifySdkPayment(stage.value, submitted.value, current.value.attempt.status)
  : false)
const actionItems = computed(() => {
  const views = {
    reload_element: {
      action: 'reload_element',
      label: 'Reload secure form',
      icon: 'i-lucide-refresh-cw',
      primary: true,
    },
    recover_attempt: {
      action: 'recover_attempt',
      label: 'Restore existing Sandbox checkout',
      icon: 'i-lucide-history',
      primary: true,
    },
    verify_attempt: {
      action: 'verify_attempt',
      label: 'Verify existing payment',
      icon: 'i-lucide-shield-check',
      primary: true,
    },
    start_clean_order: {
      action: 'start_clean_order',
      label: 'Start a separate Sandbox order',
      icon: 'i-lucide-rotate-ccw',
    },
    retry_restoration: {
      action: 'retry_restoration',
      label: 'Retry restoration',
      icon: 'i-lucide-history',
      primary: true,
    },
  } as const satisfies Record<SdkPaymentAction, {
    action: PaymentAction
    label: string
    icon: string
    primary?: boolean
  }>

  return getSdkPaymentActions({
    failure: failure.value,
    canVerify: canVerify.value,
    submitted: submitted.value,
  })
    .filter(action => !currentSubscription.value || action !== 'start_clean_order')
    .map(action => views[action])
})
const amount = computed(() => current.value ? formatMoney(current.value.order.amount) : '')
const journey = computed(() => current.value ? findOrderJourney(current.value.order) : null)
const challenge = computed(() => Boolean(currentSubscription.value) || journey.value?.id === 'three-ds-success')
const expectedMethodLabel = computed(() => {
  const labels: Record<PaymentMethodId, string> = {
    card: 'Card',
    apm: 'APM',
    'google-pay': 'Google Pay',
    'apple-pay': 'Apple Pay',
  }

  return current.value ? labels[current.value.attempt.method] : 'Unavailable'
})
const references = computed<PaymentReference[]>(() => {
  if (!current.value) {
    return []
  }

  const attempt = current.value.attempt

  return [
    ...(attempt.merchantTxnId
      ? [{ label: 'Merchant transaction ID', value: attempt.merchantTxnId }]
      : []),
    ...(attempt.transactionId
      ? [{ label: 'Onerway transaction ID', value: attempt.transactionId }]
      : []),
    { label: 'Onerway payment ID', value: current.value.paymentId },
    { label: 'Showcase order ID', value: current.value.order.id },
    { label: 'Showcase attempt ID', value: attempt.id },
  ]
})
const busy = computed(() => ['creating', 'loading', 'submitting', 'redirecting', 'verifying'].includes(stage.value))
const disabled = computed(() => stage.value !== 'ready')
const payLabel = computed(() => restoring.value && stage.value === 'creating'
  ? 'Restoring existing Sandbox checkout…'
  : ({
      creating: 'Creating Sandbox checkout…',
      loading: 'Loading secure payment form…',
      ready: currentSubscription.value ? `Pay by card ${amount.value} and subscribe` : `Pay by card · ${amount.value}`,
      submitting: 'Submitting payment…',
      awaiting_action: 'Complete the payment step',
      redirecting: 'Opening secure verification…',
      verifying: 'Verifying payment…',
      not_completed: 'Payment not completed',
      succeeded: 'Payment verified',
    })[stage.value])
const summaryLines = computed(() => current.value
  ? [
      { label: current.value.order.item.name, value: current.value.order.item.variant },
      { label: 'Quantity', value: String(current.value.order.item.quantity) },
      { label: 'Delivery', value: 'Included' },
      ...(currentSubscription.value
        ? [{ label: 'Renews', value: `Every ${currentSubscription.value.frequencyPoint} day` }]
        : []),
    ]
  : [])

async function pay(): Promise<void> {
  const target = element.value

  if (target) {
    await submit(() => target.confirm())
  }
}

async function restart(): Promise<void> {
  const selected = journey.value

  if (selected && current.value && !busy.value) {
    await start(selected.id, true, current.value.attempt.method)
  }
}

async function handleAction(action: PaymentAction): Promise<void> {
  if (action === 'reload_element') {
    reloadElement()
    await nextTick()
    status.value?.focus()
  }
  else if (action === 'verify_attempt') {
    const verification = verify()
    await nextTick()
    status.value?.focus()
    await verification
  }
  else if (isPaymentRestorationAction(action)) {
    const restoration = restoreSdk()
    await nextTick()
    status.value?.focus()
    await restoration
  }
  else if (action === 'start_clean_order') {
    await restart()
  }
}

async function restoreCurrent(): Promise<void> {
  if (restoring.value) {
    return
  }

  restoreAction.value = failure.value?.action ?? null

  try {
    if (!await recover(orderId.value)) {
      await nextTick()
      title.value?.focus()
      return
    }

    const restored = session.value

    if (!restored || restored.order.id !== orderId.value) {
      return
    }

    if (isTerminalStatus(restored.attempt.status)) {
      await navigateTo(`/halden/result/${restored.order.id}`)
      return
    }

    if (sdkUrl.value && !submitted.value) {
      loading()
    }

    await nextTick()
    title.value?.focus()
  }
  finally {
    restoreAction.value = null
  }
}

function ownsElement(paymentId: string, generation: number): boolean {
  return isCurrentSdkElementEvent(
    { paymentId, generation },
    current.value
      ? { paymentId: current.value.paymentId, generation: elementRevision.value }
      : null,
  )
}

function handleElementReady(paymentId: string, generation: number): void {
  if (ownsElement(paymentId, generation)) {
    ready()
  }
}

function handleElementError(paymentId: string, generation: number): void {
  if (ownsElement(paymentId, generation)) {
    loadFailed()
  }
}

function handleElementResult(paymentId: string, generation: number, value: unknown): void {
  if (ownsElement(paymentId, generation)) {
    acceptResult(value)
  }
}

onMounted(async () => {
  if (!current.value) {
    await recover(orderId.value)
  }

  mounted.value = true

  if (current.value && isTerminalStatus(current.value.attempt.status)) {
    await navigateTo(`/halden/result/${current.value.order.id}`, { replace: true })
    return
  }

  if (
    current.value
    && sdkUrl.value
    && !submitted.value
    && ['loading', 'ready', 'not_completed'].includes(stage.value)
  ) {
    loading()
  }

  await nextTick()
  title.value?.focus()
})
</script>

<template>
  <UContainer class="py-8 pb-40 md:max-w-2xl md:pb-24 lg:max-w-none lg:py-12 lg:pb-12">
    <div
      v-if="!mounted"
      class="space-y-6"
      aria-label="Restoring Sandbox checkout"
    >
      <USkeleton class="h-10 w-64 rounded-sm" />
      <USkeleton class="h-64 w-full rounded-lg" />
    </div>

    <section
      v-else-if="!current || !sdkUrl"
      class="mx-auto max-w-xl py-20 text-center"
    >
      <UIcon name="i-lucide-circle-off" class="mx-auto size-10 text-dimmed" aria-hidden="true" />
      <h1 ref="title" tabindex="-1" class="mt-4 text-2xl font-semibold tracking-tight text-highlighted">
        {{ emptyTitle }}
      </h1>
      <p class="mt-3 text-sm leading-relaxed text-toned">
        {{ emptyDescription }}
      </p>
      <div class="mt-6 flex flex-col-reverse justify-center gap-3 sm:flex-row">
        <UButton
          to="/"
          label="Return to Demo Hub"
          color="neutral"
          variant="outline"
          class="min-h-11"
        />
        <UButton
          v-if="canRestoreEmpty"
          :label="emptyActionLabel"
          icon="i-lucide-history"
          class="min-h-11"
          :loading="restoring"
          :disabled="restoring"
          @click="restoreCurrent"
        />
      </div>
    </section>

    <div v-else class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div class="space-y-8">
        <div>
          <div class="flex flex-wrap gap-2">
            <UBadge label="Real Sandbox" color="warning" variant="soft" />
            <UBadge label="Web JS SDK · v4/latest" color="neutral" variant="outline" />
            <UBadge
              v-if="!currentSubscription"
              :label="`Expected · ${expectedMethodLabel}`"
              color="info"
              variant="soft"
            />
          </div>
          <h1
            ref="title"
            tabindex="-1"
            class="mt-4 text-3xl font-semibold tracking-tight text-highlighted focus:outline-none sm:text-4xl"
          >
            {{ currentSubscription ? 'Start your Sandbox subscription.' : 'Complete your Sandbox order.' }}
          </h1>
          <p class="mt-3 max-w-2xl text-sm leading-relaxed text-toned">
            A signed {{ amount }} {{ currentSubscription ? 'initial subscription' : '' }} payment was created by the server with all merchant-enabled SDK payment methods.
            {{ challenge ? 'This journey requires a 3DS Challenge. Automatic return is preferred; if Onerway keeps the browser on its result page, reopen this Showcase to recover the same payment.' : 'This controlled journey is expected to complete without a 3DS Challenge.' }}
            {{ current.attempt.method === 'google-pay'
              ? 'For this acceptance target, use the Google Pay button only if the SDK renders it. The merchant Card action remains available as a fallback and does not prove Google Pay eligibility.'
              : 'Use only controlled Onerway Sandbox payment data in the hosted SDK surface.' }}
          </p>
        </div>

        <div ref="status" tabindex="-1" data-focus-target="payment-status" class="focus:outline-none">
          <PaymentSdkStatus :stage="stage" :restoring="restoring" />
        </div>
        <UAlert
          v-if="error"
          role="alert"
          :title="failure?.title"
          :description="error"
          color="warning"
          variant="subtle"
          icon="i-lucide-circle-alert"
        />

        <section
          v-if="references.length"
          aria-labelledby="payment-references-title"
          class="rounded-lg border border-default bg-muted p-4 sm:p-5"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Investigation references
              </p>
              <h2 id="payment-references-title" class="mt-1 text-base font-semibold text-highlighted">
                Payment identifiers
              </h2>
            </div>
            <UBadge label="Whitelisted identifiers" color="neutral" variant="outline" />
          </div>
          <p class="mt-2 text-xs leading-relaxed text-toned">
            Use the merchant transaction ID or Onerway identifiers when checking provider logs. No card data or raw provider payload is shown.
          </p>
          <dl class="mt-4 grid gap-3 sm:grid-cols-2">
            <div
              v-for="reference in references"
              :key="reference.label"
              class="min-w-0 rounded-md border border-default bg-default px-3 py-2.5"
            >
              <dt class="text-xs text-muted">
                {{ reference.label }}
              </dt>
              <dd class="mt-1 break-words font-mono text-xs text-highlighted [overflow-wrap:anywhere]">
                {{ reference.value }}
              </dd>
            </div>
          </dl>
        </section>

        <PaymentElement
          v-if="collecting"
          :key="`${current.paymentId}:${elementRevision}`"
          ref="element"
          :payment-id="current.paymentId"
          :url="sdkUrl"
          :generation="elementRevision"
          :expected-method="current.attempt.method"
          @ready="handleElementReady"
          @error="handleElementError"
          @result="handleElementResult"
        />

        <PaymentActions
          v-if="actionItems.length"
          title="Choose the safe next step"
          :description="currentSubscription
            ? 'Reload keeps this Payment intact and verification queries this same Attempt. Subscription recovery never creates or confirms another payment.'
            : 'Reload keeps this Payment intact, verification queries this Attempt, and a separate Sandbox order never cancels or overwrites it.'"
          :items="actionItems"
          @action="handleAction"
        />
      </div>

      <HaldenSummary
        :lines="summaryLines"
        :total="amount"
        :pay-label="payLabel"
        :disabled="disabled"
        :busy="busy"
        footer="Payment methods are hosted by Onerway Sandbox; the merchant button submits Card only."
        @pay="pay"
      />
    </div>
  </UContainer>
</template>
