<script setup lang="ts">
const props = defineProps<{ references: boolean }>()
const items = computed(() => [
  { href: '#wallet-payment', label: 'Your payment' },
  { href: '#wallet-explainer', label: 'How it works' },
  ...(props.references ? [{ href: '#wallet-references', label: 'References' }] : []),
])
</script>

<template>
  <nav aria-label="Payment page sections" class="sticky top-0 z-20 mb-6 flex flex-wrap gap-x-4 border-b border-default bg-default py-2 text-sm">
    <a v-for="item in items" :key="item.href" :href="item.href" class="inline-flex min-h-11 items-center rounded-sm font-medium text-toned hover:text-highlighted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      {{ item.label }}
    </a>
  </nav>
</template>
