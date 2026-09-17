import type { SubscriptionContract } from '../../shared/payment/subscription'
import { querySubscription, type QueriedPayment } from './gateway'
import type { ServerProfile } from './profile'
import {
  getSubscriptionForAttempt,
  PaymentStoreError,
  recordSubscriptionQueryDetails,
  subscriptionCreationRecoveryAllowedKey,
  subscriptionCreationRejectionKey,
  type PaymentRecovery,
} from './store'

export function subscriptionCreationRecoveryError(
  recovery: PaymentRecovery,
): 'SUBSCRIPTION_CREATE_CONTRACT_REJECTED' | 'SUBSCRIPTION_CREATE_RECOVERY_NOT_ALLOWED' | null {
  if (!recovery.subscription) return null

  const hasFact = (sourceKey: string) => recovery.events.some(event =>
    event.source === 'server' && event.sourceKey === sourceKey,
  )
  if (hasFact(subscriptionCreationRejectionKey(recovery.attempt.id))) {
    return 'SUBSCRIPTION_CREATE_CONTRACT_REJECTED'
  }
  if (recovery.attempt.paymentId) return null
  return hasFact(subscriptionCreationRecoveryAllowedKey(recovery.attempt.id))
    ? null
    : 'SUBSCRIPTION_CREATE_RECOVERY_NOT_ALLOWED'
}

// Transaction query may discover the contract, but never establishes its state.
// Only the independently correlated contract query can update the lifecycle.
export async function refreshSubscription(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  contract: SubscriptionContract,
  payment: QueriedPayment,
  observedAt: string,
): Promise<SubscriptionContract> {
  const discovered = contract.initialIntegration === 'checkout' ? payment.subscription : undefined
  if (
    (contract.contractId && discovered && contract.contractId !== discovered.contractId)
    || (contract.tokenId && discovered?.tokenId && contract.tokenId !== discovered.tokenId)
  ) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }

  const contractId = contract.contractId ?? discovered?.contractId
  if (!contractId) {
    const current = await getSubscriptionForAttempt(contract.initialAttemptId)
    if (!current) throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    return current
  }

  const details = await querySubscription(profile, contractId)
  if (
    (discovered?.tokenId && details.state !== 'terminal' && discovered.tokenId !== details.tokenId)
    || (discovered?.tokenId && details.tokenId && discovered.tokenId !== details.tokenId)
    || (details.state === 'active' && !details.tokenId && !contract.tokenId)
  ) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }
  return recordSubscriptionQueryDetails(contract.initialAttemptId, details, observedAt)
}
