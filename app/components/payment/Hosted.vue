<script setup lang="ts">
import { paymentPath } from '#shared/payment/checkout'
import { findOrderJourney } from '#shared/payment/journey'
import { isTerminalStatus } from '#shared/payment/sdk'

const route = useRoute()
const {
  session, subscription, stage, error, recoveryFailure, restoring,
  canOpenCheckout, openCheckout, recover, verify, start,
} = useSdk()
const mounted = shallowRef(false)
const title = useTemplateRef<HTMLElement>('title')
const orderId = computed(() => String(route.params.order))
const current = computed(() => session.value?.order.id === orderId.value ? session.value : null)
const journey = computed(() => current.value ? findOrderJourney(current.value.order) : null)
const contract = computed(() => current.value ? subscription.value : null)
const busy = computed(() => restoring.value || ['creating', 'verifying', 'redirecting'].includes(stage.value))
const amount = computed(() => current.value ? formatMoney(current.value.order.amount) : '')
const lines = computed(() => current.value ? [
  { label: current.value.order.item.name, value: current.value.order.item.variant },
  ...(contract.value
    ? [{ label: 'Billing', value: 'Merchant-managed · Every day' }, { label: 'Today', value: 'First payment' }]
    : [{ label: 'Quantity', value: String(current.value.order.item.quantity) }, { label: 'Delivery', value: 'Included' }]),
] : [])
const details = computed(() => current.value ? [
  { label: 'integration', value: 'checkout' },
  { label: contract.value ? 'subscriptionPlan' : 'journey', value: contract.value?.planId ?? journey.value?.id ?? 'unavailable' },
  { label: 'threeDSJourney', value: contract.value || journey.value?.id === 'hosted-checkout-three-ds' ? 'challenge' : 'not-selected' },
  { label: 'orderId', value: current.value.order.id },
  { label: 'attemptId', value: current.value.attempt.id },
  { label: 'merchantTxnId', value: current.value.attempt.merchantTxnId ?? 'unavailable' },
  { label: 'transactionId', value: current.value.attempt.transactionId ?? 'unavailable' },
  { label: 'paymentId', value: current.value.paymentId ?? 'not returned' },
  { label: 'normalizedStatus', value: current.value.attempt.status },
] : [])

async function restore(): Promise<void> {
  if (restoring.value) return
  await recover(orderId.value)
  if (current.value) {
    const path = paymentPath(current.value.attempt)
    if (path !== route.path) {
      await navigateTo(path, { replace: true })
      return
    }
  }
  await nextTick()
  title.value?.focus()
}

function resumeFromHistory(event: PageTransitionEvent): void {
  // BFCache revives this component without remounting. Re-establish the same
  // authorized attempt instead of replaying its already-consumed checkout URL.
  if (event.persisted) void restore()
}

onScopeDispose(() => {
  if (import.meta.client) window.removeEventListener('pageshow', resumeFromHistory)
})

onMounted(async () => {
  window.addEventListener('pageshow', resumeFromHistory)
  if (!current.value) await restore()
  mounted.value = true
  if (current.value && (current.value.attempt.integration !== 'checkout' || isTerminalStatus(current.value.attempt.status))) {
    await navigateTo(paymentPath(current.value.attempt), { replace: true })
    return
  }
  await nextTick()
  title.value?.focus()
})
</script>

<template>
  <UContainer class="py-8 pb-40 md:max-w-2xl md:pb-24 lg:max-w-none lg:py-12 lg:pb-12">
    <div v-if="!mounted" aria-label="Restoring hosted checkout" class="space-y-6">
      <USkeleton class="h-10 w-64 rounded-sm" />
      <USkeleton class="h-64 w-full rounded-lg" />
    </div>
    <section v-else-if="!current || current.attempt.integration !== 'checkout'" class="mx-auto max-w-xl py-16 text-center">
      <h1 ref="title" tabindex="-1" class="text-2xl font-semibold text-highlighted">
        Checkout could not be restored
      </h1>
      <p class="mt-4 text-sm text-toned">
        {{ error ?? 'This browser has no authorized payment for this order.' }}
      </p>
      <UButton v-if="recoveryFailure === 'retryable'" label="Retry restoration" :loading="restoring" class="mt-6 min-h-11" @click="restore" />
      <UButton v-else to="/" label="Return to Demo Hub" class="mt-6 min-h-11" />
    </section>
    <div v-else class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div class="min-w-0 space-y-8">
        <div>
          <UBadge label="Sandbox · Hosted Checkout" variant="soft" />
          <h1 ref="title" tabindex="-1" class="mt-4 text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
            {{ contract ? 'Start your Halden subscription.' : 'Complete your Halden order.' }}
          </h1>
          <p class="mt-4 max-w-2xl text-sm leading-relaxed text-toned">
            Choose your payment method on Onerway’s secure checkout. You will return to Halden to see your verified payment result.
          </p>
        </div>
        <section class="rounded-lg border border-default p-5 sm:p-6" aria-labelledby="hosted-methods-title">
          <UIcon name="i-lucide-external-link" class="size-6 text-primary" aria-hidden="true" />
          <h2 id="hosted-methods-title" class="mt-4 text-lg font-semibold text-highlighted">
            Payment options on Checkout
          </h2>
          <p class="mt-2 text-sm leading-relaxed text-toned">
            Onerway shows the methods enabled for this merchant and eligible for your country, currency and device. Enter payment details only on that page.
          </p>
          <p v-if="journey?.id === 'hosted-checkout-three-ds'" class="mt-2 text-sm leading-relaxed text-toned">
            Select Card to test the USD 50.00 Sandbox 3DS challenge. Complete authentication on the hosted page; Halden verifies the payment after your return. Selecting another method does not verify this 3DS journey.
          </p>
          <p v-if="contract" class="mt-2 text-sm leading-relaxed text-toned">
            Select Card to pay {{ amount }} today for {{ contract.productName }} and authorize daily merchant-managed billing. Complete the first-payment 3DS on Checkout. Halden verifies payment and subscription activation separately; this showcase does not schedule later charges. Other methods are outside this subscription demonstration.
          </p>
        </section>
        <SubscriptionStatusPair v-if="contract" :payment="current.attempt.status" :subscription="contract" />
        <div role="status" aria-live="polite" class="rounded-lg border border-default bg-muted p-5">
          <p class="font-medium text-highlighted">
            {{ canOpenCheckout ? 'Your Sandbox checkout is ready.' : stage === 'redirecting' ? 'Opening Onerway Checkout…' : stage === 'verifying' ? 'Checking your payment…' : 'Check this payment before starting again.' }}
          </p>
          <p class="mt-2 text-sm leading-relaxed text-toned">
            {{ canOpenCheckout ? 'Continue to select a payment method. This creates no additional order.' : 'Your order is preserved. Refreshing this page does not create another payment or reopen a previous checkout link.' }}
          </p>
        </div>
        <UAlert v-if="error" :description="error" color="warning" variant="subtle" role="alert" />
        <div v-if="!canOpenCheckout" class="flex flex-wrap gap-3">
          <UButton label="Verify existing payment" icon="i-lucide-shield-check" :disabled="busy" :loading="stage === 'verifying'" class="min-h-11" @click="verify()" />
          <UButton v-if="journey && !contract" label="Start a separate Sandbox order" variant="outline" color="neutral" :disabled="busy" class="min-h-11" @click="start(journey.id, true)" />
          <UButton v-if="contract" to="/?mode=subscription&journey=hosted-checkout" label="Return to subscription options" variant="outline" color="neutral" class="min-h-11" />
        </div>
        <section aria-label="Payment references" class="min-w-0 rounded-lg border border-default p-5">
          <h2 class="font-semibold text-highlighted">Payment references</h2>
          <dl class="mt-4 space-y-3 text-xs">
            <div v-for="detail in details" :key="detail.label" class="grid min-w-0 gap-1 sm:grid-cols-2">
              <dt class="text-muted">{{ detail.label }}</dt>
              <dd class="min-w-0 break-all font-mono text-toned">{{ detail.value }}</dd>
            </div>
          </dl>
        </section>
      </div>
      <HaldenSummary :lines="lines" :total="amount" pay-label="Continue to Onerway Checkout" :disabled="!canOpenCheckout || busy" :busy="stage === 'redirecting'" @pay="openCheckout" />
    </div>
  </UContainer>
</template>
