<script setup lang="ts">
import type { DemoStage } from '#shared/payment/state'

const props = defineProps<{
  stage: DemoStage
}>()

const views = {
  loading: {
    title: 'Preparing the simulated Payment Element',
    description: 'No card fields are mounted in this phase.',
    color: 'neutral',
    icon: 'i-lucide-loader-circle',
  },
  ready: {
    title: 'Simulation ready',
    description: 'Review the order, then run the selected payment journey.',
    color: 'success',
    icon: 'i-lucide-circle-check',
  },
  submitting: {
    title: 'Submitting the simulated payment',
    description: 'A deterministic PaymentEvent is being added to this attempt.',
    color: 'info',
    icon: 'i-lucide-loader-circle',
  },
  processing: {
    title: 'Payment still processing',
    description: 'Refresh keeps this same attempt. Verify it explicitly to continue the deterministic simulation.',
    color: 'info',
    icon: 'i-lucide-clock-3',
  },
  not_completed: {
    title: 'Secure form did not load',
    description: 'Reload the same simulated PaymentAttempt. No retry child or new order is created.',
    color: 'warning',
    icon: 'i-lucide-circle-alert',
  },
  redirecting: {
    title: 'Simulating a 3DS handoff',
    description: 'No bank page opens and no external request is made.',
    color: 'warning',
    icon: 'i-lucide-external-link',
  },
  verifying: {
    title: 'Verifying the simulated return',
    description: 'The attempt remains processing until the next simulated event.',
    color: 'info',
    icon: 'i-lucide-loader-circle',
  },
  failed: {
    title: 'Deterministic payment failure',
    description: 'This simulation-only terminal state is not derived from an Onerway transaction status.',
    color: 'error',
    icon: 'i-lucide-circle-x',
  },
  cancelled: {
    title: 'Deterministic payment cancellation',
    description: 'The simulated attempt is terminal and can be retried as a linked child attempt.',
    color: 'warning',
    icon: 'i-lucide-ban',
  },
  succeeded: {
    title: 'Simulation complete',
    description: 'The normalized attempt reached succeeded from an immutable event.',
    color: 'success',
    icon: 'i-lucide-circle-check-big',
  },
} as const

const view = computed(() => views[props.stage])
const isBusy = computed(() => ['loading', 'submitting', 'redirecting', 'verifying'].includes(props.stage))
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    aria-atomic="true"
    :data-stage="stage"
  >
    <UAlert
      :title="view.title"
      :description="view.description"
      :color="view.color"
      variant="subtle"
      :icon="view.icon"
      :ui="{
        icon: isBusy ? 'motion-safe:animate-spin' : undefined,
      }"
    />
  </div>
</template>
