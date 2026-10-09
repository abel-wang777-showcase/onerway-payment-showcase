<script setup lang="ts">
import { applePayTokenFormats } from '~/utils/apple-pay-token'

const props = withDefaults(defineProps<{ token: string | null, unavailable: boolean, manual?: boolean, captured?: boolean }>(), {
  manual: false,
  captured: false,
})
const emit = defineEmits<{ clear: [] }>()
const revealed = shallowRef(false)
const formats = computed(() => revealed.value && props.token ? applePayTokenFormats(props.token) : null)
const emptyMessage = computed(() => {
  if (props.unavailable) return props.manual
    ? 'This token contains fields that cannot be shown safely. No payment was submitted by this page.'
    : 'This token contains fields that cannot be shown safely. Payment submission is unaffected.'
  if (props.manual) return props.captured
    ? 'The token has been cleared. This page’s order is still unsubmitted. Authorize again in manual debugging to capture a new token.'
    : 'Authorize in Wallet to capture a Sandbox token for Apifox. Manual debugging does not submit a payment.'
  return 'Authorize in Wallet to inspect the Sandbox token here. Restored orders do not retain tokens.'
})
const tabs = [
  { label: 'JSON object', slot: 'json', value: 'json' },
  { label: 'Stringify', slot: 'stringify', value: 'stringify' },
  { label: 'Apifox', slot: 'apifox', value: 'apifox' },
  { label: 'Direct API', slot: 'direct', value: 'direct' },
]
watch(() => props.token, () => { revealed.value = false })
</script>

<template>
  <section class="min-w-0 space-y-4 rounded-lg border border-default p-5 sm:p-6" aria-labelledby="apple-pay-token-title" data-apple-pay-token>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="apple-pay-token-title" class="text-lg font-semibold tracking-tight text-highlighted">Apple Pay token</h2>
      <UBadge label="Sandbox · This visit" color="neutral" variant="outline" />
    </div>
    <p class="max-w-prose text-sm leading-relaxed text-toned">Inspect the encrypted token from this Wallet authorization. It stays in this page’s memory and is cleared when you refresh or leave.</p>
    <p v-if="manual && captured" class="text-sm leading-relaxed text-toned">This authorization was captured for manual debugging. This page did not submit a payment.</p>
    <p v-else-if="!manual && token" class="text-sm leading-relaxed text-toned">Automatic payment uses this token for its submission. Do not submit it again in Apifox.</p>
    <p v-if="!token" role="status" class="text-sm leading-relaxed text-toned">{{ emptyMessage }}</p>
    <template v-else>
      <div class="flex flex-wrap gap-2">
        <UButton :label="revealed ? 'Hide token' : 'Show token'" color="neutral" variant="outline" :aria-expanded="revealed" aria-controls="apple-pay-token-content" class="touch-manipulation" @click="revealed = !revealed" />
        <UButton label="Clear token" color="neutral" variant="ghost" class="touch-manipulation" @click="emit('clear')" />
      </div>
      <div id="apple-pay-token-content" class="min-w-0">
        <div v-if="formats" class="space-y-4">
          <p class="text-xs leading-relaxed text-toned">{{ manual ? 'Use this token only for the USD 5.00 Sandbox call you make in Apifox. Check that call’s result there; this page’s order remains unsubmitted.' : 'This token is part of the automatic payment submission. Inspect it for Sandbox debugging; do not submit it again in Apifox.' }} Copied text remains in your clipboard.</p>
          <UTabs :items="tabs" default-value="json" color="neutral" variant="link" size="sm" :ui="{ list: 'flex-wrap', trigger: 'flex-none touch-manipulation', content: 'min-w-0' }">
            <template #json>
              <div class="min-w-0 space-y-3">
                <p class="text-xs leading-relaxed text-toned">The complete <code class="font-mono" translate="no">event.payment.token</code> as a readable JSON object.</p>
                <PaymentApplePayMessage label="Apple Pay token: JSON object" :value="formats.json" />
              </div>
            </template>
            <template #stringify>
              <div class="min-w-0 space-y-3">
                <p class="text-xs leading-relaxed text-toned">A quoted and escaped JSON string value. In Apifox’s JSON request body, replace the entire <code class="font-mono" translate="no">tokenInfo.tokenId</code> value, including its quotes. Do not add quotes or stringify it again. Use the Apifox tab to copy the complete <code class="font-mono" translate="no">tokenInfo</code> object.</p>
                <PaymentApplePayMessage label="Apple Pay token: stringify" :value="formats.stringify" />
              </div>
            </template>
            <template #apifox>
              <div class="min-w-0 space-y-3">
                <p class="text-xs leading-relaxed text-toned">Copy this <code class="font-mono" translate="no">tokenInfo</code> object into Apifox’s JSON request body. Its <code class="font-mono" translate="no">tokenId</code> string is already escaped; the shared signing script serializes the outer object once.</p>
                <PaymentApplePayMessage label="Apifox tokenInfo object" :value="formats.apifox" />
              </div>
            </template>
            <template #direct>
              <div class="min-w-0 space-y-3">
                <p class="text-xs leading-relaxed text-toned">Use this string-valued <code class="font-mono" translate="no">tokenInfo</code> in a raw Direct API request. If Apifox’s shared signing script is enabled, use the Apifox tab to copy the object it expects.</p>
                <PaymentApplePayMessage label="Direct API tokenInfo" :value="formats.direct" />
              </div>
            </template>
          </UTabs>
        </div>
      </div>
    </template>
  </section>
</template>
