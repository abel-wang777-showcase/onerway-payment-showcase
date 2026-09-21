<script setup lang="ts">
import { canClaimAuthorizationOperation, type AuthorizationOperationType, type AuthorizationState } from '#shared/payment/authorization'

const props = defineProps<{
  authorization: AuthorizationState
  amount: string
  submitting?: boolean
  refreshing?: boolean
  requestedOperation?: AuthorizationOperationType
}>()

const emit = defineEmits<{
  operate: [type: AuthorizationOperationType]
  refresh: []
}>()
const titleId = useId()
const busy = computed(() => Boolean(props.submitting || props.refreshing))
const canOperate = computed(() => canClaimAuthorizationOperation(props.authorization) && !props.requestedOperation)
const terminal = computed(() => ['captured', 'voided'].includes(props.authorization.fundsStatus))
const operationLabel = computed(() => (props.authorization.operation?.type ?? props.requestedOperation) === 'VOID' ? 'Void' : 'Capture')
const view = computed(() => {
  if (props.authorization.conflict) return {
    title: 'Authorization needs review.',
    description: 'Conflicting confirmation was received. Funds operations are locked while the outcome is reviewed.',
    color: 'warning' as const,
    icon: 'i-lucide-triangle-alert',
  }
  if (props.authorization.fundsStatus === 'captured') return {
    title: 'Payment captured.',
    description: `The full ${props.amount} has been charged. This authorization is complete.`,
    color: 'success' as const,
    icon: 'i-lucide-circle-check-big',
  }
  if (props.authorization.fundsStatus === 'voided') return {
    title: 'Authorization released.',
    description: `The ${props.amount} authorization has been voided and the funds released. No payment was captured.`,
    color: 'neutral' as const,
    icon: 'i-lucide-circle-check',
  }
  if (props.submitting) return {
    title: `Submitting ${operationLabel.value.toLowerCase()}…`,
    description: 'Both funds actions are locked. Keep this order open while the request is submitted.',
    color: 'info' as const,
    icon: 'i-lucide-clock-3',
  }
  if (props.authorization.operation || props.requestedOperation) return {
    title: `${operationLabel.value} awaiting confirmation.`,
    description: 'The final funds outcome is not confirmed. Both actions remain locked; refresh status to check the latest confirmed outcome for this order.',
    color: 'warning' as const,
    icon: 'i-lucide-clock-3',
  }
  if (props.authorization.fundsStatus === 'authorized') return {
    title: 'Funds authorized · Not charged.',
    description: `${props.amount} is frozen for this order. Capture the full amount to charge it, or void the authorization to release it.`,
    color: 'info' as const,
    icon: 'i-lucide-lock-keyhole',
  }
  return {
    title: 'Authorization awaiting confirmation.',
    description: 'Halden has not confirmed that funds were authorized. Refresh status to check the existing authorization.',
    color: 'warning' as const,
    icon: 'i-lucide-clock-3',
  }
})

function operate(type: AuthorizationOperationType): void {
  if (canOperate.value && !busy.value) emit('operate', type)
}
</script>

<template>
  <section :aria-labelledby="titleId" class="rounded-lg border border-default p-5 sm:p-6" data-authorization>
    <p class="text-sm font-medium text-primary">Sandbox · Card authorization</p>
    <div role="status" aria-live="polite" aria-atomic="true" class="mt-4">
      <h2 :id="titleId" class="text-xl font-semibold tracking-tight text-highlighted">{{ view.title }}</h2>
      <UAlert :description="view.description" :color="view.color" :icon="view.icon" variant="subtle" class="mt-3" />
    </div>
    <div v-if="canOperate || submitting" class="mt-6 border-t border-default pt-5">
      <h3 class="text-sm font-semibold text-highlighted">Merchant demo actions</h3>
      <p class="mt-2 text-sm leading-relaxed text-toned">Choose one action for the full {{ amount }}. Once submitted, you cannot switch actions or submit it again.</p>
      <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <UButton :label="`Capture ${amount}`" :loading="submitting && requestedOperation === 'CAPTURE'" :disabled="busy || !canOperate" class="min-h-11 justify-center" @click="operate('CAPTURE')" />
        <UButton label="Void authorization" color="neutral" variant="outline" :loading="submitting && requestedOperation === 'VOID'" :disabled="busy || !canOperate" class="min-h-11 justify-center" @click="operate('VOID')" />
      </div>
    </div>
    <UButton v-if="!terminal || authorization.conflict" label="Refresh status" icon="i-lucide-refresh-cw" color="neutral" variant="outline" :loading="refreshing" :disabled="busy" class="mt-5 min-h-11" @click="emit('refresh')" />
  </section>
</template>
