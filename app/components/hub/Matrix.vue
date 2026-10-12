<script setup lang="ts">
import type { RadioGroupItem } from '@nuxt/ui'

interface MatrixValue {
  scene: string
  integration: string
  method: string
}

const props = defineProps<{
  modelValue: MatrixValue
  scenes: RadioGroupItem[]
  integrations: RadioGroupItem[]
  methods: RadioGroupItem[]
  subscription?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: MatrixValue]
}>()

function field<K extends keyof MatrixValue>(key: K) {
  return computed({
    get: () => props.modelValue[key],
    set: value => emit('update:modelValue', {
      ...props.modelValue,
      [key]: value,
    }),
  })
}

const scene = field('scene')
const integration = field('integration')
const method = field('method')
const availableScenes = computed(() => props.scenes.filter(item => item && typeof item === 'object' && !item.disabled))
const availableIntegrations = computed(() => props.integrations.filter(item => item && typeof item === 'object' && !item.disabled))
const availableMethods = computed(() => props.methods.filter(item => item && typeof item === 'object' && !item.disabled))
const otherScenes = computed(() => props.scenes.filter(item => item && typeof item === 'object' && item.disabled))
const otherMethods = computed(() => props.methods.filter(item => item && typeof item === 'object' && item.disabled))
const singleScene = computed(() => {
  const item = availableScenes.value[0]
  return availableScenes.value.length === 1 && item && typeof item === 'object' ? item : null
})
const integrationDescription = computed(() => selectedDescription(props.integrations, integration.value))
const methodDescription = computed(() => selectedDescription(props.methods, method.value))

function selectedDescription(items: RadioGroupItem[], value: string) {
  for (const item of items) {
    if (item && typeof item === 'object' && item.value === value) {
      return item.description
    }
  }
}

const compactOptionsUi = {
  fieldset: 'grid gap-2 md:grid-cols-3',
  item: 'min-h-11 min-w-0 items-center px-3 py-2.5',
  wrapper: 'min-w-0',
  description: 'sr-only',
}

</script>

<template>
  <section
    id="demo-selection"
    aria-labelledby="matrix-title"
    tabindex="-1"
    class="min-w-0 scroll-mt-6 space-y-4 focus-visible:outline-2 focus-visible:outline-primary"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2
        id="matrix-title"
        class="text-xl font-semibold tracking-tight text-highlighted"
      >
        Choose your demo.
      </h2>
      <p v-if="singleScene" class="text-sm text-toned">
        {{ singleScene.label }}
      </p>
    </div>

    <div class="min-w-0 space-y-4">
      <URadioGroup
        v-if="!singleScene"
        v-model="scene"
        legend="Scene"
        :items="availableScenes"
        class="min-w-0"
      />
      <div class="space-y-2">
        <URadioGroup
          v-model="integration"
          legend="Integration"
          :items="availableIntegrations"
          variant="card"
          class="min-w-0"
          :ui="compactOptionsUi"
        />
        <p v-if="integrationDescription" class="text-sm leading-relaxed text-toned">
          {{ integrationDescription }}
        </p>
      </div>
      <slot />
      <div v-if="!subscription" class="space-y-2">
        <URadioGroup
          v-model="method"
          legend="Payment method"
          :items="availableMethods"
          variant="card"
          class="min-w-0"
          :ui="compactOptionsUi"
        />
        <p v-if="methodDescription" class="text-sm leading-relaxed text-toned">
          {{ methodDescription }}
        </p>
      </div>
      <p v-else class="rounded-md bg-muted p-3 text-sm leading-relaxed text-toned">
        {{ integration === 'checkout' ? 'Select Card on the hosted checkout for the first subscription payment.' : 'The secure SDK form shows the payment methods enabled for this subscription.' }}
        The first payment requires 3DS. Payment and subscription activation are confirmed separately.
      </p>
    </div>

    <slot name="journey" />

    <details class="border-t border-default pt-1 text-sm">
      <summary class="min-h-11 cursor-pointer rounded-sm py-3 font-medium text-toned focus-visible:outline-2 focus-visible:outline-primary">Planned and unavailable options</summary>
      <p class="mb-4 text-sm text-toned">These choices cannot start a demo with the current selection.</p>
      <div class="grid gap-6 sm:grid-cols-2">
        <URadioGroup legend="Other scenes" :items="otherScenes" />
        <URadioGroup v-if="!subscription" legend="Other payment methods" :items="otherMethods" />
      </div>
    </details>
  </section>
</template>
