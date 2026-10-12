<script setup lang="ts">
withDefaults(defineProps<{
  context?: 'showcase' | 'store'
}>(), { context: 'showcase' })
</script>

<template>
  <span class="inline-flex flex-wrap items-baseline gap-x-2 text-sm tracking-tight text-highlighted">
    <span class="font-semibold">Onerway</span>
    <span v-if="context === 'store'" class="font-medium text-toned">Store</span>
    <span v-else class="hidden font-medium text-toned sm:inline">Payment Showcase</span>
  </span>
</template>
