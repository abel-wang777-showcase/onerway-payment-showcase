<script setup lang="ts">
interface Fact {
  label: string
  value: string
}

defineProps<{
  title: string
  description: string
  amount: string
  facts: readonly Fact[]
  profile: string
}>()
</script>

<template>
  <aside
    id="demo-launch"
    aria-labelledby="passport-title"
    tabindex="-1"
    class="demo-passport min-w-0 scroll-mt-6 rounded-lg border border-default bg-muted p-5 focus-visible:outline-2 focus-visible:outline-primary sm:p-6 lg:sticky lg:top-8"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <p class="text-sm font-medium text-toned">
        Your demo
      </p>
      <UBadge
        label="Sandbox"
        color="info"
        variant="soft"
      />
    </div>
    <h2
      id="passport-title"
      class="mt-2 text-xl font-semibold tracking-tight text-highlighted"
    >
      {{ title }}
    </h2>

    <p class="mt-3 text-sm leading-relaxed text-toned">
      {{ description }}
    </p>

    <p class="mt-5 text-3xl font-semibold tracking-tight text-highlighted tabular-nums">
      {{ amount }}
    </p>

    <slot />

    <dl class="mt-6 divide-y divide-default border-y border-default">
      <div
        v-for="fact in facts"
        :key="fact.label"
        class="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-sm"
      >
        <dt class="text-toned">
          {{ fact.label }}
        </dt>
        <dd class="min-w-0 break-words font-medium text-highlighted">
          {{ fact.value }}
        </dd>
      </div>
    </dl>

    <div class="mt-4 flex items-start gap-2">
      <UIcon
        name="i-lucide-circle-check"
        class="mt-0.5 size-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <p class="text-xs leading-relaxed text-toned">
        {{ profile }}. Sandbox tests a payment integration. No production payments.
      </p>
    </div>

  </aside>
</template>
