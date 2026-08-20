<script setup lang="ts">
import type { RadioGroupItem } from '@nuxt/ui'

const props = defineProps<{
  modelValue: string
  items: RadioGroupItem[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const value = computed({
  get: () => props.modelValue,
  set: next => emit('update:modelValue', next),
})
</script>

<template>
  <section
    aria-labelledby="journey-title"
    class="min-w-0 space-y-4"
  >
    <div class="space-y-2">
      <p class="text-sm font-medium text-primary">
        Deterministic journey
      </p>
      <h2
        id="journey-title"
        class="text-2xl font-semibold tracking-tight text-highlighted"
      >
        Pick the outcome you want to explore.
      </h2>
      <p class="text-sm leading-relaxed text-toned">
        Every fixture has a local simulation. Confirmed fixtures can also expose a real Sandbox entry using the same shared Order → PaymentAttempt → PaymentEvent model.
      </p>
    </div>

    <URadioGroup
      v-model="value"
      legend="Payment journey"
      :items="items"
      variant="card"
      indicator="end"
      size="lg"
      class="min-w-0"
    />
  </section>
</template>
