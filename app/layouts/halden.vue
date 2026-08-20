<script setup lang="ts">
const route = useRoute()
const { session, retainedSubscriptionOrderId } = useSdk()
const isCheckout = computed(() =>
  route.path.includes('/checkout/')
  || route.path.includes('/sdk/')
  || route.path.includes('/subscription/return'),
)
const isResult = computed(() => route.path.includes('/result/'))
const isSandbox = computed(() =>
  route.path.includes('/sdk/')
  || route.path.includes('/subscription/')
  || (isResult.value && session.value?.order.id === String(route.params.order))
  || (
    isResult.value
    && retainedSubscriptionOrderId.value === String(route.params.order)
  ),
)
</script>

<template>
  <div class="halden-shell min-h-dvh bg-default text-default">
    <a
      href="#main"
      class="fixed start-4 top-4 z-50 -translate-y-24 rounded-sm bg-default px-3 py-2 text-sm font-medium focus-visible:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      Skip to content
    </a>

    <header class="border-b border-default bg-default">
      <UContainer class="flex min-h-16 items-center justify-between gap-4 py-3">
        <NuxtLink
          to="/"
          class="inline-flex min-h-11 items-center gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label="Back to Onerway Demo Hub"
        >
          <span class="font-mono text-sm font-semibold tracking-[0.18em] text-highlighted">
            HALDEN
          </span>
          <UBadge
            :label="isSandbox ? 'Sandbox' : 'Simulation'"
            color="neutral"
            variant="outline"
            size="sm"
          />
        </NuxtLink>

        <nav
          aria-label="Checkout progress"
          class="hidden items-center gap-2 text-sm md:flex"
        >
          <span
            class="font-medium"
            :class="isCheckout ? 'text-highlighted' : 'text-muted'"
            :aria-current="isCheckout ? 'step' : undefined"
          >
            Checkout
          </span>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4 text-dimmed"
            aria-hidden="true"
          />
          <span
            class="font-medium"
            :class="isResult ? 'text-highlighted' : 'text-muted'"
            :aria-current="isResult ? 'step' : undefined"
          >
            Result
          </span>
        </nav>

        <UButton
          to="/"
          label="Demo Hub"
          color="neutral"
          variant="ghost"
          size="sm"
          class="min-h-11"
          icon="i-lucide-arrow-left"
        />
      </UContainer>
    </header>

    <main
      id="main"
      tabindex="-1"
    >
      <slot />
    </main>

    <footer
      class="border-t border-default"
      :class="isCheckout ? 'pb-40 md:pb-24 lg:pb-0' : undefined"
    >
      <UContainer class="py-6">
        <p class="text-sm text-toned">
          {{ isSandbox
            ? 'Halden is a fictional merchant. When payment is active, card fields are hosted by Onerway Sandbox and never pass through this merchant server.'
            : 'Halden is a fictional merchant. This journey is simulated and does not collect payment data.' }}
        </p>
      </UContainer>
    </footer>
  </div>
</template>
