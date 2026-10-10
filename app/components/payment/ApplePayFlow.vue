<script setup lang="ts">
import type { PaymentStep } from '#shared/payment/protocol'
import { applePayFlowActors, applePayFlows } from '~/utils/apple-pay-flow'

defineProps<{ steps: readonly PaymentStep[] }>()
</script>

<template>
  <PaymentProtocolFlow wallet="apple-pay" title="Apple Pay protocol map" :actors="applePayFlowActors" :flows="applePayFlows" :steps="steps" />
</template>
