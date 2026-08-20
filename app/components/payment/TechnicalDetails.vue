<script setup lang="ts">
interface Detail {
  label: string
  value: string
}

const props = defineProps<{
  id: string
  rows: readonly Detail[]
  mode?: 'simulation' | 'sandbox'
}>()

const open = ref(false)
const contentId = computed(() => `${props.id}-content`)
const badge = computed(() => props.mode === 'sandbox' ? 'Verified Sandbox outcome' : 'Simulated outcome')
const note = computed(() => props.mode === 'sandbox'
  ? 'Whitelisted identifiers and normalized states only; no raw provider payload.'
  : 'Whitelisted demo facts, not an Onerway response.')
</script>

<template>
  <UCollapsible
    v-model:open="open"
    class="rounded-lg border border-default bg-muted"
  >
    <UButton
      :label="open ? 'Hide Technical details' : 'Show Technical details'"
      color="neutral"
      variant="ghost"
      block
      class="min-h-11 justify-between px-4"
      :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
      :aria-expanded="open"
      :aria-controls="contentId"
    />

    <template #content>
      <div
        :id="contentId"
        class="border-t border-default p-4"
      >
        <div class="mb-4 flex items-center gap-2">
          <UBadge
            :label="badge"
            :color="mode === 'sandbox' ? 'success' : 'info'"
            variant="soft"
          />
          <p class="text-xs text-toned">
            {{ note }}
          </p>
        </div>

        <dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <template
            v-for="row in rows"
            :key="row.label"
          >
            <dt class="font-mono text-xs text-muted">
              {{ row.label }}
            </dt>
            <dd class="break-words font-mono text-xs text-highlighted [overflow-wrap:anywhere]">
              {{ row.value }}
            </dd>
          </template>
        </dl>
      </div>
    </template>
  </UCollapsible>
</template>
