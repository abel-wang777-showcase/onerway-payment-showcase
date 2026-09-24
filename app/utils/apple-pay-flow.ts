export type ApplePayFlowActorId = 'customer' | 'client' | 'server' | 'apple' | 'onerway'

interface ApplePayFlowActor {
  readonly id: ApplePayFlowActorId
  readonly label: string
  readonly icon: string
  readonly merchant: boolean
}

interface ApplePayFlowEdge {
  readonly from: ApplePayFlowActorId
  readonly to: ApplePayFlowActorId
  readonly label: string
  readonly detail?: string
}

interface ApplePayFlow {
  readonly id: 'prepare' | 'begin' | 'validate' | 'authorize' | 'submit' | 'result' | 'cancel'
  readonly title: string
  readonly trigger: string
  readonly edges: readonly ApplePayFlowEdge[]
  readonly client: string
  readonly server: string
  readonly note: string
  readonly clientCode?: string
  readonly serverCode?: string
}

export const applePayFlowActors = [
  { id: 'customer', label: 'Customer', icon: 'i-lucide-user-round', merchant: false },
  { id: 'client', label: 'Merchant client', icon: 'i-lucide-monitor-smartphone', merchant: true },
  { id: 'server', label: 'Merchant server', icon: 'i-lucide-server', merchant: true },
  { id: 'apple', label: 'Apple / Wallet', icon: 'i-lucide-wallet-cards', merchant: false },
  { id: 'onerway', label: 'Onerway', icon: 'i-lucide-shield-check', merchant: false },
] as const satisfies readonly ApplePayFlowActor[]

export const applePayFlows = [
  {
    id: 'prepare',
    title: 'Prepare payment',
    trigger: 'The payment page opens or restores this order.',
    edges: [
      { from: 'server', to: 'onerway', label: 'Consult Apple Pay' },
      { from: 'onerway', to: 'server', label: 'Country and networks' },
      { from: 'server', to: 'client', label: 'Payment request' },
      { from: 'client', to: 'apple', label: 'Check availability' },
    ],
    client: 'Load Apple Pay and check this device with the server-owned request.',
    server: 'Restore the order and consult Onerway for the eligible Apple Pay configuration.',
    note: 'Preparation and device checks do not create an Onerway payment transaction.',
    clientCode: '// Illustrative\nconst eligible = await ApplePaySession.applePayCapabilities(merchantIdentifier)',
    serverCode: '// Illustrative\nconst method = await onerway.consultPaymentMethod({ amount, currency: \'USD\' })',
  },
  {
    id: 'begin',
    title: 'Open Wallet',
    trigger: 'The customer chooses Apple Pay.',
    edges: [
      { from: 'customer', to: 'client', label: 'Click Apple Pay' },
      { from: 'client', to: 'apple', label: 'session.begin()' },
    ],
    client: 'Create and begin the Apple Pay session synchronously inside the customer click.',
    server: 'No server payment call runs at this stage.',
    note: 'Opening or closing the sheet does not establish an Onerway payment result.',
    clientCode: '// Illustrative\nconst session = new ApplePaySession(6, paymentRequest)\nsession.begin()',
  },
  {
    id: 'validate',
    title: 'Validate merchant',
    trigger: 'Apple fires onvalidatemerchant.',
    edges: [
      { from: 'apple', to: 'client', label: 'onvalidatemerchant' },
      { from: 'client', to: 'server', label: 'validationURL' },
      { from: 'server', to: 'apple', label: 'mTLS startSession' },
      { from: 'apple', to: 'server', label: 'merchantSession' },
      { from: 'server', to: 'client', label: 'merchantSession', detail: 'Complete session, held only for Apple' },
      { from: 'client', to: 'apple', label: 'completeMerchantValidation' },
    ],
    client: 'Forward the approved validation URL and return the merchant session to Apple.',
    server: 'Validate the URL and obtain a merchant session from Apple over mTLS.',
    note: 'The complete merchantSession passes back to Apple ephemerally; only its demonstration projection omits sensitive values.',
    clientCode: '// Illustrative\nsession.onvalidatemerchant = async ({ validationURL }) => {\n  const merchantSession = await merchantServer.validate(validationURL)\n  session.completeMerchantValidation(merchantSession)\n}',
    serverCode: '// Illustrative\nconst merchantSession = await appleMtls.startSession({ validationURL, merchantIdentifier, domainName })',
  },
  {
    id: 'authorize',
    title: 'Authorize in Wallet',
    trigger: 'The customer approves the payment in Wallet.',
    edges: [
      { from: 'customer', to: 'apple', label: 'Approve in Wallet' },
      { from: 'apple', to: 'client', label: 'onpaymentauthorized', detail: 'event.payment.token' },
    ],
    client: 'Read event.payment.token and forward the complete token once without storing it.',
    server: 'Wait for the authorized token before creating the Onerway transaction.',
    note: 'Apple supplies an encrypted payment token; no card number or credential is displayed.',
    clientCode: '// Illustrative\nsession.onpaymentauthorized = ({ payment }) => merchantServer.pay(payment.token)',
  },
  {
    id: 'submit',
    title: 'Submit to Onerway',
    trigger: 'The merchant client has the complete authorized token.',
    edges: [
      { from: 'client', to: 'server', label: '/api/payment/apple-pay/pay' },
      { from: 'server', to: 'onerway', label: '/v1/txn/doTransaction', detail: 'tokenInfo provider + tokenId' },
      { from: 'onerway', to: 'server', label: 'Direct response' },
    ],
    client: 'Send the complete encrypted token once to the merchant server.',
    server: 'Claim the attempt and serialize provider plus tokenId into tokenInfo for Onerway.',
    note: 'Onerway handles token decryption; the Showcase stores neither the token nor its cryptographic fields.',
    clientCode: '// Illustrative\nawait merchantServer.pay({ token: event.payment.token })',
    serverCode: '// Illustrative\nconst tokenInfo = JSON.stringify({\n  provider: \'ApplePay\',\n  tokenId: JSON.stringify(paymentToken),\n})\nawait onerway.doTransaction({ tokenInfo })',
  },
  {
    id: 'result',
    title: 'Confirm result',
    trigger: 'A trusted observation becomes available.',
    edges: [
      { from: 'onerway', to: 'server', label: 'Synchronous response', detail: 'Direct response path' },
      { from: 'server', to: 'onerway', label: 'Query original transaction', detail: 'Recovery path' },
      { from: 'onerway', to: 'server', label: 'Matched query result', detail: 'Recovery path' },
      { from: 'onerway', to: 'server', label: 'Verified webhook', detail: 'Independent delivery path' },
      { from: 'server', to: 'client', label: 'Saved order state' },
      { from: 'client', to: 'apple', label: 'completePayment', detail: 'Apple sheet result only' },
    ],
    client: 'Complete the sheet once for a terminal result, or fail it at the 25-second budget while the order stays pending.',
    server: 'Correlate and persist synchronous, query, or verified Webhook facts for the same transaction.',
    note: 'Synchronous response, query, and verified Webhook are independent paths with no assumed delivery order; completePayment does not replace the saved order result.',
    clientCode: '// Illustrative: closes the Apple sheet only\nsession.completePayment({ status: sheetStatus })',
    serverCode: '// Illustrative: merge each trusted observation into the original attempt\nmergeAttempt(originalAttempt, observation)',
  },
  {
    id: 'cancel',
    title: 'Close Wallet',
    trigger: 'The customer closes Wallet before a confirmed result.',
    edges: [
      { from: 'apple', to: 'client', label: 'oncancel' },
      { from: 'client', to: 'customer', label: 'Return to checkout' },
    ],
    client: 'Close the local sheet state and recover the original order if its token was already submitted.',
    server: 'Do not invent a failed or cancelled Onerway transaction.',
    note: 'Teaching branch only: the Showcase has no provider cancel message to present for this interaction.',
    clientCode: '// Illustrative\nsession.oncancel = () => showExistingOrder()',
  },
] as const satisfies readonly ApplePayFlow[]
