<script setup lang="ts">
import type { SdkStage } from '#shared/payment/sdk'

const props = withDefaults(defineProps<{
  stage: SdkStage
  restoring?: boolean
}>(), {
  restoring: false,
})

const views = {
  creating: ['Creating Sandbox checkout', 'The server is creating a signed USD 5.00 payment.', 'info', 'i-lucide-loader-circle'],
  loading: ['Loading secure payment form', 'The confirmed v4 Sandbox SDK is mounting its hosted fields.', 'info', 'i-lucide-loader-circle'],
  ready: ['Secure form ready', 'Enter the controlled Sandbox card details, then submit payment.', 'success', 'i-lucide-circle-check'],
  submitting: ['Submitting payment', 'The hosted SDK is processing the card details without sending them to this merchant server.', 'info', 'i-lucide-loader-circle'],
  awaiting_action: ['Complete the payment step', 'Onerway is presenting the required payment step in the current Checkout. Keep this page open.', 'info', 'i-lucide-shield-ellipsis'],
  redirecting: ['Opening secure verification', 'Onerway is redirecting this browser to the required payment step.', 'info', 'i-lucide-loader-circle'],
  verifying: ['Verifying with Onerway', 'The client result is not final. The server is querying the Payment status.', 'info', 'i-lucide-loader-circle'],
  not_completed: ['Payment not completed', 'Review the message below before continuing or verifying the existing Payment.', 'warning', 'i-lucide-circle-alert'],
  succeeded: ['Payment verified', 'A server-side Payment query confirmed that the payment succeeded.', 'success', 'i-lucide-circle-check-big'],
} as const

const restoration = ['Restoring existing Sandbox checkout', 'The server is restoring the cookie-bound PaymentAttempt without creating a new Order.', 'info', 'i-lucide-loader-circle'] as const
const view = computed(() => props.restoring && props.stage === 'creating' ? restoration : views[props.stage])
const busy = computed(() => ['creating', 'loading', 'submitting', 'redirecting', 'verifying'].includes(props.stage))
</script>

<template>
  <div role="status" aria-live="polite" aria-atomic="true" :data-stage="stage">
    <UAlert
      :title="view[0]"
      :description="view[1]"
      :color="view[2]"
      :icon="view[3]"
      variant="subtle"
      :ui="{ icon: busy ? 'motion-safe:animate-spin' : undefined }"
    />
  </div>
</template>
