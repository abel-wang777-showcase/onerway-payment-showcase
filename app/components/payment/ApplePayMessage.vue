<script setup lang="ts">
import type { ShjToken } from '@speed-highlight/core'

type SyntaxLanguage = 'json' | 'js'
interface SyntaxToken { readonly text: string, readonly type?: ShjToken }

const props = withDefaults(defineProps<{ label: string, value: string, language?: SyntaxLanguage }>(), {
  language: 'json',
})
const mounted = shallowRef(false)
const highlighted = shallowRef<readonly SyntaxToken[] | null>(null)
const proseUi = {
  root: 'my-0 min-w-0 max-w-full overflow-hidden',
  base: 'max-w-full overflow-hidden rounded-none border-0 p-0 whitespace-normal',
} as const

async function tokenizeMessage(value: string, language: SyntaxLanguage): Promise<readonly SyntaxToken[] | null> {
  try {
    const { tokenize } = await import('@speed-highlight/core')
    const tokens: SyntaxToken[] = []
    await tokenize(value, language, (text, type) => {
      tokens.push(type ? { text, type } : { text })
    })
    return tokens.map(token => token.text).join('') === value ? Object.freeze(tokens) : null
  }
  catch {
    return null
  }
}

watch(
  [mounted, () => props.value, () => props.language],
  ([ready, value, language], _previous, onCleanup) => {
    highlighted.value = null
    if (!ready) return

    let active = true
    onCleanup(() => { active = false })
    void tokenizeMessage(value, language).then((tokens) => {
      if (!active) return
      highlighted.value = tokens
    })
  },
  { immediate: true },
)
onMounted(() => { mounted.value = true })
</script>

<template>
  <div class="min-w-0 max-w-full overflow-hidden rounded-md border border-muted">
    <div class="flex min-w-0 items-center justify-between gap-3 border-b border-muted bg-default px-3 py-2">
      <span class="min-w-0 break-words text-xs font-medium text-toned">{{ label }}</span>
      <div class="shrink-0 [&_button]:justify-center [&_button]:touch-manipulation pointer-coarse:[&_button]:min-h-11 pointer-coarse:[&_button]:min-w-11">
        <CopyButton
          :value="value"
          :label="`Copy ${label}`"
          :copied-label="`${label} copied to clipboard`"
          :tooltip="false"
          size="sm"
          variant="ghost"
          color="neutral"
        />
      </div>
    </div>
    <ProsePre :language="language" hide-header :copy="false" :ui="proseUi">
      <code
        translate="no"
        :data-language="language"
        tabindex="0"
        role="region"
        :aria-label="`${label} code`"
        class="block max-w-full overflow-x-auto overscroll-x-contain whitespace-pre p-3 font-mono text-xs leading-relaxed text-toned focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
      ><template v-if="highlighted"><span v-for="(token, index) in highlighted" :key="index" :data-syntax="token.type" :class="token.type ? ['apple-pay-code-token', `apple-pay-code-token--${token.type}`] : undefined">{{ token.text }}</span></template><template v-else>{{ value }}</template></code>
    </ProsePre>
  </div>
</template>
