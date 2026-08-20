import type { ServerProfile } from './profile'
import type { PaymentAttempt } from '../../shared/payment/attempt'
import {
  GatewayError,
  queryPaymentMethod,
  type QueriedPaymentMethod,
} from './gateway'
import { PaymentStoreError, recordPaymentMethodDetails } from './store'

export async function findDirectPaymentMethod(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  paymentId: string,
  transactionId: string,
): Promise<QueriedPaymentMethod | null> {
  try {
    return await queryPaymentMethod(profile, paymentId, transactionId)
  }
  catch (error) {
    if (error instanceof GatewayError) {
      return null
    }

    throw error
  }
}

export async function enrichDirectPaymentMethod(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  attempt: PaymentAttempt,
  queriedTransactionId: string,
  occurredAt: string,
): Promise<PaymentAttempt> {
  if (
    !attempt.paymentId
    || !attempt.transactionId
    || attempt.transactionId !== queriedTransactionId
    || (
      attempt.attributionTransactionId === attempt.transactionId
      && Boolean(attempt.actualWallet || attempt.fundingNetwork)
    )
  ) {
    return attempt
  }

  const details = await findDirectPaymentMethod(
    profile,
    attempt.paymentId,
    queriedTransactionId,
  )

  if (!details) {
    return attempt
  }

  try {
    return await recordPaymentMethodDetails(attempt.id, attempt.paymentId, details, occurredAt)
  }
  catch (error) {
    if (error instanceof PaymentStoreError) {
      return attempt
    }

    throw error
  }
}
