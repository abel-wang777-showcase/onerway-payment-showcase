import type { AuthorizationQueryTarget } from '../../shared/payment/authorization'
import { toPaymentAttemptSummary, type RecoverSdkPaymentResponse } from '../../shared/payment/sdk'
import { AuthorizationQueryConflictError, GatewayError, queryAuthorization } from './gateway'
import type { ServerProfile } from './profile'
import { getPaymentRecovery, PaymentStoreError, recordAuthorizationQueryConflict, recordAuthorizationQueryEvent, type PaymentRecovery } from './store'

/** Query only the original authorization or an already claimed funds operation. */
export async function refreshAuthorizationRecovery(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  recovery: PaymentRecovery,
): Promise<PaymentRecovery> {
  const authorization = recovery.attempt.authorization
  if (!authorization || (!authorization.conflict && ['captured', 'voided'].includes(authorization.fundsStatus))) {
    return recovery
  }

  const operation = authorization.operation
  const target: AuthorizationQueryTarget = {
    txnType: operation?.type ?? 'AUTH',
    merchantTxnId: operation?.merchantTxnId ?? authorization.authMerchantTxnId,
    paymentId: authorization.paymentId ?? recovery.attempt.paymentId,
    // A create response identifies a transaction, not a successful AUTH anchor.
    transactionId: operation ? operation.transactionId : authorization.authTransactionId,
  }

  let failure: unknown
  try {
    let fact: Awaited<ReturnType<typeof queryAuthorization>>
    try {
      fact = await queryAuthorization(profile, {
        ...target,
        amountMinor: authorization.amountMinor,
        currency: authorization.currency,
        ...(operation ? { originTransactionId: authorization.authTransactionId } : {}),
      })
    }
    catch (error) {
      if (!(error instanceof GatewayError)) throw error
      // Only a correlated current Payment that contradicts the saved AUTH
      // locks its actions. Network or unrecognised replies prove no change.
      if (error instanceof AuthorizationQueryConflictError) {
        await recordAuthorizationQueryConflict(recovery.attempt.id, error.target, new Date().toISOString())
      }
    }
    if (fact) {
      // This is observation time, never evidence of Provider success or expiry.
      const observedAt = new Date().toISOString()
      await recordAuthorizationQueryEvent(recovery.attempt.id, target, { ...fact, occurredAt: observedAt }, observedAt)
    }
  }
  catch (error) {
    // A rejected, unavailable, or unrecognised Provider reply cannot unlock or
    // replace the existing attempt. Never expose its raw response to the client.
    if (!(error instanceof PaymentStoreError && error.code === 'PAYMENT_ATTEMPT_MISMATCH')) failure = error
  }

  // A Webhook or another recovery may have committed while the query was in
  // flight, including when the Provider query failed or returned no result.
  const latest = await getPaymentRecovery(recovery.order.id, recovery.attempt.id)
  if (!latest) throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
  if (failure) throw failure
  return latest
}

/** Serialize only persisted, verified authorization facts. */
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
