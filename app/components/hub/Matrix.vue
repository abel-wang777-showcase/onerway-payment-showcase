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
</script>

<template>
  <section
    id="demo-selection"
    aria-labelledby="matrix-title"
    tabindex="-1"
    class="min-w-0 scroll-mt-6 space-y-6 focus-visible:outline-2 focus-visible:outline-primary"
  >
    <div class="space-y-2">
      <h2
        id="matrix-title"
        class="text-2xl font-semibold tracking-tight text-highlighted"
      >
        Make it your demo.
      </h2>
      <p class="max-w-2xl text-sm leading-relaxed text-toned">
        Compare how customers pay with each integration. Conditional methods depend on the merchant setup and customer’s device.
      </p>
    </div>

    <div class="min-w-0 space-y-6">
      <URadioGroup
        v-model="scene"
        legend="Scene"
        :items="availableScenes"
        class="min-w-0"
      />
      <URadioGroup
        v-model="integration"
        legend="Integration"
        :items="availableIntegrations"
        variant="card"
        size="lg"
        class="min-w-0"
        :ui="{ fieldset: 'grid gap-3 sm:grid-cols-3', description: 'text-toned', item: 'min-w-0' }"
      />
      <slot />
      <URadioGroup
        v-if="!subscription"
        v-model="method"
        legend="Payment method"
        :items="availableMethods"
        variant="card"
        size="lg"
        class="min-w-0"
        :ui="{ fieldset: 'grid gap-3 sm:grid-cols-2', description: 'text-toned', item: 'min-w-0' }"
      />
      <p v-else class="rounded-md bg-muted p-4 text-sm leading-relaxed text-toned">
        {{ integration === 'checkout' ? 'Select Card on the hosted checkout for the first subscription payment.' : 'The secure SDK form shows the payment methods enabled for this subscription.' }}
        The first payment requires 3DS. Payment and subscription activation are confirmed separately.
      </p>
    </div>

    <details class="border-t border-default pt-4 text-sm">
      <summary class="min-h-11 cursor-pointer rounded-sm py-3 font-medium text-toned focus-visible:outline-2 focus-visible:outline-primary">Explore planned and unavailable options</summary>
      <p class="mb-4 text-sm text-toned">These choices cannot start a demo with the current selection.</p>
      <div class="grid gap-6 sm:grid-cols-2">
        <URadioGroup legend="Other scenes" :items="otherScenes" />
        <URadioGroup v-if="!subscription" legend="Other payment methods" :items="otherMethods" />
      </div>
    </details>
  </section>
</template>
