import { verifyBearerToken } from '../../../utils/access'
import { getPaymentTimeline, PaymentStoreError } from '../../../utils/store'

function readIdentifier(event: Parameters<typeof getQuery>[0]): string {
  const query = getQuery(event)
  const keys = Object.keys(query)

  if (keys.length !== 1) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_TIMELINE_QUERY_INVALID' })
  }

  if (keys[0] === 'merchantTxnId' && typeof query.merchantTxnId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(query.merchantTxnId)) {
    return query.merchantTxnId
  }

  if (keys[0] === 'transactionId' && typeof query.transactionId === 'string' && /^\d{1,20}$/.test(query.transactionId)) {
    return query.transactionId
  }

  throw createError({ statusCode: 400, statusMessage: 'PAYMENT_TIMELINE_QUERY_INVALID' })
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  if (!verifyBearerToken(getHeader(event, 'authorization'), process.env.PAYMENT_DIAGNOSTIC_TOKEN)) {
    throw createError({ statusCode: 401, statusMessage: 'PAYMENT_DIAGNOSTIC_UNAUTHORIZED' })
  }

  try {
    const timeline = await getPaymentTimeline(readIdentifier(event))

    if (!timeline) {
      throw createError({ statusCode: 404, statusMessage: 'PAYMENT_TIMELINE_NOT_FOUND' })
    }

    return timeline
  }
  catch (error) {
    if (error instanceof PaymentStoreError) {
      throw createError({
        statusCode: error.code === 'PAYMENT_TIMELINE_AMBIGUOUS' ? 409 : 503,
        statusMessage: error.code,
      })
    }

    throw error
  }
})
