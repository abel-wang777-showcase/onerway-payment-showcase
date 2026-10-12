<script setup lang="ts">
import type { HubOption } from '~/composables/useHubSelection'

interface MatrixValue {
  scene: string
  integration: string
  method: string
}

const props = defineProps<{
  modelValue: MatrixValue
  scenes: HubOption[]
  integrations: HubOption[]
  methods: HubOption[]
  subscription?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: MatrixValue]
}>()

function field<K extends keyof MatrixValue>(key: K) {
  return computed({
    get: () => props.modelValue[key],
    set: value => emit('update:modelValue', { ...props.modelValue, [key]: value }),
  })
}

const scene = field('scene')
const integration = field('integration')
const method = field('method')
const availableScenes = computed(() => props.scenes.filter(item => !item.disabled))
const availableMethods = computed(() => props.methods.filter(item => !item.disabled))
const otherScenes = computed(() => props.scenes.filter(item => item.disabled))
const otherMethods = computed(() => props.methods.filter(item => item.disabled))
const unavailableGroups = computed(() => [
  { label: 'Other scenes', items: otherScenes.value },
  ...(!props.subscription ? [{ label: 'Other payment methods', items: otherMethods.value }] : []),
])
const integrationTabs = computed(() => props.integrations.map(item => ({
  ...item,
  label: item.title ?? item.label,
})))
const integrationDescription = computed(() => props.integrations.find(item => item.value === integration.value)?.description)
const methodCondition = computed(() => {
  const selected = props.methods.find(item => item.value === method.value)
  return selected?.status === 'conditional' ? selected.description : undefined
})
</script>

<template>
  <section
    id="demo-selection"
    aria-labelledby="matrix-title"
    tabindex="-1"
    class="min-w-0 scroll-mt-6 focus-visible:outline-2 focus-visible:outline-primary"
  >
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 lg:mb-4">
      <h2 id="matrix-title" class="text-lg font-semibold tracking-tight text-highlighted">
        Configure your demo
      </h2>
      <span v-if="availableScenes.length === 1" class="text-xs font-medium text-toned">
        {{ availableScenes[0]?.title ?? availableScenes[0]?.label }} · Halden
      </span>
    </div>

    <UFormField v-if="availableScenes.length > 1" label="Scene" class="mb-4">
      <USelect v-model="scene" aria-label="Scene" :items="availableScenes" class="min-h-11 w-full" />
    </UFormField>

    <UTabs
      v-model="integration"
      role="group"
      aria-label="Integration"
      :items="integrationTabs"
      variant="pill"
      color="neutral"
      class="w-full"
      :ui="{ list: 'w-full', indicator: 'bg-default', trigger: 'min-h-11 flex-1 justify-center px-2 data-[state=active]:text-highlighted data-[state=inactive]:text-toned', label: 'whitespace-normal text-center', content: 'pt-3 focus-visible:outline-primary' }"
    >
      <template #content>
        <p class="mb-3 text-sm leading-relaxed text-toned">{{ integrationDescription }}</p>
        <div class="grid min-w-0 grid-cols-2 items-start gap-3 lg:gap-4">
          <slot />
          <UFormField v-if="!subscription" label="Payment method" name="payment-method">
            <USelect
              v-model="method"
              aria-label="Payment method"
              :items="availableMethods"
              size="lg"
              class="min-h-11 w-full"
              :ui="{ value: 'whitespace-normal text-start', item: 'min-h-11', itemLabel: 'whitespace-normal' }"
            />
          </UFormField>
          <div v-else class="space-y-2 text-sm">
            <p class="font-medium text-highlighted">First payment</p>
            <p class="flex min-h-11 items-center gap-2 text-toned">
              <UIcon name="i-lucide-shield-check" class="size-4 shrink-0" aria-hidden="true" />
              3DS required
            </p>
          </div>
          <slot name="journey" />
        </div>
        <p v-if="!subscription && methodCondition" class="mt-3 text-sm leading-relaxed text-toned">
          {{ methodCondition }}
        </p>
        <p v-else-if="subscription" class="mt-4 text-sm leading-relaxed text-toned">
          {{ integration === 'checkout' ? 'Select Card on the hosted checkout for the first subscription payment.' : 'The secure SDK form shows the payment methods enabled for this subscription.' }}
          Payment and subscription activation are confirmed separately.
        </p>
      </template>
    </UTabs>

    <details class="group mt-3 border-t border-default text-sm lg:mt-5">
      <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-sm font-medium text-toned focus-visible:outline-2 focus-visible:outline-primary">
        Planned and unavailable options
        <UIcon name="i-lucide-plus" class="size-4 shrink-0 group-open:rotate-45" aria-hidden="true" />
      </summary>
      <p class="mb-4 text-sm text-toned">These choices cannot start a demo with the current selection.</p>
      <div class="grid gap-4 pb-2 sm:grid-cols-2">
        <div v-for="group in unavailableGroups" :key="group.label">
          <h3 class="mb-2 font-medium text-highlighted">{{ group.label }}</h3>
          <ul class="space-y-3">
            <li v-for="item in group.items" :key="item.value">
              <p class="text-toned">{{ item.label }}</p>
              <p class="mt-1 text-xs leading-relaxed text-muted">{{ item.description }}</p>
            </li>
          </ul>
        </div>
      </div>
    </details>
  </section>
</template>
