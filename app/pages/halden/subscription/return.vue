<script setup lang="ts">
definePageMeta({ layout: 'halden' })

useSeoMeta({
  title: 'Restoring subscription · Halden',
  description: 'Restore the original Sandbox subscription payment and verify its server-side status.',
})

const { session, retainedSubscriptionOrderId, recover } = useSdk()
const title = useTemplateRef<HTMLElement>('title')
const error = shallowRef<string | null>(null)

onMounted(async () => {
  window.history.replaceState({}, '', '/halden/subscription/return')

  try {
    await $fetch('/api/payment/subscription/return', { method: 'POST' })
  }
  catch {
    // The return/query fact may already be committed. Cookie recovery is the
    // only safe continuation and never creates or confirms another payment.
  }

  if (await recover()) {
    const restored = session.value

    if (restored) {
      await navigateTo(`/halden/result/${restored.order.id}`, { replace: true })
      return
    }

    if (retainedSubscriptionOrderId.value) {
      await navigateTo(`/halden/result/${retainedSubscriptionOrderId.value}`, { replace: true })
      return
    }
  }

  error.value = 'This browser could not restore the original subscription payment. No new payment was created; return to the Demo Hub without submitting again.'
  await nextTick()
  title.value?.focus()
})
</script>

<template>
  <UContainer class="py-20">
    <section class="mx-auto max-w-xl text-center" aria-live="polite">
      <UIcon
        :name="error ? 'i-lucide-circle-alert' : 'i-lucide-loader-circle'"
        class="mx-auto size-10 text-muted"
        :class="error ? undefined : 'animate-spin'"
        aria-hidden="true"
      />
      <h1 ref="title" tabindex="-1" class="mt-4 text-2xl font-semibold tracking-tight text-highlighted focus:outline-none">
        {{ error ? 'Subscription recovery unavailable' : 'Verifying your subscription…' }}
      </h1>
      <p class="mt-3 text-sm leading-relaxed text-toned">
        {{ error ?? 'Restoring the same PaymentAttempt and running a fresh server-side query. This page will not create or submit another payment.' }}
      </p>
      <UButton
        v-if="error"
        to="/"
        label="Return to Demo Hub"
        color="neutral"
        variant="outline"
        class="mt-6 min-h-11"
      />
    </section>
  </UContainer>
</template>
