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
  sandbox: boolean
}>()
</script>

<template>
  <aside
    aria-labelledby="passport-title"
    class="demo-passport min-w-0 rounded-lg border border-default p-6 lg:sticky lg:top-8"
  >
    <div class="flex items-start justify-between gap-4">
      <div>
        <p class="font-mono text-xs font-medium uppercase tracking-[0.16em] text-muted">
          Demo passport
        </p>
        <h2
          id="passport-title"
          class="mt-2 text-xl font-semibold tracking-tight text-highlighted"
        >
          {{ title }}
        </h2>
      </div>
      <UBadge
        :label="sandbox ? 'Simulation + Sandbox' : 'Simulation'"
        color="info"
        variant="soft"
      />
    </div>

    <p class="mt-3 text-sm leading-relaxed text-toned">
      {{ description }}
    </p>

    <p class="mt-8 font-mono text-4xl font-semibold tracking-tight text-highlighted">
      {{ amount }}
    </p>

    <dl class="mt-8 divide-y divide-default border-y border-default">
      <div
        v-for="fact in facts"
        :key="fact.label"
        class="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-4 py-3 text-sm"
      >
        <dt class="text-muted">
          {{ fact.label }}
        </dt>
        <dd class="text-right font-medium text-highlighted">
          {{ fact.value }}
        </dd>
      </div>
    </dl>

    <div class="mt-6 flex items-start gap-3 rounded-md border border-default bg-default p-3">
      <UIcon
        name="i-lucide-circle-check"
        class="mt-0.5 size-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <p class="text-xs leading-relaxed text-toned">
        {{ profile }}. Simulation stays local; the real Sandbox button uses signed server calls and Onerway-hosted card fields. Production remains locked.
      </p>
    </div>

    <slot />
  </aside>
</template>
