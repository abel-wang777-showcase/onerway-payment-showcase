import type { ApplePayStep, PrepareApplePayResponse, PayApplePayResponse, ValidateApplePayResponse, DirectRecoveryResponse } from '#shared/payment/apple-pay'
import { isTerminalStatus } from '#shared/payment/sdk'
import { browserData } from '~/utils/browser.client'
import { applePayExamples, preparationEvidence, validationEvidence, authorizationEvidence, submissionEvidence, resultEvidence } from '~/utils/apple-pay-evidence'
import {
  APPLE_PAY_SESSION_VERSION,
  appleSessionConstructor,
  checkApplePay,
  createApplePayCompletion,
  loadApplePay,
  type AppleSession,
} from '~/utils/apple-pay.client'

function preparationMessage(error: unknown): string {
  const value = typeof error === 'object' && error !== null ? error as Record<string, unknown> : null
  const data = typeof value?.data === 'object' && value.data !== null ? value.data as Record<string, unknown> : null
  const code = data?.statusMessage ?? value?.statusMessage
  switch (code) {
    case 'APPLE_PAY_NOT_CONFIGURED':
      return 'Apple Pay merchant identity is not configured for this Sandbox demo. The demo operator must finish server setup before payment can begin.'
    case 'APPLE_PAY_UNAVAILABLE':
      return 'Apple Pay is not available for this merchant and order. The demo operator must check the enabled Sandbox payment methods.'
    case 'APPLE_PAY_CONFIGURATION_INVALID':
      return 'The Apple Pay country or card-network configuration could not be validated. The demo operator must check the Sandbox payment configuration.'
    case 'APPLE_PAY_NETWORK_ERROR':
      return 'The payment service is temporarily unavailable. Retry preparation shortly; your existing order is preserved.'
    default:
      return 'Apple Pay could not be prepared. Retry preparation or contact the demo operator; your existing order is preserved.'
  }
}

function initialSteps(): ApplePayStep[] {
  const definitions: ApplePayStep[] = [
    { id: 'prepare', title: 'Prepare this payment', actor: 'Merchant server → Onerway', input: 'The server-owned USD 5.00 order and DIRECT payment method context.', output: 'Eligible country and card networks, then browser capability detection.', failure: 'If configuration or device support is unavailable, no payment is submitted.', documentation: 'https://developers.onerway.com/zh/payments/api-reference/endpoints/list-available-payment-methods', state: 'waiting' },
    { id: 'begin', title: 'Open the Apple Pay sheet', actor: 'Customer → browser / Apple', input: 'A customer click and the prepared payment request.', output: 'ApplePaySession.begin() opens the sheet or supported payment code flow.', failure: 'Closing the sheet does not prove that an Onerway transaction was cancelled.', documentation: 'https://developer.apple.com/documentation/applepayontheweb/applepaysession/begin', state: 'waiting' },
    { id: 'validate', title: 'Let Apple verify this website', actor: 'Browser → merchant server → Apple', input: 'Apple’s validation URL; the server supplies the Merchant Identity certificate and registered domain.', output: 'A single-use merchant session completes merchant validation. Only a safe field summary is shown; session credentials are never shown or saved.', failure: 'A rejected URL, identity or session stops this sheet before authorization.', documentation: 'https://developer.apple.com/documentation/applepayontheweb/requesting-an-apple-pay-payment-session', state: 'waiting' },
    { id: 'authorize', title: 'Approve this payment in Wallet', actor: 'Customer → Apple → browser', input: 'A Sandbox Wallet card and customer approval.', output: 'Apple returns the full encrypted payment token, held only while forwarding it to the server.', failure: 'Wallet cancellation is a sheet outcome; it is not a payment failure. Ordinary Wallet cards are not this Sandbox test path.', documentation: 'https://developer.apple.com/documentation/applepayontheweb/applepaysession/onpaymentauthorized', state: 'waiting' },
    { id: 'submit', title: 'Send the payment to Onerway', actor: 'Merchant server → Onerway', input: 'One persisted merchant transaction ID and tokenInfo with provider ApplePay and the serialized full token.', output: 'Onerway decrypts the token and processes CARD / DIRECT / SALE. No token is retained.', failure: 'A network error or a nonterminal response leaves the result unconfirmed. The same transaction is never resubmitted.', documentation: 'https://developers.onerway.com/zh/payments/api-reference/endpoints/direct-create-transaction', state: 'waiting' },
    { id: 'result', title: 'Confirm the order result', actor: 'Onerway → merchant server → browser', input: 'This transaction’s status from its response, a matched query, or a verified Webhook.', output: 'S means paid, F means failed, N means cancelled. The order can recover after the sheet closes.', failure: 'After 25 seconds from authorization the sheet is closed as unsuccessful, while an unknown order stays pending. A late result can still confirm payment.', documentation: 'https://developers.onerway.com/zh/payments/api-reference/webhooks/payment-result', state: 'waiting' },
  ]
  return definitions.map(item => ({ ...item, example: applePayExamples[item.id] }))
}

export function useApplePay(orderId: string) {
  const session = shallowRef<DirectRecoveryResponse | null>(null)
  const prepared = shallowRef<PrepareApplePayResponse | null>(null)
  const steps = shallowRef(initialSteps())
  const loading = shallowRef(true)
  const checking = shallowRef(false)
  const eligible = shallowRef(false)
  const sheetOpen = shallowRef(false)
  const submitted = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const sheetMessage = shallowRef('Preparing Apple Pay…')
  let disposed = false
  let appleSession: AppleSession | null = null
  let completion: ReturnType<typeof createApplePayCompletion> | null = null
  let recoveryFlight: Promise<void> | null = null
  let preparing = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let polls = 0
  const stepStarted = new Map<string, number>()

  const canPay = computed(() => !loading.value && eligible.value && prepared.value?.canAuthorize === true && !sheetOpen.value && !submitted.value)
  const terminal = computed(() => session.value !== null && isTerminalStatus(session.value.attempt.status))

  function step(id: string, state: ApplePayStep['state'], evidence?: ApplePayStep['evidence']): void {
    if (state === 'active') stepStarted.set(id, performance.now())
    const started = stepStarted.get(id)
    steps.value = steps.value.map(item => item.id === id ? { ...item, state,
      ...(evidence ? { evidence: { ...evidence, occurredAt: evidence.occurredAt ?? new Date().toISOString(), ...(started !== undefined && state !== 'active' && evidence.source === 'live' ? { durationMs: Math.round(performance.now() - started) } : {}) } } : {}),
    } : item)
  }

  function accept(response: DirectRecoveryResponse, source: 'live' | 'stored' = 'stored'): void {
    if (disposed || response.order.id !== orderId || response.attempt.integration !== 'direct-api') return
    if (session.value && response.attempt.id !== session.value.attempt.id) return
    if (session.value) {
      const currentTime = Date.parse(session.value.attempt.updatedAt)
      const incomingTime = Date.parse(response.attempt.updatedAt)
      if (incomingTime < currentTime || (incomingTime === currentTime && session.value.attempt.statusSource === 'query' && response.attempt.statusSource !== 'query')) return
    }
    if (session.value && isTerminalStatus(session.value.attempt.status) && !isTerminalStatus(response.attempt.status)) return
    session.value = response
    if (response.submitted || isTerminalStatus(response.attempt.status)) submitted.value = true
    if (response.submitted || isTerminalStatus(response.attempt.status)) {
      step('result', response.verificationPending ? 'interrupted' : isTerminalStatus(response.attempt.status) ? 'completed' : 'active', resultEvidence(response, source))
      const submissionEvent = response.events.find(event => event.source === 'server' && event.rawStatus)
      if (source === 'stored' && submissionEvent) {
        const previous = steps.value.find(item => item.id === 'submit')
        if (!previous?.evidence) step('submit', 'completed', { ...submissionEvidence(response), source: 'stored', occurredAt: submissionEvent.occurredAt, summary: 'The saved server response confirms an earlier submission.', request: undefined })
      }
    }
    if (isTerminalStatus(response.attempt.status)) {
      clearTimeout(pollTimer)
      step('result', response.verificationPending ? 'interrupted' : 'completed')
      const ApplePay = appleSessionConstructor()
      if (completion && ApplePay && completion.finish(response.attempt.status === 'succeeded' ? ApplePay.STATUS_SUCCESS : ApplePay.STATUS_FAILURE)) {
        sheetOpen.value = false
        sheetMessage.value = response.attempt.status === 'succeeded' ? 'Apple Pay sheet completed.' : 'Apple Pay sheet closed without success.'
      }
    }
  }

  function scheduleRecovery(): void {
    if (disposed || terminal.value || polls >= 12) return
    clearTimeout(pollTimer)
    pollTimer = setTimeout(() => {
      polls++
      void verify().then(scheduleRecovery)
    }, 1250)
  }

  async function verify(): Promise<void> {
    if (recoveryFlight) return recoveryFlight
    checking.value = true
    recoveryFlight = (async () => {
      try {
        const response = await $fetch<DirectRecoveryResponse>('/api/payment/recover', { query: { orderId }, retry: 0 })
        accept(response)
        if (!disposed) error.value = response.verificationPending
          ? 'A fresh payment result is not available yet. The last stored order status is shown; keep this order and check again.'
          : null
      }
      catch {
        if (!disposed) error.value = terminal.value
          ? 'The latest check is unavailable. Your last confirmed order result is preserved.'
          : 'The result could not be confirmed yet. Keep this order and check again; do not pay twice.'
      }
      finally {
        checking.value = false
        recoveryFlight = null
      }
    })()
    return recoveryFlight
  }

  async function prepare(): Promise<void> {
    if (preparing || sheetOpen.value || submitted.value) return
    preparing = true
    loading.value = true
    error.value = null
    step('prepare', 'active')
    try {
      const response = await $fetch<PrepareApplePayResponse>('/api/payment/apple-pay/prepare', { method: 'POST', body: { orderId }, retry: 0 })
      if (disposed) return
      accept(response)
      if (!session.value) throw new Error('INVALID_ORDER')
      prepared.value = response
      submitted.value = response.submitted || !response.canAuthorize
      if (!response.canAuthorize) {
        step('prepare', 'completed', preparationEvidence(response))
        sheetMessage.value = 'Existing order restored. Earlier Apple sheet events are not replayed.'
        await verify()
        return
      }
      await loadApplePay()
      const available = await checkApplePay(response.merchantIdentifier)
      if (disposed) return
      eligible.value = available
      step('prepare', available ? 'completed' : 'interrupted', preparationEvidence(response, available))
      sheetMessage.value = available ? 'Ready for your Sandbox Wallet authorization.' : 'Apple Pay is unavailable in this browser or device configuration.'
    }
    catch (reason) {
      if (disposed) return
      eligible.value = false
      step('prepare', 'interrupted')
      await verify()
      if (disposed) return
      error.value = preparationMessage(reason)
    }
    finally { loading.value = false; preparing = false }
  }

  // Deliberately synchronous: begin() must remain in the customer's click event.
  function pay(): void {
    const ApplePay = appleSessionConstructor()
    const current = prepared.value
    if (!canPay.value || !ApplePay || !current) return
    error.value = null
    sheetOpen.value = true
    stepStarted.clear()
    steps.value = initialSteps().map(item => item.id === 'prepare' ? { ...item, state: 'completed', evidence: preparationEvidence(current, eligible.value) } : item)
    step('begin', 'active')
    try {
      const sheet = new ApplePay(APPLE_PAY_SESSION_VERSION, current.paymentRequest)
      appleSession = sheet
      const controller = createApplePayCompletion(sheet, () => {
        sheetOpen.value = false
        sheetMessage.value = 'Apple Pay timed out. Payment result is still being confirmed; do not pay again.'
        step('result', 'active')
        void verify().then(scheduleRecovery)
      })
      completion = controller
      sheet.onvalidatemerchant = async (event) => {
        step('validate', 'active', validationEvidence(event.validationURL, current.merchantIdentifier, window.location.hostname))
        try {
          const response = await $fetch<ValidateApplePayResponse>('/api/payment/apple-pay/validate', { method: 'POST', body: { orderId, attemptId: current.attempt.id, validationURL: event.validationURL }, retry: 0, timeout: 15_000 })
          if (disposed || !controller.active) return
          sheet.completeMerchantValidation(response.merchantSession)
          step('validate', 'completed', validationEvidence(event.validationURL, current.merchantIdentifier, window.location.hostname, response.merchantSession))
          step('authorize', 'active')
        }
        catch {
          if (disposed || !controller.active) return
          controller.cancel()
          try { sheet.abort() } catch { /* Already closed. */ }
          sheetOpen.value = false
          step('validate', 'interrupted', { ...validationEvidence(event.validationURL, current.merchantIdentifier, window.location.hostname), summary: 'Merchant validation stopped before payment authorization.' })
          error.value = 'Merchant validation failed. No payment token was submitted.'
        }
      }
      sheet.onpaymentauthorized = async (event) => {
        if (disposed || !controller.authorize(ApplePay.STATUS_FAILURE) || submitted.value) return
        if (!navigator.locks) {
          controller.finish(ApplePay.STATUS_FAILURE)
          sheetOpen.value = false
          step('submit', 'interrupted')
          error.value = 'This browser cannot safely coordinate payment requests. No payment was submitted; use a browser with Web Locks support.'
          return
        }
        submitted.value = true
        step('authorize', 'completed', authorizationEvidence(event.payment.token))
        step('submit', 'active', { summary: 'Waiting for exclusive access before sending this payment.', source: 'live', fields: [{ label: 'Submission', value: 'Not sent yet' }] })
        sheetMessage.value = 'Authorization received. Confirming this order with Onerway…'
        try {
          const response = await navigator.locks.request('onerway-payment-intent', { mode: 'exclusive' }, () => {
            // The original authorization budget includes lock contention. Never
            // submit an expired or cancelled sheet after another tab releases it.
            if (disposed || !controller.active) return null
            step('submit', 'active', submissionEvidence(current))
            return $fetch<PayApplePayResponse>('/api/payment/apple-pay/pay', {
              method: 'POST',
              body: { orderId, attemptId: current.attempt.id, token: event.payment.token, browser: browserData() },
              retry: 0,
              timeout: 30_000,
            })
          })
          if (disposed) return
          if (!response) {
            submitted.value = Boolean(session.value?.submitted)
            step('submit', 'interrupted')
            error.value = 'The Apple Pay sheet closed before this payment could be submitted. Its token was not sent.'
            return
          }
          step('submit', 'completed', { ...submissionEvidence(response, response.evidence?.request), summary: 'The merchant server returned a payment result.', response: resultEvidence(response, 'live').response })
          if (!terminal.value) step('result', 'active')
          accept(response, 'live')
        }
        catch {
          if (disposed || terminal.value) return
          step('submit', 'interrupted')
          step('result', 'active')
          error.value = 'The payment response was not confirmed. Check this order; its token will not be resubmitted.'
        }
        if (!disposed && !terminal.value) void verify().then(scheduleRecovery)
      }
      sheet.oncancel = () => {
        controller.cancel()
        sheetOpen.value = false
        sheetMessage.value = submitted.value ? 'Apple Pay closed. The order result still needs confirmation.' : 'Apple Pay closed before payment was submitted.'
        if (submitted.value) void verify().then(scheduleRecovery)
        else {
          for (const item of steps.value.filter(item => item.state === 'active')) {
            step(item.id, 'interrupted', { ...(item.evidence ?? { source: 'live' as const, fields: [] }), summary: 'The wallet was closed before payment authorization.' })
          }
        }
      }
      sheet.begin()
      step('begin', 'completed', { summary: 'The browser accepted the request to open Apple Pay.', source: 'live', fields: [{ label: 'Amount', value: `${current.paymentRequest.currencyCode} ${current.paymentRequest.total.amount}` }, { label: 'Display name', value: current.paymentRequest.total.label }], request: JSON.stringify(current.paymentRequest, null, 2) })
      sheetMessage.value = 'Continue in the Apple Pay sheet or on your supported Apple device.'
    }
    catch {
      completion?.cancel()
      sheetOpen.value = false
      step('begin', 'interrupted')
      error.value = 'Apple Pay could not open. Check this device’s Apple Pay settings.'
    }
  }

  onScopeDispose(() => {
    disposed = true
    clearTimeout(pollTimer)
    const active = completion?.active
    completion?.cancel()
    if (active) {
      try { appleSession?.abort() } catch { /* Already closed. */ }
    }
    if (appleSession) {
      appleSession.onpaymentauthorized = null
      appleSession.onvalidatemerchant = null
      appleSession.oncancel = null
    }
    appleSession = null
  })

  return { session: readonly(session), steps: readonly(steps), loading: readonly(loading), checking: readonly(checking), canPay, terminal, submitted: readonly(submitted), sheetOpen: readonly(sheetOpen), sheetMessage: readonly(sheetMessage), error: readonly(error), prepare, pay, verify }
}
