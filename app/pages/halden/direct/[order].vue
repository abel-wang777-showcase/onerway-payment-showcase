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
  <UContainer v-else class="space-y-6 py-6 pb-16 lg:py-12">
    <h1 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">Your Halden payment</h1>
    <section class="max-w-2xl space-y-5 rounded-lg border border-default p-5 sm:p-6" aria-labelledby="wallet-restore-title">
      <PaymentWalletReceipt :order-id="orderId" heading-id="wallet-restore-title" :checking="!failed" :loading="loading" />
      <UAlert v-if="failed" description="This order could not be restored. Your existing payment is preserved. Retry restoration to check it again." color="warning" variant="subtle" />
      <UButton v-if="failed" label="Retry restoration" :loading="loading" class="min-h-11 touch-manipulation" @click="restore" />
    </section>
  </UContainer>
</template>
