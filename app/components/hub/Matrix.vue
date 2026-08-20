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
</script>

<template>
  <section
    aria-labelledby="matrix-title"
    class="min-w-0 space-y-6"
  >
    <div class="space-y-2">
      <p class="text-sm font-medium text-primary">
        Capability matrix
      </p>
      <h2
        id="matrix-title"
        class="text-2xl font-semibold tracking-tight text-highlighted"
      >
        Choose the customer experience.
      </h2>
      <p class="max-w-2xl text-sm leading-relaxed text-toned">
        Runnable choices can open a demo. Conditional choices remain subject to the SDK, browser, wallet and merchant configuration shown here.
      </p>
    </div>

    <div class="grid min-w-0 gap-6 lg:grid-cols-3">
      <URadioGroup
        v-model="scene"
        legend="Scene"
        :items="scenes"
        variant="card"
        size="lg"
        class="min-w-0"
      />
      <URadioGroup
        v-model="integration"
        legend="Integration"
        :items="integrations"
        variant="card"
        size="lg"
        class="min-w-0"
      />
      <URadioGroup
        v-model="method"
        legend="Payment method"
        :items="methods"
        variant="card"
        size="lg"
        class="min-w-0"
      />
    </div>
  </section>
</template>
