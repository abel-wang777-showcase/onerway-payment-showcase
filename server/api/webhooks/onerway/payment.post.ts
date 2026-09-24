import { isDirectApplePayAttempt } from '../../../../shared/payment/attempt'
import {
  isSubscriptionWebhookProcessed,
  getPaymentTimeline,
  PaymentStoreError,
  recordSubscriptionWebhookEvent,
  recordWebhookEvent,
  recordAuthorizationWebhookEvent,
} from '../../../utils/store'
import {
  readWebhookBody,
  verifyWebhookSignature,
  readPaymentWebhook,
  readAuthorizationWebhook,
  readSubscriptionPaymentWebhook,
  WebhookError,
} from '../../../utils/webhook'
import { requireServerProfile } from '../../../utils/profile'
import { GatewayError, querySubscription } from '../../../utils/gateway'

function fail(statusCode: number, statusMessage: string): never {
  throw createError({ statusCode, statusMessage })
}

export default defineEventHandler(async (event): Promise<string> => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  const profile = requireServerProfile()

  if (profile.profile !== 'sandbox') {
    fail(403, 'TRANSACTIONS_LOCKED')
  }

  try {
    const body = await readWebhookBody(event.node.req, getHeader(event, 'content-length'))
    const signatureHeader = getHeader(event, 'x-rh-signature')
    let transactionId: string

    if (body.scenarios !== undefined && body.scenarios !== null) {
      const fact = readSubscriptionPaymentWebhook(body, profile.secret, profile.merchantNo, signatureHeader)

      if (await isSubscriptionWebhookProcessed(fact)) {
        setResponseStatus(event, 200)
        setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
        return fact.transactionId
      }

      const details = fact.contractId
        ? await querySubscription(profile, fact.contractId)
        : null
      await recordSubscriptionWebhookEvent(fact, details, new Date().toISOString())
      transactionId = fact.transactionId
    }
    else if (['AUTH', 'CAPTURE', 'VOID'].includes(String(body.txnType))) {
      const fact = readAuthorizationWebhook(body, profile.secret, profile.merchantNo, signatureHeader)
      const recorded = await recordAuthorizationWebhookEvent(fact, new Date().toISOString())
      if (!recorded.correlated) throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
      transactionId = fact.transactionId
    }
    else {
      if (!verifyWebhookSignature(body, profile.secret, signatureHeader)) {
        throw new WebhookError('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
      }
      const timeline = typeof body.merchantTxnId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.merchantTxnId)
        ? await getPaymentTimeline(body.merchantTxnId) : null
      const direct = Boolean(timeline && timeline.attempt.merchantTxnId === body.merchantTxnId
        && isDirectApplePayAttempt(timeline.attempt))
      const fact = readPaymentWebhook(body, profile.secret, profile.merchantNo, signatureHeader, direct)
      await recordWebhookEvent(fact)
      transactionId = fact.transactionId
    }

    setResponseStatus(event, 200)
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return transactionId
  }
  catch (error) {
    if (error instanceof WebhookError) {
      console.warn('[payment-webhook] rejected', {
        code: error.code,
        ...(error.diagnosticCode ? { diagnosticCode: error.diagnosticCode } : {}),
      })
      fail(400, error.code)
    }

    if (error instanceof PaymentStoreError) {
      if (['PAYMENT_ATTEMPT_NOT_FOUND', 'PAYMENT_ATTEMPT_MISMATCH'].includes(error.code)) {
        fail(409, error.code)
      }

      fail(503, error.code)
    }

    if (error instanceof GatewayError) {
      fail(error.code === 'PAYMENT_NETWORK_ERROR' ? 504 : 502, error.code)
    }

    fail(500, 'PAYMENT_WEBHOOK_FAILED')
  }
})
