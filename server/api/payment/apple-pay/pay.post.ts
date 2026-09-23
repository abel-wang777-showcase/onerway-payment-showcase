import { randomUUID } from 'node:crypto'
import { createEvent } from '../../../../shared/payment/event'
import { buildApplePayPayload, createApplePayPayment } from '../../../utils/apple-pay'
import { readBrowserData } from '../../../utils/browser'
import { directFailure, canAuthorizeDirect, requireDirectRecovery, toDirectRecovery } from '../../../utils/direct'
import { requireCanonicalPaymentOrigin, requireIp, withPaymentLimit } from '../../../utils/limit'
import { requireServerProfile } from '../../../utils/profile'
import { claimPaymentCreation, completePaymentRecord, getPaymentRecovery } from '../../../utils/store'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const profile = requireServerProfile()
  if (profile.profile !== 'sandbox') throw createError({ statusCode: 403, statusMessage: 'TRANSACTIONS_LOCKED' })
  requireCanonicalPaymentOrigin(event, profile.showcaseOrigin)
  return withPaymentLimit(event, 'create', async (clientIp) => {
    const input = await readBody<Record<string, unknown>>(event)
    const recovery = await requireDirectRecovery(event, profile, input, ['orderId', 'attemptId', 'token', 'browser'])
    if (!canAuthorizeDirect(recovery)) throw createError({ statusCode: 409, statusMessage: 'APPLE_PAY_ALREADY_SUBMITTED' })
    const browser = readBrowserData(input.browser)
    const transactionIp = requireIp(profile.transactionIp ?? clientIp)
    const context = {
      order: recovery.order, merchantTxnId: recovery.attempt.merchantTxnId!,
      merchantCustId: recovery.customer!.merchantCustId,
      returnUrl: `${profile.showcaseOrigin}/halden/direct/${recovery.order.id}`,
      ...browser, transactionIp,
      accept: getHeader(event, 'accept')?.slice(0, 512) || '*/*',
      userAgent: getHeader(event, 'user-agent')?.slice(0, 512) || 'unknown',
      token: input.token,
    }
    buildApplePayPayload(profile, context)
    const claim = await claimPaymentCreation(recovery.attempt.id, createEvent({
      id: randomUUID(), attemptId: recovery.attempt.id, source: 'server',
      sourceKey: `create-claim:${recovery.attempt.id}`, status: 'created', occurredAt: new Date().toISOString(),
    }))
    if (claim.outcome !== 'claimed') throw createError({ statusCode: 409, statusMessage: 'APPLE_PAY_ALREADY_SUBMITTED' })
    const result = await createApplePayPayment(profile, context)
    await completePaymentRecord(recovery.attempt.id, result.paymentId, result.transactionId, createEvent({
      id: randomUUID(), attemptId: recovery.attempt.id, source: 'server',
      sourceKey: `direct-create:${recovery.attempt.id}`, status: result.status,
      rawStatus: result.rawStatus, transactionStatus: result.rawStatus,
      transactionId: result.transactionId, occurredAt: new Date().toISOString(),
    }))
    const updated = await getPaymentRecovery(recovery.order.id, recovery.attempt.id)
    if (!updated) throw createError({ statusCode: 503, statusMessage: 'PAYMENT_RECOVERY_PENDING' })
    return { ...toDirectRecovery(updated), evidence: result.evidence }
  }).catch(directFailure)
})
