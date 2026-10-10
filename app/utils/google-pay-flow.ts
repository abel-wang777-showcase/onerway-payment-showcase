import type { PaymentStep } from '#shared/payment/protocol'

export type GooglePayMode = 'automatic' | 'manual'
export const googlePayFlowActors = [
  { id: 'customer', label: 'Customer', icon: 'i-lucide-user-round', merchant: false },
  { id: 'browser', label: 'Merchant browser', icon: 'i-lucide-monitor-smartphone', merchant: true },
  { id: 'google', label: 'Google Pay', icon: 'i-lucide-wallet-cards', merchant: false },
  { id: 'server', label: 'Merchant server', icon: 'i-lucide-server', merchant: true },
  { id: 'onerway', label: 'Onerway', icon: 'i-lucide-shield-check', merchant: false },
] as const

export function googlePayFlows(mode: GooglePayMode) {
  const manual = mode === 'manual'
  return [
    { id: 'prepare', title: 'Prepare payment', trigger: 'The page prepares this Sandbox order.',
      edges: [{ from: 'browser', to: 'server', label: 'Prepare original order' }, { from: 'server', to: 'onerway', label: 'consultPaymentMethod' }, { from: 'onerway', to: 'server', label: 'GooglePay configuration' }, { from: 'server', to: 'browser', label: 'Safe gateway configuration' }],
      client: 'Read the server-owned gateway configuration for this order.', server: 'Check the recovery cookie and consult US / USD 5.00 / WEB / DIRECT.',
      note: 'Preparation creates no Onerway payment transaction.', serverCode: '// Illustrative\nawait onerway.consultPaymentMethod({ country: "US", orderAmount: "5.00", orderCurrency: "USD", paymentMode: "WEB", subProductType: "DIRECT" })' },
    { id: 'ready', title: 'Check readiness', trigger: 'The prepared configuration is available.',
      edges: [{ from: 'browser', to: 'google', label: 'isReadyToPay()' }, { from: 'google', to: 'browser', label: 'Readiness result' }],
      client: 'Load pay.js and ask Google about browser readiness using the allowed networks and authentication methods.', server: 'No payment call runs during the readiness check.',
      note: 'Readiness does not prove that a token is chargeable or that Onerway will accept it.', clientCode: '// Illustrative\nconst client = new google.payments.api.PaymentsClient({ environment: "TEST" })\nconst ready = await client.isReadyToPay(request)' },
    { id: 'authorize', title: manual ? 'Capture a Google token' : 'Authorize with Google Pay', trigger: 'The customer clicks the official Google Pay button.',
      edges: [{ from: 'customer', to: 'browser', label: 'Click Google Pay' }, { from: 'browser', to: 'google', label: 'loadPaymentData()' }, { from: 'customer', to: 'google', label: 'Select and approve' }, { from: 'google', to: 'browser', label: 'tokenizationData.token', detail: 'Original gateway token string' }],
      client: manual ? 'Capture only the returned token string for this visit. Stop before payment submission.' : 'Extract only the original token string and continue to one automatic submission.',
      server: 'No payment is submitted until the browser explicitly sends the token.',
      note: manual ? 'Manual capture ends here. Separate Apifox calls and their results are not tracked by this order.' : 'A returned Google TEST token is authorization data, not evidence of payment success.',
      clientCode: '// Illustrative: called directly from the customer click\nconst data = await client.loadPaymentData(request)\nconst token = data.paymentMethodData.tokenizationData.token' },
    { id: 'submit', title: manual ? 'Submission is disabled' : 'Submit to Onerway', trigger: manual ? 'Not executed in manual mode.' : 'Automatic mode has received a new authorization token.',
      edges: manual ? [] : [{ from: 'browser', to: 'server', label: '/api/payment/google-pay/pay' }, { from: 'server', to: 'onerway', label: '/v1/txn/doTransaction', detail: 'CARD / DIRECT / SALE' }, { from: 'onerway', to: 'server', label: 'Direct transaction response' }],
      client: manual ? 'Showcase does not submit, claim or reuse the captured token.' : 'Send this authorization once under the existing request lock.',
      server: manual ? 'No create request or creation claim runs.' : 'Claim the original attempt, sign the request and send tokenInfo to Onerway.',
      note: 'tokenId keeps the original Google string. Only the outer tokenInfo object is serialized; no extra token stringify.',
      serverCode: '// Illustrative encoding only; manual mode does not run this\nconst tokenInfo = JSON.stringify({ provider: "GooglePay", tokenId: token })' },
    { id: 'result', title: manual ? 'External results are separate' : 'Confirm the order result', trigger: manual ? 'Not executed for a manual capture.' : 'A server response, matched query or verified Webhook is available.',
      edges: manual ? [] : [{ from: 'onerway', to: 'server', label: 'Synchronous response', detail: 'Create response path' }, { from: 'server', to: 'onerway', label: 'Query original transaction', detail: 'Recovery path' }, { from: 'onerway', to: 'server', label: 'Matched query result', detail: 'Recovery path' }, { from: 'onerway', to: 'server', label: 'Verified Webhook', detail: 'Independent delivery path' }, { from: 'server', to: 'browser', label: 'Saved order result' }],
      client: manual ? 'Check any separate transaction in the tool that submitted it.' : 'Display the saved result and recover this order when the outcome is unknown.',
      server: manual ? 'No polling or status change follows token capture.' : 'Correlate each observation to the original merchantTxnId and merge trusted transaction status.',
      note: manual ? 'Capturing or copying a token does not establish an Order payment result.' : 'Response, query and Webhook have no fixed arrival order. R stays requires_action; unverified action URLs are not followed.' },
    { id: 'cancel', title: 'Close or interrupt Google Pay', trigger: 'loadPaymentData rejects or cannot finish.',
      edges: [{ from: 'google', to: 'browser', label: 'Authorization not completed' }, { from: 'browser', to: 'customer', label: 'Return to checkout' }],
      client: 'Keep the order unsubmitted when authorization does not return a usable token.', server: 'Do not create a cancelled or failed Provider transaction from this browser outcome.',
      note: 'A dismissed sheet, unsupported browser and authorization rejection are not distinguished as Provider cancellation.' },
  ] as const
}

export function googlePaySteps(mode: GooglePayMode): PaymentStep[] {
  const manual = mode === 'manual'
  const google = 'https://developers.google.com/pay/api/web/reference/client'
  const onerway = 'https://developers.onerway.com/zh/payments/online-payments/payment-methods/google-pay'
  return [
    { id: 'prepare', title: 'Prepare this order', actor: 'Merchant server → Onerway', input: 'The server-owned US / USD 5.00 order and its recovery permission.', output: 'The unique GooglePay gateway, merchant gateway reference and supported networks; Google environment TEST.', failure: 'Unavailable configuration stops preparation without submitting a payment.', documentation: onerway, example: { language: 'js', request: 'consultPaymentMethod({ country: "US", orderAmount: "5.00", orderCurrency: "USD", paymentMode: "WEB", subProductType: "DIRECT" })' }, state: 'waiting' },
    { id: 'ready', title: 'Check browser readiness', actor: 'Merchant browser → Google Pay', input: 'Allowed networks with PAN_ONLY and CRYPTOGRAM_3DS.', output: 'isReadyToPay returns a browser readiness result. No card or processor acceptance is proven.', failure: 'A false result or a script/API error leaves payment unavailable.', documentation: `${google}#isReadyToPay`, example: { language: 'js', request: 'await client.isReadyToPay(readyRequest)', response: '{ "result": true }' }, state: 'waiting' },
    { id: 'authorize', title: manual ? 'Capture a token without paying' : 'Authorize with Google Pay', actor: 'Customer → Google Pay → merchant browser', input: 'A customer click, PAYMENT_GATEWAY configuration and the fixed payment amount.', output: manual ? 'Capture the original token string in this visit only. No claim, submission or result polling follows.' : 'Read the original token string and submit it once. PaymentData is not retained.', failure: 'Closing or rejecting authorization does not mean Onerway cancelled a payment.', documentation: `${google}#loadPaymentData`, example: { language: 'js', request: 'const data = await client.loadPaymentData(paymentRequest)\nconst token = data.paymentMethodData.tokenizationData.token', response: '{ "tokenReceived": true, "contents": "[omitted]" }' }, state: 'waiting' },
    { id: 'submit', title: manual ? 'Submission is disabled in manual mode' : 'Submit the original token once', actor: 'Merchant browser → merchant server → Onerway', input: manual ? 'None: captured tokens are not submitted by Showcase.' : 'The existing attempt and the original Google token string.', output: manual ? 'No creation claim or Onerway request.' : 'A claimed CARD / DIRECT / SALE request; only its safe server projection is shown.', failure: 'An unknown submission outcome permits only checking the original order, never resending the token.', documentation: onerway, example: { language: 'js', request: 'JSON.stringify({ provider: "GooglePay", tokenId: "[original token string omitted]" })' }, state: 'waiting' },
    { id: 'result', title: manual ? 'No payment result from token capture' : 'Confirm the original order', actor: 'Onerway → merchant server → merchant browser', input: manual ? 'None: external Apifox transactions are separate.' : 'Correlated synchronous response, matched query or independently verified Webhook.', output: manual ? 'Check a separate API call in the tool that sent it.' : 'S / F / N establish succeeded / failed / cancelled. R requires further action and is not a payment failure.', failure: 'Unknown results remain unconfirmed. Hosted action is unavailable until its destination can be verified.', documentation: 'https://developers.onerway.com/zh/payments/api-reference/webhooks/payment-result', example: { response: '{ "trustedSources": ["server", "query", "webhook"], "deliveryOrder": "independent" }' }, state: 'waiting' },
    { id: 'cancel', title: 'Handle an interrupted authorization', actor: 'Google Pay → merchant browser', input: 'loadPaymentData could not provide a usable token.', output: 'Return to the unsubmitted order; no Provider status is invented.', failure: 'A browser rejection is not proof of customer cancellation or Provider N.', documentation: `${google}#loadPaymentData`, example: { response: '{ "authorizationCompleted": false, "paymentSubmitted": false }' }, state: 'waiting' },
  ]
}
