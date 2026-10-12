<script setup lang="ts">
import type { HubOption } from '~/composables/useHubSelection'

const props = defineProps<{
  modelValue: string
  items: HubOption[]
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
  <UFormField label="Payment journey" name="payment-journey" class="col-span-2 min-w-0">
    <USelect
      v-model="value"
      aria-label="Payment journey"
      :items="items"
      size="lg"
      class="min-h-11 w-full"
      :ui="{ value: 'whitespace-normal text-start', item: 'min-h-11', itemLabel: 'whitespace-normal' }"
    />
  </UFormField>
</template>
