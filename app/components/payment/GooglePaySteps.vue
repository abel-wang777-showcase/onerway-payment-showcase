<script setup lang="ts">
import type { PaymentStep } from '#shared/payment/protocol'
import { googlePayFlowActors, googlePayFlows } from '~/utils/google-pay-flow'

const props = defineProps<{ steps: readonly PaymentStep[], mode: 'automatic' | 'manual' }>()
const flows = computed(() => googlePayFlows(props.mode))
const announcement = computed(() => {
  const active = props.steps.find(step => step.state === 'active')
  if (active) return `${active.title}. In progress.`
  const latest = [...props.steps].reverse().find(step => step.evidence || step.state === 'interrupted')
  if (!latest) return 'Waiting for payment events.'
  return `${latest.title}. ${latest.state === 'interrupted' ? 'Needs attention.' : latest.evidence?.source === 'stored' ? 'Restored from server.' : 'Recorded.'}`
})
</script>

<template>
  <section aria-labelledby="google-pay-steps-title" class="min-w-0">
    <h2 id="google-pay-steps-title" class="text-balance text-xl font-semibold tracking-tight text-highlighted">How this payment works</h2>
    <p class="mt-2 max-w-prose text-pretty text-sm leading-relaxed text-toned">Follow the payment across your browser, Halden, Google Pay and Onerway. Explore each stage, then inspect the recorded evidence below.</p>
    <p v-if="mode === 'manual'" class="mt-2 max-w-prose text-sm leading-relaxed text-toned">Manual debugging stops at token capture. Submission and result paths are explanations only; external Apifox calls do not update this order.</p>
    <p role="status" aria-live="polite" aria-atomic="true" class="sr-only">{{ announcement }}</p>
    <PaymentProtocolFlow wallet="google-pay" title="Google Pay protocol map" :actors="googlePayFlowActors" :flows="flows" :steps="steps" />
    <ol class="mt-8 min-w-0">
      <PaymentStep v-for="(step, index) in steps" :key="step.id" wallet="google-pay" :step="step" :index="index" />
    </ol>
  </section>
</template>
