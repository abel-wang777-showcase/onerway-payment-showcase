<script setup lang="ts">
import type { DemoStage } from '#shared/payment/state'

const props = defineProps<{
  stage: DemoStage
}>()

const isLoading = computed(() => props.stage === 'loading')
const isReady = computed(() => props.stage === 'ready')
const isBusy = computed(() => ['submitting', 'redirecting', 'verifying'].includes(props.stage))
const isPending = computed(() => props.stage === 'processing')
const needsReload = computed(() => props.stage === 'not_completed')
</script>

<template>
  <section
    aria-labelledby="payment-element-title"
    class="rounded-lg border border-dashed border-accented bg-muted p-5 sm:p-6"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="space-y-1">
        <p
          id="payment-element-title"
          class="text-sm font-semibold tracking-tight text-highlighted"
        >
          Simulated Payment Element
        </p>
        <p class="text-sm leading-relaxed text-toned">
          This placeholder exercises merchant-owned states without rendering payment inputs.
        </p>
      </div>
      <UBadge
        label="No card data"
        color="neutral"
        variant="outline"
        size="sm"
      />
    </div>

    <div class="mt-6 min-h-32 rounded-md border border-default bg-default p-4">
      <div
        v-if="isLoading"
        class="space-y-3"
        aria-hidden="true"
      >
        <USkeleton class="h-10 w-full rounded-sm" />
        <USkeleton class="h-10 w-full rounded-sm" />
      </div>

      <div
        v-else-if="isReady"
        class="flex min-h-24 flex-col items-center justify-center gap-3 text-center"
      >
        <span class="flex size-10 items-center justify-center rounded-full bg-muted">
          <UIcon
            name="i-lucide-circle-check"
            class="size-5 text-primary"
            aria-hidden="true"
          />
        </span>
        <div>
          <p class="text-sm font-medium text-highlighted">
            Ready for a deterministic demo
          </p>
          <p class="mt-1 text-sm text-toned">
            The simulation does not request or accept PAN or CVV.
          </p>
        </div>
      </div>

      <div
        v-else-if="isBusy"
        class="flex min-h-24 flex-col justify-center gap-4"
      >
        <UProgress
          :model-value="null"
          animation="carousel"
          size="sm"
          aria-label="Simulation in progress"
        />
        <p class="text-center text-sm text-toned">
          Advancing through the selected event sequence…
        </p>
      </div>

      <div
        v-else-if="isPending || needsReload"
        class="flex min-h-24 flex-col items-center justify-center gap-3 text-center"
      >
        <UIcon
          :name="isPending ? 'i-lucide-clock-3' : 'i-lucide-refresh-cw'"
          class="size-6 text-primary"
          aria-hidden="true"
        />
        <p class="text-sm text-toned">
          {{ isPending ? 'This attempt is waiting for explicit verification.' : 'Reload this same simulated form to continue.' }}
        </p>
      </div>

      <div
        v-else
        class="flex min-h-24 items-center justify-center text-center"
      >
        <p class="text-sm text-toned">
          The simulated payment journey has finished.
        </p>
      </div>
    </div>
  </section>
</template>
