<script setup lang="ts">
import { parsePaymentAmount } from '#shared/payment/amount'

const value = defineModel<string>({ required: true })
const error = computed(() => parsePaymentAmount(value.value) === null
  ? 'Enter USD 0.01–10,000.00, with up to 2 decimal places.' : undefined)
const presets = [
  { label: 'USD 0.01–10,000.00', type: 'label' as const },
  { label: 'Use $5.00', onSelect: () => { value.value = '5.00' } },
  { label: 'Use $50.00', onSelect: () => { value.value = '50.00' } },
]
</script>

<template>
  <UFormField label="Amount (USD)" name="payment-amount" :error="error" class="min-w-0">
    <UInput
      v-model="value"
      aria-label="Payment amount"
      aria-describedby="payment-amount-range"
      inputmode="decimal"
      type="text"
      size="lg"
      placeholder="0.01–10,000.00"
      class="w-full"
      :ui="{ base: 'h-11 tabular-nums', trailing: 'pe-0' }"
    >
      <template #trailing>
        <UDropdownMenu :items="presets">
          <UButton aria-label="Amount presets" icon="i-lucide-chevron-down" color="neutral" variant="ghost" class="size-11 text-dimmed" :ui="{ leadingIcon: 'size-5' }" />
        </UDropdownMenu>
      </template>
    </UInput>
    <span id="payment-amount-range" class="sr-only">Sandbox demo amount: USD 0.01 to 10,000.00. Payment providers may apply their own limits.</span>
  </UFormField>
</template>
