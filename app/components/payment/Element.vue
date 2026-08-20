<script setup lang="ts">
import {
  loadSdk,
  type OnerwayCheckout,
  type OnerwayPaymentElement,
} from '~/utils/sdk.client'
import type { PaymentMethodId } from '#shared/payment/capability'

const props = withDefaults(defineProps<{
  paymentId: string
  url: string
  generation: number
  expectedMethod?: PaymentMethodId
}>(), {
  expectedMethod: 'card',
})

const emit = defineEmits<{
  ready: [paymentId: string, generation: number]
  error: [paymentId: string, generation: number]
  result: [paymentId: string, generation: number, value: unknown]
}>()

const mountId = 'onerway-payment-element'
const description = computed(() => props.expectedMethod === 'google-pay'
  ? 'The Onerway Sandbox SDK owns Google Pay eligibility, branding and wallet interaction. If its Google Pay button is not rendered, this page does not replace it with a merchant-made button. Hosted Card remains available in the same checkout.'
  : 'Available methods and Card fields are hosted by the Onerway Sandbox SDK. This merchant page does not receive PAN or CVV; saved-card choices remain inside the hosted surface.')
let checkout: OnerwayCheckout | null = null
let element: OnerwayPaymentElement | null = null
let disposed = false

function onReady(): void {
  if (!disposed) {
    emit('ready', props.paymentId, props.generation)
  }
}

function onError(): void {
  if (!disposed) {
    emit('error', props.paymentId, props.generation)
  }
}

function onResult(value: unknown): void {
  if (!disposed) {
    emit('result', props.paymentId, props.generation, value)
  }
}

onMounted(async () => {
  try {
    const sdk = await loadSdk(props.url)

    if (disposed) {
      return
    }

    checkout = await sdk.createCheckout(props.paymentId, {
      environment: 'sandbox',
      locale: 'en',
    })

    if (disposed) {
      checkout = null
      return
    }

    element = checkout.createPaymentElement()
    element.on('ready', onReady)
    element.on('loaderror', onError)
    checkout.on('payment_result', onResult)
    element.mount(mountId)
  }
  catch {
    onError()
  }
})

onBeforeUnmount(() => {
  disposed = true
  element?.off('ready', onReady)
  element?.off('loaderror', onError)
  checkout?.off('payment_result', onResult)
})

async function confirm(): Promise<unknown> {
  if (!checkout) {
    throw new Error('SDK_NOT_READY')
  }

  return checkout.confirmPayment()
}

defineExpose({ confirm })
</script>

<template>
  <section
    aria-labelledby="payment-element-title"
    class="rounded-lg border border-default p-5 sm:p-6"
  >
    <div class="mb-5 flex items-start gap-3">
      <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <UIcon
          name="i-lucide-circle-check"
          class="size-4 text-primary"
          aria-hidden="true"
        />
      </span>
      <div>
        <h2
          id="payment-element-title"
          class="text-base font-semibold tracking-tight text-highlighted"
        >
          Secure payment methods
        </h2>
        <p class="mt-1 text-sm leading-relaxed text-toned">
          {{ description }}
        </p>
      </div>
    </div>

    <div
      :id="mountId"
      class="min-h-44"
    />
  </section>
</template>
