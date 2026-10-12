<script setup lang="ts">
import type { HubOption } from '~/composables/useHubSelection'

const props = defineProps<{
  modelValue: string
  items: HubOption[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const selectedLabel = computed(() => props.items.find(item => item.value === props.modelValue)?.label.replace(/^USD [\d,.]+ · /, '') ?? '')

const value = computed({
  get: () => props.modelValue,
  set: next => emit('update:modelValue', next),
})
</script>

<template>
  <UFormField label="Journey preset" name="payment-journey" class="min-w-0">
    <USelect
      v-model="value"
      aria-label="Journey preset"
      :items="items"
      size="lg"
      class="min-h-11 w-full"
      :ui="{ value: 'whitespace-normal text-start', item: 'min-h-11', itemLabel: 'whitespace-normal' }"
    >
      <span class="min-w-0 whitespace-normal text-start">{{ selectedLabel }}</span>
    </USelect>
  </UFormField>
</template>
