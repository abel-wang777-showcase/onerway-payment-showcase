<script setup lang="ts">
import { findOrderJourney, getJourney } from '#shared/payment/journey'
import {
  getActiveAttempt,
  type DemoSession,
} from '#shared/demo/session'
import { findProjectionEvent } from '#shared/payment/merge'
import { getRetryDecision } from '#shared/payment/attempt'
import {
  isPaymentRestorationAction,
  type PaymentAction,
} from '#shared/payment/failure'
import { isTerminalStatus } from '#shared/payment/sdk'
import type { PaymentMethodId } from '#shared/payment/capability'

definePageMeta({
  layout: 'halden',
})

useSeoMeta({
  title: 'Payment result · Halden',
  description: 'Review a normalized payment outcome and its whitelisted technical details.',
})

const route = useRoute()
const {
  session: demoSession,
  restored,
  restore,
  retry,
} = useDemo()
const {
  session: sdkSession,
  subscription,
  retainedSubscriptionOrderId,
  retainedSubscriptionPaymentStatus,
  error: sdkError,
  failure: sdkFailure,
  restoring,
  retrying,
  recover: recoverSdk,
  verify: verifySdk,
  retry: retrySdk,
} = useSdk()
const ready = shallowRef(false)
const restoreAction = shallowRef<PaymentAction | null>(null)
const title = useTemplateRef<HTMLElement>('title')
const actions = useTemplateRef<HTMLElement>('actions')
const orderId = computed(() => String(route.params.order))
const demo = computed<DemoSession | null>(() =>
  demoSession.value?.order.id === orderId.value ? demoSession.value : null,
)
const sdk = computed(() => sdkSession.value?.order.id === orderId.value ? sdkSession.value : null)
const retainedContract = computed(() =>
  retainedSubscriptionOrderId.value === orderId.value && !sdk.value
    ? subscription.value
    : null,
)
const contract = computed(() => sdk.value ? subscription.value : retainedContract.value)
const order = computed(() => sdk.value?.order ?? demo.value?.order ?? null)
const attempt = computed(() => sdk.value?.attempt ?? (demo.value ? getActiveAttempt(demo.value) : null))
const attempts = computed(() => demo.value?.attempts ?? sdk.value?.attempts ?? [])
const amount = computed(() => order.value ? formatMoney(order.value.amount) : '')
const sandbox = computed(() => Boolean(sdk.value))
const succeeded = computed(() => attempt.value?.status === 'succeeded')
const subscriptionPending = computed(() => Boolean(
  contract.value && ['pending', 'needs_attention'].includes(contract.value.state),
))
const canRetrySdk = computed(() => Boolean(
  sdk.value
  && !contract.value
  && attempt.value
  && (
    retrying.value
    || (
      !restoring.value
      && !sdkFailure.value
      && getRetryDecision(attempt.value).allowed
    )
  ),
))
const canRestoreSdk = computed(() =>
  !retrying.value
  && (restoring.value || isPaymentRestorationAction(sdkFailure.value?.action)),
)
const restoreLabel = computed(() => (restoreAction.value ?? sdkFailure.value?.action) === 'retry_restoration'
  ? 'Retry restoration'
  : 'Restore this order')
const emptyTitle = computed(() => canRestoreSdk.value
  ? sdkFailure.value?.title ?? 'Restoring payment result'
  : 'Payment result not found')
const emptyDescription = computed(() => canRestoreSdk.value
  ? sdkError.value ?? 'Restoring the existing authorized PaymentAttempt without creating a new payment.'
  : 'No authorized persisted payment result could be restored for this order in the current browser.')
const verification = computed(() => {
  const source = attempt.value?.statusSource

  if (source === 'webhook') {
    return { source, label: 'verified Webhook', rawLabel: 'webhookRawStatus' }
  }

  if (source === 'query') {
    return { source, label: 'server-side Payment query', rawLabel: 'queryRawStatus' }
  }

  return {
    source: source ?? 'unavailable',
    label: 'persisted server state',
    rawLabel: 'providerRawStatus',
  }
})
const verificationEvent = computed(() => {
  if (!sdk.value || !attempt.value) {
    return null
  }

  return findProjectionEvent(attempt.value, sdk.value.events) ?? null
})
const sdkJourney = computed(() => sdk.value ? findOrderJourney(sdk.value.order) : null)
const returned = computed(() => sdk.value?.events.some(event => event.source === 'return') ?? false)
const clientResult = computed(() => sdk.value?.events.some(event => event.source === 'client') ?? false)
const paymentMethodLabels: Record<PaymentMethodId, string> = {
  card: 'Card',
  apm: 'APM',
  'google-pay': 'Google Pay',
  'apple-pay': 'Apple Pay',
}
const interaction = computed(() => clientResult.value
  ? 'SDK callback'
  : returned.value ? 'browser return' : 'client-visible state')
const outcome = computed(() => {
  if (contract.value?.state === 'active' && succeeded.value) {
    return {
      icon: 'i-lucide-circle-check-big',
      color: 'success' as const,
      badge: 'Server verified',
      title: 'Subscription active.',
      description: 'The initial payment and the independent subscription contract were both verified by server-side Provider evidence.',
    }
  }

  if (contract.value?.state === 'needs_attention' && succeeded.value) {
    return {
      icon: 'i-lucide-triangle-alert',
      color: 'warning' as const,
      badge: 'Contract needs attention',
      title: 'Payment verified · Subscription needs attention.',
      description: 'The initial payment succeeded, but Provider contract evidence is not an active or terminal state. Verify the existing contract; do not create another subscription.',
    }
  }

  if (contract.value?.state === 'terminal' && succeeded.value) {
    return {
      icon: 'i-lucide-circle-off',
      color: 'neutral' as const,
      badge: 'Contract terminal',
      title: 'Payment verified · Subscription ended.',
      description: 'The initial payment succeeded, but the independent subscription contract is canceled or ended and cannot be treated as active.',
    }
  }

  if (contract.value?.state === 'pending' && succeeded.value) {
    return {
      icon: 'i-lucide-clock-3',
      color: 'warning' as const,
      badge: 'Activation pending',
      title: 'Payment verified · Subscription pending.',
      description: 'The initial payment succeeded, but the contract is not active until the Subscription Webhook or a known-contract query establishes it.',
    }
  }

  if (succeeded.value) {
    return {
      icon: 'i-lucide-circle-check-big',
      color: 'success' as const,
      badge: sandbox.value ? 'Server verified' : 'Simulated outcome',
      title: sandbox.value ? 'Sandbox payment verified.' : 'Simulated payment complete.',
      description: sandbox.value
        ? `The ${interaction.value} remained non-final until the ${verification.value.label} durably established succeeded.`
        : 'The active PaymentAttempt reached succeeded through the selected deterministic event sequence. No real payment was submitted.',
    }
  }

  const status = attempt.value?.status ?? 'unknown'
  const failed = status === 'failed'

  return {
    icon: failed ? 'i-lucide-circle-x' : 'i-lucide-circle-alert',
    color: failed ? 'error' as const : 'warning' as const,
    badge: sandbox.value ? 'Server verified' : 'Simulated outcome',
    title: failed ? 'Payment failed.' : 'Payment was not completed.',
    description: sandbox.value
      ? `The ${verification.value.label} established the normalized status as ${status}. The ${interaction.value} was not treated as final proof.`
      : `The deterministic simulation reached ${status}. No real payment or provider response was created.`,
  }
})
const details = computed(() => {
  if (!order.value || !attempt.value) {
    return []
  }

  if (sdk.value) {
    return [
      { label: 'mode', value: 'sandbox' },
      { label: 'integration', value: 'web-js-sdk' },
      ...(!contract.value
        ? [
            { label: 'expectedMethod', value: paymentMethodLabels[attempt.value.method] },
            { label: 'actualWallet', value: attempt.value.actualWallet
              ? paymentMethodLabels[attempt.value.actualWallet]
              : 'not reported' },
            { label: 'fundingNetwork', value: attempt.value.fundingNetwork ?? 'not reported' },
            { label: 'methodAttributionSource', value: attempt.value.actualWallet || attempt.value.fundingNetwork
              ? 'server-side transaction query'
              : 'unavailable' },
          ]
        : []),
      { label: 'sdkRelease', value: 'v4/latest · replaceable current entry' },
      { label: 'journey', value: sdkJourney.value?.id ?? 'unavailable' },
      ...(contract.value
        ? [
            { label: 'subscriptionPlan', value: contract.value.planId },
            { label: 'normalizedContractStatus', value: contract.value.state },
            { label: 'contractVerificationSource', value: contract.value.statusSource },
          ]
        : []),
      {
        label: 'threeDSJourney',
        value: contract.value || sdkJourney.value?.id === 'three-ds-success'
          ? 'challenge'
          : 'not-required',
      },
      { label: 'returnObserved', value: returned.value ? 'yes' : 'no' },
      { label: 'orderId', value: order.value.id },
      { label: 'attemptId', value: attempt.value.id },
      { label: 'retryOf', value: attempt.value.retryOf ?? 'not-a-retry' },
      { label: 'merchantTxnId', value: attempt.value.merchantTxnId ?? 'unavailable' },
      { label: 'transactionId', value: attempt.value.transactionId ?? 'unavailable' },
      { label: 'paymentId', value: sdk.value.paymentId },
      { label: 'amountMinor / currency', value: `${order.value.amount.minor} / ${order.value.amount.currency}` },
      { label: 'normalizedStatus', value: attempt.value.status },
      { label: verification.value.rawLabel, value: verificationEvent.value?.rawStatus ?? 'unavailable' },
      { label: 'verificationSource', value: verification.value.source },
      ...(sdk.value.paymentMethod
        ? [{ label: 'sdkCallbackMethod', value: sdk.value.paymentMethod }]
        : []),
    ]
  }

  const journey = getJourney(demo.value!.journeyId)

  return [
    { label: 'mode', value: 'simulation' },
    { label: 'journey', value: journey.id },
    { label: 'orderId', value: order.value.id },
    { label: 'attemptId', value: attempt.value.id },
    { label: 'retryOf', value: attempt.value.retryOf ?? 'not-a-retry' },
    { label: 'amountMinor / currency', value: `${order.value.amount.minor} / ${order.value.amount.currency}` },
    { label: 'normalizedStatus', value: attempt.value.status },
    { label: 'simulated3DS', value: journey.id === 'three-ds-success' ? 'challenge' : 'not-required' },
    { label: 'attemptCount', value: String(demo.value!.attempts.length) },
  ]
})

async function restoreCurrentSdkOrder(): Promise<void> {
  if (restoring.value) {
    return
  }

  restoreAction.value = sdkFailure.value?.action ?? null

  try {
    if (!await recoverSdk(orderId.value)) {
      await nextTick()
      title.value?.focus()
      return
    }

    const restored = sdkSession.value

    if (restored && !isTerminalStatus(restored.attempt.status)) {
      await navigateTo(`/halden/sdk/${restored.order.id}`)
      return
    }

    if (restored) {
      await nextTick()
      title.value?.focus()
    }
  }
  finally {
    restoreAction.value = null
  }
}

async function verifyRetainedSubscription(): Promise<void> {
  await recoverSdk(orderId.value)
  await nextTick()
  title.value?.focus()
}

async function retryCurrentSdkOrder(): Promise<void> {
  await retrySdk()
  await nextTick()

  if (sdkFailure.value && canRestoreSdk.value) {
    actions.value?.querySelector<HTMLButtonElement>('[data-sdk-action]')?.focus()
  }
}

onMounted(async () => {
  restore()

  if (!demo.value && !sdk.value) {
    await recoverSdk(orderId.value)
  }

  ready.value = true

  if (demo.value && !isTerminalStatus(attempt.value?.status ?? 'created')) {
    await navigateTo(`/halden/checkout/${demo.value.order.id}`, { replace: true })
    return
  }

  const sdkNeedsVerification = Boolean(
    sdk.value
    && (
      !isTerminalStatus(sdk.value.attempt.status)
      || (
        !contract.value
        && !sdk.value.attempt.attributionTransactionId
      )
    ),
  )

  if (sdk.value && sdkNeedsVerification) {
    await verifySdk(1, false)

    if (sdk.value && !isTerminalStatus(sdk.value.attempt.status)) {
      await navigateTo(`/halden/sdk/${sdk.value.order.id}`, { replace: true })
      return
    }
  }

  await nextTick()
  title.value?.focus()
})
</script>

<template>
  <UContainer class="py-10 sm:py-16">
    <div
      v-if="!ready || !restored"
      class="mx-auto max-w-2xl space-y-6"
      aria-label="Restoring payment result"
    >
      <USkeleton class="mx-auto h-12 w-72 rounded-sm" />
      <USkeleton class="h-64 w-full rounded-lg" />
    </div>

    <section
      v-else-if="retainedContract && retainedSubscriptionPaymentStatus"
      class="mx-auto max-w-2xl py-10"
    >
      <div class="text-center">
        <span class="mx-auto flex size-14 items-center justify-center rounded-full bg-info/10">
          <UIcon name="i-lucide-history" class="size-7 text-info" aria-hidden="true" />
        </span>
        <UBadge label="Retained contract" color="info" variant="soft" class="mt-5" />
        <h1 ref="title" tabindex="-1" class="mt-4 text-3xl font-semibold tracking-tight text-highlighted focus:outline-none sm:text-4xl">
          Subscription status restored.
        </h1>
        <p class="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-toned">
          The 30-day Payment audit record has expired. This view uses fresh Provider queries for the same initial payment and the independently retained subscription contract.
        </p>
        <p class="mt-6 font-mono text-3xl font-semibold tracking-tight text-highlighted">
          {{ formatMoney(retainedContract.amount) }}
        </p>
      </div>

      <SubscriptionStatusPair
        :payment="retainedSubscriptionPaymentStatus"
        :subscription="retainedContract"
      />

      <PaymentTechnicalDetails
        id="payment-technical-details"
        :rows="[
          { label: 'mode', value: 'sandbox' },
          { label: 'retention', value: 'Payment audit expired after 30 days' },
          { label: 'orderId', value: orderId },
          { label: 'subscriptionPlan', value: retainedContract.planId },
          { label: 'normalizedPaymentStatus', value: retainedSubscriptionPaymentStatus },
          { label: 'normalizedContractStatus', value: retainedContract.state },
          { label: 'contractVerificationSource', value: retainedContract.statusSource },
        ]"
        mode="sandbox"
        class="mt-6"
      />

      <div class="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
        <UButton to="/" label="Return to Demo Hub" color="neutral" variant="outline" size="lg" class="min-h-11" />
        <UButton
          label="Verify retained subscription"
          icon="i-lucide-shield-check"
          size="lg"
          class="min-h-11"
          :loading="restoring"
          :disabled="restoring"
          @click="verifyRetainedSubscription"
        />
      </div>
    </section>

    <section
      v-else-if="!order || !attempt"
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
          v-if="canRestoreSdk"
          :label="restoreLabel"
          icon="i-lucide-history"
          class="min-h-11"
          :loading="restoring"
          :disabled="restoring"
          @click="restoreCurrentSdkOrder"
        />
      </div>
    </section>

    <div v-else class="mx-auto max-w-2xl">
      <div class="text-center">
        <span
          class="mx-auto flex size-14 items-center justify-center rounded-full"
          :class="succeeded ? 'bg-success/10' : attempt.status === 'failed' ? 'bg-error/10' : 'bg-warning/10'"
        >
          <UIcon
            :name="outcome.icon"
            class="size-7"
            :class="succeeded ? 'text-success' : attempt.status === 'failed' ? 'text-error' : 'text-warning'"
            aria-hidden="true"
          />
        </span>
        <UBadge :label="outcome.badge" :color="outcome.color" variant="soft" class="mt-5" />
        <h1
          ref="title"
          tabindex="-1"
          class="mt-4 text-3xl font-semibold tracking-tight text-highlighted focus:outline-none sm:text-4xl"
        >
          {{ outcome.title }}
        </h1>
        <p class="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-toned">
          {{ outcome.description }}
        </p>
        <p class="mt-6 font-mono text-3xl font-semibold tracking-tight text-highlighted">
          {{ amount }}
        </p>
      </div>

      <section aria-labelledby="result-order-title" class="mt-10 rounded-lg border border-default p-5 sm:p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-sm text-muted">Halden order</p>
            <h2 id="result-order-title" class="mt-1 font-mono text-base font-semibold text-highlighted">
              {{ order.id }}
            </h2>
          </div>
          <UBadge
            :label="`${attempt.status} · ${sandbox ? 'Sandbox' : 'Simulation'}`"
            :color="outcome.color"
            variant="soft"
          />
        </div>

        <USeparator class="my-5" />

        <PaymentAttempts :attempts="attempts" :active-id="attempt.id" />
      </section>

      <SubscriptionStatusPair
        v-if="contract"
        :payment="attempt.status"
        :subscription="contract"
      />

      <UAlert
        v-if="sdkError"
        role="alert"
        :title="sdkFailure?.title"
        :description="sdkError"
        color="warning"
        variant="subtle"
        icon="i-lucide-circle-alert"
        class="mt-6"
      />

      <PaymentTechnicalDetails
        id="payment-technical-details"
        :rows="details"
        :mode="sandbox ? 'sandbox' : 'simulation'"
        class="mt-6"
      />

      <div ref="actions" class="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
        <UButton
          to="/"
          label="Return to Demo Hub"
          color="neutral"
          variant="outline"
          size="lg"
          class="min-h-11"
        />
        <UButton
          v-if="!sandbox"
          :label="succeeded ? 'Run this journey again' : 'Retry simulated payment'"
          icon="i-lucide-refresh-cw"
          size="lg"
          class="min-h-11"
          @click="retry"
        />
        <UButton
          v-else-if="canRestoreSdk"
          data-sdk-action
          :label="restoreLabel"
          icon="i-lucide-history"
          size="lg"
          class="min-h-11"
          :loading="restoring"
          :disabled="restoring"
          @click="restoreCurrentSdkOrder"
        />
        <UButton
          v-if="contract && subscriptionPending"
          label="Verify existing subscription"
          icon="i-lucide-shield-check"
          size="lg"
          class="min-h-11"
          @click="verifySdk(1)"
        />
        <UButton
          v-else-if="canRetrySdk"
          data-sdk-action
          label="Retry payment"
          icon="i-lucide-refresh-cw"
          size="lg"
          class="min-h-11"
          :loading="retrying"
          :disabled="retrying"
          @click="retryCurrentSdkOrder"
        />
      </div>
    </div>
  </UContainer>
</template>
