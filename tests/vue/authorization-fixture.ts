import type { AuthorizationState } from '../../shared/payment/authorization'
import type { RecoverSdkPaymentResponse } from '../../shared/payment/sdk'

export function authorizationSession(overrides: Partial<AuthorizationState> = {}): RecoverSdkPaymentResponse {
  const createdAt = '2026-09-18T00:00:00.000Z'
  const authorization: AuthorizationState = {
    fundsStatus: 'authorized',
    authMerchantTxnId: 'merchant-auth-1',
    authTransactionId: 'transaction-auth-1',
    paymentId: 'payment-auth-1',
    amountMinor: 500,
    currency: 'USD',
    updatedAt: createdAt,
    ...overrides,
  }
  const status = authorization.fundsStatus === 'captured' ? 'succeeded' as const
    : authorization.fundsStatus === 'voided' ? 'cancelled' as const : 'processing' as const
  const attempt = {
    id: 'attempt-auth-1', orderId: 'order-auth-1', integration: 'checkout' as const,
    method: 'card' as const, status, statusSource: authorization.fundsStatus === 'pending' ? 'server' as const : 'webhook' as const,
    merchantTxnId: 'merchant-auth-1',
    ...(authorization.paymentId ? { paymentId: authorization.paymentId } : {}),
    authorization, createdAt, updatedAt: createdAt,
  }
  return {
    order: {
      id: attempt.orderId, scene: 'ecommerce',
      item: { sku: 'HL-AUTH-005', name: 'Halden reservation', variant: 'Card pre-authorization', quantity: 1, unitAmount: { minor: 500, currency: 'USD' } },
      amount: { minor: 500, currency: 'USD' }, fulfillment: 'pending', createdAt,
    },
    attempt, attempts: [attempt], events: [], paymentId: authorization.paymentId ?? null,
    query: null, submitted: true,
  }
}
