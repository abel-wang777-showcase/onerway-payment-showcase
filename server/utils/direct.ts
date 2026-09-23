import type { DirectRecoveryResponse } from '../../shared/payment/apple-pay'
import { randomUUID } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import { createEvent } from '../../shared/payment/event'
import { findOrderJourney } from '../../shared/payment/journey'
import { toPaymentAttemptSummary, type RecoverSdkPaymentResponse } from '../../shared/payment/sdk'
import { isMerchantCustomerInScope } from './customer'
import { ApplePayError, queryApplePayPayment } from './apple-pay'
import type { ServerProfile } from './profile'
import { readPaymentRecovery } from './recovery'
import { completePaymentRecord, getPaymentRecovery, recordPaymentMethodDetails, type PaymentRecovery, PaymentStoreError } from './store'

type SandboxProfile = Extract<ServerProfile, { profile: 'sandbox' }>

export function assertDirectRecovery(profile: SandboxProfile, recovery: PaymentRecovery): void {
  if (recovery.attempt.integration !== 'direct-api' || recovery.attempt.method !== 'apple-pay'
    || recovery.subscription || recovery.attempt.authorization || !recovery.attempt.merchantTxnId
    || findOrderJourney(recovery.order)?.id !== 'apple-pay-direct'
    || !recovery.customer || !isMerchantCustomerInScope(recovery.customer, profile)) {
    throw createError({ statusCode: 409, statusMessage: 'APPLE_PAY_ORDER_MISMATCH' })
  }
}

export function canAuthorizeDirect(recovery: PaymentRecovery): boolean {
  return recovery.attempt.status === 'created'
    && !recovery.attempt.paymentId && !recovery.attempt.transactionId
    && !recovery.events.some(item => item.source === 'server' && item.sourceKey === `create-claim:${recovery.attempt.id}`)
}

export async function requireDirectRecovery(event: H3Event, profile: SandboxProfile, input: unknown, keys: readonly string[]): Promise<PaymentRecovery> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !keys.includes(key))) {
    throw createError({ statusCode: 400, statusMessage: 'APPLE_PAY_INPUT_INVALID' })
  }
  const body = input as Record<string, unknown>
  if (typeof body.orderId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(body.orderId)) {
    throw createError({ statusCode: 400, statusMessage: 'APPLE_PAY_INPUT_INVALID' })
  }
  const ref = readPaymentRecovery(event, profile.secret, body.orderId)
  if (!ref || (body.attemptId !== undefined && body.attemptId !== ref.attemptId)) {
    throw createError({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })
  }
  const recovery = await getPaymentRecovery(ref.orderId, ref.attemptId)
  if (!recovery) throw createError({ statusCode: 404, statusMessage: 'PAYMENT_RECOVERY_NOT_FOUND' })
  assertDirectRecovery(profile, recovery)
  return recovery
}

export function toDirectRecovery(recovery: PaymentRecovery): RecoverSdkPaymentResponse {
  return Object.freeze({
    order: recovery.order, attempt: recovery.attempt,
    attempts: Object.freeze(recovery.attempts.map(toPaymentAttemptSummary)),
    events: recovery.events,
    paymentId: recovery.attempt.paymentId ?? null,
    query: null,
    submitted: !canAuthorizeDirect(recovery),
  })
}

export async function refreshDirectRecovery(profile: SandboxProfile, recovery: PaymentRecovery): Promise<DirectRecoveryResponse> {
  assertDirectRecovery(profile, recovery)
  if (canAuthorizeDirect(recovery)) return toDirectRecovery(recovery)
  let found
  try {
    found = await queryApplePayPayment(profile, {
      merchantTxnId: recovery.attempt.merchantTxnId!,
      amountMinor: recovery.order.amount.minor,
      currency: recovery.order.amount.currency,
      transactionId: recovery.attempt.transactionId,
      paymentId: recovery.attempt.paymentId,
    })
  }
  catch (error) {
    if (!(error instanceof ApplePayError)) throw error
    const latest = await getPaymentRecovery(recovery.order.id, recovery.attempt.id)
    if (!latest) throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    return { ...toDirectRecovery(latest), verificationPending: true }
  }
  await completePaymentRecord(recovery.attempt.id, found.paymentId, found.transactionId, createEvent({
    id: randomUUID(), attemptId: recovery.attempt.id, source: 'query',
    sourceKey: `direct-query:${recovery.attempt.id}:${randomUUID()}`,
    status: found.status, rawStatus: found.rawStatus, transactionStatus: found.rawStatus,
    transactionId: found.transactionId, occurredAt: new Date().toISOString(),
  }))
  if (found.actualWallet && found.fundingNetwork) {
    try {
      await recordPaymentMethodDetails(recovery.attempt.id, found.paymentId ?? recovery.attempt.paymentId, {
        transactionId: found.transactionId,
        paymentId: found.paymentId ?? recovery.attempt.paymentId,
        actualWallet: found.actualWallet,
        fundingNetwork: found.fundingNetwork,
      }, new Date().toISOString())
    }
    catch {
      // Optional attribution cannot revoke the independently stored payment truth.
    }
  }
  const updated = await getPaymentRecovery(recovery.order.id, recovery.attempt.id)
  if (!updated) throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
  return toDirectRecovery(updated)
}

// Expose only controlled codes, never upstream bodies, tokens or TLS details.
export function directFailure(error: unknown): never {
  if (error instanceof ApplePayError) {
    const pending = error.code === 'PAYMENT_QUERY_NOT_FOUND'
    throw createError({ statusCode: pending ? 409 : 502,
      statusMessage: pending ? 'PAYMENT_RECOVERY_PENDING' : error.code })
  }
  if (error instanceof PaymentStoreError) {
    throw createError({ statusCode: 503, statusMessage: error.code })
  }
  if (error instanceof TypeError) {
    throw createError({ statusCode: 400, statusMessage: 'APPLE_PAY_INPUT_INVALID' })
  }
  if (error && typeof error === 'object' && 'statusCode' in error) throw error
  throw createError({ statusCode: 503, statusMessage: 'APPLE_PAY_UNAVAILABLE' })
}
