import { createEvent } from '#shared/payment/event'
import type { JourneyId } from '#shared/payment/journey'
import type { PaymentMethodId } from '#shared/payment/capability'
import type { SubscriptionPlanId, SubscriptionSummary } from '#shared/payment/subscription'
import {
  getRetryDecision,
  setAttemptStatus,
  type PaymentAttempt,
} from '#shared/payment/attempt'
import {
  getPaymentFailure,
  type PaymentFailure,
  type PaymentFailureSource,
} from '#shared/payment/failure'
import {
  applyQueryResult,
  canAcceptSdkResult,
  isTerminalStatus,
  preserveTerminalStatus,
  readConfirmResult,
  readSdkResult,
  singleFlight,
  toPaymentAttemptSummary,
  type BrowserData,
  type ClaimPaymentSubmissionResponse,
  type CreatePaymentIntentResponse,
  type CreatePaymentRetryResponse,
  type CreateSdkPaymentResponse,
  type CreateSubscriptionIntentResponse,
  type CreateSubscriptionPaymentResponse,
  type QuerySdkPaymentResponse,
  type QuerySubscriptionPaymentResponse,
  type PaymentAttemptSummary,
  type RecoverRetainedSubscriptionResponse,
  type RecoverSdkPaymentResponse,
  type RecoverSubscriptionPaymentResponse,
  type SdkReasonType,
  type SdkResultFact,
  type SdkSession,
  type SdkStage,
} from '#shared/payment/sdk'

export type SdkRecoveryFailure = 'unauthorized' | 'retryable'
type SdkRecoveryResult = 'restored' | 'failed' | 'stale'

interface DeferredSdkResult {
  readonly attemptId: string
  readonly result: SdkResultFact | null
  readonly conflict: boolean
}

const PAYMENT_INTENT_LOCK = 'onerway-payment-intent'

function responseStatus(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const error = value as Record<string, unknown>
  const direct = error.statusCode ?? error.status

  if (typeof direct === 'number') {
    return direct
  }

  const response = error.response
  const nested = typeof response === 'object' && response !== null
    ? (response as Record<string, unknown>).status
    : null

  return typeof nested === 'number' ? nested : null
}

function browserData(): BrowserData {
  const javaEnabled = (() => {
    try {
      return typeof navigator.javaEnabled === 'function' && navigator.javaEnabled()
    }
    catch {
      return false
    }
  })()

  return Object.freeze({
    javaEnabled,
    colorDepth: String(screen.colorDepth),
    screenHeight: String(screen.height),
    screenWidth: String(screen.width),
    timeZoneOffset: String(new Date().getTimezoneOffset()),
    contentLength: String(document.documentElement.outerHTML.length),
    language: navigator.language || 'en-US',
  })
}

async function requestPaymentIntent(
  journeyId: JourneyId,
  method: PaymentMethodId,
  restart: boolean,
  ownsState: () => boolean,
): Promise<CreatePaymentIntentResponse | null> {
  if (!navigator.locks) {
    throw new TypeError('PAYMENT_INTENT_LOCK_UNAVAILABLE')
  }

  return navigator.locks.request(PAYMENT_INTENT_LOCK, { mode: 'exclusive' }, () => {
    if (!ownsState()) {
      return null
    }

    return $fetch<CreatePaymentIntentResponse>('/api/payment/intent', {
      method: 'POST',
      body: { journeyId, method, ...(restart ? { restart: true } : {}) },
    })
  })
}

async function requestSubscriptionIntent(
  planId: SubscriptionPlanId,
  newTestCustomer: boolean,
  ownsState: () => boolean,
): Promise<CreateSubscriptionIntentResponse | null> {
  if (!navigator.locks) {
    throw new TypeError('PAYMENT_INTENT_LOCK_UNAVAILABLE')
  }

  return navigator.locks.request(PAYMENT_INTENT_LOCK, { mode: 'exclusive' }, () => {
    if (!ownsState()) {
      return null
    }

    return $fetch<CreateSubscriptionIntentResponse>('/api/payment/subscription/intent', {
      method: 'POST',
      body: { planId, ...(newTestCustomer ? { newTestCustomer: true } : {}) },
    })
  })
}

function delay(duration: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, duration))
}

function replaceAttempt(
  attempts: readonly PaymentAttemptSummary[],
  next: PaymentAttempt,
): readonly PaymentAttemptSummary[] {
  const summary = toPaymentAttemptSummary(next)

  return attempts.some(attempt => attempt.id === next.id)
    ? attempts.map(attempt => attempt.id === next.id ? summary : attempt)
    : [...attempts, summary]
}

function assertSessionCorrelation(
  next: SdkSession,
  expectedOrderId?: string,
  retryParentId?: string,
): void {
  const active = next.attempts.filter(item => item.id === next.attempt.id)
  const summary = active[0]
  const parents = retryParentId === undefined
    ? []
    : next.attempts.filter(item => item.id === retryParentId)
  const parentFallback = retryParentId !== undefined
    && next.attempt.id === retryParentId
    && !getRetryDecision(next.attempt).allowed
  const directChild = retryParentId !== undefined
    && next.attempt.retryOf === retryParentId

  if (
    (expectedOrderId !== undefined && next.order.id !== expectedOrderId)
    || next.attempt.orderId !== next.order.id
    || next.attempt.paymentId !== next.paymentId
    || active.length !== 1
    || summary?.status !== next.attempt.status
    || summary?.retryOf !== next.attempt.retryOf
    || next.events.some(event => event.attemptId !== next.attempt.id)
    || (retryParentId !== undefined && parents.length !== 1)
    || (retryParentId !== undefined && !parentFallback && !directChild)
  ) {
    throw new TypeError('PAYMENT_SESSION_MISMATCH')
  }
}

function statuslessResultMessage(result: SdkResultFact): string {
  const labels: Readonly<Record<SdkReasonType, string>> = {
    canceled: 'Payment canceled',
    validation_error: 'Onerway validation error',
    sdk_error: 'Onerway SDK error',
    api_error: 'Onerway API error',
  }
  const label = result.reasonType ? labels[result.reasonType] : 'Onerway payment error'
  const code = result.reasonCode ? ` ${result.reasonCode}` : ''
  const detail = result.reasonMessage ? `: ${result.reasonMessage}` : ''
  const punctuation = /[.!?]$/.test(detail || code) ? '' : '.'
  const transactionUrlHint = result.reasonType === 'api_error' && result.reasonCode === '40000'
    ? ' Check the configured returnUrl and notifyUrl.'
    : ''

  return `${label}${code}${detail}${punctuation}${transactionUrlHint} This SDK diagnostic is not the final payment status. Verify the existing payment before starting another Sandbox test order.`
}

export function useSdk() {
  const session = useState<SdkSession | null>('sdk-session', () => null)
  const subscription = useState<SubscriptionSummary | null>('sdk-subscription', () => null)
  const retainedSubscriptionOrderId = useState<string | null>('sdk-retained-subscription-order', () => null)
  const retainedSubscriptionPaymentStatus = useState<PaymentAttempt['status'] | null>('sdk-retained-subscription-payment-status', () => null)
  const stage = useState<SdkStage>('sdk-stage', () => 'not_completed')
  const error = useState<string | null>('sdk-error', () => null)
  const failure = useState<PaymentFailure | null>('sdk-failure', () => null)
  const recoveryFailure = useState<SdkRecoveryFailure | null>('sdk-recovery-failure', () => null)
  const recoveryError = useState<string | null>('sdk-recovery-error', () => null)
  const resultAttempt = useState<string | null>('sdk-result-attempt', () => null)
  const submittedAttempt = useState<string | null>('sdk-submitted-attempt', () => null)
  const elementRevision = useState<number>('sdk-element-revision', () => 0)
  const retrying = useState<boolean>('sdk-retrying', () => false)
  const restoring = useState<boolean>('sdk-restoring', () => false)
  const ownerRevision = useState<number>('sdk-owner-revision', () => 0)
  const takeoverStage = stage.value
  const takeoverRetrying = retrying.value
  const takeoverRestoring = restoring.value
  const previousOwner = ownerRevision.value
  ownerRevision.value += 1
  const owner = ownerRevision.value
  const takingOver = previousOwner > 0
  retrying.value = false
  restoring.value = false
  let createFlight: Promise<void> | null = null
  let createAbort: AbortController | null = null
  let resultFlight: Promise<void> | null = null
  let deferredResult: DeferredSdkResult | null = null
  let queryFlight: Promise<void> | null = null
  let recoverFlight: Promise<SdkRecoveryResult> | null = null
  let resubmitAttempt: string | null = null
  let active = true
  const submitted = computed(() => {
    const current = session.value
    return current !== null && submittedAttempt.value === current.attempt.id
  })

  function ownsState(): boolean {
    return active && owner === ownerRevision.value
  }

  function clearFailure(): void {
    failure.value = null
    error.value = null
  }

  function setFailure(
    source: PaymentFailureSource,
    message?: string,
    status?: number | null,
  ): void {
    const signal = typeof status === 'number' ? { status } : {}
    failure.value = getPaymentFailure(source, signal)
    error.value = message ?? failure.value.description
  }

  function setNotice(message: string): void {
    failure.value = null
    error.value = message
  }

  if (takingOver && takeoverRetrying) {
    stage.value = 'not_completed'
    setFailure('retry', 'Payment retry moved to the current page. Restore this order before trying the retry request again.')
  }
  else if (takingOver && takeoverRestoring) {
    stage.value = 'not_completed'
    setFailure('recovery', 'Payment restoration moved to the current page. Retry restoration without creating a new payment.')
  }
  else if (takingOver && takeoverStage === 'creating') {
    stage.value = 'not_completed'
    setFailure('create', 'Checkout creation moved to the current page. Restore the existing payment before starting another order.')
  }
  else if (takingOver && ['submitting', 'awaiting_action', 'redirecting'].includes(takeoverStage)) {
    stage.value = 'not_completed'
    setFailure('confirm', 'Payment submission moved to the current page. Verify the existing payment before trying again.')
  }
  else if (takingOver && takeoverStage === 'verifying') {
    stage.value = 'not_completed'
    setFailure('query', 'Payment verification moved to the current page. Verify the existing payment again.')
  }

  onScopeDispose(() => {
    const owned = ownsState()
    active = false
    createAbort?.abort()
    deferredResult = null
    resubmitAttempt = null

    if (!owned) {
      return
    }

    restoring.value = false
    retrying.value = false

    if (stage.value === 'creating') {
      stage.value = 'not_completed'
      clearFailure()
      return
    }

    const current = session.value

    if (!current || isTerminalStatus(current.attempt.status)) {
      return
    }

    if (stage.value === 'submitting') {
      stage.value = 'not_completed'
      setFailure('confirm', 'Payment submission was paused. Verify the existing payment before trying again.')
    }
    else if (stage.value === 'verifying') {
      stage.value = 'not_completed'
      setFailure('query', 'Payment verification was paused. Verify the existing payment before trying again.')
    }
    else if (stage.value === 'awaiting_action') {
      stage.value = 'not_completed'
      setFailure('confirm', 'The payment action was paused. Verify the existing payment before trying again.')
    }
  })

  function write(next: SdkSession, expectedOrderId?: string, retryParentId?: string): void {
    assertSessionCorrelation(next, expectedOrderId, retryParentId)
    session.value = Object.freeze({
      ...next,
      attempts: Object.freeze([...next.attempts]),
      events: Object.freeze([...next.events]),
    })
  }

  function deferResult(attemptId: string, result: SdkResultFact | null): void {
    if (!deferredResult || deferredResult.attemptId !== attemptId) {
      deferredResult = { attemptId, result, conflict: false }
      return
    }

    deferredResult = { attemptId, result: null, conflict: true }
  }

  function takeDeferredResult(attemptId: string): DeferredSdkResult | null {
    const queued = deferredResult
    deferredResult = null

    return queued?.attemptId === attemptId ? queued : null
  }

  function append(event: SdkSession['events'][number], paymentMethod?: string, transactionId?: string): void {
    const current = session.value

    if (!current || event.attemptId !== current.attempt.id) {
      throw new Error('PAYMENT_EVENT_MISMATCH')
    }

    const nextStatus = preserveTerminalStatus(current.attempt.status, event.status)
    const attempt = isTerminalStatus(current.attempt.status)
      ? Object.freeze({
          ...current.attempt,
          ...(transactionId ? { transactionId } : {}),
        })
      : Object.freeze({
          ...setAttemptStatus(current.attempt, nextStatus, event.occurredAt),
          ...(transactionId ? { transactionId } : {}),
        })

    write({
      ...current,
      attempt,
      attempts: replaceAttempt(current.attempts, attempt),
      events: [...current.events, event],
      ...(paymentMethod ? { paymentMethod } : {}),
    })
  }

  async function openCreated(
    created: CreateSdkPaymentResponse,
    expectedOrderId: string,
    expectedAttemptId?: string,
    retryParentId?: string,
    contract?: SubscriptionSummary,
  ): Promise<void> {
    if (
      created.order.id !== expectedOrderId
      || (expectedAttemptId !== undefined && created.attempt.id !== expectedAttemptId)
    ) {
      throw new TypeError('PAYMENT_CREATE_RESULT_MISMATCH')
    }

    write({
      order: created.order,
      attempt: created.attempt,
      attempts: created.attempts,
      events: [created.event],
      paymentId: created.paymentId,
      query: created.query,
    }, expectedOrderId, retryParentId)
    resultAttempt.value = null
    submittedAttempt.value = null
    deferredResult = null
    stage.value = 'loading'
    clearFailure()
    subscription.value = contract ?? null
    retainedSubscriptionOrderId.value = null
    retainedSubscriptionPaymentStatus.value = null
    if (retryParentId !== undefined) {
      retrying.value = false
    }
    await navigateTo(`/halden/sdk/${created.order.id}`)
  }

  async function start(
    journeyId: JourneyId,
    restart = false,
    method: PaymentMethodId = 'card',
  ): Promise<void> {
    if (!ownsState()) {
      return
    }

    if (createFlight) {
      return createFlight
    }

    resubmitAttempt = null
    let controller: AbortController | null = null
    let orderId: string | null = null
    stage.value = 'creating'
    clearFailure()
    subscription.value = null
    createFlight = (async () => {
      try {
        const intent = await requestPaymentIntent(journeyId, method, restart, ownsState)

        if (!intent) {
          return
        }

        orderId = intent.orderId

        if (!ownsState()) {
          return
        }

        if (!intent.create) {
          const recovery = await navigateRecovered(intent.orderId)

          if (recovery !== 'failed') {
            return
          }

          throw new Error('PAYMENT_RECOVERY_PENDING')
        }

        controller = new AbortController()
        createAbort = controller
        const created = await $fetch<CreateSdkPaymentResponse>('/api/payment/create', {
          method: 'POST',
          body: browserData(),
          signal: controller.signal,
        })

        if (!ownsState()) {
          return
        }

        await openCreated(created, intent.orderId)
      }
      catch {
        if (!ownsState()) {
          return
        }

        if (orderId) {
          const recovery = await navigateRecovered(orderId)

          if (recovery !== 'failed') {
            return
          }
        }

        stage.value = 'not_completed'
        setFailure(
          'create',
          'Sandbox checkout could not be opened. If Onerway accepted a payment, this site will recover that attempt before creating another.',
        )
      }
      finally {
        if (controller && createAbort === controller) {
          createAbort = null
        }

        createFlight = null
      }
    })()

    return createFlight
  }

  async function startSubscription(
    planId: SubscriptionPlanId,
    newTestCustomer = false,
  ): Promise<void> {
    if (!ownsState() || createFlight) {
      return createFlight ?? undefined
    }

    let orderId: string | null = null
    stage.value = 'creating'
    clearFailure()
    createFlight = (async () => {
      try {
        const intent = await requestSubscriptionIntent(planId, newTestCustomer, ownsState)

        if (!intent || !ownsState()) {
          return
        }

        orderId = intent.orderId

        if (!intent.create) {
          const recovery = await navigateRecovered(intent.orderId)

          if (recovery !== 'failed') {
            return
          }

          throw new Error('PAYMENT_RECOVERY_PENDING')
        }

        const created = await $fetch<CreateSubscriptionPaymentResponse>('/api/payment/subscription/create', {
          method: 'POST',
          body: browserData(),
        })

        if (ownsState()) {
          await openCreated(created, intent.orderId, undefined, undefined, created.subscription)
        }
      }
      catch {
        if (!ownsState()) {
          return
        }

        if (orderId && await navigateRecovered(orderId) !== 'failed') {
          return
        }

        stage.value = 'not_completed'
        setFailure(
          'create',
          newTestCustomer
            ? 'The new Sandbox test customer could not be opened. Restore the cookie-bound subscription before starting another test customer.'
            : 'The Sandbox subscription could not be opened. Restore the existing subscription payment before trying again.',
        )
      }
      finally {
        createFlight = null
      }
    })()

    return createFlight
  }

  async function recoverOwned(
    orderId?: string,
    returned = false,
    retryParentId?: string,
  ): Promise<SdkRecoveryResult> {
    if (!ownsState()) {
      return 'stale'
    }

    if (recoverFlight) {
      return recoverFlight
    }

    resubmitAttempt = null
    restoring.value = true
    recoverFlight = (async () => {
      try {
        recoveryFailure.value = null
        recoveryError.value = null
        clearFailure()

        if (returned && orderId) {
          try {
            await $fetch('/api/payment/return', {
              method: 'POST',
              body: { orderId },
            })
          }
          catch {
            // The return event or query may already have been persisted. Recovery
            // remains the safe next step and never creates a new PaymentAttempt.
          }
        }

        const response = await $fetch<
          RecoverSdkPaymentResponse
          | RecoverSubscriptionPaymentResponse
          | RecoverRetainedSubscriptionResponse
        >('/api/payment/recover', {
          ...(orderId ? { query: { orderId } } : {}),
        })

        if (!ownsState()) {
          return 'stale'
        }

        if ('retained' in response) {
          session.value = null
          subscription.value = response.subscription
          retainedSubscriptionOrderId.value = response.orderId
          retainedSubscriptionPaymentStatus.value = response.paymentStatus
          resultAttempt.value = null
          submittedAttempt.value = null
          deferredResult = null
          stage.value = response.paymentStatus === 'succeeded' ? 'succeeded' : 'not_completed'
          clearFailure()
          return 'restored'
        }

        const { submitted: wasSubmitted, ...next } = response
        subscription.value = 'subscription' in response ? response.subscription : null
        retainedSubscriptionOrderId.value = null
        retainedSubscriptionPaymentStatus.value = null

        resultAttempt.value = null
        submittedAttempt.value = wasSubmitted ? next.attempt.id : null
        deferredResult = null
        write(next, orderId, retryParentId)
        stage.value = next.attempt.status === 'succeeded' ? 'succeeded' : 'not_completed'
        clearFailure()

        return 'restored'
      }
      catch (reason) {
        if (!ownsState()) {
          return 'stale'
        }

        const status = responseStatus(reason)
        recoveryFailure.value = status !== null && [400, 401, 403, 404].includes(status)
          ? 'unauthorized'
          : 'retryable'
        recoveryError.value = recoveryFailure.value === 'unauthorized'
          ? 'No authorized persisted payment attempt matched this browser return.'
          : 'The payment return could not be restored yet. Retry restoration without creating a new payment.'
        setFailure('recovery', recoveryError.value, status)
        return 'failed'
      }
      finally {
        if (owner === ownerRevision.value) {
          restoring.value = false
        }
        recoverFlight = null
      }
    })()

    return recoverFlight
  }

  async function recover(orderId?: string, returned = false): Promise<boolean> {
    return await recoverOwned(orderId, returned) === 'restored'
  }

  async function navigateRecovered(orderId?: string): Promise<SdkRecoveryResult> {
    const recovery = await recoverOwned(orderId)

    if (recovery !== 'restored') {
      return recovery
    }

    const restored = session.value

    if (!ownsState()) {
      return 'stale'
    }

    if (retainedSubscriptionOrderId.value) {
      await navigateTo(`/halden/result/${retainedSubscriptionOrderId.value}`)
      return 'restored'
    }

    if (!restored) {
      return 'failed'
    }

    await navigateTo(
      isTerminalStatus(restored.attempt.status)
        ? `/halden/result/${restored.order.id}`
        : `/halden/sdk/${restored.order.id}`,
    )
    return 'restored'
  }

  async function restore(): Promise<void> {
    if (!ownsState() || stage.value === 'creating') {
      return
    }

    stage.value = 'creating'

    const recovery = await navigateRecovered()

    if (recovery === 'failed' && ownsState()) {
      stage.value = 'not_completed'
    }
  }

  function loading(): void {
    if (ownsState() && session.value && stage.value !== 'succeeded') {
      stage.value = 'loading'
      clearFailure()
    }
  }

  function ready(): void {
    if (ownsState() && session.value && stage.value === 'loading') {
      stage.value = 'ready'
    }
  }

  function loadFailed(): void {
    const current = session.value

    if (
      !ownsState()
      || !current
      || stage.value !== 'loading'
      || submitted.value
      || Boolean(current.attempt.submissionStartedAt)
      || isTerminalStatus(current.attempt.status)
    ) {
      return
    }

    stage.value = 'not_completed'
    setFailure('load', 'The secure payment form could not load. No card details were sent to this site.')
  }

  function reloadElement(): void {
    const current = session.value

    if (
      !ownsState()
      || !current
      || submitted.value
      || failure.value?.action !== 'reload_element'
      || isTerminalStatus(current.attempt.status)
    ) {
      return
    }

    elementRevision.value += 1
    stage.value = 'loading'
    clearFailure()
  }

  async function restoreRetry(orderId: string, parentId: string): Promise<SdkRecoveryResult> {
    const recovery = await recoverOwned(orderId, false, parentId)

    if (recovery !== 'restored') {
      return recovery
    }

    const restored = session.value

    if (!ownsState()) {
      return 'stale'
    }

    if (!restored) {
      return 'failed'
    }

    retrying.value = false
    await navigateTo(
      isTerminalStatus(restored.attempt.status)
        ? `/halden/result/${restored.order.id}`
        : `/halden/sdk/${restored.order.id}`,
    )
    return 'restored'
  }

  const retry = singleFlight(async (): Promise<void> => {
    const current = session.value

    if (
      !ownsState()
      || !current
      || retrying.value
      || failure.value !== null
      || !getRetryDecision(current.attempt).allowed
      || !current.attempt.paymentId
      || subscription.value !== null
    ) {
      return
    }

    const parent = current.attempt
    retrying.value = true
    clearFailure()

    try {
      const response = await $fetch<CreatePaymentRetryResponse>('/api/payment/retry', {
        method: 'POST',
        body: {
          orderId: current.order.id,
          attemptId: parent.id,
          paymentId: current.paymentId,
        },
      })

      if (!ownsState()) {
        return
      }

      if (response.orderId !== current.order.id || response.attemptId === parent.id) {
        throw new Error('PAYMENT_RETRY_RESULT_MISMATCH')
      }

      if (response.create) {
        try {
          const created = await $fetch<CreateSdkPaymentResponse>('/api/payment/create', {
            method: 'POST',
            body: browserData(),
          })

          if (!ownsState()) {
            return
          }

          if (created.attempt.id !== response.attemptId || created.order.id !== response.orderId) {
            throw new Error('PAYMENT_RETRY_CREATE_MISMATCH')
          }

          await openCreated(created, response.orderId, response.attemptId, parent.id)
          return
        }
        catch {
          const recovery = await restoreRetry(current.order.id, parent.id)

          if (recovery !== 'failed') {
            return
          }

          if (ownsState()) {
            setFailure('retry', 'The retry payment creation result is unknown. Restore this order before trying the retry request again.')
          }
          return
        }
      }

      if (await restoreRetry(current.order.id, parent.id) === 'failed' && ownsState()) {
        setFailure('retry')
      }
    }
    catch {
      if (await restoreRetry(current.order.id, parent.id) === 'failed' && ownsState()) {
        setFailure('retry')
      }
    }
    finally {
      if (owner === ownerRevision.value) {
        retrying.value = false
      }
    }
  })

  async function verify(maxChecks = 12, navigate = true): Promise<void> {
    if (queryFlight) {
      return queryFlight
    }

    const started = session.value
    const terminalNeedsAttribution = Boolean(
      started
      && isTerminalStatus(started.attempt.status)
      && subscription.value === null
      && !started.attempt.attributionTransactionId,
    )

    if (
      !ownsState()
      || !started
      || (
        isTerminalStatus(started.attempt.status)
        && subscription.value === null
        && !terminalNeedsAttribution
      )
    ) {
      return
    }

    stage.value = 'verifying'
    clearFailure()
    queryFlight = (async () => {
      let refreshed = false

      try {
        for (let check = 0; check < maxChecks; check += 1) {
          const current = session.value

          if (!ownsState() || !current || current.attempt.id !== started.attempt.id) {
            return
          }

          let response: QuerySdkPaymentResponse | QuerySubscriptionPaymentResponse

          try {
            response = await $fetch<QuerySdkPaymentResponse | QuerySubscriptionPaymentResponse>('/api/payment/query', {
              method: 'POST',
              body: {
                attemptId: current.attempt.id,
                paymentId: current.paymentId,
                token: current.query.token,
                expiresAt: current.query.expiresAt,
              },
            })
          }
          catch (reason) {
            const status = responseStatus(reason)

            if (!ownsState()) {
              return
            }

            let recovery: SdkRecoveryResult | null = null

            if (!refreshed && status !== null && [401, 403].includes(status)) {
              recovery = await recoverOwned(started.order.id)

              if (recovery === 'stale') {
                return
              }
            }

            if (
              recovery === 'restored'
              && session.value?.attempt.id === started.attempt.id
            ) {
              refreshed = true
              stage.value = 'verifying'
              check -= 1
              continue
            }

            throw reason
          }

          if (!ownsState()) {
            return
          }

          if ('subscription' in response) {
            subscription.value = response.subscription
          }

          const projected = applyQueryResult(current, response)
          write(projected)

          if (isTerminalStatus(projected.attempt.status)) {
            stage.value = projected.attempt.status === 'succeeded' ? 'succeeded' : 'not_completed'
            clearFailure()

            if (ownsState() && navigate) {
              await navigateTo(`/halden/result/${current.order.id}`, { replace: true })
            }

            return
          }

          if (ownsState() && check < maxChecks - 1) {
            await delay(1_250)
          }
        }

        if (ownsState()) {
          stage.value = 'not_completed'
          setFailure('query', 'Payment confirmation is still pending. Verify the status again before retrying payment.')
        }
      }
      catch {
        if (ownsState()) {
          stage.value = 'not_completed'
          setFailure('query', 'The payment status could not be verified. No new payment was created.')
        }
      }
      finally {
        queryFlight = null
      }
    })()

    return queryFlight
  }

  async function probeRecovery(): Promise<boolean> {
    const result = await recoverOwned()

    if (result !== 'restored') {
      if (recoveryFailure.value === 'unauthorized') {
        recoveryFailure.value = null
        recoveryError.value = null
        clearFailure()
      }
      return false
    }

    if (subscription.value) {
      await verify(1, false)
    }

    return true
  }

  function applyResult(result: SdkResultFact, current: SdkSession): Promise<void> {
    if (
      !ownsState()
      || session.value?.attempt.id !== current.attempt.id
      || !canAcceptSdkResult(current.attempt, resultAttempt.value)
    ) {
      return Promise.resolve()
    }

    if (resultFlight) {
      return resultFlight
    }

    submittedAttempt.value = current.attempt.id
    resultAttempt.value = current.attempt.id

    const flight = (async () => {
      try {
        if (result.cancelled) {
          resubmitAttempt = current.attempt.id
          submittedAttempt.value = null
          stage.value = 'ready'
          setNotice('The payment step was closed. You can try again with this existing payment.')
          return
        }

        if (!result.rawStatus) {
          stage.value = 'not_completed'
          setFailure('confirm', statuslessResultMessage(result))
          return
        }

        const occurredAt = new Date().toISOString()
        append(createEvent({
          id: crypto.randomUUID(),
          attemptId: current.attempt.id,
          source: 'client',
          status: 'processing',
          ...(result.rawStatus ? { rawStatus: result.rawStatus } : {}),
          occurredAt,
        }), result.paymentMethod)

        if (result.rawStatus === 'O') {
          resubmitAttempt = current.attempt.id
          submittedAttempt.value = null
          stage.value = 'ready'
          setNotice('Onerway kept this payment open. Review the payment details and try again with the same payment.')
          return
        }

        await verify()
      }
      catch {
        if (ownsState()) {
          stage.value = 'not_completed'
          setFailure('confirm', 'The payment form returned an unrecognized result. Verify the payment before trying again.')
        }
      }
    })()
    resultFlight = flight

    return flight.finally(() => {
      if (resultFlight === flight) {
        resultFlight = null
      }
    })
  }

  function acceptResult(value: unknown): Promise<void> {
    if (!ownsState()) {
      return Promise.resolve()
    }

    const current = session.value

    if (!current || isTerminalStatus(current.attempt.status)) {
      return Promise.resolve()
    }

    const merchantSubmitting = stage.value === 'submitting'
      && submittedAttempt.value === current.attempt.id

    let result: SdkResultFact

    try {
      result = readSdkResult(value, current.paymentId)
    }
    catch {
      if (merchantSubmitting) {
        deferResult(current.attempt.id, null)
      }
      else if (
        (stage.value === 'ready' && submittedAttempt.value !== current.attempt.id)
        || (stage.value === 'awaiting_action' && submittedAttempt.value === current.attempt.id)
      ) {
        stage.value = 'not_completed'
        setFailure('confirm', 'The payment form returned an unrecognized result. Verify the payment before trying again.')
      }
      return Promise.resolve()
    }

    if (merchantSubmitting) {
      deferResult(current.attempt.id, result)
      return Promise.resolve()
    }

    const sdkOwnedResult = stage.value === 'ready'
      && submittedAttempt.value !== current.attempt.id
    const presenterResult = stage.value === 'awaiting_action'
      && submittedAttempt.value === current.attempt.id

    if (!sdkOwnedResult && !presenterResult) {
      return Promise.resolve()
    }

    return applyResult(result, current)
  }

  const submit = singleFlight(async (confirm: () => Promise<unknown>): Promise<void> => {
    let current = session.value

    if (!ownsState() || stage.value !== 'ready' || !current || isTerminalStatus(current.attempt.status)) {
      return
    }

    resultAttempt.value = null
    deferredResult = null

    const needsClaim = !current.attempt.submissionStartedAt

    if (!needsClaim && resubmitAttempt !== current.attempt.id) {
      submittedAttempt.value = current.attempt.id
      stage.value = 'not_completed'
      setFailure('confirm', 'This payment was already submitted. Verify the existing payment before trying again.')
      return
    }

    submittedAttempt.value = current.attempt.id
    stage.value = 'submitting'
    clearFailure()
    try {
      if (needsClaim) {
        const claimed = await $fetch<ClaimPaymentSubmissionResponse>('/api/payment/submit', {
          method: 'POST',
          body: {
            orderId: current.order.id,
            attemptId: current.attempt.id,
            paymentId: current.paymentId,
          },
        })

        if (
          !ownsState()
          || session.value?.attempt.id !== current.attempt.id
          || claimed.attempt.id !== current.attempt.id
          || claimed.attempt.orderId !== current.order.id
          || claimed.attempt.paymentId !== current.paymentId
          || !claimed.attempt.submissionStartedAt
          || !claimed.claimed
        ) {
          throw new Error('PAYMENT_SUBMISSION_CLAIM_MISMATCH')
        }

        write({
          ...current,
          attempt: claimed.attempt,
          attempts: replaceAttempt(current.attempts, claimed.attempt),
        })
        current = session.value!
      }
      else {
        resubmitAttempt = null
      }

      const result = await confirm()

      if (!ownsState() || session.value?.attempt.id !== current.attempt.id) {
        return
      }

      const confirmed = readConfirmResult(result, current.paymentId)
      const queued = takeDeferredResult(current.attempt.id)

      if (confirmed.rawStatus === 'R') {
        append(createEvent({
          id: crypto.randomUUID(),
          attemptId: current.attempt.id,
          source: 'client',
          status: 'requires_action',
          rawStatus: 'R',
          occurredAt: new Date().toISOString(),
        }), confirmed.paymentMethod)
        if (confirmed.nextAction === 'RedirectShopper') {
          stage.value = 'redirecting'
        }
        else if (confirmed.nextAction === 'PresentToShopper') {
          stage.value = 'awaiting_action'

          if (queued) {
            if (queued.conflict || !queued.result) {
              stage.value = 'not_completed'
              setFailure('confirm', 'The payment action returned conflicting or unrecognized results. Verify the existing payment before continuing.')
            }
            else {
              await applyResult(queued.result, current)
            }
          }
        }
        else {
          stage.value = 'not_completed'
          setFailure('confirm', 'Onerway requires another payment step but did not provide a browser action. Verify this payment or start a separate Sandbox test order.')
        }
        return
      }

      await applyResult(confirmed, current)
    }
    catch {
      deferredResult = null

      if (!ownsState() || session.value?.attempt.id !== current.attempt.id) {
        return
      }

      stage.value = 'not_completed'
      setFailure('confirm', 'The payment submission result is unknown. Verify this payment before trying again.')
    }
  })

  return {
    session: readonly(session),
    subscription: readonly(subscription),
    retainedSubscriptionOrderId: readonly(retainedSubscriptionOrderId),
    retainedSubscriptionPaymentStatus: readonly(retainedSubscriptionPaymentStatus),
    stage: readonly(stage),
    error: readonly(error),
    failure: readonly(failure),
    recoveryFailure: readonly(recoveryFailure),
    recoveryError: readonly(recoveryError),
    submitted: readonly(submitted),
    elementRevision: readonly(elementRevision),
    retrying: readonly(retrying),
    restoring: readonly(restoring),
    start,
    startSubscription,
    restore,
    recover,
    loading,
    ready,
    loadFailed,
    reloadElement,
    submit,
    acceptResult,
    verify,
    probeRecovery,
    retry,
  }
}
