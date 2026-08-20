<script setup lang="ts">
import type { PaymentAttemptSummary } from '#shared/payment/sdk'

const props = defineProps<{
  attempts: readonly PaymentAttemptSummary[]
  activeId: string
}>()

const numbers = computed(() => new Map(
  props.attempts.map((attempt, index) => [attempt.id, index + 1]),
))

function color(attempt: PaymentAttemptSummary): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (attempt.status === 'succeeded') return 'success'
  if (attempt.status === 'failed') return 'error'
  if (attempt.status === 'cancelled') return 'warning'
  if (['processing', 'requires_action'].includes(attempt.status)) return 'info'
  return 'neutral'
}
</script>

<template>
  <ol aria-label="Payment attempt history" class="space-y-3">
    <li
      v-for="(attempt, index) in attempts"
      :key="attempt.id"
      class="min-w-0 rounded-md border border-default bg-muted px-3 py-3 text-sm"
    >
      <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span class="min-w-0 break-words font-mono text-xs text-toned [overflow-wrap:anywhere]">
          Attempt {{ index + 1 }} · {{ attempt.id }}
        </span>
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            v-if="attempt.id === activeId"
            label="Active"
            color="primary"
            variant="outline"
            size="sm"
          />
          <UBadge :label="attempt.status" :color="color(attempt)" variant="soft" size="sm" />
        </div>
      </div>
      <p v-if="attempt.retryOf" class="mt-2 text-xs text-muted">
        Retry of Attempt {{ numbers.get(attempt.retryOf) ?? 'unknown' }}
      </p>
    </li>
  </ol>
</template>
