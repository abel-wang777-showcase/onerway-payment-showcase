import { toPaymentAttemptSummary, type RecoverSdkPaymentResponse } from '../../shared/payment/sdk'
import type { PaymentRecovery } from './store'

/** AUTH restores persisted, verified facts until its query contract is confirmed. */
export function toAuthorizationRecovery(recovery: PaymentRecovery): RecoverSdkPaymentResponse {
  return Object.freeze({
    order: recovery.order,
    attempt: recovery.attempt,
    attempts: Object.freeze(recovery.attempts.map(toPaymentAttemptSummary)),
    events: recovery.events,
    paymentId: recovery.attempt.paymentId ?? null,
    query: null,
    submitted: recovery.events.some(item =>
      item.source === 'server' && item.sourceKey === `create-claim:${recovery.attempt.id}`,
    ),
  })
}
