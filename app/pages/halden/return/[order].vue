<script setup lang="ts">
import { isTerminalStatus } from '#shared/payment/sdk'

definePageMeta({
  layout: 'halden',
})

useSeoMeta({
  title: 'Restoring payment · Halden',
  description: 'Restore the Onerway 3DS browser return and verify the final payment state on the server.',
})

const route = useRoute()
const {
  session,
  stage,
  error,
  recoveryFailure,
  recoveryError,
  recover,
  verify,
} = useSdk()
const ready = shallowRef(false)
const recovered = shallowRef(false)
const title = useTemplateRef<HTMLElement>('title')
const orderId = computed(() => String(route.params.order))
const current = computed(() => session.value?.order.id === orderId.value ? session.value : null)

async function restore(): Promise<void> {
  ready.value = false
  recovered.value = false

  if (Object.keys(route.query).length > 0) {
    await navigateTo(route.path, { replace: true })
  }

  if (!await recover(orderId.value, true)) {
    ready.value = true
    await nextTick()
    title.value?.focus()
    return
  }

  recovered.value = true
  ready.value = true
  await nextTick()
  title.value?.focus()

  if (current.value && isTerminalStatus(current.value.attempt.status)) {
    await navigateTo(`/halden/result/${current.value.order.id}`, { replace: true })
    return
  }

  if (current.value) {
    await verify()
  }

}

onMounted(restore)
</script>

<template>
  <UContainer class="py-10 sm:py-16">
    <section class="mx-auto max-w-xl text-center">
      <div v-if="!ready" aria-label="Restoring 3DS return" class="space-y-6">
        <USkeleton class="mx-auto h-12 w-72 rounded-sm" />
        <USkeleton class="h-40 w-full rounded-lg" />
      </div>

      <template v-else-if="recovered && current">
        <span class="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10">
          <UIcon name="i-lucide-shield-check" class="size-7 text-primary" aria-hidden="true" />
        </span>
        <UBadge label="3DS browser return" color="primary" variant="soft" class="mt-5" />
        <h1 ref="title" tabindex="-1" class="mt-4 text-3xl font-semibold tracking-tight text-highlighted focus:outline-none">
          Verifying your payment.
        </h1>
        <p class="mt-4 text-sm leading-relaxed text-toned">
          Onerway returned the browser to this order. The return itself is not a success signal, so the server is querying the existing Payment before showing a final result.
        </p>
        <PaymentSdkStatus :stage="stage" class="mt-8 text-left" />
        <UAlert
          v-if="error"
          :description="error"
          color="warning"
          variant="subtle"
          icon="i-lucide-circle-alert"
          class="mt-6 text-left"
        />
        <UButton
          v-if="stage === 'not_completed' && !isTerminalStatus(current.attempt.status)"
          label="Verify existing payment"
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          class="mt-6 min-h-11"
          @click="verify()"
        />
      </template>

      <template v-else>
        <UIcon name="i-lucide-circle-off" class="mx-auto size-10 text-dimmed" aria-hidden="true" />
        <h1 ref="title" tabindex="-1" class="mt-4 text-2xl font-semibold tracking-tight text-highlighted">
          {{ recoveryFailure === 'retryable' ? 'Payment return needs another check' : 'Payment return could not be restored' }}
        </h1>
        <p class="mt-3 text-sm leading-relaxed text-toned">
          {{ recoveryError ?? 'No authorized persisted payment attempt matched this browser return.' }}
        </p>
        <UButton
          v-if="recoveryFailure === 'retryable'"
          label="Retry restoration"
          icon="i-lucide-refresh-cw"
          class="mt-6 min-h-11"
          @click="restore"
        />
        <UButton v-else to="/" label="Return to Demo Hub" class="mt-6 min-h-11" />
      </template>
    </section>
  </UContainer>
</template>
