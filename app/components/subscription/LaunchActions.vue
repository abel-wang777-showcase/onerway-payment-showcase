<script setup lang="ts">
import type { SubscriptionState } from '#shared/payment/subscription'

interface ExistingSubscription {
  readonly orderId: string
  readonly state: SubscriptionState
  readonly replayAvailable: boolean
}

const props = defineProps<{
  existing: ExistingSubscription | null
  canonicalHref: string | null
  startDisabled: boolean
  loading: boolean
  startingNewCustomer: boolean
}>()

const emit = defineEmits<{
  start: []
  startNewCustomer: []
}>()

const primaryTarget = computed(() => {
  if (props.canonicalHref) {
    return props.canonicalHref
  }

  return props.existing ? `/halden/result/${props.existing.orderId}` : undefined
})

const primaryLabel = computed(() => {
  if (props.canonicalHref) {
    return 'Continue on canonical Production'
  }

  if (props.existing) {
    return 'View existing subscription'
  }

  return props.loading ? 'Creating Sandbox subscription…' : 'Start Sandbox subscription'
})

const primaryDisabled = computed(() =>
  props.loading || (!primaryTarget.value && props.startDisabled),
)

function start(): void {
  if (!primaryTarget.value) {
    emit('start')
  }
}
</script>

<template>
  <UAlert
    v-if="existing"
    title="Subscription already exists"
    :description="existing.replayAvailable
      ? `This Sandbox customer already has this ${existing.state.replace('_', ' ')} subscription. Viewing it creates no payment. Starting again creates a separate test customer and leaves this subscription unchanged.`
      : `This Sandbox customer already has this ${existing.state.replace('_', ' ')} subscription. Viewing it creates no payment. A new test customer stays unavailable until this attempt has Provider payment evidence.`"
    color="info"
    variant="subtle"
    icon="i-lucide-history"
    class="mt-6"
  />

  <UButton
    :label="primaryLabel"
    :to="primaryTarget"
    :external="Boolean(canonicalHref)"
    trailing-icon="i-lucide-circle-check"
    color="neutral"
    variant="outline"
    size="xl"
    block
    class="mt-3 min-h-11"
    :disabled="primaryDisabled"
    :loading="loading && !startingNewCustomer"
    @click="start"
  />

  <UButton
    v-if="existing?.replayAvailable && !canonicalHref"
    label="Start again as a new Sandbox customer"
    trailing-icon="i-lucide-user-plus"
    color="neutral"
    variant="ghost"
    size="xl"
    block
    class="mt-2 min-h-11"
    :disabled="startDisabled || loading"
    :loading="loading && startingNewCustomer"
    @click="emit('startNewCustomer')"
  />
</template>
