<script setup lang="ts">
import type { CreatePaymentIntentResponse } from '#shared/payment/sdk'

const props = defineProps<{ orderId: string }>()
const { session, steps, loading, checking, canPay, submitted, sheetOpen, sheetMessage, error, prepare, pay, verify } = useApplePay(props.orderId)
const title = useTemplateRef<HTMLElement>('title')
const restarting = shallowRef(false)
const restartError = shallowRef<string | null>(null)
let disposed = false
const amount = computed(() => session.value ? formatMoney(session.value.order.amount) : 'USD 5.00')
const resultTitle = computed(() => {
  if (!session.value) return loading.value ? 'Preparing your order…' : 'This order could not be restored.'
  switch (session.value?.attempt.status) {
    case 'succeeded': return 'Your order is paid.'
    case 'failed': return 'This payment failed.'
    case 'cancelled': return 'This transaction was cancelled.'
    case 'requires_action': return 'This payment needs further confirmation.'
    default: return submitted.value ? 'Payment result is being confirmed.' : 'Your order is ready.'
  }
})
const canRestart = computed(() => session.value && ['failed', 'cancelled'].includes(session.value.attempt.status))
const references = computed(() => session.value ? [
  { label: 'Order', value: session.value.order.id },
  { label: 'Attempt', value: session.value.attempt.id },
  { label: 'Merchant transaction', value: session.value.attempt.merchantTxnId ?? 'Not assigned' },
  { label: 'Onerway transaction', value: session.value.attempt.transactionId ?? 'Not returned' },
  { label: 'Onerway payment', value: session.value.paymentId ?? 'Not returned' },
  { label: 'Order payment status', value: session.value.attempt.status },
  { label: 'Status source', value: session.value.attempt.statusSource ?? 'Not confirmed' },
  { label: 'Latest server status', value: [...session.value.events].reverse().find(event => ['server', 'query', 'webhook'].includes(event.source))?.rawStatus ?? 'Not returned' },
] : [])

async function restart(): Promise<void> {
  if (restarting.value || !canRestart.value) return
  restarting.value = true
  restartError.value = null
  try {
    if (!navigator.locks) throw new Error('PAYMENT_INTENT_LOCK_UNAVAILABLE')
    const response = await navigator.locks.request('onerway-payment-intent', { mode: 'exclusive' }, () => {
      if (disposed) return null
      return $fetch<CreatePaymentIntentResponse>('/api/payment/intent', { method: 'POST', body: { journeyId: 'apple-pay-direct', method: 'apple-pay', restart: true }, retry: 0 })
    })
    if (!disposed && response) await navigateTo(`/halden/direct/${encodeURIComponent(response.orderId)}`)
  }
  catch { if (!disposed) restartError.value = 'A new order could not be opened. Your previous order is preserved.' }
  finally { restarting.value = false }
}

function restoreFromHistory(event: PageTransitionEvent): void {
  if (event.persisted) void verify()
}
onMounted(async () => {
  window.addEventListener('pageshow', restoreFromHistory)
  await prepare()
  if (!disposed) { await nextTick(); title.value?.focus() }
})
onScopeDispose(() => {
  disposed = true
  if (import.meta.client) window.removeEventListener('pageshow', restoreFromHistory)
})
</script>

<template>
  <UContainer class="py-8 pb-16 lg:py-12">
    <div class="grid gap-8 lg:grid-cols-3 lg:items-start">
      <div class="min-w-0 space-y-8 lg:col-span-2">
        <header>
          <UBadge label="Sandbox · Direct API · Apple Pay" variant="soft" />
          <h1 ref="title" tabindex="-1" class="mt-4 text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">Pay with Apple Pay.</h1>
          <p class="mt-4 max-w-2xl text-sm leading-relaxed text-toned">Complete your Halden order in Apple Pay, then explore how your browser, Halden, Apple and Onerway work together.</p>
        </header>
        <section class="space-y-4 rounded-lg border border-default p-5 sm:p-6" aria-labelledby="apple-pay-order-title">
          <h2 id="apple-pay-order-title" class="text-lg font-semibold text-highlighted">{{ resultTitle }}</h2>
          <p v-if="submitted && !canRestart && session?.attempt.status !== 'succeeded'" class="text-sm leading-relaxed text-toned">Please do not pay again while this order is unconfirmed. Closing Apple Pay, leaving this page or a timeout does not cancel a payment already submitted.</p>
          <p v-if="canRestart" class="text-sm leading-relaxed text-toned">The original result is preserved. Paying again creates a new order and requires fresh Apple Pay authorization.</p>
          <p role="status" aria-live="polite" class="text-sm leading-relaxed text-toned">{{ sheetMessage }}</p>
          <UAlert v-if="error || restartError" :description="error ?? restartError ?? ''" color="warning" variant="subtle" />
          <USkeleton v-if="loading" class="h-12 w-full rounded-sm" aria-label="Preparing Apple Pay" />
          <component :is="'apple-pay-button'" v-else-if="canPay" buttonstyle="black" type="pay" locale="en-US" class="apple-pay-control" @click="pay" />
          <div class="flex flex-wrap gap-3">
            <UButton v-if="!submitted && !loading && !sheetOpen && !canPay" label="Retry preparation" color="neutral" variant="outline" class="min-h-11 touch-manipulation" @click="prepare" />
            <UButton v-if="session && submitted" label="Check this order" :loading="checking" :disabled="checking" color="neutral" variant="outline" class="min-h-11 touch-manipulation" @click="verify" />
            <UButton v-if="canRestart" label="Place a new order and pay" :loading="restarting" :disabled="restarting" class="min-h-11 touch-manipulation" @click="restart" />
            <UButton to="/" label="Demo Hub" color="neutral" variant="link" class="min-h-11 touch-manipulation" />
          </div>
        </section>
        <PaymentApplePaySteps :steps="steps" />
      </div>
      <aside class="min-w-0 space-y-6 lg:sticky lg:top-24" aria-label="Order and test conditions">
        <section class="rounded-lg border border-default p-5 sm:p-6">
          <h2 class="text-lg font-semibold text-highlighted">Your Halden order</h2>
          <p class="mt-4 text-sm text-toned">{{ session?.order.item.name ?? 'Sandbox order' }}</p>
          <p v-if="session" class="mt-1 text-sm text-muted">{{ session.order.item.variant }} · Quantity {{ session.order.item.quantity }}</p>
          <p class="mt-6 text-2xl font-semibold text-highlighted">{{ amount }}</p>
          <p class="mt-1 text-xs text-muted">One-time Sandbox payment · SALE</p>
        </section>
        <section class="rounded-lg border border-default bg-muted p-5 text-sm leading-relaxed">
          <h2 class="font-semibold text-highlighted">Before you test</h2>
          <p class="mt-2 text-toned">Use an Apple Sandbox tester with a supported test card in Wallet. A regular Wallet card is not the supported test path for this demo.</p>
          <p class="mt-3 text-toned">A compatible browser may offer a code to scan with a supported iPhone or iPad. Availability depends on your device and region; this is not limited by browser name.</p>
          <UButton to="https://developer.apple.com/apple-pay/sandbox-testing/" target="_blank" rel="noopener noreferrer" label="Apple Sandbox setup" variant="link" color="neutral" class="mt-2 min-h-11 touch-manipulation" />
        </section>
        <section v-if="session" class="rounded-lg border border-default p-5">
          <h2 class="font-semibold text-highlighted">Payment references</h2>
          <dl class="mt-4 space-y-4 text-xs">
            <div v-for="reference in references" :key="reference.label"><dt class="text-muted">{{ reference.label }}</dt><dd class="mt-1 break-all font-mono text-toned">{{ reference.value }}</dd></div>
          </dl>
          <p class="mt-4 text-xs leading-relaxed text-muted">Apple token contents and merchant-session credentials are never included in these details.</p>
        </section>
      </aside>
    </div>
  </UContainer>
</template>
