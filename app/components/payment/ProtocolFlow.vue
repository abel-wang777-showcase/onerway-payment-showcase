<script setup lang="ts">
import type { PaymentStep, ProtocolActor, ProtocolFlow, ProtocolEdge } from '#shared/payment/protocol'

const props = defineProps<{ wallet: 'apple-pay' | 'google-pay', title: string, actors: readonly ProtocolActor[], flows: readonly ProtocolFlow[], steps: readonly PaymentStep[] }>()
const flowNav = useTemplateRef<HTMLElement>('flowNav')
const manualFlowId = shallowRef<string | null>(null)
const openCode = reactive({ client: false, server: false })
const actorById = computed(() => new Map(props.actors.map(actor => [actor.id, actor])))
const protocolFlows = computed(() => props.flows.filter(flow => flow.id !== 'cancel'))
const cancellationFlows = computed(() => props.flows.filter(flow => flow.id === 'cancel'))
const flowIds = computed(() => new Set(props.flows.map(flow => flow.id)))

const liveFlowId = computed<string>(() => {
  const active = [...props.steps].reverse().find(step => step.state === 'active')
  const latest = active ?? [...props.steps].reverse().find(step => step.evidence || step.state === 'interrupted')
  return latest && flowIds.value.has(latest.id) ? latest.id : (props.flows[0]?.id ?? '')
})
const selectedFlowId = computed(() => manualFlowId.value ?? liveFlowId.value)
const selectedFlow = computed(() => props.flows.find(flow => flow.id === selectedFlowId.value) ?? props.flows[0])
const involvedActors = computed(() => new Set(selectedFlow.value?.edges.flatMap(edge => [edge.from, edge.to]) ?? []))

watch(selectedFlowId, () => {
  openCode.client = false
  openCode.server = false
})

function actorLabel(id: string): string {
  return actorById.value.get(id)?.label ?? id
}

function actorPosition(id: string): number {
  const index = props.actors.findIndex(actor => actor.id === id)
  return (index + 0.5) * 100 / props.actors.length
}

function edgePosition(edge: ProtocolEdge): string {
  const from = actorPosition(edge.from)
  const to = actorPosition(edge.to)
  return `--flow-from: ${from}%; --flow-to: ${to}%; --flow-left: ${Math.min(from, to)}%; --flow-width: ${Math.abs(to - from)}%`
}

function selectFlow(id: string): void {
  manualFlowId.value = id
}

async function followLive(): Promise<void> {
  manualFlowId.value = null
  await nextTick()
  flowNav.value?.querySelector<HTMLElement>(`[data-flow-step="${liveFlowId.value}"]`)?.focus()
}
</script>

<template>
  <section v-if="selectedFlow" :data-apple-pay-flow="wallet === 'apple-pay' ? '' : undefined" :data-google-pay-flow="wallet === 'google-pay' ? '' : undefined" :aria-labelledby="`${wallet}-flow-title`" class="mt-8 min-w-0 rounded-lg border border-default bg-elevated p-3 sm:p-5">
    <div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h3 :id="`${wallet}-flow-title`" class="text-base font-semibold tracking-tight text-highlighted">{{ title }}</h3>
        <p class="mt-1 max-w-prose text-xs leading-relaxed text-toned">Choose a stage to see who sends what. Recorded payment evidence remains in the timeline below.</p>
      </div>
      <UButton
        v-if="manualFlowId"
        data-flow-follow
        label="Follow live events"
        icon="i-lucide-radio"
        color="neutral"
        variant="soft"
        size="sm"
        class="min-h-11 shrink-0 touch-manipulation"
        @click="followLive"
      />
    </div>

    <nav ref="flowNav" :aria-label="`${wallet === 'apple-pay' ? 'Apple Pay' : 'Google Pay'} protocol stages`" class="mt-5 min-w-0">
      <div class="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" :class="protocolFlows.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-6'">
        <button
          v-for="(flow, index) in protocolFlows"
          :key="flow.id"
          type="button"
          :data-flow-step="flow.id"
          :aria-pressed="selectedFlow.id === flow.id"
          class="min-h-11 min-w-0 rounded-md border px-3 py-2 text-start text-xs font-medium leading-snug transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary touch-manipulation"
          :class="selectedFlow.id === flow.id ? 'border-primary bg-accented text-highlighted' : 'border-default bg-default text-toned hover:text-highlighted'"
          @click="selectFlow(flow.id)"
        >
          <span class="me-1 font-mono text-muted" aria-hidden="true">{{ index + 1 }}</span>
          {{ flow.title }}
        </button>
      </div>
      <div v-if="cancellationFlows.length" class="mt-2 border-t border-dashed border-default pt-2">
        <button
          v-for="flow in cancellationFlows"
          :key="flow.id"
          type="button"
          :data-flow-step="flow.id"
          :aria-pressed="selectedFlow.id === flow.id"
          class="min-h-11 w-full rounded-md border px-3 py-2 text-start text-xs font-medium leading-snug transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary touch-manipulation sm:w-auto"
          :class="selectedFlow.id === flow.id ? 'border-primary bg-accented text-highlighted' : 'border-default bg-default text-toned hover:text-highlighted'"
          @click="selectFlow(flow.id)"
        >
          <UIcon name="i-lucide-git-branch" class="me-1 size-4 align-text-bottom" aria-hidden="true" />
          {{ flow.title }}
        </button>
      </div>
    </nav>

    <div
      :data-flow-panel="selectedFlow.id"
      class="mt-5 min-w-0 border-t border-default pt-5"
      role="region"
      :aria-labelledby="`${wallet}-flow-${selectedFlow.id}-title`"
    >
      <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs font-medium text-primary">{{ manualFlowId ? 'Browsing protocol' : 'Following live events' }}</p>
          <h4 :id="`${wallet}-flow-${selectedFlow.id}-title`" class="mt-1 text-pretty text-base font-semibold text-highlighted">{{ selectedFlow.title }}</h4>
        </div>
        <p class="max-w-prose text-xs leading-relaxed text-toned">{{ selectedFlow.trigger }}</p>
      </div>

      <div class="mt-4 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-0" aria-label="Protocol participants">
        <div
          v-for="actor in actors"
          :key="actor.id"
          :data-flow-actor="actor.id"
          class="min-w-0 rounded-md border p-2.5 lg:mx-1"
          :class="involvedActors.has(actor.id) ? 'border-primary bg-accented' : 'border-default bg-default'"
        >
          <div class="flex min-w-0 items-center gap-2">
            <UIcon :name="actor.icon" class="size-4 shrink-0 text-toned" aria-hidden="true" />
            <span class="min-w-0 text-pretty text-xs font-medium text-highlighted">{{ actor.label }}</span>
          </div>
          <span v-if="actor.merchant" class="mt-1 block text-[0.6875rem] font-medium text-primary">Merchant</span>
        </div>
      </div>

      <div class="mt-4 min-w-0 space-y-2 lg:hidden" role="list" aria-label="Selected stage data flow">
        <div
          v-for="(edge, index) in selectedFlow.edges"
          :key="`${edge.from}-${edge.to}-${index}`"
          data-flow-edge
          :data-flow-edge-index="selectedFlow.id === 'result' ? undefined : index + 1"
          role="listitem"
          class="apple-pay-flow-edge min-w-0 rounded-md border border-default bg-default p-3"
        >
          <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <span class="min-w-0 text-pretty text-xs font-medium text-highlighted"><span v-if="selectedFlow.id !== 'result'" class="me-1 font-mono text-muted">{{ index + 1 }}</span>{{ actorLabel(edge.from) }}</span>
            <UIcon name="i-lucide-arrow-right" class="apple-pay-flow-arrow size-4 shrink-0 text-primary" aria-hidden="true" />
            <span class="min-w-0 text-pretty text-end text-xs font-medium text-highlighted">{{ actorLabel(edge.to) }}</span>
          </div>
          <p class="mt-2 text-pretty text-sm font-medium text-highlighted">{{ edge.label }}</p>
          <p v-if="edge.detail" class="mt-1 text-pretty text-xs leading-relaxed text-toned">{{ edge.detail }}</p>
        </div>
      </div>

      <div class="relative mt-4 hidden min-w-0 overflow-hidden rounded-md border border-default bg-default px-2 py-3 lg:block" role="list" :aria-label="selectedFlow.id === 'result' ? 'Independent result paths across five participants' : 'Selected stage sequence across five participants'">
        <div class="pointer-events-none absolute inset-x-2 inset-y-3 grid grid-cols-5" aria-hidden="true">
          <span v-for="actor in actors" :key="actor.id" class="relative">
            <span class="absolute inset-y-0 start-1/2 border-s border-dashed border-default" />
          </span>
        </div>
        <div
          v-for="(edge, index) in selectedFlow.edges"
          :key="`${edge.from}-${edge.to}-${index}`"
          data-flow-lane-edge
          :data-flow-edge-index="selectedFlow.id === 'result' ? undefined : index + 1"
          :data-direction="actorPosition(edge.from) < actorPosition(edge.to) ? 'forward' : 'reverse'"
          :style="edgePosition(edge)"
          class="apple-pay-flow-lane-row relative min-h-20 min-w-0"
          role="listitem"
        >
          <div class="relative z-10 mx-auto w-fit max-w-[80%] rounded-sm bg-default px-2 text-center">
            <p class="text-pretty text-xs font-medium text-highlighted"><span v-if="selectedFlow.id !== 'result'" class="me-1 font-mono text-muted">{{ index + 1 }}</span>{{ edge.label }}</p>
            <p class="mt-0.5 text-[0.6875rem] text-toned">{{ actorLabel(edge.from) }} → {{ actorLabel(edge.to) }}</p>
          </div>
          <span class="apple-pay-flow-lane-origin" aria-hidden="true" />
          <span class="apple-pay-flow-lane-line" aria-hidden="true" />
          <p v-if="edge.detail" class="absolute inset-x-0 bottom-1 z-10 mx-auto w-fit max-w-[80%] rounded-sm bg-default px-2 text-center text-[0.6875rem] text-toned">{{ edge.detail }}</p>
        </div>
      </div>

      <div class="mt-4 grid min-w-0 gap-3 md:grid-cols-2" aria-label="Merchant responsibilities">
        <section class="min-w-0 rounded-md border border-default bg-default p-3" data-flow-responsibility="client">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-monitor-smartphone" class="size-4 text-toned" aria-hidden="true" />
            <h5 class="text-sm font-semibold text-highlighted">Merchant client</h5>
          </div>
          <p class="mt-2 text-pretty text-xs leading-relaxed text-toned">{{ selectedFlow.client }}</p>
          <template v-if="selectedFlow.clientCode">
            <button
              type="button"
              data-flow-code="client"
              :aria-expanded="openCode.client"
              class="mt-3 inline-flex min-h-11 items-center gap-2 rounded-sm text-xs font-medium text-toned hover:text-highlighted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary touch-manipulation"
              @click="openCode.client = !openCode.client"
            >
              Client example
              <UIcon name="i-lucide-chevron-down" class="size-4" :class="{ 'rotate-180': openCode.client }" aria-hidden="true" />
            </button>
            <PaymentMessage v-if="openCode.client" data-flow-code-panel="client" class="mt-2" :label="`${selectedFlow.title}: client example`" :value="selectedFlow.clientCode" language="js" />
          </template>
        </section>
        <section class="min-w-0 rounded-md border border-default bg-default p-3" data-flow-responsibility="server">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-server" class="size-4 text-toned" aria-hidden="true" />
            <h5 class="text-sm font-semibold text-highlighted">Merchant server</h5>
          </div>
          <p class="mt-2 text-pretty text-xs leading-relaxed text-toned">{{ selectedFlow.server }}</p>
          <template v-if="selectedFlow.serverCode">
            <button
              type="button"
              data-flow-code="server"
              :aria-expanded="openCode.server"
              class="mt-3 inline-flex min-h-11 items-center gap-2 rounded-sm text-xs font-medium text-toned hover:text-highlighted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary touch-manipulation"
              @click="openCode.server = !openCode.server"
            >
              Server example
              <UIcon name="i-lucide-chevron-down" class="size-4" :class="{ 'rotate-180': openCode.server }" aria-hidden="true" />
            </button>
            <PaymentMessage v-if="openCode.server" data-flow-code-panel="server" class="mt-2" :label="`${selectedFlow.title}: server example`" :value="selectedFlow.serverCode" language="js" />
          </template>
        </section>
      </div>

      <p class="mt-3 text-pretty text-xs leading-relaxed text-toned"><UIcon name="i-lucide-info" class="me-1 size-3.5 align-text-bottom" aria-hidden="true" />{{ selectedFlow.note }}</p>
    </div>
  </section>
</template>
