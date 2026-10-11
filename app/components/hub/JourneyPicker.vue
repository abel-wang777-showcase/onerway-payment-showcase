<script setup lang="ts">
import type { RadioGroupItem } from '@nuxt/ui'

const props = defineProps<{
  modelValue: string
  items: RadioGroupItem[]
  hosted?: boolean
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
      <h2
        id="journey-title"
        class="text-2xl font-semibold tracking-tight text-highlighted"
      >
        {{ hosted ? 'Choose your hosted payment.' : 'What would you like to demonstrate?' }}
      </h2>
      <p class="text-sm leading-relaxed text-toned">
        {{ hosted ? 'Choose a journey, then pay on Onerway. Halden checks the result when you return.' : 'Try a successful payment, a 3DS challenge, or show how a customer recovers when payment is interrupted. Simulations do not charge a card.' }}
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
      :ui="{ fieldset: 'grid gap-3 sm:grid-cols-2', description: 'text-toned', item: 'min-w-0' }"
    />
  </section>
</template>
