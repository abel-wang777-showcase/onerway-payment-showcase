<script setup lang="ts">
import type { ShjToken } from '@speed-highlight/core'

type SyntaxLanguage = 'json' | 'js'
interface SyntaxToken { readonly text: string, readonly type?: ShjToken }

const props = withDefaults(defineProps<{ label: string, value: string, language?: SyntaxLanguage }>(), {
  language: 'json',
})
const mounted = shallowRef(false)
const highlighted = shallowRef<readonly SyntaxToken[] | null>(null)
const copyProps = computed(() => ({ 'aria-label': `Copy ${props.label}`, size: 'sm' as const }))
const proseUi = {
  root: 'my-0 min-w-0 max-w-full overflow-hidden',
  header: 'min-w-0 pe-16',
  icon: 'hidden',
  filename: 'min-w-0 break-words text-xs font-medium text-toned',
  copy: 'top-1 end-1 min-h-11 min-w-11 touch-manipulation',
  base: 'max-w-full overflow-hidden p-0 whitespace-normal',
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
  <ProsePre
    :filename="label"
    :code="value"
    :language="language"
    :copy="copyProps"
    :ui="proseUi"
  >
    <code
      translate="no"
      :data-language="language"
      tabindex="0"
      role="region"
      :aria-label="`${label} code`"
      class="block max-w-full overflow-x-auto overscroll-x-contain whitespace-pre p-3 pe-14 font-mono text-xs leading-relaxed text-toned focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
    ><template v-if="highlighted"><span v-for="(token, index) in highlighted" :key="index" :data-syntax="token.type" :class="token.type ? ['apple-pay-code-token', `apple-pay-code-token--${token.type}`] : undefined">{{ token.text }}</span></template><template v-else>{{ value }}</template></code>
  </ProsePre>
</template>
