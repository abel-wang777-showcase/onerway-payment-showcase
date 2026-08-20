import type { PaymentAttempt, PaymentStatus } from './attempt'
import { isTerminalStatus } from './sdk'
import type { PaymentEvent } from './event'

export interface AttemptMerge {
  readonly attempt: PaymentAttempt
  readonly conflict: boolean
}

const trustedTerminalSources = new Set<PaymentEvent['source']>(['query', 'webhook'])

function latest(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right
}

function transactionProjection(
  attempt: PaymentAttempt,
  transactionId: string | undefined,
): Pick<PaymentAttempt, 'transactionId' | 'actualWallet' | 'fundingNetwork' | 'attributionTransactionId'> {
  const nextTransactionId = transactionId ?? attempt.transactionId

  if (transactionId && transactionId !== attempt.transactionId) {
    return Object.freeze({
      transactionId,
      actualWallet: undefined,
      fundingNetwork: undefined,
      attributionTransactionId: undefined,
    })
  }

  return Object.freeze({
    transactionId: nextTransactionId,
    actualWallet: attempt.actualWallet,
    fundingNetwork: attempt.fundingNetwork,
    attributionTransactionId: attempt.attributionTransactionId,
  })
}

export function findProjectionEvent(
  attempt: PaymentAttempt,
  events: readonly PaymentEvent[],
): PaymentEvent | undefined {
  const source = attempt.statusSource

  if (!source) {
    return undefined
  }

  return [...events].reverse().find(event =>
    event.attemptId === attempt.id
    && event.source === source
    && event.status === attempt.status,
  )
}

export function mapWebhookStatus(
  transactionStatus: string,
  paymentStatus?: string,
): PaymentStatus {
  if (paymentStatus === 'S') {
    return 'succeeded'
  }

  if (paymentStatus === 'O') {
    return 'processing'
  }

  if (paymentStatus === 'N' || (paymentStatus === undefined && transactionStatus === 'N')) {
    return 'cancelled'
  }

  if (paymentStatus !== undefined || !['S', 'F'].includes(transactionStatus)) {
    throw new TypeError('PAYMENT_WEBHOOK_STATUS_UNKNOWN')
  }

  // A transaction can fail while the Payment remains open. Without a
  // Payment-level status, query must establish the terminal truth.
  return 'processing'
}

export function mergeAttempt(attempt: PaymentAttempt, event: PaymentEvent): AttemptMerge {
  if (isTerminalStatus(event.status) && !trustedTerminalSources.has(event.source)) {
    throw new TypeError('PAYMENT_EVENT_TERMINAL_UNTRUSTED')
  }

  const currentTerminal = isTerminalStatus(attempt.status)
  const incomingTerminal = isTerminalStatus(event.status)

  if (!currentTerminal) {
    if (
      (!incomingTerminal && attempt.statusSource === 'query' && event.source === 'webhook')
      || (event.source === 'server' && ['query', 'webhook'].includes(attempt.statusSource ?? ''))
    ) {
      return Object.freeze({ attempt, conflict: false })
    }

    return Object.freeze({
      attempt: Object.freeze({
        ...attempt,
        status: event.status,
        statusSource: event.source,
        ...transactionProjection(attempt, event.transactionId),
        updatedAt: latest(attempt.updatedAt, event.occurredAt),
      }),
      conflict: false,
    })
  }

  if (!incomingTerminal) {
    return Object.freeze({ attempt, conflict: false })
  }

  if (attempt.status === event.status) {
    if (attempt.statusSource === 'query' && event.source === 'webhook') {
      return Object.freeze({ attempt, conflict: false })
    }

    return Object.freeze({
      attempt: Object.freeze({
        ...attempt,
        statusSource: event.source === 'query' ? 'query' : attempt.statusSource,
        ...transactionProjection(attempt, event.transactionId),
        updatedAt: latest(attempt.updatedAt, event.occurredAt),
      }),
      conflict: false,
    })
  }

  // A fresh server query is the reconciliation authority for terminal
  // conflicts. Webhooks never overwrite a terminal query projection.
  if (event.source === 'query') {
    return Object.freeze({
      attempt: Object.freeze({
        ...attempt,
        status: event.status,
        statusSource: 'query',
        ...transactionProjection(attempt, event.transactionId),
        updatedAt: latest(attempt.updatedAt, event.occurredAt),
      }),
      conflict: true,
    })
  }

  return Object.freeze({ attempt, conflict: true })
}
