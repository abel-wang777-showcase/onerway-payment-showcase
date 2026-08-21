import {
  isSubscriptionWebhookProcessed,
  PaymentStoreError,
  recordSubscriptionWebhookEvent,
  recordWebhookEvent,
} from '../../../utils/store'
import {
  readWebhookBody,
  readPaymentWebhook,
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
    let transactionId: string

    if (body.scenarios !== undefined) {
      const fact = readSubscriptionPaymentWebhook(body, profile.secret, profile.merchantNo)

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
    else {
      const fact = readPaymentWebhook(body, profile.secret, profile.merchantNo)
      await recordWebhookEvent(fact)
      transactionId = fact.transactionId
    }

    setResponseStatus(event, 200)
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return transactionId
  }
  catch (error) {
    if (error instanceof WebhookError) {
      console.warn('[payment-webhook] rejected', { code: error.code })
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
