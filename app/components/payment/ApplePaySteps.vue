<script setup lang="ts">
import type { ApplePayStep } from '#shared/payment/apple-pay'

const props = defineProps<{ steps: readonly ApplePayStep[] }>()
const announcement = computed(() => {
  const active = props.steps.find(step => step.state === 'active')
  if (active) return `${active.title}. In progress.`
  const latest = [...props.steps].reverse().find(step => step.evidence || step.state === 'interrupted')
  if (!latest) return 'Waiting for payment events.'
  return `${latest.title}. ${latest.state === 'interrupted' ? 'Needs attention.' : latest.evidence?.source === 'stored' ? 'Restored from server.' : 'Recorded.'}`
})
</script>

<template>
  <section aria-labelledby="apple-pay-steps-title" class="min-w-0">
    <h2 id="apple-pay-steps-title" class="text-balance text-xl font-semibold tracking-tight text-highlighted">How this payment works</h2>
    <p class="mt-2 max-w-prose text-pretty text-sm leading-relaxed text-toned">Follow the payment across your browser, Halden, Apple and Onerway. Recorded data stays separate from integration examples.</p>
    <p role="status" aria-live="polite" aria-atomic="true" class="sr-only">{{ announcement }}</p>
    <ol class="mt-8 min-w-0">
      <PaymentApplePayStep v-for="(step, index) in steps" :key="step.id" :step="step" :index="index" />
    </ol>
  </section>
</template>
