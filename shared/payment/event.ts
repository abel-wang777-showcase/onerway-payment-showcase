import type { PaymentStatus } from './attempt'

export const PAYMENT_EVENT_SOURCES = [
  'simulation',
  'server',
  'client',
  'return',
  'query',
  'webhook',
] as const
export type PaymentEventSource = typeof PAYMENT_EVENT_SOURCES[number]

export interface PaymentEvent {
  readonly id: string
  readonly attemptId: string
  readonly source: PaymentEventSource
  readonly sourceKey?: string
  readonly status: PaymentStatus
  readonly rawStatus?: string
  readonly transactionId?: string
  readonly transactionStatus?: string
  readonly paymentStatus?: string
  readonly conflict?: boolean
  readonly occurredAt: string
}

export interface CreateEventInput {
  readonly id: string
  readonly attemptId: string
  readonly source: PaymentEventSource
  readonly sourceKey?: string
  readonly status: PaymentStatus
  readonly rawStatus?: string
  readonly transactionId?: string
  readonly transactionStatus?: string
  readonly paymentStatus?: string
  readonly conflict?: boolean
  readonly occurredAt: string
}

export function createEvent(input: CreateEventInput): PaymentEvent {
  return Object.freeze({ ...input })
}
