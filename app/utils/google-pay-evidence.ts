import type { DirectRecoveryResponse } from '#shared/payment/apple-pay'
import type { PrepareGooglePayResponse } from '#shared/payment/google-pay'
import type { PaymentEvidence } from '#shared/payment/protocol'

const json = (value: unknown) => JSON.stringify(value, null, 2)
const field = (label: string, value: string) => ({ label, value })
const networks = new Set(['AMEX', 'DISCOVER', 'INTERAC', 'JCB', 'MASTERCARD', 'VISA'])
const statuses = new Set(['created', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled'])
const sources = new Set(['server', 'query', 'webhook'])
const directStatuses = new Set(['S', 'F', 'N', 'P', 'I', 'U', 'R'])
const text = (value: unknown, allowed: ReadonlySet<string>) => typeof value === 'string' && allowed.has(value) ? value : 'Not confirmed'
const reference = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? (value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : '••••') : 'Not returned'
const date = (value: unknown): string | undefined => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined

export function googlePreparationEvidence(value: PrepareGooglePayResponse): PaymentEvidence {
  const config = value.config
  const cardNetworks = config.allowedCardNetworks.filter(network => networks.has(network))
  const authMethods = config.allowedAuthMethods.filter(method => ['PAN_ONLY', 'CRYPTOGRAM_3DS'].includes(method))
  const gateway = /^[a-z0-9_-]{1,64}$/.test(config.gateway) ? config.gateway : 'Not returned'
  return { source: 'live', summary: 'The server returned Google Pay configuration for this order.',
    fields: [field('Amount', 'USD 5.00'), field('Country', 'US'), field('Google environment', 'TEST'), field('Onerway environment', 'Sandbox'), field('Gateway', gateway), field('Networks', cardNetworks.join(', ')), field('Can authorize this order', String(value.canAuthorize === true))],
    response: json({ environment: 'TEST', gateway, gatewayMerchantId: reference(config.gatewayMerchantId), allowedCardNetworks: cardNetworks, allowedAuthMethods: authMethods, countryCode: 'US', currencyCode: 'USD', totalPrice: '5.00', canAuthorize: value.canAuthorize === true }) }
}

export function googleReadinessEvidence(eligible: boolean): PaymentEvidence {
  return { source: 'live', summary: eligible ? 'Google reports this browser ready to request payment data.' : 'Google reports this browser unavailable for payment data.',
    fields: [field('isReadyToPay.result', String(eligible)), field('Processor acceptance', 'Not tested by this check')], response: json({ result: eligible }) }
}

/** Retains only non-content metadata. Never return a token or PaymentData snapshot. */
export function googleAuthorizationEvidence(token: string, manual: boolean): PaymentEvidence {
  let format = 'Opaque string'
  try { const parsed: unknown = JSON.parse(token); format = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? 'JSON object string' : 'JSON value string' }
  catch { /* Format only; the original token remains untouched. */ }
  return { source: 'live', summary: manual ? 'A Google token was received. No payment was submitted.' : 'A Google token was received for one automatic submission.',
    fields: [field('Token received', 'Yes; contents omitted'), field('Token bytes', String(new TextEncoder().encode(token).length)), field('Token format', format), field('Payment outcome', 'Not established by authorization')],
    response: json({ tokenReceived: true, byteLength: new TextEncoder().encode(token).length, format, contents: '[omitted]' }) }
}

export function googleSubmissionEvidence(value: DirectRecoveryResponse, request?: string): PaymentEvidence {
  // The server already projects its outgoing request. Re-project only safe fields here,
  // so raw response additions can never become demonstration evidence.
  let safeRequest: string | undefined
  if (request) {
    try {
      const parsed = JSON.parse(request)
      if (parsed?.method === 'POST' && parsed?.path === '/v1/txn/doTransaction'
        && parsed.body?.productType === 'CARD' && parsed.body?.subProductType === 'DIRECT'
        && parsed.body?.txnType === 'SALE' && parsed.body?.orderAmount === '5.00' && parsed.body?.orderCurrency === 'USD') {
        safeRequest = json({ method: 'POST', path: '/v1/txn/doTransaction', body: { orderAmount: '5.00', orderCurrency: 'USD', productType: 'CARD', subProductType: 'DIRECT', txnType: 'SALE', tokenInfo: JSON.stringify({ provider: 'GooglePay', tokenId: '[original token string omitted]' }), sign: '[signature omitted]' } })
      }
    }
    catch { /* Unknown evidence is omitted, never displayed as raw text. */ }
  }
  return { source: 'live', summary: safeRequest ? 'The server returned a safe projection of its Onerway request.' : value.submitted ? 'The merchant server returned the submission result without request evidence.' : 'The browser started submission. An Onerway response is not yet confirmed.',
    fields: [field('Merchant transaction', reference(value.attempt.merchantTxnId)), field('Operation', 'CARD / DIRECT / SALE')],
    ...(safeRequest ? { request: safeRequest } : {}) }
}

export function googleResultEvidence(value: DirectRecoveryResponse, source: PaymentEvidence['source']): PaymentEvidence {
  const status = text(value.attempt.status, statuses)
  const confirmedBy = text(value.attempt.statusSource, sources)
  const observations = value.events.filter(event => sources.has(event.source) && directStatuses.has(event.rawStatus ?? '')).map(event => ({ source: text(event.source, sources), status: text(event.status, statuses), rawStatus: text(event.rawStatus, directStatuses), occurredAt: date(event.occurredAt) }))
  return { source, summary: value.verificationPending ? 'A fresh check is unavailable. This is the saved order state.' : source === 'stored' ? 'This order was restored from the server; earlier browser steps are unknown.' : 'The server returned the original order’s payment state.',
    fields: [field('Payment result', status), field('Confirmed by', confirmedBy), field('Verified wallet', value.attempt.actualWallet === 'google-pay' ? 'Google Pay' : 'Not confirmed'), field('Funding network', text(value.attempt.fundingNetwork, networks))],
    occurredAt: date(value.attempt.updatedAt),
    response: json({ merchantTxnId: reference(value.attempt.merchantTxnId), transactionId: reference(value.attempt.transactionId), paymentId: reference(value.paymentId), status, source: confirmedBy, observations }) }
}

export function googleInterruptionEvidence(summary: string): PaymentEvidence {
  return { source: 'live', summary, fields: [field('Payment result', 'No Provider result inferred from this interaction')] }
}
