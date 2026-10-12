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
    class="min-w-0"
  >
    <h2 id="journey-title" class="sr-only">{{ hosted ? 'Hosted payment journey' : 'SDK payment journey' }}</h2>
    <URadioGroup
      v-model="value"
      legend="Payment journey"
      :items="items"
      variant="card"
      indicator="end"
      class="min-w-0"
      :ui="{ fieldset: hosted ? 'grid gap-2 md:grid-cols-3' : 'grid gap-2 sm:grid-cols-2', description: 'sr-only', item: 'min-h-11 min-w-0 p-3' }"
    />
  </section>
</template>
