<script setup lang="ts">
import type { ApplePayStep } from '#shared/payment/apple-pay'

defineProps<{ steps: readonly ApplePayStep[] }>()
const labels = { waiting: 'Not observed', active: 'In progress', completed: 'Observed', interrupted: 'Interrupted' } as const
</script>

<template>
  <section aria-labelledby="apple-pay-steps-title" class="min-w-0">
    <h2 id="apple-pay-steps-title" class="text-xl font-semibold text-highlighted">How this payment works</h2>
    <p class="mt-2 text-sm leading-relaxed text-toned">These six steps follow real events in this page. Expand a step at any time; the payment continues while you read. Earlier browser events are not reconstructed after a refresh.</p>
    <ol class="mt-6 divide-y divide-default rounded-lg border border-default">
      <li v-for="(step, index) in steps" :key="step.id" class="min-w-0">
        <details class="group p-4 sm:p-5">
          <summary class="flex cursor-pointer list-none flex-wrap items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary touch-manipulation">
            <span aria-hidden="true" class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-toned">{{ index + 1 }}</span>
            <span class="min-w-0 flex-1 text-sm font-medium text-highlighted">{{ step.title }}</span>
            <UBadge :label="labels[step.state]" :color="step.state === 'active' ? 'primary' : 'neutral'" variant="soft" />
            <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted group-open:rotate-180" aria-hidden="true" />
          </summary>
          <dl class="mt-5 space-y-4 text-sm leading-relaxed">
            <div><dt class="font-medium text-highlighted">Who acts</dt><dd class="mt-1 text-toned">{{ step.actor }}</dd></div>
            <div><dt class="font-medium text-highlighted">Input</dt><dd class="mt-1 text-toned">{{ step.input }}</dd></div>
            <div><dt class="font-medium text-highlighted">Output</dt><dd class="mt-1 text-toned">{{ step.output }}</dd></div>
            <div><dt class="font-medium text-highlighted">If it stops here</dt><dd class="mt-1 text-toned">{{ step.failure }}</dd></div>
          </dl>
          <UButton :to="step.documentation" target="_blank" rel="noopener noreferrer" label="Official documentation" icon="i-lucide-external-link" variant="link" color="neutral" class="mt-3 min-h-11 touch-manipulation" />
        </details>
      </li>
    </ol>
  </section>
</template>
