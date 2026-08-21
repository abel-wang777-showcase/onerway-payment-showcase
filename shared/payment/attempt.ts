import type {
  IntegrationId,
  PaymentMethodId,
  WalletPaymentMethodId,
} from './capability'
import type { PaymentEventSource } from './event'

export const PAYMENT_STATUSES = [
  'created',
  'requires_action',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
] as const
export type PaymentStatus = typeof PAYMENT_STATUSES[number]

export interface PaymentAttempt {
  readonly id: string
  readonly orderId: string
  readonly integration: IntegrationId
  readonly method: PaymentMethodId
  readonly status: PaymentStatus
  readonly statusSource?: PaymentEventSource
  readonly retryOf?: string
  readonly merchantTxnId?: string
  readonly paymentId?: string
  readonly transactionId?: string
  readonly actualWallet?: WalletPaymentMethodId
  readonly fundingNetwork?: string
  readonly attributionTransactionId?: string
  readonly submissionStartedAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateAttemptInput {
  readonly id: string
  readonly orderId: string
  readonly integration: IntegrationId
  readonly method: PaymentMethodId
  readonly retryOf?: string
  readonly merchantTxnId?: string
  readonly paymentId?: string
  readonly transactionId?: string
  readonly createdAt: string
}

export function createAttempt(input: CreateAttemptInput): PaymentAttempt {
  return Object.freeze({
    ...input,
    status: 'created',
    updatedAt: input.createdAt,
  })
}

export function setAttemptStatus(
  attempt: PaymentAttempt,
  status: PaymentStatus,
  updatedAt: string,
  statusSource?: PaymentEventSource,
): PaymentAttempt {
  return Object.freeze({
    ...attempt,
    status,
    ...(statusSource ? { statusSource } : {}),
    updatedAt,
  })
}

export function hasCompletePaymentMethodAttribution(attempt: PaymentAttempt): boolean {
  if (
    !attempt.transactionId
    || attempt.attributionTransactionId !== attempt.transactionId
  ) {
    return false
  }

  if (attempt.method === 'google-pay' || attempt.method === 'apple-pay') {
    return Boolean(attempt.actualWallet && attempt.fundingNetwork)
  }

  return Boolean(attempt.actualWallet || attempt.fundingNetwork)
}

export const RETRY_REASONS = [
  'eligible',
  'pending',
  'succeeded',
  'untrusted_terminal',
] as const
export type RetryReason = typeof RETRY_REASONS[number]

export interface RetryDecision {
  readonly allowed: boolean
  readonly reason: RetryReason
}

const trustedTerminalSources = new Set<PaymentEventSource>(['query', 'webhook'])

export function getRetryDecision(attempt: PaymentAttempt): RetryDecision {
  if (!['succeeded', 'failed', 'cancelled'].includes(attempt.status)) {
    return Object.freeze({ allowed: false, reason: 'pending' })
  }

  if (attempt.status === 'succeeded') {
    return Object.freeze({ allowed: false, reason: 'succeeded' })
  }

  if (!attempt.statusSource || !trustedTerminalSources.has(attempt.statusSource)) {
    return Object.freeze({ allowed: false, reason: 'untrusted_terminal' })
  }

  return Object.freeze({ allowed: true, reason: 'eligible' })
}
