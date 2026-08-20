<script setup lang="ts">
import {
  getActiveAttempt,
  type DemoSession,
} from '#shared/demo/session'
import { getJourney } from '#shared/payment/journey'
import type { PaymentAction } from '#shared/payment/failure'

definePageMeta({
  layout: 'halden',
})

useSeoMeta({
  title: 'Simulated checkout · Halden',
  description: 'Run a deterministic merchant checkout simulation without collecting payment data.',
})

const route = useRoute()
const { session, restored, resume, pay, verify, reload } = useDemo()
const title = ref<HTMLElement | null>(null)
const status = useTemplateRef<HTMLElement>('status')
const orderId = computed(() => String(route.params.order))

const current = computed<DemoSession | null>(() =>
  session.value?.order.id === orderId.value ? session.value : null,
)
const journey = computed(() => current.value ? getJourney(current.value.journeyId) : null)
const amount = computed(() => current.value ? formatMoney(current.value.order.amount) : '')
const activeAttempt = computed(() => current.value ? getActiveAttempt(current.value) : null)
const stage = computed(() => current.value?.stage ?? 'loading')
const busy = computed(() => ['submitting', 'redirecting', 'verifying'].includes(stage.value))
const disabled = computed(() => stage.value !== 'ready')
const actionItems = computed(() => {
  if (stage.value === 'processing') {
    return [{
      action: 'verify_attempt' as const,
      label: 'Verify existing simulated payment',
      icon: 'i-lucide-shield-check',
      primary: true,
    }]
  }

  if (stage.value === 'not_completed') {
    return [{
      action: 'reload_element' as const,
      label: 'Reload simulated secure form',
      icon: 'i-lucide-refresh-cw',
      primary: true,
    }]
  }

  return []
})

const payLabel = computed(() => {
  const labels = {
    loading: 'Preparing simulation…',
    ready: `Simulate payment · ${amount.value}`,
    submitting: 'Submitting simulation…',
    processing: 'Waiting for verification…',
    not_completed: 'Secure form unavailable',
    redirecting: 'Simulating 3DS handoff…',
    verifying: 'Verifying simulated return…',
    failed: 'Simulation failed',
    cancelled: 'Simulation cancelled',
    succeeded: 'Simulation complete',
  }

  return labels[stage.value]
})

async function handleAction(action: PaymentAction): Promise<void> {
  if (action === 'verify_attempt') {
    const verification = verify()
    await nextTick()
    status.value?.focus()
    await verification
    return
  }

  if (action === 'reload_element') {
    reload()
  }

  await nextTick()
  status.value?.focus()
}

const summaryLines = computed(() => {
  if (!current.value) {
    return []
  }

  return [
    { label: current.value.order.item.name, value: current.value.order.item.variant },
    { label: 'Quantity', value: String(current.value.order.item.quantity) },
    { label: 'Delivery', value: 'Included' },
  ]
})

onMounted(async () => {
  resume(orderId.value)
  await nextTick()
  title.value?.focus()
})
</script>

<template>
  <UContainer class="py-8 pb-40 md:max-w-2xl md:pb-24 lg:max-w-none lg:py-12 lg:pb-12">
    <div
      v-if="!restored"
      class="space-y-6"
      aria-label="Restoring demo session"
    >
      <USkeleton class="h-10 w-64 rounded-sm" />
      <USkeleton class="h-64 w-full rounded-lg" />
    </div>

    <section
      v-else-if="!current"
      class="mx-auto max-w-xl py-20 text-center"
    >
      <UIcon
        name="i-lucide-circle-off"
        class="mx-auto size-10 text-dimmed"
        aria-hidden="true"
      />
      <h1
        ref="title"
        tabindex="-1"
        class="mt-4 text-2xl font-semibold tracking-tight text-highlighted"
      >
        Demo session not found
      </h1>
      <p class="mt-3 text-sm leading-relaxed text-toned">
        This simulated checkout is not available in the current browser session. Start a new journey from the Demo Hub.
      </p>
      <UButton
        to="/"
        label="Return to Demo Hub"
        class="mt-6 min-h-11"
      />
    </section>

    <div
      v-else
      class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start"
    >
      <div class="space-y-8">
        <div>
          <p class="font-mono text-xs font-medium uppercase tracking-[0.16em] text-muted">
            {{ journey?.label }}
          </p>
          <h1
            ref="title"
            tabindex="-1"
            class="mt-2 text-3xl font-semibold tracking-tight text-highlighted focus:outline-none sm:text-4xl"
          >
            Complete your simulated order.
          </h1>
          <p class="mt-3 max-w-2xl text-sm leading-relaxed text-toned">
            This merchant page exercises checkout states without mounting the Onerway SDK or collecting payment details.
          </p>
        </div>

        <section
          aria-labelledby="delivery-title"
          class="rounded-lg border border-default p-5 sm:p-6"
        >
          <div class="flex items-start gap-4">
            <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <UIcon
                name="i-lucide-package-check"
                class="size-5 text-primary"
                aria-hidden="true"
              />
            </span>
            <div>
              <h2
                id="delivery-title"
                class="text-base font-semibold tracking-tight text-highlighted"
              >
                Demo delivery
              </h2>
              <p class="mt-1 text-sm leading-relaxed text-toned">
                A fictional Halden order reserved for this browser session. No fulfillment request is created.
              </p>
            </div>
          </div>
        </section>

        <div ref="status" tabindex="-1" data-focus-target="payment-status" class="focus:outline-none">
          <PaymentStatus :stage="stage" />
        </div>
        <PaymentElementMock :stage="stage" />

        <PaymentActions
          v-if="actionItems.length"
          title="Continue this PaymentAttempt"
          description="This deterministic action keeps the same order and attempt; it does not create a real payment."
          :items="actionItems"
          @action="handleAction"
        />

        <p class="font-mono text-xs text-muted">
          Attempt {{ activeAttempt?.id }}
        </p>
      </div>

      <HaldenSummary
        :lines="summaryLines"
        :total="amount"
        :pay-label="payLabel"
        :disabled="disabled"
        :busy="busy"
        @pay="pay"
      />
    </div>
  </UContainer>
</template>
