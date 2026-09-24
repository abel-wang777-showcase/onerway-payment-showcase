<script setup lang="ts">
import type { ApplePayNetworkEvidence } from '#shared/payment/apple-pay'

defineProps<{
  networks: readonly ApplePayNetworkEvidence[]
  value: string
}>()
</script>

<template>
  <span class="flex min-w-0 flex-wrap items-center gap-1.5">
    <span
      v-for="network in networks"
      :key="`${network.value}-${network.icon}`"
      :data-apple-pay-network="network.value"
      class="inline-flex shrink-0 items-center"
    >
      <UIcon :name="network.icon" class="size-4 text-toned" aria-hidden="true" />
    </span>
    <span class="min-w-0 break-all">{{ value }}</span>
  </span>
</template>
