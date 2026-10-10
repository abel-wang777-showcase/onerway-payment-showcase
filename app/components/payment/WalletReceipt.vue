<script setup lang="ts">
import type { Order } from '#shared/payment/order'
import type { PaymentStatus } from '#shared/payment/attempt'

const props = defineProps<{
  orderId: string
  order?: Order
  status?: PaymentStatus
  headingId: string
  submitted?: boolean
  submitting?: boolean
  checking?: boolean
  loading?: boolean
  sheetOpen?: boolean
  manualCaptured?: boolean
  verificationPending?: boolean
  transactionNotFound?: boolean
  message?: string
}>()
const receipt = useTemplateRef<HTMLElement>('receipt')
watch(() => props.submitting, async (active, previous) => {
  if (active && !previous) {
    await nextTick()
    receipt.value?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' })
  }
})
const terminal = computed(() => props.status && ['succeeded', 'failed', 'cancelled'].includes(props.status))
const busy = computed(() => !terminal.value && (props.submitting || props.checking || props.loading))
const feedback = computed(() => {
  if (props.status === 'succeeded') return { title: 'Your order is paid.', description: 'Payment confirmed. Keep this order reference for your records.', icon: 'i-lucide-circle-check', tone: 'success' }
  if (props.status === 'failed') return { title: 'This payment failed.', description: 'The payment service confirmed a failed result. A new payment needs a new order and fresh authorization.', icon: 'i-lucide-circle-x', tone: 'error' }
  if (props.status === 'cancelled') return { title: 'This transaction was cancelled.', description: 'The payment service confirmed cancellation. You can start a new order when you are ready.', icon: 'i-lucide-circle-minus', tone: 'neutral' }
  if (props.submitting) return { title: 'Processing your payment…', description: 'Your wallet authorization is received. Keep this page open while we send and confirm this payment.', icon: 'i-lucide-loader-circle', tone: 'primary' }
  if (props.checking) return { title: 'Checking your payment…', description: 'We are checking this original order with the payment service. You do not need to authorize again.', icon: 'i-lucide-loader-circle', tone: 'primary' }
  if (props.loading) return { title: 'Preparing your order…', description: 'Loading your order and wallet availability.', icon: 'i-lucide-loader-circle', tone: 'primary' }
  if (!props.order) return { title: 'This order could not be restored.', description: 'Your existing payment is preserved. Retry restoration or preparation to continue.', icon: 'i-lucide-circle-alert', tone: 'neutral' }
  if (props.manualCaptured && !props.submitted) return { title: 'Token captured — payment not submitted.', description: 'Your token is ready in the debugging section below. This order has not been sent for payment.', icon: 'i-lucide-code', tone: 'neutral' }
  if (props.transactionNotFound) return { title: 'Waiting for a payment result', description: props.message || 'No transaction was found yet. Complete hosted verification if it is still open, then check this order.', icon: 'i-lucide-clock-3', tone: 'neutral' }
  if (props.status === 'requires_action') return { title: 'Further confirmation is needed', description: 'Follow the payment service’s verification instructions, then check this original order for an updated result.', icon: 'i-lucide-shield-check', tone: 'neutral' }
  if (props.submitted) return { title: 'Payment is not confirmed yet', description: props.verificationPending ? 'We could not obtain a fresh result. Your saved order is preserved; use Check this order to try again.' : 'Your payment has been submitted. Use Check this order for an updated result; do not submit the same payment again.', icon: 'i-lucide-clock-3', tone: 'neutral' }
  if (props.sheetOpen) return { title: 'Continue in your wallet', description: props.message || 'Approve or close the wallet to continue here.', icon: 'i-lucide-wallet', tone: 'neutral' }
  return { title: 'Your order is ready.', description: props.message || 'Choose your payment mode and authorize with your wallet below.', icon: 'i-lucide-shopping-bag', tone: 'neutral' }
})
const iconTone = computed(() => ({ success: 'text-success', error: 'text-error', primary: 'text-primary', neutral: 'text-toned' }[feedback.value.tone]))
</script>

<template>
  <div ref="receipt" class="wallet-receipt" data-wallet-receipt>
    <div class="flex flex-wrap items-start justify-between gap-4 border-b border-default pb-5" aria-label="Order summary" data-wallet-order-summary>
      <div class="min-w-0 flex-1">
        <p class="font-medium text-highlighted">{{ order?.item.name ?? 'Your Halden order' }}</p>
        <p v-if="order" class="mt-1 text-sm text-toned">{{ order.item.variant }} · <span class="whitespace-nowrap">Qty {{ order.item.quantity }}</span></p>
        <p class="mt-2 break-all text-xs text-toned">Order <span translate="no" class="font-mono">{{ orderId }}</span></p>
      </div>
      <div class="shrink-0 text-right">
        <p class="text-2xl font-semibold tracking-tight text-highlighted tabular-nums" data-wallet-amount>{{ order ? formatMoney(order.amount) : '—' }}</p>
        <p class="mt-1 text-xs text-toned">Sandbox payment</p>
      </div>
    </div>
    <div class="flex items-start gap-4 pt-6" role="status" aria-live="polite" aria-atomic="true" data-wallet-feedback :data-busy="busy">
      <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted" :class="iconTone">
        <UIcon :name="feedback.icon" class="size-6" :class="busy ? 'motion-safe:animate-spin' : ''" aria-hidden="true" />
      </div>
      <div class="min-w-0 space-y-2">
        <h2 :id="headingId" class="text-pretty text-xl font-semibold tracking-tight text-highlighted sm:text-2xl">{{ feedback.title }}</h2>
        <p class="max-w-prose text-sm leading-relaxed text-toned">{{ feedback.description }}</p>
        <p v-if="terminal && checking" class="text-sm text-toned">Checking the latest update… Your confirmed result stays visible.</p>
      </div>
    </div>
  </div>
</template>
