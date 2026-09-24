<script setup lang="ts">
definePageMeta({ layout: 'halden' })
useSeoMeta({ title: 'Apple Pay Direct · Halden', description: 'Pay with Apple Pay and follow the Direct API payment journey.', referrer: 'no-referrer' })
const route = useRoute()
const orderId = computed(() => String(route.params.order))
</script>

<template>
  <PaymentApplePay :key="orderId" :order-id="orderId" />
</template>
