<script setup lang="ts">
const route = useRoute()
const isHome = computed(() => route.path === '/')
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <a
      href="#main"
      class="fixed start-4 top-4 z-50 -translate-y-24 rounded-md bg-default px-3 py-2 text-sm font-medium shadow-lg focus-visible:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      Skip to content
    </a>

    <header class="border-b border-default">
      <UContainer class="flex h-16 items-center justify-between gap-4">
        <NuxtLink
          to="/"
          class="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold tracking-tight text-highlighted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Onerway Payment Showcase
        </NuxtLink>

        <nav aria-label="Primary navigation">
          <UButton
            to="/"
            label="Demo Hub"
            color="neutral"
            variant="ghost"
            size="sm"
            class="min-h-11"
            :aria-current="isHome ? 'page' : undefined"
          />
        </nav>
      </UContainer>
    </header>

    <main
      id="main"
      tabindex="-1"
    >
      <slot />
    </main>

    <footer class="border-t border-default">
      <UContainer class="py-6">
        <p class="text-sm text-toned">
          Customer-facing payment journeys. Simulations are labeled and production transactions stay locked.
        </p>
      </UContainer>
    </footer>
  </div>
</template>
