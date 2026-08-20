<script setup lang="ts">
import type { NuxtError } from '#app'
import { getErrorView } from './utils/error'

const props = defineProps<{
  error: NuxtError
}>()

const status = computed(() => props.error.statusCode ?? 500)
const view = computed(() => getErrorView(status.value))

useSeoMeta({
  title: () => `${status.value} · Onerway Payment Showcase`,
})

function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <NuxtLayout>
    <UContainer>
      <section class="flex min-h-[calc(100dvh-8rem)] items-center py-16">
        <div class="max-w-xl">
          <p class="font-mono text-sm text-primary">
            {{ status }}
          </p>
          <h1 class="mt-3 text-4xl font-semibold tracking-tight text-highlighted">
            {{ view.title }}
          </h1>
          <p class="mt-4 text-base leading-7 text-toned">
            {{ view.description }}
          </p>
          <UButton
            label="Back to showcase"
            icon="i-lucide-arrow-left"
            class="mt-8 min-h-11"
            @click="goHome"
          />
        </div>
      </section>
    </UContainer>
  </NuxtLayout>
</template>
