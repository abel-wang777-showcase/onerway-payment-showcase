<script setup lang="ts">
import type { ApplePayStep } from '#shared/payment/apple-pay'

const props = defineProps<{ step: ApplePayStep, index: number }>()
const details = useTemplateRef<HTMLDetailsElement>('details')
const manualChoice = shallowRef<boolean | null>(null)
const keepOpenForFocus = shallowRef(false)
const isOpen = computed(() => manualChoice.value ?? (props.step.state === 'active' || keepOpenForFocus.value))
const previewFields = computed(() => props.step.evidence?.fields.slice(0, 3) ?? [])
const additionalFields = computed(() => props.step.evidence?.fields.slice(3) ?? [])
const statusLabel = computed(() => {
  if (props.step.state === 'active') return 'In progress'
  if (props.step.state === 'interrupted') return 'Needs attention'
  if (props.step.evidence) return 'Recorded'
  return props.step.state === 'completed' ? 'Completed' : 'Not recorded'
})
const sourceLabel = computed(() => props.step.evidence?.source === 'stored' ? 'Restored from server' : 'This visit')
const timestamp = computed(() => {
  const value = props.step.evidence?.occurredAt
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  // An explicit UTC time zone keeps server and client rendering identical.
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(date)
})
const duration = computed(() => {
  const value = props.step.evidence?.durationMs
  return value !== undefined && Number.isFinite(value) && value >= 0 ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} ms` : null
})
const exampleLanguage = computed(() => ['begin', 'validate', 'authorize'].includes(props.step.id) ? 'js' as const : 'json' as const)

function toggle(): void { manualChoice.value = !isOpen.value }
function preserveFocusedContent(event: FocusEvent): void {
  if (event.target !== details.value?.querySelector('summary') && isOpen.value) keepOpenForFocus.value = true
}
</script>

<template>
  <li class="apple-pay-timeline-step min-w-0" :data-apple-pay-step="step.id" :data-state="step.state" :aria-current="step.state === 'active' ? 'step' : undefined">
    <span class="apple-pay-timeline-marker flex size-8 items-center justify-center rounded-full border bg-default text-sm font-medium tabular-nums text-highlighted" :class="step.state === 'active' ? 'border-primary' : 'border-default'" aria-hidden="true">{{ index + 1 }}</span>
    <div class="min-w-0">
      <div class="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 class="min-w-0 text-pretty text-base font-semibold tracking-tight text-highlighted">{{ step.title }}</h3>
        <span class="inline-flex min-h-6 shrink-0 items-center gap-1 text-xs font-medium text-toned">
          <span v-if="step.state === 'active'" aria-hidden="true" class="size-1.5 rounded-full bg-primary" />
          {{ statusLabel }}
        </span>
      </div>
      <p class="mt-2 max-w-prose text-pretty text-sm leading-relaxed text-toned">{{ step.evidence?.summary ?? step.input }}</p>
      <div v-if="step.evidence" class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-toned">
        <span class="inline-flex items-center gap-1.5"><UIcon :name="step.evidence.source === 'stored' ? 'i-lucide-database' : 'i-lucide-radio'" class="size-3.5" aria-hidden="true" />{{ sourceLabel }}</span>
        <time v-if="timestamp" :datetime="step.evidence.occurredAt" class="tabular-nums">{{ timestamp }}</time>
        <span v-if="duration" class="tabular-nums">{{ duration }}</span>
      </div>
      <dl v-if="previewFields.length" class="mt-3 grid min-w-0 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        <div v-for="(field, fieldIndex) in previewFields" :key="`${field.label}-${fieldIndex}`" class="min-w-0">
          <dt class="break-words text-toned">{{ field.label }}</dt>
          <dd class="mt-1 font-mono text-toned" translate="no">
            <PaymentApplePayNetworkList v-if="field.networks?.length" :networks="field.networks" :value="field.value" />
            <span v-else class="break-all">{{ field.value }}</span>
          </dd>
        </div>
      </dl>
      <details ref="details" data-step-details :open="isOpen" class="mt-3 min-w-0" @focusin="preserveFocusedContent">
        <summary class="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm text-sm font-medium text-toned hover:text-highlighted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary touch-manipulation" @click.prevent="toggle">
          <span>{{ isOpen ? 'Hide step details' : 'Explore this step' }}<span class="sr-only">: {{ step.title }}</span></span>
          <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0" :class="{ 'rotate-180': isOpen }" aria-hidden="true" />
        </summary>
        <div class="min-w-0 space-y-6 border-t border-default pt-4 pb-2">
          <section :aria-label="`${step.title}: recorded data`" class="min-w-0 space-y-3">
            <h4 class="text-sm font-semibold tracking-tight text-highlighted">{{ step.evidence?.source === 'stored' ? 'Stored payment evidence' : 'Data from this visit' }}</h4>
            <template v-if="step.evidence">
              <p class="max-w-prose text-xs leading-relaxed text-toned">Only safe fields are shown. Sensitive values are omitted or masked; this is not a full raw payload.</p>
              <dl v-if="additionalFields.length" class="grid min-w-0 gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
                <div v-for="(field, fieldIndex) in additionalFields" :key="`${field.label}-${fieldIndex}`" class="min-w-0">
                  <dt class="break-words text-toned">{{ field.label }}</dt>
                  <dd class="mt-1 font-mono text-toned" translate="no">
                    <PaymentApplePayNetworkList v-if="field.networks?.length" :networks="field.networks" :value="field.value" />
                    <span v-else class="break-all">{{ field.value }}</span>
                  </dd>
                </div>
              </dl>
              <PaymentApplePayMessage v-if="step.evidence.request" :label="`${step.title}: safe request`" :value="step.evidence.request" />
              <PaymentApplePayMessage v-if="step.evidence.response" :label="`${step.title}: safe response`" :value="step.evidence.response" />
              <p v-if="!step.evidence.request && !step.evidence.response" class="text-xs leading-relaxed text-toned">No request or response body is retained for this step.</p>
            </template>
            <p v-else class="text-sm leading-relaxed text-toned">No data was recorded for this step in this visit. The explanation below describes the integration; it does not prove that this step ran.</p>
          </section>
          <section :aria-label="`${step.title}: integration explanation`" class="space-y-3">
            <h4 class="text-sm font-semibold tracking-tight text-highlighted">How to integrate</h4>
            <dl class="space-y-3 text-sm leading-relaxed">
              <div><dt class="font-medium text-highlighted">Who acts</dt><dd class="mt-1 text-toned">{{ step.actor }}</dd></div>
              <div><dt class="font-medium text-highlighted">Input</dt><dd class="mt-1 text-toned">{{ step.input }}</dd></div>
              <div><dt class="font-medium text-highlighted">Output</dt><dd class="mt-1 text-toned">{{ step.output }}</dd></div>
              <div><dt class="font-medium text-highlighted">If this step is interrupted</dt><dd class="mt-1 text-toned">{{ step.failure }}</dd></div>
            </dl>
            <UButton :to="step.documentation" target="_blank" rel="noopener noreferrer" label="Official documentation" icon="i-lucide-external-link" variant="link" color="neutral" class="min-h-11 text-toned hover:text-highlighted touch-manipulation" />
          </section>
          <section v-if="step.example?.request || step.example?.response" :aria-label="`${step.title}: synthetic example`" class="min-w-0 space-y-3 border-t border-dashed border-default pt-4">
            <h4 class="text-sm font-semibold tracking-tight text-highlighted">Synthetic example</h4>
            <p class="text-xs leading-relaxed text-toned">Illustrative values only. This example is not a message from your payment.</p>
            <PaymentApplePayMessage v-if="step.example.request" :label="`${step.title}: example request`" :value="step.example.request" :language="exampleLanguage" />
            <PaymentApplePayMessage v-if="step.example.response" :label="`${step.title}: example response`" :value="step.example.response" language="json" />
          </section>
        </div>
      </details>
    </div>
  </li>
</template>
