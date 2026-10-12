<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

interface Fact {
  label: string
  value: string
}

const props = defineProps<{
  title: string
  description: string
  amount: string
  facts: readonly Fact[]
}>()

const wideLayout = useMediaQuery('(min-width: 961px)', { ssrWidth: 0 })
const summaryTitle = computed(() => props.title.replace(/^USD \d+\.\d{2} · /, ''))
</script>

<template>
  <aside
    id="demo-launch"
    aria-labelledby="passport-title"
    tabindex="-1"
    class="demo-passport min-w-0 scroll-mt-6 p-4 focus-visible:outline-2 focus-visible:outline-primary sm:p-6"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <p class="text-sm font-medium text-toned">
        Your Sandbox demo
      </p>
    </div>
    <div class="mt-2 flex items-center justify-between gap-3 lg:block">
      <h2 id="passport-title" class="text-lg font-semibold tracking-tight text-highlighted lg:text-xl">
        {{ summaryTitle }}
      </h2>
      <p class="shrink-0 text-2xl font-semibold tracking-tight text-highlighted tabular-nums lg:mt-4 lg:text-4xl">
        {{ amount }}
      </p>
    </div>

    <slot />

    <details :open="wideLayout" class="group mt-3 border-y border-default lg:mt-4">
      <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-sm text-sm font-medium text-toned focus-visible:outline-2 focus-visible:outline-primary lg:hidden">
        Demo details
        <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <p class="pb-3 text-sm leading-relaxed text-toned lg:pt-3">{{ description }}</p>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-3 pb-3">
        <div
          v-for="fact in facts"
          :key="fact.label"
          class="min-w-0 text-sm"
        >
          <dt class="text-xs text-toned">
            {{ fact.label }}
          </dt>
          <dd class="min-w-0 break-words font-medium text-highlighted">
            {{ fact.value }}
          </dd>
        </div>
      </dl>
    </details>

    <div class="mt-3 flex items-start gap-2">
      <UIcon
        name="i-lucide-circle-check"
        class="mt-0.5 size-4 shrink-0 text-primary"
        aria-hidden="true"
      />
      <p class="text-xs leading-relaxed text-toned">
        Sandbox only. No production payments.
      </p>
    </div>

  </aside>
</template>
