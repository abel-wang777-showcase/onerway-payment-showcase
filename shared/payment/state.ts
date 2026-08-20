import type { PaymentStatus } from './attempt'

export const DEMO_STAGES = [
  'loading',
  'ready',
  'submitting',
  'processing',
  'not_completed',
  'redirecting',
  'verifying',
  'failed',
  'cancelled',
  'succeeded',
] as const
export type DemoStage = typeof DEMO_STAGES[number]

export const STAGE_STATUS = Object.freeze({
  loading: 'created',
  ready: 'created',
  submitting: 'processing',
  processing: 'processing',
  not_completed: 'created',
  redirecting: 'requires_action',
  verifying: 'processing',
  failed: 'failed',
  cancelled: 'cancelled',
  succeeded: 'succeeded',
} satisfies Record<DemoStage, PaymentStatus>)

const transitions: Record<PaymentStatus, readonly DemoStage[]> = {
  created: ['loading', 'ready', 'submitting', 'not_completed'],
  requires_action: ['verifying'],
  processing: ['processing', 'redirecting', 'succeeded', 'failed', 'cancelled'],
  succeeded: ['succeeded'],
  failed: [],
  cancelled: [],
}

export function reduceStage(current: PaymentStatus, stage: DemoStage): PaymentStatus {
  if (!transitions[current].includes(stage)) {
    throw new Error(`Invalid payment transition: ${current} -> ${stage}`)
  }

  return STAGE_STATUS[stage]
}
