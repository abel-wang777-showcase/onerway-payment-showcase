import { randomUUID } from 'node:crypto'
import type { AuthorizationOperationType } from '../../../../shared/payment/authorization'
import type { RecoverSdkPaymentResponse } from '../../../../shared/payment/sdk'
import { findOrderJourney } from '../../../../shared/payment/journey'
import { toAuthorizationRecovery } from '../../../utils/authorization'
import { isMerchantCustomerInScope } from '../../../utils/customer'
import { executeAuthorizationOperation, GatewayError } from '../../../utils/gateway'
import { requireCanonicalPaymentOrigin, withPaymentLimit } from '../../../utils/limit'
import { requireServerProfile } from '../../../utils/profile'
import { readPaymentRecovery } from '../../../utils/recovery'
import {
  claimStoredAuthorizationOperation,
  getPaymentRecovery,
  PaymentStoreError,
  recordAuthorizationOperationResponse,
} from '../../../utils/store'

function readOperation(value: unknown): AuthorizationOperationType {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('type' in value)
    || (value.type !== 'CAPTURE' && value.type !== 'VOID')) {
    throw createError({ statusCode: 400, statusMessage: 'AUTHORIZATION_OPERATION_INVALID' })
  }
  return value.type
}

export default defineEventHandler(async (event): Promise<RecoverSdkPaymentResponse> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const profile = requireServerProfile()
  if (profile.profile !== 'sandbox') {
    throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  }
  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)

  return withPaymentLimit(event, 'submit', async () => {
    const type = readOperation(await readBody<unknown>(event))
    const orderId = getRouterParam(event, 'orderId')
    if (!orderId || !/^[A-Za-z0-9-]{1,128}$/.test(orderId)) {
      throw createError({ statusCode: 400, statusMessage: 'PAYMENT_RECOVERY_INVALID' })
    }
    const ref = readPaymentRecovery(event, profile.secret, orderId)
    if (!ref || ref.orderId !== orderId) throw createError({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })

    try {
      const recovery = await getPaymentRecovery(ref.orderId, ref.attemptId)
      if (!recovery) throw createError({ statusCode: 404, statusMessage: 'PAYMENT_RECOVERY_NOT_FOUND' })
      if (!recovery.customer || !isMerchantCustomerInScope(recovery.customer, profile)) {
        throw createError({ statusCode: 409, statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
      }
      if (recovery.subscription || recovery.attempt.integration !== 'checkout'
        || recovery.attempt.method !== 'card' || !recovery.attempt.authorization
        || findOrderJourney(recovery.order)?.id !== 'hosted-authorization') {
        throw createError({ statusCode: 409, statusMessage: 'AUTHORIZATION_OPERATION_UNAVAILABLE' })
      }

      const merchantTxnId = `showcase-${randomUUID()}`
      const claim = await claimStoredAuthorizationOperation(recovery.attempt.id, type, merchantTxnId, new Date().toISOString())
      if (claim.claimed) {
        const authorization = claim.attempt.authorization!
        // The row-locked claim is committed before any request leaves the server.
        let response = null
        try {
          response = await executeAuthorizationOperation(profile, {
            type,
            merchantTxnId,
            originTransactionId: authorization.authTransactionId!,
            paymentId: authorization.paymentId!,
            amountMinor: authorization.amountMinor,
            currency: authorization.currency,
          })
        }
        catch (error) {
          if (!(error instanceof GatewayError)) throw error
          // Rejection, timeout and invalid replies never reopen the operation.
        }
        await recordAuthorizationOperationResponse(recovery.attempt.id, merchantTxnId, response, new Date().toISOString())
      }

      const latest = await getPaymentRecovery(ref.orderId, ref.attemptId)
      if (!latest) throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
      return toAuthorizationRecovery(latest)
    }
    catch (error) {
      if (error instanceof PaymentStoreError) {
        throw createError({
          statusCode: error.code === 'PAYMENT_ATTEMPT_MISMATCH' ? 409 : 503,
          statusMessage: error.code,
        })
      }
      throw error
    }
  })
})
