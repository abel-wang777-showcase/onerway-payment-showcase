<script setup lang="ts">
import type { DirectRecoveryResponse } from '#shared/payment/apple-pay'
const props = defineProps<{ orderId: string, initial?: DirectRecoveryResponse }>()
const { session, steps, manualCaptured, tokenDebugUnavailable, mode, loading, checking, sheetOpen, submitted, tokenDebug, error, message, canPay, setMode, initialize, prepare, verify, clearToken, createButton } = useGooglePay(props.orderId, props.initial)
const restarting = shallowRef(false)
const restartError = shallowRef<string | null>(null)
let disposed = false
const canRestart = computed(() => !!session.value && ['failed', 'cancelled'].includes(session.value.attempt.status))
const references = computed(() => session.value ? [
  ['Order', session.value.order.id], ['Attempt', session.value.attempt.id],
  ['Merchant transaction', session.value.attempt.merchantTxnId ?? 'Not assigned'],
  ['Onerway transaction', session.value.attempt.transactionId ?? 'Not returned'],
  ['Onerway payment', session.value.paymentId ?? 'Not returned'],
  ['Status', session.value.attempt.status], ['Source', session.value.attempt.statusSource ?? 'Not confirmed'],
  ['Latest server status', [...session.value.events].reverse().find(event => ['server', 'query', 'webhook'].includes(event.source))?.rawStatus ?? 'Not returned'],
] : [])
async function restart() {
  if (restarting.value || !canRestart.value) return
  restarting.value = true
  restartError.value = null
  try {
    if (!navigator.locks) throw new Error('LOCK_UNAVAILABLE')
    const response = await navigator.locks.request('onerway-payment-intent', { mode: 'exclusive' }, () => disposed ? null : $fetch<{ orderId: string, initial?: DirectRecoveryResponse }>('/api/payment/intent', { method: 'POST', body: { journeyId: 'google-pay-direct', method: 'google-pay', restart: true }, retry: 0 }))
    if (!disposed && response) await navigateTo(`/halden/direct/${encodeURIComponent(response.orderId)}`)
  }
  catch { if (!disposed) restartError.value = 'A new order could not be opened. Your original order is preserved.' }
  finally { restarting.value = false }
}
onScopeDispose(() => { disposed = true })
const buttonHost = useTemplateRef<HTMLElement>('buttonHost')
const modeItems = [
  { label: 'Automatic payment', value: 'automatic', description: 'Authorize in Google Pay to submit this Sandbox order.' },
  { label: 'Manual debugging', value: 'manual', description: 'Capture a token for Apifox. Showcase does not submit or track that separate call.' },
]
const resultTitle = computed(() => {
  if (session.value?.attempt.status === 'succeeded') return 'Your order is paid.'
  if (session.value?.attempt.status === 'failed') return 'This payment failed.'
  if (session.value?.attempt.status === 'cancelled') return 'This transaction was cancelled.'
  if (session.value?.attempt.status === 'requires_action') return 'Further confirmation is required.'
  if (submitted.value) return 'Payment result is being confirmed.'
  return manualCaptured.value ? 'Token captured — payment not submitted.' : 'Your Halden order'
})
function selectMode(value: unknown) { if (value === 'automatic' || value === 'manual') setMode(value) }
watch([canPay, buttonHost], () => {
  const host = buttonHost.value
  if (!host) return
  host.replaceChildren()
  if (canPay.value) { const button = createButton(); if (button) host.append(button) }
}, { flush: 'post' })
onMounted(initialize)
</script>

<template>
  <UContainer class="py-8 pb-16 lg:py-12">
    <div class="grid gap-8 lg:grid-cols-3 lg:items-start">
      <div class="min-w-0 space-y-8 lg:col-span-2">
        <header>
          <UBadge label="Sandbox · Direct API · Google Pay" variant="soft" />
          <h1 class="mt-4 text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">Pay with Google Pay.</h1>
          <p class="mt-4 text-sm text-toned">Authorize your Halden purchase, then explore how Google Pay and Onerway process it.</p>
        </header>
        <section class="space-y-4 rounded-lg border border-default p-5 sm:p-6" aria-labelledby="google-pay-order-title">
          <h2 id="google-pay-order-title" class="text-lg font-semibold text-highlighted">{{ resultTitle }}</h2>
          <UFormField label="After Google Pay authorization" name="google-pay-mode">
            <URadioGroup :model-value="mode" :items="modeItems" :disabled="loading || submitted || sheetOpen" :ui="{ item: 'min-h-11 touch-manipulation' }" color="neutral" variant="list" @update:model-value="selectMode" />
          </UFormField>
          <p role="status" class="text-sm leading-relaxed text-toned">{{ message }}</p>
          <p v-if="session?.attempt.status === 'requires_action'" class="text-sm text-toned">Onerway may need card verification on its hosted page. After returning, check this original order’s server result; returning alone does not confirm payment. Do not pay again.</p>
          <UAlert v-if="error || restartError" :description="error ?? restartError ?? ''" color="warning" variant="subtle" />
          <USkeleton v-if="loading" class="h-12 w-full" aria-label="Preparing Google Pay" />
          <div ref="buttonHost" class="google-pay-control" />
          <div class="flex flex-wrap gap-3">
            <UButton v-if="!loading && !submitted && !sheetOpen && !canPay" class="min-h-11 touch-manipulation" label="Retry preparation" variant="outline" color="neutral" @click="prepare" />
            <UButton v-if="submitted" class="min-h-11 touch-manipulation" label="Check this order" :loading="checking" variant="outline" color="neutral" @click="verify" />
            <UButton v-if="canRestart" class="min-h-11 touch-manipulation" label="Place a new order and pay" :loading="restarting" @click="restart" />
            <UButton class="min-h-11 touch-manipulation" to="/" label="Demo Hub" variant="link" color="neutral" />
          </div>
        </section>
        <PaymentGooglePayToken :token="tokenDebug" :unavailable="tokenDebugUnavailable" :manual="mode === 'manual'" :captured="manualCaptured" @clear="clearToken" />
        <PaymentGooglePaySteps :steps="steps" :mode="mode" />
      </div>
      <aside class="min-w-0 space-y-6 lg:sticky lg:top-24" aria-label="Order and test conditions">
        <section class="rounded-lg border border-default p-5 sm:p-6">
          <h2 class="font-semibold text-highlighted">Your Halden order</h2>
          <p class="mt-4 text-sm text-toned">{{ session?.order.item.name ?? 'Sandbox order' }}</p>
          <p class="mt-6 text-2xl font-semibold text-highlighted">{{ session ? formatMoney(session.order.amount) : 'USD 5.00' }}</p>
          <p class="mt-2 text-xs text-muted">One-time Sandbox payment · SALE</p>
        </section>
        <section class="space-y-3 rounded-lg border border-default bg-muted p-5 text-sm text-toned">
          <h2 class="font-semibold text-highlighted">Google Pay test conditions</h2>
          <p>Google Pay runs in TEST. Availability depends on your browser, account, card networks and merchant configuration. Google TEST can return mock tokens that the payment gateway rejects; obtaining a token does not prove it can be charged.</p>
          <p>Full PaymentData, card details and tokens are never saved. The encrypted token is available only in this page’s Sandbox debugging view.</p>
          <p v-if="submitted">Do not pay again while this order is unconfirmed.</p>
        </section>
        <section v-if="session" class="space-y-3 rounded-lg border border-default p-5 text-sm">
          <h2 class="font-semibold text-highlighted">Safe payment summary</h2>
          <dl class="space-y-3 break-all"><div v-for="[label, value] in references" :key="label"><dt class="text-muted">{{ label }}</dt><dd class="font-mono">{{ value }}</dd></div></dl>
        </section>
      </aside>
    </div>
  </UContainer>
</template>
