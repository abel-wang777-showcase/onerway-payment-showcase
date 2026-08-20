import type { PaymentStatus } from '../payment/attempt'
import { createEvent, type PaymentEvent } from '../payment/event'
import type { DemoStage } from '../payment/state'

export interface SimulationEvent extends PaymentEvent {
  readonly source: 'simulation'
  readonly stage: DemoStage
}

export interface CreateSimulationEventInput {
  readonly id: string
  readonly attemptId: string
  readonly stage: DemoStage
  readonly status: PaymentStatus
  readonly occurredAt: string
}

export function createSimulationEvent(
  input: CreateSimulationEventInput,
): SimulationEvent {
  const event = createEvent({
    id: input.id,
    attemptId: input.attemptId,
    source: 'simulation',
    status: input.status,
    occurredAt: input.occurredAt,
  })

  return Object.freeze({
    ...event,
    source: 'simulation',
    stage: input.stage,
  })
}
