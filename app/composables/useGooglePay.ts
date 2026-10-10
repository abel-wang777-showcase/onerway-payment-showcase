import type { PaymentEvidence, PaymentStep } from '#shared/payment/protocol'
import { googlePaySteps, type GooglePayMode } from '~/utils/google-pay-flow'
import { googleAuthorizationEvidence, googleInterruptionEvidence, googlePreparationEvidence, googleReadinessEvidence, googleResultEvidence, googleSubmissionEvidence } from '~/utils/google-pay-evidence'
import type { DirectRecoveryResponse } from '#shared/payment/apple-pay'
import { readGooglePayToken, type PayGooglePayResponse, type PrepareGooglePayResponse } from '#shared/payment/google-pay'
import { isTerminalStatus } from '#shared/payment/sdk'
import { canDisplayGooglePayToken } from '~/utils/google-pay-token'
import { browserData } from '~/utils/browser.client'
import { googlePayRequests, loadGooglePay, type GooglePaymentsClient } from '~/utils/google-pay.client'

type Prepared = PrepareGooglePayResponse

export function useGooglePay(orderId: string, initial?: DirectRecoveryResponse) {
  const session = shallowRef<DirectRecoveryResponse | null>(null)
  const prepared = shallowRef<Prepared | null>(null)
  const mode = shallowRef<GooglePayMode>('automatic')
  const loading = shallowRef(false)
  const checking = shallowRef(false)
  const eligible = shallowRef(false)
  const sheetOpen = shallowRef(false)
  const submitted = shallowRef(false)
  const tokenDebug = shallowRef<string | null>(null)
  const submissionRequest = shallowRef<string | null>(null)
  const manualCaptured = shallowRef(false)
  const tokenDebugUnavailable = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const message = shallowRef('Preparing Google Pay…')
  const phase = shallowRef('prepare')
  const observations = shallowRef<Record<string, { state: PaymentStep['state'], evidence?: PaymentEvidence }>>({})
  const starts = new Map<string, number>()
  const steps = computed(() => googlePaySteps(mode.value).map(step => ({ ...step, ...observations.value[step.id] })))
  function recordStep(stepId: string, state: PaymentStep['state'], evidence?: PaymentEvidence) {
    const now = Date.now()
    if (state === 'active' && !starts.has(stepId)) starts.set(stepId, now)
    const started = starts.get(stepId)
    observations.value = { ...observations.value, [stepId]: { state, ...(evidence ? { evidence: { ...evidence, occurredAt: evidence.occurredAt ?? new Date(now).toISOString(), ...(started !== undefined ? { durationMs: Math.max(0, now - started) } : {}) } } : {}) } }
    if (state !== 'active') starts.delete(stepId)
  }
  function resetInteractionSteps() {
    observations.value = Object.fromEntries(Object.entries(observations.value).filter(([key]) => ['prepare', 'ready'].includes(key)))
    starts.clear()
  }
  function recordResult(value: DirectRecoveryResponse, source: PaymentEvidence['source']) {
    recordStep('result', value.verificationPending ? 'interrupted' : isTerminalStatus(value.attempt.status) ? 'completed' : 'active', googleResultEvidence(value, value.verificationPending ? 'stored' : source))
  }
  let client: GooglePaymentsClient | undefined
  let generation = 0
  let disposed = false
  let hidden = false
  let lockAbort: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let polls = 0
  const terminal = computed(() => !!session.value && isTerminalStatus(session.value.attempt.status))
  const canPay = computed(() => !disposed && !hidden && !loading.value && eligible.value && prepared.value?.canAuthorize === true && !sheetOpen.value && !submitted.value)
  const current = (id: number) => !disposed && !hidden && generation === id
  function clearToken() { tokenDebug.value = null; tokenDebugUnavailable.value = false }
  function invalidate() { generation++; submissionRequest.value = null; clearToken(); lockAbort?.abort(); clearTimeout(timer); sheetOpen.value = false }
  function setMode(value: GooglePayMode) {
    if (submitted.value || loading.value || sheetOpen.value || mode.value === value || !['automatic', 'manual'].includes(value)) return
    invalidate()
    manualCaptured.value = false
    mode.value = value
    resetInteractionSteps()
    phase.value = 'ready'
    message.value = value === 'manual' ? 'Authorize to capture a token. Showcase will not submit or track your external API call.' : 'A new Google Pay authorization will submit this order.'
  }
  function accept(value: DirectRecoveryResponse) {
    if (value.order.id !== orderId || value.attempt.method !== 'google-pay' || value.attempt.integration !== 'direct-api') throw new Error('ORDER_MISMATCH')
    if (session.value?.attempt.statusSource === 'query' && value.attempt.statusSource !== 'query' && value.attempt.updatedAt === session.value.attempt.updatedAt) return
    if (session.value && (value.attempt.id !== session.value.attempt.id || Date.parse(value.attempt.updatedAt) < Date.parse(session.value.attempt.updatedAt) || (terminal.value && !isTerminalStatus(value.attempt.status)))) return
    session.value = value
    submitted.value ||= value.submitted || isTerminalStatus(value.attempt.status)
    if (terminal.value) clearTimeout(timer)
  }
  async function verify() {
    if (disposed || hidden || checking.value || !submitted.value) return
    const id = generation
    checking.value = true
    recordStep('result', 'active', session.value ? googleResultEvidence(session.value, 'stored') : undefined)
    try {
      const response = await $fetch<DirectRecoveryResponse>('/api/payment/recover', { query: { orderId }, retry: 0 })
      if (!current(id)) return
      accept(response)
      if (session.value) recordResult(session.value, 'live')
      error.value = response.verificationPending ? 'A fresh result is unavailable. Keep this order and check again.' : null
    }
    catch { if (current(id)) { error.value = 'Payment is unconfirmed. Check this order; do not pay again.'; recordStep('result', 'interrupted', session.value ? { ...googleResultEvidence(session.value, 'stored'), summary: 'The fresh check failed. The saved order state is preserved.' } : googleInterruptionEvidence('The fresh check failed. No payment result is inferred.')) } }
    finally { checking.value = false }
  }
  function schedule() {
    if (disposed || hidden || terminal.value || !submitted.value || polls >= 12) return
    clearTimeout(timer)
    timer = setTimeout(() => { polls++; void verify().then(schedule) }, 1250)
  }
  async function prepare() {
    if (loading.value || submitted.value || disposed || hidden) return
    const id = ++generation
    loading.value = true
    eligible.value = false
    error.value = null
    recordStep('prepare', 'active')
    try {
      const response = await $fetch<Prepared>('/api/payment/google-pay/prepare', { method: 'POST', body: { orderId }, retry: 0 })
      if (!current(id)) return
      accept(response)
      prepared.value = response
      recordStep('prepare', 'completed', googlePreparationEvidence(response))
      if (!response.canAuthorize) { submitted.value = true; await verify(); schedule(); return }
      recordStep('ready', 'active')
      const loaded = await loadGooglePay()
      const ready = await loaded.isReadyToPay(googlePayRequests(response.config).ready)
      if (!current(id)) return
      client = loaded
      eligible.value = ready.result === true
      recordStep('ready', eligible.value ? 'completed' : 'interrupted', googleReadinessEvidence(eligible.value))
      phase.value = 'ready'
      message.value = eligible.value ? 'Ready for your Sandbox Google Pay authorization.' : 'Google Pay is unavailable for this browser or account.'
    }
    catch { if (current(id)) { error.value = 'Google Pay could not be prepared. Check Sandbox merchant configuration or retry preparation.'; const active = observations.value.ready?.state === 'active' ? 'ready' : 'prepare'; recordStep(active, 'interrupted', googleInterruptionEvidence('Preparation could not finish. No payment was submitted.')) } }
    finally { loading.value = false }
  }
  function createButton(): HTMLElement | undefined {
    return client?.createButton({ onClick: pay, buttonColor: 'black', buttonType: 'pay', buttonSizeMode: 'fill' })
  }
  // Keep the API call inside the customer's click, before any awaited work.
  function pay() {
    if (!canPay.value || !client || !prepared.value) return
    invalidate()
    resetInteractionSteps()
    const id = generation
    manualCaptured.value = false
    const selectedMode = mode.value
    const order = prepared.value
    sheetOpen.value = true
    error.value = null
    phase.value = 'authorize'
    message.value = 'Continue in Google Pay.'
    recordStep('authorize', 'active')
    try {
      const authorization = client.loadPaymentData(googlePayRequests(order.config).payment)
      // Extract only the token; never retain PaymentData in reactive state or diagnostics.
      void authorization.then(data => readGooglePayToken(data.paymentMethodData?.tokenizationData?.token)).then(async (token) => {
        if (!current(id)) return
        sheetOpen.value = false
        recordStep('authorize', 'completed', googleAuthorizationEvidence(token, selectedMode === 'manual'))
        tokenDebugUnavailable.value = !canDisplayGooglePayToken(token)
        tokenDebug.value = tokenDebugUnavailable.value ? null : token
        if (selectedMode === 'manual') {
          manualCaptured.value = tokenDebug.value !== null
          phase.value = manualCaptured.value ? 'captured' : 'ready'
          message.value = manualCaptured.value ? 'Token captured. No payment submitted. Check any separate Apifox transaction in Apifox.' : 'This token cannot be displayed safely. No payment was submitted; authorize again.'
          return
        }
        if (!navigator.locks) { error.value = 'This browser cannot coordinate payment requests. No payment was submitted.'; recordStep('submit', 'interrupted', googleInterruptionEvidence('Browser request coordination is unavailable. No payment was submitted.')); return }
        const abort = new AbortController()
        lockAbort = abort
        const expiresAt = Date.now() + 30000
        const lockTimer = setTimeout(() => abort.abort(), 30000)
        let sent = false
        sheetOpen.value = true
        phase.value = 'submit'
        recordStep('submit', 'active')
        try {
          const response = await navigator.locks.request('onerway-payment-intent', { mode: 'exclusive', signal: abort.signal }, () => {
            if (!current(id) || abort.signal.aborted || Date.now() > expiresAt) return null
            clearTimeout(lockTimer)
            sent = true
            submitted.value = true
            recordStep('submit', 'active', googleSubmissionEvidence(order))
            return $fetch<PayGooglePayResponse>('/api/payment/google-pay/pay', { method: 'POST', body: { orderId, attemptId: order.attempt.id, token, browser: browserData() }, retry: 0, timeout: 30000 })
          })
          if (!current(id)) return
          if (response) { accept(response); submissionRequest.value = response.evidence?.request ?? null; recordStep('submit', 'completed', googleSubmissionEvidence(response, response.evidence?.request)); if (session.value) recordResult(session.value, 'live'); phase.value = 'result'; message.value = 'The server returned this order’s payment result.' }
          else { error.value = 'The submission wait timed out before payment was sent. Start a new Google Pay authorization.'; recordStep('submit', 'interrupted', googleInterruptionEvidence('The request lock expired before submission. No payment was sent.')) }
        }
        catch { if (current(id)) { error.value = sent ? 'Submission result is unknown. This token will not be submitted again; check this order.' : 'The submission wait timed out before payment was sent. Authorize again.'; recordStep('submit', 'interrupted', googleInterruptionEvidence(sent ? 'The submission result is unknown. Recover this order without sending the token again.' : 'Submission did not start. A new authorization is required.')) } }
        finally { clearTimeout(lockTimer); if (current(id)) { sheetOpen.value = false; lockAbort = undefined } }
        if (current(id) && sent && !terminal.value) { await verify(); schedule() }
      }).catch(() => {
        if (!current(id)) return
        sheetOpen.value = false
        clearToken()
        recordStep('authorize', 'interrupted', googleInterruptionEvidence('Google Pay did not return a usable authorization token.'))
        recordStep('cancel', 'completed', googleInterruptionEvidence('The authorization ended without a submission. No Provider cancellation is inferred.'))
        message.value = 'Google Pay closed or authorization could not finish. No payment was submitted.'
        phase.value = 'ready'
      })
    }
    catch { sheetOpen.value = false; recordStep('authorize', 'interrupted', googleInterruptionEvidence('Google Pay could not open. No payment was submitted.')); message.value = 'Google Pay could not open. No payment was submitted.' }
  }
  async function initialize() {
    if (initial) accept(initial)
    if (submitted.value) {
      phase.value = 'result'
      message.value = 'Your existing order has been restored.'
      if (session.value) recordResult(session.value, 'stored')
      if (!terminal.value) { await verify(); schedule() }
      return
    }
    await prepare()
  }
  function leave() { hidden = true; manualCaptured.value = false; invalidate(); for (const [stepId, observation] of Object.entries(observations.value)) { if (observation.state === 'active') recordStep(stepId, 'interrupted', googleInterruptionEvidence('This browser operation was interrupted by leaving the page. Recover the original order if submission started.')) } }
  function restore(event: PageTransitionEvent) { if (event.persisted) { hidden = false; if (submitted.value) void verify().then(schedule); else void prepare() } }
  onMounted(() => { window.addEventListener('pagehide', leave); window.addEventListener('pageshow', restore) })
  onScopeDispose(() => { disposed = true; invalidate(); if (import.meta.client) { window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', restore) } })
  return { steps: readonly(steps), submissionRequest: readonly(submissionRequest), prepared: readonly(prepared), manualCaptured: readonly(manualCaptured), tokenDebugUnavailable: readonly(tokenDebugUnavailable), session: readonly(session), mode: readonly(mode), loading: readonly(loading), checking: readonly(checking), sheetOpen: readonly(sheetOpen), submitted: readonly(submitted), tokenDebug: readonly(tokenDebug), error: readonly(error), message: readonly(message), phase: readonly(phase), canPay, terminal, setMode, initialize, prepare, pay, verify, clearToken, createButton }
}
