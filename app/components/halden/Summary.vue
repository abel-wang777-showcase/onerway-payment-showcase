<script setup lang="ts">
interface SummaryLine {
  label: string
  value: string
}

defineProps<{
  lines: readonly SummaryLine[]
  total: string
  payLabel: string
  disabled: boolean
  busy: boolean
  footer?: string
}>()

const emit = defineEmits<{
  pay: []
}>()

const open = ref(false)
const detailsId = 'order-summary-details'
</script>

<template>
  <aside
    aria-labelledby="order-summary-title"
    class="relative lg:sticky lg:top-8"
  >
    <div class="rounded-lg border border-default bg-muted">
      <div class="flex items-center justify-between gap-4 p-5">
        <div>
          <p class="text-sm text-muted">
            Order total
          </p>
          <h2
            id="order-summary-title"
            class="mt-1 font-mono text-2xl font-semibold tracking-tight text-highlighted"
          >
            {{ total }}
          </h2>
        </div>

        <UButton
          :label="open ? 'Hide summary' : 'View summary'"
          color="neutral"
          variant="ghost"
          size="sm"
          class="min-h-11 lg:hidden"
          :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          :aria-expanded="open"
          :aria-controls="detailsId"
          @click="open = !open"
        />
      </div>

      <div
        :id="detailsId"
        :class="open ? 'block' : 'hidden lg:block'"
        class="border-t border-default p-5 lg:block"
      >
        <dl class="space-y-3 text-sm">
          <div
            v-for="line in lines"
            :key="line.label"
            class="flex justify-between gap-6"
          >
            <dt class="text-toned">
              {{ line.label }}
            </dt>
            <dd class="font-medium text-highlighted">
              {{ line.value }}
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <div
      class="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-default/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:flex md:items-center md:justify-end md:gap-4 md:px-6 lg:static lg:mt-4 lg:block lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none"
    >
      <div class="mb-3 flex items-center justify-between gap-4 md:mb-0 lg:mb-3">
        <span class="text-sm text-toned">Total</span>
        <span class="font-mono text-lg font-semibold text-highlighted">{{ total }}</span>
      </div>
      <UButton
        :label="payLabel"
        color="primary"
        size="xl"
        block
        class="min-h-11 md:w-auto md:min-w-64 lg:w-full"
        :disabled="disabled"
        :loading="busy"
        :aria-busy="busy"
        @click="emit('pay')"
      />
      <p
        v-if="footer"
        class="mt-2 text-center text-xs text-muted md:hidden lg:block"
      >
        {{ footer }}
      </p>
    </div>
  </aside>
</template>
