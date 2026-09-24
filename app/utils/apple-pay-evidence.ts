import type { ApplePayEvidence, ApplePayEvidenceField, ApplePayNetworkEvidence, ApplePayNetworkIcon, PrepareApplePayResponse, DirectRecoveryResponse } from '#shared/payment/apple-pay'

const json = (value: unknown) => JSON.stringify(value, null, 2)
export function maskPaymentReference(value: string | undefined | null): string {
  if (!value) return 'Not returned'
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : '••••'
}
const networkIcons: Readonly<Record<string, ApplePayNetworkIcon>> = {
  visa: 'i-simple-icons-visa',
  mastercard: 'i-simple-icons-mastercard',
  amex: 'i-simple-icons-americanexpress',
  americanexpress: 'i-simple-icons-americanexpress',
  discover: 'i-simple-icons-discover',
  jcb: 'i-simple-icons-jcb',
}

export function applePayNetworkEvidence(value: string): ApplePayNetworkEvidence {
  const normalized = value.normalize('NFKC').trim().toLowerCase()
  return { value, icon: networkIcons[normalized] ?? 'i-lucide-credit-card' }
}

const field = (label: string, value: string, networks?: readonly string[]): ApplePayEvidenceField => ({
  label,
  value,
  ...(networks?.length ? { networks: networks.map(applePayNetworkEvidence) } : {}),
})

export function preparationEvidence(value: PrepareApplePayResponse, eligible?: boolean): ApplePayEvidence {
  return { summary: eligible === false ? 'This device cannot open Apple Pay.' : 'The order and supported card networks are ready.', source: 'live',
    fields: [field('Amount', `${value.paymentRequest.currencyCode} ${value.paymentRequest.total.amount}`), field('Country', value.paymentRequest.countryCode), field('Networks', value.paymentRequest.supportedNetworks.join(', '), value.paymentRequest.supportedNetworks)],
    response: json({ merchantIdentifier: value.merchantIdentifier, paymentRequest: value.paymentRequest, deviceEligible: eligible ?? 'Not checked for a restored order' }) }
}

export function validationEvidence(url: string, merchantIdentifier: string, domain: string, session?: Record<string, unknown>): ApplePayEvidence {
  let approvedUrl = 'Rejected validation address'
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && !parsed.search && !parsed.hash
      && parsed.href === url && ['apple-pay-gateway-cert.apple.com', 'cn-apple-pay-gateway-cert.apple.com'].includes(parsed.hostname)
      && ['/paymentservices/startSession', '/paymentservices/paymentSession'].includes(parsed.pathname)) approvedUrl = parsed.href
  }
  catch { /* Never display an arbitrary event URL. */ }
  const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? value : 'Not returned'
  return { summary: session ? 'Apple returned a merchant session for this payment.' : 'The merchant server is asking Apple to validate this website.', source: 'live',
    fields: [field('Validation URL', approvedUrl), field('Website', domain), field('Merchant ID', merchantIdentifier), ...(typeof time(session?.expiresAt) === 'number' ? [field('Session expires at', new Date(session!.expiresAt as number).toISOString())] : [])],
    request: json({ method: 'POST', url: approvedUrl, body: { merchantIdentifier, displayName: 'Halden', initiative: 'web', initiativeContext: domain } }),
    ...(session ? { response: json({ epochTimestamp: time(session.epochTimestamp), expiresAt: time(session.expiresAt), domainName: session.domainName === domain ? domain : 'Not returned or not matched', displayName: session.displayName === 'Halden' ? 'Halden' : 'Not returned', merchantSessionIdentifier: '[session identifier omitted]', merchantIdentifier: '[session identifier omitted]', nonce: '[nonce omitted]', signature: '[signature omitted]' }) } : {}) }
}

export function authorizationEvidence(token: Record<string, unknown>): ApplePayEvidence {
  const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  const method = object(token.paymentMethod)
  const data = object(token.paymentData)
  const network = typeof method.network === 'string' && ['visa', 'mastercard', 'amex', 'discover', 'jcb', 'unionpay', 'maestro', 'eftpos', 'electron', 'vpay', 'cartesbancaires', 'interac', 'mada', 'girocard', 'privatelabel'].includes(method.network.toLowerCase()) ? method.network : 'Not returned'
  const type = typeof method.type === 'string' && ['debit', 'credit', 'prepaid', 'store'].includes(method.type) ? method.type : 'Not returned'
  const version = ['EC_v1', 'RSA_v1'].includes(String(data.version)) ? data.version : 'Not returned'
  return { summary: 'Wallet authorization arrived with an encrypted payment token.', source: 'live', fields: [field('Wallet-reported network', network, [network]), field('Card type', type), field('Encrypted token', 'Received; contents omitted')],
    response: json({ paymentMethod: { network, type, displayName: '[card label omitted]' }, transactionIdentifier: '[wallet transaction identifier omitted]', paymentData: { version, data: '[encrypted payment data omitted]', signature: '[signature omitted]', header: '[cryptographic header omitted]' } }) }
}

export function submissionEvidence(value: DirectRecoveryResponse, request?: string): ApplePayEvidence {
  return { summary: request ? 'The merchant server submitted this request to Onerway.' : 'The authorized payment is being sent to the merchant server.', source: 'live',
    fields: [field('Merchant transaction', maskPaymentReference(value.attempt.merchantTxnId)), field('Operation', 'CARD / DIRECT / SALE'), field('Amount', `${value.order.amount.currency} ${(value.order.amount.minor / 100).toFixed(2)}`)],
    request: request ?? json({ method: 'POST', path: '/api/payment/apple-pay/pay', body: { orderId: maskPaymentReference(value.order.id), attemptId: maskPaymentReference(value.attempt.id), token: '[encrypted Apple payment token omitted]', browser: '[device metadata omitted]' } }) }
}

export function resultEvidence(value: DirectRecoveryResponse, source: ApplePayEvidence['source']): ApplePayEvidence {
  const observations = value.events.filter(e => ['server', 'query', 'webhook'].includes(e.source) && e.rawStatus).map(e => ({ source: e.source, status: e.status, rawStatus: e.rawStatus, occurredAt: e.occurredAt }))
  return { summary: value.verificationPending ? 'A fresh check is unavailable; the saved result is preserved.' : `The saved payment result is ${value.attempt.status}.`, source,
    fields: [field('Payment result', value.attempt.status), field('Confirmed by', value.attempt.statusSource ?? 'Not confirmed'), field('Verified wallet / network', [value.attempt.actualWallet, value.attempt.fundingNetwork].filter(Boolean).join(' / ') || 'Not yet verified', value.attempt.fundingNetwork ? [value.attempt.fundingNetwork] : undefined)],
    occurredAt: value.attempt.updatedAt,
    response: json({ merchantTxnId: maskPaymentReference(value.attempt.merchantTxnId), transactionId: maskPaymentReference(value.attempt.transactionId), paymentId: maskPaymentReference(value.paymentId), status: value.attempt.status, observations }) }
}

export const applePayExamples: Record<string, { request?: string, response?: string }> = {
  prepare: { response: json({ countryCode: 'US', currencyCode: 'USD', supportedNetworks: ['visa', 'masterCard'] }) },
  begin: { request: 'const session = new ApplePaySession(6, paymentRequest)\nsession.begin() // Call directly from the customer click' },
  validate: {
    request: 'session.onvalidatemerchant = async ({ validationURL }) => {\n  const merchantSession = await merchantServer.validate(validationURL)\n  session.completeMerchantValidation(merchantSession)\n}\n// Illustrative only',
    response: json({
      epochTimestamp: '[epoch milliseconds]',
      expiresAt: '[epoch milliseconds]',
      merchantSessionIdentifier: '[session identifier omitted]',
      nonce: '[nonce omitted]',
      merchantIdentifier: '[merchant identifier omitted]',
      domainName: 'shop.example',
      displayName: 'Halden',
      signature: '[signature omitted]',
    }),
  },
  authorize: {
    request: 'session.onpaymentauthorized = ({ payment }) => {\n  merchantServer.pay(payment.token)\n}\n// Illustrative only',
    response: json({
      paymentData: {
        version: 'EC_v1',
        data: '[encrypted payment data omitted]',
        signature: '[signature omitted]',
        header: {
          ephemeralPublicKey: '[ephemeral public key omitted]',
          publicKeyHash: '[public key hash omitted]',
          transactionId: '[cryptographic transaction id omitted]',
        },
      },
      paymentMethod: { displayName: '[card label omitted]', network: 'visa', type: 'credit' },
      transactionIdentifier: '[wallet transaction identifier omitted]',
    }),
  },
  submit: {
    request: json({
      tokenInfo: JSON.stringify({
        provider: 'ApplePay',
        tokenId: JSON.stringify({
          paymentData: {
            version: 'EC_v1',
            data: '[encrypted payment data omitted]',
            signature: '[signature omitted]',
            header: {
              ephemeralPublicKey: '[ephemeral public key omitted]',
              publicKeyHash: '[public key hash omitted]',
              transactionId: '[cryptographic transaction id omitted]',
            },
          },
          paymentMethod: { displayName: '[card label omitted]', network: 'visa', type: 'credit' },
          transactionIdentifier: '[wallet transaction identifier omitted]',
        }),
      }),
    }),
  },
  result: { response: json({ trustedSources: ['synchronous response', 'matched query', 'verified webhook'], deliveryOrder: 'independent; no fixed order', sheetCompletion: 'separate from the saved order status' }) },
}
