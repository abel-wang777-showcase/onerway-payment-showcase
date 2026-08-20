<script setup lang="ts">
import type { PaymentStatus } from '#shared/payment/attempt'
import type { SubscriptionSummary } from '#shared/payment/subscription'
import { subscriptionStatusSourceLabel } from '#shared/payment/subscription'

defineProps<{
  payment: PaymentStatus
  subscription: SubscriptionSummary
}>()
</script>

<template>
  <section aria-labelledby="subscription-status-title" class="mt-8">
    <h2 id="subscription-status-title" class="sr-only">
      Payment and subscription status
    </h2>
    <div class="grid gap-4 sm:grid-cols-2" role="status" aria-live="polite">
      <UCard variant="subtle">
        <p class="text-xs font-medium uppercase tracking-wide text-muted">Payment</p>
        <p class="mt-2 text-lg font-semibold capitalize text-highlighted">{{ payment }}</p>
        <p class="mt-1 text-sm text-toned">Initial Sandbox card payment</p>
      </UCard>
      <UCard variant="subtle">
        <p class="text-xs font-medium uppercase tracking-wide text-muted">Subscription contract</p>
        <p class="mt-2 text-lg font-semibold capitalize text-highlighted">
          {{ subscription.state.replace('_', ' ') }}
        </p>
        <p class="mt-1 text-sm text-toned">
          {{ subscriptionStatusSourceLabel(subscription.statusSource) }}
        </p>
      </UCard>
    </div>
  </section>
</template>
