<script setup lang="ts">
import type { CreatePaymentIntentResponse } from '#shared/payment/sdk'

const props = defineProps<{ orderId: string }>()
const { session, steps, mode, manualCaptured, tokenDebug, tokenDebugUnavailable, loading, checking, submitting, canPay, submitted, sheetOpen, sheetMessage, error, prepare, pay, verify, clearToken, setMode } = useApplePay(props.orderId)
const restarting = shallowRef(false)
const restartError = shallowRef<string | null>(null)
let disposed = false
const modeItems = [
  { label: 'Automatic payment', value: 'automatic', description: 'Authorize in Wallet to submit this Sandbox payment.' },
  { label: 'Manual debugging', value: 'manual', description: 'Capture a token without submitting this order. Copy it to Apifox to call the Direct API.' },
]
const modeLocked = computed(() => loading.value || sheetOpen.value || submitted.value)
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

function selectMode(nextMode: unknown): void {
  if (nextMode === 'automatic' || nextMode === 'manual') setMode(nextMode)
}

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
})
onScopeDispose(() => {
  disposed = true
  if (import.meta.client) window.removeEventListener('pageshow', restoreFromHistory)
})
</script>

<template>
  <UContainer class="py-6 pb-16 lg:py-12">
    <div class="grid gap-8 lg:grid-cols-3 lg:items-start">
      <div class="min-w-0 space-y-8 lg:col-span-2">
        <header>
          <UBadge label="Sandbox · Direct API · Apple Pay" variant="soft" />
          <h1 class="mt-3 text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">Pay with Apple Pay.</h1>
          <p class="mt-4 max-w-2xl text-sm leading-relaxed text-toned">Complete your Halden order in Apple Pay, then explore how your browser, Halden, Apple and Onerway work together.</p>
        </header>
        <section class="space-y-4 rounded-lg border border-default p-5 sm:p-6" aria-labelledby="apple-pay-order-title">
          <PaymentWalletReceipt
            :order-id="orderId" :order="session?.order" :status="session?.attempt.status" heading-id="apple-pay-order-title"
            :submitted="submitted" :submitting="submitting" :checking="checking" :loading="loading" :sheet-open="sheetOpen"
            :manual-captured="manualCaptured" :verification-pending="session?.verificationPending" :message="sheetMessage" />
          <p v-if="submitted && !canRestart && session?.attempt.status !== 'succeeded'" class="text-sm leading-relaxed text-toned">Please do not pay again while this order is unconfirmed. Closing Apple Pay, leaving this page or a timeout does not cancel a payment already submitted.</p>
          <p v-if="manualCaptured && !submitted" class="text-sm leading-relaxed text-toned">Copy the token below to Apifox and match this USD 5.00 order’s amount and currency. A call made in Apifox is separate from this Showcase order; check that call’s result in Apifox. This page’s order remains unsubmitted.</p>
          <p v-if="canRestart" class="text-sm leading-relaxed text-toned">The original result is preserved. Paying again creates a new order and requires fresh Apple Pay authorization.</p>
          <UFormField v-if="!submitted" label="After Wallet authorization" name="apple-pay-mode" :help="sheetOpen ? 'Close Wallet before changing mode.' : submitted ? 'The mode is locked after payment submission.' : undefined">
            <URadioGroup :model-value="mode" :items="modeItems" :disabled="modeLocked" color="neutral" variant="list" :ui="{ item: 'min-h-11 touch-manipulation' }" @update:model-value="selectMode" />
          </UFormField>
          <UAlert v-if="error || restartError" :description="error ?? restartError ?? ''" color="warning" variant="subtle" />
          <component :is="'apple-pay-button'" v-if="canPay" buttonstyle="black" type="pay" locale="en-US" class="apple-pay-control" @click="pay" />
          <div class="flex flex-wrap gap-3">
            <UButton v-if="!submitted && !loading && !sheetOpen && !canPay" label="Retry preparation" color="neutral" variant="outline" class="min-h-11 touch-manipulation" @click="prepare" />
            <UButton v-if="session && submitted" label="Check this order" :loading="checking" :disabled="checking || submitting" color="neutral" variant="outline" class="min-h-11 touch-manipulation" @click="verify" />
            <UButton v-if="canRestart" label="Place a new order and pay" :loading="restarting" :disabled="restarting" class="min-h-11 touch-manipulation" @click="restart" />
            <UButton to="/" label="Demo Hub" color="neutral" variant="link" class="min-h-11 touch-manipulation" />
          </div>
        </section>
        <PaymentApplePayToken v-if="session" :token="tokenDebug" :unavailable="tokenDebugUnavailable" :manual="mode === 'manual'" :captured="manualCaptured" @clear="clearToken" />
        <PaymentApplePaySteps :steps="steps" />
      </div>
      <aside class="min-w-0 space-y-6 lg:sticky lg:top-24" aria-label="Order and test conditions">
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
