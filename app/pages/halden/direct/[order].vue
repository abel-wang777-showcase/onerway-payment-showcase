<script setup lang="ts">
import type { DirectRecoveryResponse } from '#shared/payment/apple-pay'

definePageMeta({ layout: 'halden' })
useSeoMeta({ title: 'Wallet Direct · Halden', description: 'Follow your wallet authorization and Direct API payment journey.', referrer: 'no-referrer' })
const route = useRoute()
const orderId = computed(() => String(route.params.order))
const method = shallowRef<'apple-pay' | 'google-pay' | null>(null)
const recovered = shallowRef<DirectRecoveryResponse | null>(null)
const failed = shallowRef(false)
const loading = shallowRef(false)
let generation = 0

async function restore(): Promise<void> {
  const current = ++generation
  method.value = null
  failed.value = false
  loading.value = true
  try {
    const response = await $fetch<DirectRecoveryResponse>('/api/payment/recover', { query: { orderId: orderId.value }, retry: 0 })
    if (generation !== current) return
    if (response.order.id !== orderId.value || response.attempt.integration !== 'direct-api'
      || !['apple-pay', 'google-pay'].includes(response.attempt.method)) throw new Error('DIRECT_ORDER_MISMATCH')
    recovered.value = response
    method.value = response.attempt.method as 'apple-pay' | 'google-pay'
  }
  catch { if (generation === current) failed.value = true }
  finally { if (generation === current) loading.value = false }
}
onMounted(restore)
watch(orderId, restore)
onScopeDispose(() => { generation++ })
</script>

<template>
  <PaymentGooglePay v-if="method === 'google-pay'" :key="orderId" :order-id="orderId" :initial="recovered ?? undefined" />
  <PaymentApplePay v-else-if="method === 'apple-pay'" :key="orderId" :order-id="orderId" />
  <UContainer v-else class="space-y-4 py-12">
    <p role="status">{{ failed ? 'This order could not be restored. Your existing payment is preserved.' : 'Restoring your wallet order…' }}</p>
    <UButton v-if="failed" label="Retry restoration" :loading="loading" class="touch-manipulation" @click="restore" />
  </UContainer>
</template>
