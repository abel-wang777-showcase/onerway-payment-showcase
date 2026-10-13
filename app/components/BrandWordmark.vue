<script setup lang="ts">
withDefaults(defineProps<{
  context?: 'showcase' | 'store'
}>(), { context: 'showcase' })
</script>

<template>
  <span class="inline-flex items-center gap-2 text-sm tracking-tight text-highlighted">
    <img src="/brand/onerway.svg" alt="" width="241" height="179" class="h-6 w-auto shrink-0">
    <span class="inline-flex flex-col gap-x-2 leading-tight sm:flex-row sm:items-baseline">
      <span class="font-semibold">Onerway</span>
      <span v-if="context === 'store'" class="text-xs font-medium text-toned sm:text-sm">Store</span>
      <span v-else class="hidden font-medium text-toned sm:inline">Payment Showcase</span>
    </span>
  </span>
</template>
