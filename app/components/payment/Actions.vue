<script setup lang="ts">
import type { PaymentAction } from '#shared/payment/failure'

export interface PaymentActionItem {
  readonly action: PaymentAction
  readonly label: string
  readonly icon: string
  readonly primary?: boolean
  readonly loading?: boolean
  readonly disabled?: boolean
}

defineProps<{
  title: string
  description: string
  items: readonly PaymentActionItem[]
}>()

const titleId = useId()

const emit = defineEmits<{
  action: [value: PaymentAction]
}>()
</script>

<template>
  <section
    :aria-labelledby="titleId"
    class="rounded-lg border border-default bg-muted p-4 sm:p-5"
  >
    <h2 :id="titleId" class="text-sm font-semibold text-highlighted">
      {{ title }}
    </h2>
    <p class="mt-1 text-xs leading-relaxed text-toned">
      {{ description }}
    </p>
    <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <UButton
        v-for="item in items"
        :key="item.action"
        :label="item.label"
        :icon="item.icon"
        :color="item.primary ? 'primary' : 'neutral'"
        :variant="item.primary ? 'solid' : 'outline'"
        :loading="item.loading"
        :disabled="item.disabled"
        class="min-h-11 justify-center"
        @click="emit('action', item.action)"
      />
    </div>
  </section>
</template>
