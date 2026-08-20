import {
  createAttempt,
  PAYMENT_STATUSES,
  setAttemptStatus,
  type PaymentAttempt,
} from '../payment/attempt'
import {
  createSimulationEvent,
  type SimulationEvent,
} from './event'
import { createOrder, type Order } from '../payment/order'
import {
  DEMO_STAGES,
  reduceStage,
  type DemoStage,
} from '../payment/state'
import {
  getJourney,
  JOURNEY_IDS,
  type Journey,
  type JourneyId,
} from '../payment/journey'

export const SESSION_VERSION = 1 as const

const epoch = Date.parse('2026-07-28T14:32:00.000Z')

export interface DemoSession {
  readonly version: typeof SESSION_VERSION
  readonly journeyId: JourneyId
  readonly step: number
  readonly stage: DemoStage
  readonly order: Order
  readonly attempts: readonly PaymentAttempt[]
  readonly events: readonly SimulationEvent[]
}

export type SerializedDemoSession = string

function timestamp(sequence: number): string {
  return new Date(epoch + sequence * 1_000).toISOString()
}

function attemptId(orderId: string, sequence: number): string {
  return `${orderId}-attempt-${sequence}`
}

function eventId(attempt: PaymentAttempt, sequence: number): string {
  return `${attempt.id}-event-${sequence}`
}

function eventsFor(session: DemoSession, attempt: PaymentAttempt): SimulationEvent[] {
  return session.events.filter(event => event.attemptId === attempt.id)
}

function freezeSession(session: DemoSession): DemoSession {
  return Object.freeze({
    ...session,
    attempts: Object.freeze([...session.attempts]),
    events: Object.freeze([...session.events]),
  })
}

function createDemoOrder(journey: Journey): Order {
  const createdAt = timestamp(0)

  return createOrder({
    id: journey.orderId,
    scene: journey.scene,
    amount: {
      minor: journey.amount,
      currency: journey.currency,
    },
    item: {
      sku: journey.sku,
      name: journey.item,
      variant: journey.variant,
      quantity: 1,
      unitAmount: {
        minor: journey.amount,
        currency: journey.currency,
      },
    },
    createdAt,
  })
}

function createDemoAttempt(
  journey: Journey,
  sequence: number,
  createdAt: string,
  retryOf?: string,
): PaymentAttempt {
  return createAttempt({
    id: attemptId(journey.orderId, sequence),
    orderId: journey.orderId,
    integration: journey.integration,
    method: journey.method,
    ...(retryOf ? { retryOf } : {}),
    createdAt,
  })
}

function appendStage(
  session: DemoSession,
  attempt: PaymentAttempt,
  stage: DemoStage,
): DemoSession {
  const attemptEvents = eventsFor(session, attempt)
  const occurredAt = timestamp(session.events.length)
  const status = reduceStage(attempt.status, stage)
  const nextAttempt = setAttemptStatus(attempt, status, occurredAt)
  const event = createSimulationEvent({
    id: eventId(attempt, attemptEvents.length + 1),
    attemptId: attempt.id,
    stage,
    status,
    occurredAt,
  })

  return freezeSession({
    ...session,
    stage,
    attempts: session.attempts.map(item => item.id === attempt.id ? nextAttempt : item),
    events: [...session.events, event],
  })
}

export function createSession(journeyId: JourneyId): DemoSession {
  const journey = getJourney(journeyId)
  const order = createDemoOrder(journey)
  const attempt = createDemoAttempt(journey, 1, order.createdAt)
  const session = freezeSession({
    version: SESSION_VERSION,
    journeyId,
    step: 0,
    stage: readStage(journey, 0),
    order,
    attempts: [attempt],
    events: [],
  })

  return appendStage(session, attempt, readStage(journey, 0))
}

export function getActiveAttempt(session: DemoSession): PaymentAttempt {
  const attempt = session.attempts.at(-1)

  if (!attempt) {
    throw new Error('Demo session has no payment attempt')
  }

  return attempt
}

export function getCurrentStage(session: DemoSession): DemoStage {
  return session.stage
}

export function canAdvance(session: DemoSession): boolean {
  return session.step < getJourney(session.journeyId).stages.length - 1
}

export function advanceSession(session: DemoSession): DemoSession {
  if (!canAdvance(session)) {
    return session
  }

  const step = session.step + 1
  const stage = readStage(getJourney(session.journeyId), step)
  const next = appendStage(session, getActiveAttempt(session), stage)

  return freezeSession({
    ...next,
    step,
  })
}

export function retrySession(session: DemoSession): DemoSession {
  if (canAdvance(session)) {
    throw new Error('Cannot retry an unfinished payment attempt')
  }

  const journey = getJourney(session.journeyId)
  const previous = getActiveAttempt(session)
  const createdAt = timestamp(session.events.length)
  const attempt = createDemoAttempt(
    journey,
    session.attempts.length + 1,
    createdAt,
    previous.id,
  )
  const next = freezeSession({
    ...session,
    step: 0,
    stage: readStage(journey, 0),
    attempts: [...session.attempts, attempt],
  })

  return appendStage(next, attempt, readStage(journey, 0))
}

export function serializeSession(session: DemoSession): SerializedDemoSession {
  return JSON.stringify(session)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStage(journey: Journey, step: number): DemoStage {
  const stage = journey.stages[step]

  if (!stage) {
    throw new RangeError(`Journey ${journey.id} has no step ${step}`)
  }

  return stage
}

function isMember<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function readText(record: Record<string, unknown>, key: string): string {
  const value = record[key]

  if (typeof value !== 'string' || !value) {
    throw new TypeError(`Invalid session field: ${key}`)
  }

  return value
}

function restoreAttempt(value: unknown, order: Order): PaymentAttempt {
  if (!isRecord(value)) {
    throw new TypeError('Invalid payment attempt')
  }

  const status = value.status
  const integration = value.integration
  const method = value.method
  const retryOf = value.retryOf
  const transactionId = value.transactionId
  const merchantTxnId = value.merchantTxnId
  const paymentId = value.paymentId
  const statusSource = value.statusSource

  if (
    !isMember(PAYMENT_STATUSES, status)
    || !isMember(['web-js-sdk', 'checkout', 'direct-api'] as const, integration)
    || !isMember(['card', 'apm', 'google-pay', 'apple-pay'] as const, method)
    || (retryOf !== undefined && typeof retryOf !== 'string')
    || transactionId !== undefined
    || merchantTxnId !== undefined
    || paymentId !== undefined
    || statusSource !== undefined
  ) {
    throw new TypeError('Invalid payment attempt')
  }

  const attempt = createAttempt({
    id: readText(value, 'id'),
    orderId: readText(value, 'orderId'),
    integration,
    method,
    ...(retryOf ? { retryOf } : {}),
    createdAt: readText(value, 'createdAt'),
  })

  if (attempt.orderId !== order.id) {
    throw new TypeError('Payment attempt does not belong to the order')
  }

  return setAttemptStatus(attempt, status, readText(value, 'updatedAt'))
}

function restoreEvent(value: unknown): SimulationEvent {
  if (!isRecord(value)) {
    throw new TypeError('Invalid payment event')
  }

  const source = value.source
  const stage = value.stage
  const status = value.status

  if (
    source !== 'simulation'
    || !isMember(DEMO_STAGES, stage)
    || !isMember(PAYMENT_STATUSES, status)
  ) {
    throw new TypeError('Invalid payment event')
  }

  return createSimulationEvent({
    id: readText(value, 'id'),
    attemptId: readText(value, 'attemptId'),
    stage,
    status,
    occurredAt: readText(value, 'occurredAt'),
  })
}

function restoreOrder(value: unknown, journey: Journey): Order {
  if (!isRecord(value) || !isRecord(value.amount) || !isRecord(value.item)) {
    throw new TypeError('Invalid order')
  }

  const amount = value.amount
  const item = value.item
  const unitAmount = item.unitAmount

  if (
    !isRecord(unitAmount)
    || value.id !== journey.orderId
    || value.scene !== journey.scene
    || value.fulfillment !== 'pending'
    || amount.currency !== journey.currency
    || unitAmount.currency !== journey.currency
    || amount.minor !== journey.amount
    || unitAmount.minor !== journey.amount
    || item.sku !== journey.sku
    || item.name !== journey.item
    || item.variant !== journey.variant
    || item.quantity !== 1
    || value.createdAt !== timestamp(0)
  ) {
    throw new TypeError('Order does not match its journey')
  }

  const order = createOrder({
    id: readText(value, 'id'),
    scene: journey.scene,
    amount: {
      minor: journey.amount,
      currency: journey.currency,
    },
    item: {
      sku: readText(item, 'sku'),
      name: readText(item, 'name'),
      variant: readText(item, 'variant'),
      quantity: 1,
      unitAmount: {
        minor: journey.amount,
        currency: journey.currency,
      },
    },
    createdAt: readText(value, 'createdAt'),
  })

  return order
}

function validateHistory(session: DemoSession): void {
  const journey = getJourney(session.journeyId)

  if (
    !Number.isInteger(session.step)
    || session.step < 0
    || session.step >= journey.stages.length
    || session.stage !== readStage(journey, session.step)
  ) {
    throw new TypeError('Invalid session progress')
  }

  if (session.attempts.length < 1 || session.events.length < session.attempts.length) {
    throw new TypeError('Invalid session history')
  }

  const orderedEvents: SimulationEvent[] = []

  session.attempts.forEach((attempt, index) => {
    const expectedId = attemptId(session.order.id, index + 1)
    const previous = session.attempts[index - 1]
    const isActive = index === session.attempts.length - 1
    const expectedStages = isActive
      ? journey.stages.slice(0, session.step + 1)
      : journey.stages

    if (
      attempt.id !== expectedId
      || attempt.integration !== journey.integration
      || attempt.method !== journey.method
      || attempt.transactionId !== undefined
      || (index === 0 && attempt.retryOf !== undefined)
      || (index > 0 && attempt.retryOf !== previous?.id)
    ) {
      throw new TypeError('Invalid retry chain')
    }

    const events = eventsFor(session, attempt)
    const last = events.at(-1)

    if (
      events.length !== expectedStages.length
      || events.some((event, eventIndex) =>
        event.id !== eventId(attempt, eventIndex + 1)
        || event.stage !== expectedStages[eventIndex],
      )
      || attempt.createdAt !== events[0]?.occurredAt
    ) {
      throw new TypeError('Invalid attempt event history')
    }

    let status: PaymentAttempt['status'] = 'created'

    for (const event of events) {
      status = reduceStage(status, event.stage)

      if (event.source !== 'simulation' || event.status !== status) {
        throw new TypeError('Invalid attempt event history')
      }
    }

    if (!last || attempt.status !== last.status || attempt.updatedAt !== last.occurredAt) {
      throw new TypeError('Invalid attempt event history')
    }

    orderedEvents.push(...events)
  })

  if (
    orderedEvents.length !== session.events.length
    || orderedEvents.some((event, index) => event !== session.events[index])
    || session.events.some((event, index) => event.occurredAt !== timestamp(index))
  ) {
    throw new TypeError('Invalid event order')
  }

  const activeEvents = eventsFor(session, getActiveAttempt(session))
  const activeLast = activeEvents.at(-1)

  if (!activeLast || activeLast.stage !== session.stage) {
    throw new TypeError('Session stage does not match its active attempt')
  }
}

export function restoreSession(serialized: SerializedDemoSession): DemoSession {
  let value: unknown

  try {
    value = JSON.parse(serialized)
  }
  catch {
    throw new TypeError('Invalid serialized demo session')
  }

  if (!isRecord(value) || value.version !== SESSION_VERSION) {
    throw new TypeError('Unsupported demo session version')
  }

  const journeyId = value.journeyId

  if (!isMember(JOURNEY_IDS, journeyId)) {
    throw new TypeError('Unknown demo journey')
  }

  const journey = getJourney(journeyId)
  const order = restoreOrder(value.order, journey)
  const attempts = Array.isArray(value.attempts)
    ? value.attempts.map(item => restoreAttempt(item, order))
    : []
  const events = Array.isArray(value.events)
    ? value.events.map(restoreEvent)
    : []
  const stage = value.stage

  if (!isMember(DEMO_STAGES, stage) || typeof value.step !== 'number') {
    throw new TypeError('Invalid session progress')
  }

  const session = freezeSession({
    version: SESSION_VERSION,
    journeyId,
    step: value.step,
    stage,
    order,
    attempts,
    events,
  })

  validateHistory(session)
  return session
}
