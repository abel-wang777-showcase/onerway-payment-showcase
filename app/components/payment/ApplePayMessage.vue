<script setup lang="ts">
const props = defineProps<{ label: string, value: string }>()
const copied = shallowRef(false)
const copyError = shallowRef(false)
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
let disposed = false

async function copy(): Promise<void> {
  const text = props.value
  try {
    await navigator.clipboard.writeText(text)
    if (disposed || props.value !== text) return
    copied.value = true
    copyError.value = false
  }
  catch {
    if (disposed || props.value !== text) return
    copied.value = false
    copyError.value = true
  }
  clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => { copied.value = false; copyError.value = false }, 3000)
}
watch(() => props.value, () => { copied.value = false; copyError.value = false })
onScopeDispose(() => { disposed = true; clearTimeout(feedbackTimer) })
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-md border border-default bg-muted">
    <div class="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-default px-3 py-1">
      <p class="min-w-0 break-words text-xs font-medium text-toned">{{ label }}</p>
      <UButton :aria-label="`Copy ${label}`" :label="copied ? 'Copied' : 'Copy'" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral" variant="ghost" size="xs" class="min-h-11 shrink-0 touch-manipulation" @click="copy" />
    </div>
    <pre tabindex="0" role="region" :aria-label="`${label} code`" class="max-w-full overflow-x-auto overscroll-x-contain p-3 font-mono text-xs leading-relaxed text-toned focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"><code translate="no">{{ value }}</code></pre>
    <p role="status" aria-live="polite" :class="copyError ? 'px-3 py-2 text-xs leading-relaxed text-toned' : 'sr-only'">{{ copied ? `${label} copied.` : copyError ? `Could not copy ${label}. Select the text to copy it manually.` : '' }}</p>
  </div>
</template>
