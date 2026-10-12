<script setup lang="ts">
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import { useMediaQuery } from '@vueuse/core'

const wideLayout = useMediaQuery('(min-width: 961px)', { ssrWidth: 0 })
const configuration = useTemplateRef<InstanceType<typeof SplitterPanel>>('configuration')
</script>

<template>
  <SplitterGroup
    id="demo-workspace"
    direction="horizontal"
    :keyboard-resize-by="5"
    class="demo-workspace rounded-lg border border-default bg-default"
  >
    <SplitterPanel id="demo-configuration-panel" ref="configuration" :default-size="60" :min-size="45" :max-size="65">
      <div class="min-w-0 p-4 sm:p-6">
        <slot />
      </div>
    </SplitterPanel>
    <SplitterResizeHandle
      id="demo-column-resize"
      :disabled="!wideLayout"
      aria-label="Resize configuration and summary"
      aria-orientation="vertical"
      title="Drag or use arrow keys to resize. Double-click to reset."
      class="group relative hidden w-3 shrink-0 items-center justify-center bg-muted outline-primary focus-visible:outline-2 focus-visible:-outline-offset-2 lg:flex"
      @dblclick="configuration?.resize(60)"
    >
      <span class="h-11 w-1 rounded-full bg-accented group-hover:bg-primary group-focus-visible:bg-primary" aria-hidden="true" />
    </SplitterResizeHandle>
    <SplitterPanel id="demo-summary-panel" :default-size="40" :min-size="35" :max-size="55" class="rounded-b-lg border-t border-default bg-muted lg:rounded-bl-none lg:rounded-tr-lg lg:border-t-0">
      <slot name="summary" />
    </SplitterPanel>
  </SplitterGroup>
</template>
