import type { PaymentAttempt, PaymentStatus } from './attempt'
import type { PaymentEvent } from './event'
import type { JourneyId } from './journey'
import type { PaymentMethodId } from './capability'
import type { Order } from './order'
import type { SubscriptionPlanId, SubscriptionSummary } from './subscription'

export const SDK_STAGES = [
  'creating',
  'loading',
  'ready',
  'submitting',
  'awaiting_action',
  'redirecting',
  'verifying',
  'not_completed',
  'succeeded',
] as const
export type SdkStage = typeof SDK_STAGES[number]

export const SDK_NEXT_ACTIONS = [
  'PresentToShopper',
  'RedirectShopper',
] as const
export type SdkNextAction = typeof SDK_NEXT_ACTIONS[number]

export const SDK_REASON_TYPES = [
  'canceled',
  'validation_error',
  'sdk_error',
  'api_error',
] as const
export type SdkReasonType = typeof SDK_REASON_TYPES[number]

export interface BrowserData {
  readonly javaEnabled: boolean
  readonly colorDepth: string
  readonly screenHeight: string
  readonly screenWidth: string
  readonly timeZoneOffset: string
  readonly contentLength: string
  readonly language: string
}

export interface QueryRef {
  readonly token: string
  readonly expiresAt: string
}

export interface SdkElementKey {
  readonly paymentId: string
  readonly generation: number
}

export function isCurrentSdkElementEvent(
  event: SdkElementKey,
  current: SdkElementKey | null,
): boolean {
  return current !== null
    && event.paymentId === current.paymentId
    && event.generation === current.generation
}

export interface PaymentAttemptSummary {
  readonly id: string
  readonly status: PaymentStatus
  readonly retryOf?: string
}

export function toPaymentAttemptSummary(attempt: PaymentAttempt): PaymentAttemptSummary {
  return Object.freeze({
    id: attempt.id,
    status: attempt.status,
    ...(attempt.retryOf ? { retryOf: attempt.retryOf } : {}),
  })
}

export interface CreateSdkPaymentResponse {
  readonly order: Order
  readonly attempt: PaymentAttempt
  readonly attempts: readonly PaymentAttemptSummary[]
  readonly event: PaymentEvent
  readonly paymentId: string
  readonly query: QueryRef
}

export interface CreatePaymentIntentResponse {
  readonly orderId: string
  readonly create: boolean
}

export interface CreatePaymentIntentInput {
  readonly journeyId: JourneyId
  readonly method?: PaymentMethodId
  readonly restart?: true
}

export interface ClaimPaymentSubmissionResponse {
  readonly attempt: PaymentAttempt
  readonly claimed: boolean
}

export interface PaymentAttemptInput {
  readonly orderId: string
  readonly attemptId: string
  readonly paymentId: string
}

export interface CreatePaymentRetryResponse {
  readonly orderId: string
  readonly attemptId: string
  readonly create: boolean
  readonly reused: boolean
}

export interface ObservePaymentReturnResponse {
  readonly duplicate: boolean
}

export interface QuerySdkPaymentResponse {
  readonly attempt: PaymentAttempt
  readonly event: PaymentEvent
}

export interface SdkSession {
  readonly order: Order
  readonly attempt: PaymentAttempt
  readonly attempts: readonly PaymentAttemptSummary[]
  readonly events: readonly PaymentEvent[]
  readonly paymentId: string
  readonly query: QueryRef
  readonly paymentMethod?: string
}

export interface RecoverSdkPaymentResponse extends SdkSession {
  readonly submitted: boolean
}

export interface CreateSubscriptionIntentInput {
  readonly planId: SubscriptionPlanId
  readonly newTestCustomer?: true
}

export interface CreateSubscriptionIntentResponse {
  readonly orderId: string
  readonly create: boolean
  readonly existing: boolean
}

export interface CreateSubscriptionPaymentResponse extends CreateSdkPaymentResponse {
  readonly subscription: SubscriptionSummary
}

export interface SubscriptionSession extends SdkSession {
  readonly subscription: SubscriptionSummary
}

export interface RecoverSubscriptionPaymentResponse extends SubscriptionSession {
  readonly submitted: boolean
}

export interface RecoverRetainedSubscriptionResponse {
  readonly retained: true
  readonly orderId: string
  readonly paymentStatus: PaymentStatus
  readonly subscription: SubscriptionSummary
}

export interface QuerySubscriptionPaymentResponse extends QuerySdkPaymentResponse {
  readonly subscription: SubscriptionSummary
}

export interface SdkResultFact {
  readonly paymentId: string
  readonly paymentMethod?: string
  readonly rawStatus?: string
  readonly reasonType?: SdkReasonType
  readonly reasonCode?: string
  readonly reasonMessage?: string
  readonly cancelled: boolean
}

export interface ConfirmSdkResultFact extends SdkResultFact {
  readonly nextAction?: SdkNextAction
}

const clientStatuses = ['P', 'A', 'O', 'S', 'N'] as const
type ClientStatus = typeof clientStatuses[number]

const MAX_REASON_MESSAGE_LENGTH = 240
const reasonCodePattern = /^[A-Z0-9][A-Z0-9._-]{0,63}$/i
const reasonEmailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const reasonAbsoluteUrlPattern = /\bhttps?:\/\/[^\s<>"']+/giu
const reasonDomainUrlPattern = /\b(?:[A-Z0-9-]+\.)+[A-Z]{2,}(?::\d{2,5})?(?:\/[^\s<>"']*)?/giu
const reasonRelativeUrlPattern = /(^|[\s("'=:])\/[^\s<>"']+/gu
const reasonQueryPattern = /\?[^\s<>"']+/gu
const reasonSensitiveRootPattern = /(auth|bearer|token|secret|credential|signature|password|nonce|(?:cv[cvn]|cid|csc)\d?|pan|capability|api[_\s-]?key|card[_\s-]?number|security[_\s-]?code|return[_\s-]?url|notify[_\s-]?url)/iu
const reasonNumberPattern = /(^|[^\d])((?:\d[ -]?){11,18}\d)(?!\d)/g
const reasonShortNumberPattern = /(^|[^\d])(\d{3,4})(?!\d)/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readReasonCode(value: unknown): string | undefined {
  const code = readOptionalText(value)?.trim()
  return code && reasonCodePattern.test(code) && !reasonSensitiveRootPattern.test(code)
    ? code
    : undefined
}

function readReasonMessage(value: unknown): string | undefined {
  const message = readOptionalText(value)

  if (!message) {
    return undefined
  }

  const normalized = message
    .normalize('NFKC')
    .replace(/\p{C}+/gu, '')

  if (reasonSensitiveRootPattern.test(normalized)) {
    return '[redacted-sensitive-details]'
  }

  const sanitized = normalized
    .replace(reasonEmailPattern, '[redacted-email]')
    .replace(reasonAbsoluteUrlPattern, '[redacted-url]')
    .replace(reasonDomainUrlPattern, '[redacted-url]')
    .replace(reasonRelativeUrlPattern, '$1[redacted-url]')
    .replace(reasonQueryPattern, '[redacted-query]')
    .replace(reasonNumberPattern, '$1[redacted-number]')
    .replace(reasonShortNumberPattern, '$1[redacted-number]')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!sanitized) {
    return undefined
  }

  return sanitized.length <= MAX_REASON_MESSAGE_LENGTH
    ? sanitized
    : `${sanitized.slice(0, MAX_REASON_MESSAGE_LENGTH - 1).trimEnd()}…`
}

export function readSdkResult(value: unknown, expectedPaymentId: string): SdkResultFact {
  if (!isRecord(value) || value.paymentId !== expectedPaymentId) {
    throw new TypeError('SDK_RESULT_INVALID')
  }

  const rawStatus = readOptionalText(value.paymentStatus)

  if (rawStatus !== undefined && !clientStatuses.includes(rawStatus as ClientStatus)) {
    throw new TypeError('SDK_RESULT_STATUS_UNKNOWN')
  }

  const reason = isRecord(value.reason) ? value.reason : null
  const rawResult = isRecord(value.rawResult) ? value.rawResult : null
  const reasonType = rawStatus === undefined ? readOptionalText(reason?.type) : undefined

  if (reasonType !== undefined && !SDK_REASON_TYPES.includes(reasonType as SdkReasonType)) {
    throw new TypeError('SDK_RESULT_REASON_UNKNOWN')
  }

  const diagnosticAllowed = rawStatus === undefined && reasonType !== 'canceled'
  const reasonCode = diagnosticAllowed
    ? readReasonCode(reason?.code) ?? readReasonCode(rawResult?.respCode)
    : undefined
  const reasonMessage = diagnosticAllowed
    ? readReasonMessage(reason?.message) ?? readReasonMessage(rawResult?.respMsg)
    : undefined

  if (
    rawStatus === undefined
    && reasonType === undefined
    && reasonCode === undefined
    && reasonMessage === undefined
  ) {
    throw new TypeError('SDK_RESULT_STATUS_MISSING')
  }

  return Object.freeze({
    paymentId: expectedPaymentId,
    ...(readOptionalText(value.paymentMethod)
      ? { paymentMethod: readOptionalText(value.paymentMethod) }
      : {}),
    ...(rawStatus ? { rawStatus } : {}),
    ...(reasonType ? { reasonType: reasonType as SdkReasonType } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(reasonMessage ? { reasonMessage } : {}),
    cancelled: reasonType === 'canceled',
  })
}

export function readConfirmResult(value: unknown, expectedPaymentId: string): ConfirmSdkResultFact {
  if (!isRecord(value) || value.paymentId !== expectedPaymentId) {
    throw new TypeError('SDK_CONFIRM_RESULT_INVALID')
  }

  if (value.paymentStatus !== 'R') {
    return readSdkResult(value, expectedPaymentId)
  }

  const action = value.nextAction
  const type = isRecord(action) ? readOptionalText(action.type) : undefined

  if (action != null && (!type || !SDK_NEXT_ACTIONS.includes(type as SdkNextAction))) {
    throw new TypeError('SDK_NEXT_ACTION_UNKNOWN')
  }

  return Object.freeze({
    paymentId: expectedPaymentId,
    ...(readOptionalText(value.paymentMethod)
      ? { paymentMethod: readOptionalText(value.paymentMethod) }
      : {}),
    rawStatus: 'R',
    cancelled: false,
    ...(type ? { nextAction: type as SdkNextAction } : {}),
  })
}

export function mapQueryStatus(rawStatus: string): PaymentStatus {
  const statuses: Readonly<Record<string, PaymentStatus>> = {
    S: 'succeeded',
    P: 'processing',
    U: 'processing',
    I: 'processing',
    A: 'processing',
    O: 'processing',
    R: 'requires_action',
    N: 'cancelled',
  }
  const status = statuses[rawStatus]

  if (!status) {
    throw new TypeError('PAYMENT_STATUS_UNKNOWN')
  }

  return status
}

export function isTerminalStatus(status: PaymentStatus): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(status)
}

export function canVerifySdkPayment(
  stage: SdkStage,
  submitted: boolean,
  status: PaymentStatus,
): boolean {
  return stage === 'not_completed'
    && !isTerminalStatus(status)
    && (submitted || ['processing', 'requires_action'].includes(status))
}

export function preserveTerminalStatus(current: PaymentStatus, next: PaymentStatus): PaymentStatus {
  return isTerminalStatus(current) ? current : next
}

export function applyQueryResult(
  session: SdkSession,
  response: QuerySdkPaymentResponse,
): SdkSession {
  if (
    response.attempt.id !== session.attempt.id
    || response.attempt.orderId !== session.order.id
    || response.attempt.paymentId !== session.paymentId
    || response.event.attemptId !== session.attempt.id
  ) {
    throw new TypeError('PAYMENT_QUERY_RESULT_MISMATCH')
  }

  return Object.freeze({
    ...session,
    attempt: Object.freeze({ ...response.attempt }),
    attempts: Object.freeze(session.attempts.map(attempt =>
      attempt.id === response.attempt.id
        ? toPaymentAttemptSummary(response.attempt)
        : attempt,
    )),
    events: Object.freeze([...session.events, response.event]),
  })
}

export function canAcceptSdkResult(attempt: PaymentAttempt, handledAttemptId: string | null): boolean {
  return handledAttemptId !== attempt.id && !isTerminalStatus(attempt.status)
}

export function singleFlight<Args extends readonly unknown[], Result>(
  task: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  let active: Promise<Result> | null = null

  return (...args) => {
    if (!active) {
      active = task(...args).finally(() => {
        active = null
      })
    }

    return active
  }
}
