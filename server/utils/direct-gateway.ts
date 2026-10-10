import type { PaymentStatus } from '../../shared/payment/attempt'
import { mapDirectTransactionStatus } from '../../shared/payment/merge'
import { buildCreationQueryPayload, signPayload, type CreateContext } from './gateway'
import type { ServerProfile } from './profile'

type SandboxProfile = Extract<ServerProfile, { profile: 'sandbox' }>
type Payload = Readonly<Record<string, unknown>>
export type DirectWalletProvider = 'ApplePay' | 'GooglePay'
export class DirectGatewayError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'DirectGatewayError' }
}
function failDirect(code: string): never { throw new DirectGatewayError(code) }
function code(provider: DirectWalletProvider, suffix: string): string {
  return `${provider === 'ApplePay' ? 'APPLE_PAY' : 'GOOGLE_PAY'}_${suffix}`
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}
function sandbox(profile: ServerProfile): asserts profile is SandboxProfile {
  if (profile.profile !== 'sandbox' || profile.transactionPolicy !== 'sandbox-only') failDirect('PROFILE_PRODUCTION_LOCKED')
}
function responseData(value: unknown, provider: DirectWalletProvider): unknown {
  if (!record(value) || value.respCode !== '20000') failDirect(code(provider, 'GATEWAY_REJECTED'))
  return value.data
}
export async function postDirect(profile: SandboxProfile, path: string, payload: Payload, provider: DirectWalletProvider): Promise<unknown> {
  sandbox(profile)
  try {
    const response = await fetch(`${profile.apiBaseUrl}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signPayload(payload, profile.secret)), redirect: 'error', signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) failDirect(code(provider, 'NETWORK_ERROR'))
    return await response.json()
  }
  catch { return failDirect(code(provider, 'NETWORK_ERROR')) }
}

export function buildDirectPayload(profile: SandboxProfile, context: CreateContext, tokenInfo: string, provider: DirectWalletProvider): Payload {
  sandbox(profile)
  if (context.order.scene !== 'ecommerce' || context.order.amount.currency !== 'USD' || context.order.amount.minor !== 500
    || context.order.item.unitAmount.currency !== 'USD' || context.order.item.quantity * context.order.item.unitAmount.minor !== 500) failDirect('PAYMENT_ORDER_INVALID')
  const amount = '5.00'
  if (!id(context.merchantTxnId) || !id(context.merchantCustId)) failDirect(code(provider, 'REQUEST_INVALID'))
  const address = { country: 'US', email: 'customer@test.com', province: 'CA' }
  return {
    merchantNo: profile.merchantNo, merchantTxnId: context.merchantTxnId, merchantCustId: context.merchantCustId,
    orderAmount: amount, orderCurrency: 'USD', productType: 'CARD', subProductType: 'DIRECT', txnType: 'SALE', paymentMode: 'WEB',
    billingInformation: address, shippingInformation: address,
    // Already serialized: signPayload must not recursively encode the full token.
    tokenInfo,
    txnOrderMsg: {
      appId: profile.appId, returnUrl: context.returnUrl, notifyUrl: profile.notifyUrl,
      products: [{ currency: 'USD', name: context.order.item.name, num: String(context.order.item.quantity), price: (context.order.item.unitAmount.minor / 100).toFixed(2) }],
      transactionIp: context.transactionIp, javaEnabled: context.javaEnabled, colorDepth: context.colorDepth,
      screenHeight: context.screenHeight, screenWidth: context.screenWidth, timeZoneOffset: context.timeZoneOffset,
      accept: context.accept, userAgent: context.userAgent, contentLength: context.contentLength, language: context.language,
    },
  }
}

export interface DirectQueryContext {
  readonly appId?: string
  readonly merchantTxnId: string
  readonly amountMinor: number
  readonly currency: string
  readonly transactionId?: string
  readonly paymentId?: string
}
export interface DirectTransaction {
  readonly merchantTxnId: string
  readonly transactionId?: string
  readonly paymentId?: string
  readonly rawStatus: string
  readonly status: PaymentStatus
  readonly actualWallet?: 'apple-pay' | 'google-pay'
  readonly fundingNetwork?: string
}
function readTransaction(data: unknown, merchantNo: string, context: DirectQueryContext, query: boolean, provider: DirectWalletProvider): DirectTransaction {
  const missingActionIds = provider === 'GooglePay' && !query && record(data) && data.status === 'R'
    && data.transactionId == null && data.paymentId == null && data.merchantTxnId === context.merchantTxnId
  if (!record(data) || !id(context.merchantTxnId) || context.amountMinor !== 500 || context.currency !== 'USD'
    || (!id(data.transactionId) && !missingActionIds) || (context.transactionId !== undefined && data.transactionId !== context.transactionId)
    || (query ? data.merchantTxnId !== context.merchantTxnId : data.merchantTxnId !== undefined && data.merchantTxnId !== context.merchantTxnId)
    || (data.merchantNo !== undefined && data.merchantNo !== merchantNo)
    || (data.paymentId != null && !id(data.paymentId))
    || (context.paymentId !== undefined && data.paymentId != null && data.paymentId !== context.paymentId)
    || ((query || data.txnType !== undefined) && data.txnType !== 'SALE')
    || (data.productType !== undefined && data.productType !== 'CARD')
    || (data.appId != null && data.appId !== context.appId)
    || ((query || data.subProductType !== undefined) && data.subProductType !== 'DIRECT')
    || ((query || data.orderAmount !== undefined) && (typeof data.orderAmount !== 'string' || !/^5(?:\.0{1,2})?$/.test(data.orderAmount)))
    || ((query || data.orderCurrency !== undefined) && data.orderCurrency !== context.currency)) failDirect(code(provider, 'RESPONSE_INVALID'))
  let status: PaymentStatus
  try {
    if (typeof data.status !== 'string') failDirect(code(provider, 'RESPONSE_INVALID'))
    status = mapDirectTransactionStatus(data.status)
  }
  catch { return failDirect(code(provider, 'RESPONSE_INVALID')) }
  const network = typeof data.paymentMethod === 'string' ? data.paymentMethod.toUpperCase() : undefined
  const attributed = data.walletTypeName === provider && network && /^[A-Z0-9][A-Z0-9 _-]{0,31}$/.test(network)
  return { merchantTxnId: context.merchantTxnId, ...(id(data.transactionId) ? { transactionId: data.transactionId } : {}), ...(id(data.paymentId) ? { paymentId: data.paymentId } : {}), rawStatus: data.status as string, status,
    ...(attributed ? { actualWallet: provider === 'GooglePay' ? 'google-pay' as const : 'apple-pay' as const, fundingNetwork: network } : {}) }
}
export function readDirectCreateResponse(value: unknown, merchantNo: string, context: DirectQueryContext, provider: DirectWalletProvider): DirectTransaction {
  // A business decline can include a definitive failed transaction despite a non-success envelope.
  // Keep query envelopes strict and require the full amount/currency on this exception path.
  const declined = record(value) && typeof value.respCode === 'string' && /^\d{5}$/.test(value.respCode)
    && value.respCode !== '20000' && record(value.data) && value.data.status === 'F'
    && typeof value.data.orderAmount === 'string' && /^5(?:\.0{1,2})?$/.test(value.data.orderAmount)
    && value.data.orderCurrency === context.currency
  return readTransaction(declined ? value.data : responseData(value, provider), merchantNo, context, false, provider)
}
export function readDirectQueryResponse(value: unknown, merchantNo: string, context: DirectQueryContext, provider: DirectWalletProvider): DirectTransaction {
  const data = responseData(value, provider)
  if (!record(data) || !Array.isArray(data.content) || Number(data.totalPages ?? 1) > 1) failDirect(code(provider, 'RESPONSE_INVALID'))
  const matches = data.content.filter(item => record(item) && item.merchantTxnId === context.merchantTxnId)
  if (!matches.length) failDirect('PAYMENT_QUERY_NOT_FOUND')
  if (matches.length !== 1) failDirect(code(provider, 'RESPONSE_INVALID'))
  return readTransaction(matches[0], merchantNo, context, true, provider)
}
function maskedRequestIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || value.length <= 8) return '[identifier omitted]'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

/** An ephemeral projection of the exact outgoing payload, never a raw request. */
export function directRequestEvidence(payload: Payload, provider: DirectWalletProvider): { readonly request: string } {
  const orderMessage = record(payload.txnOrderMsg) ? payload.txnOrderMsg : {}
  return {
    request: JSON.stringify({
      method: 'POST',
      path: '/v1/txn/doTransaction',
      body: {
        merchantNo: maskedRequestIdentifier(payload.merchantNo),
        merchantTxnId: maskedRequestIdentifier(payload.merchantTxnId),
        merchantCustId: maskedRequestIdentifier(payload.merchantCustId),
        orderAmount: payload.orderAmount,
        orderCurrency: payload.orderCurrency,
        productType: payload.productType,
        subProductType: payload.subProductType,
        txnType: payload.txnType,
        paymentMode: payload.paymentMode,
        txnOrderMsg: JSON.stringify({ appId: maskedRequestIdentifier(orderMessage.appId) }),
        tokenInfo: JSON.stringify({ provider, tokenId: '[encrypted payment token omitted]' }),
        sign: '[signature omitted]',
      },
    }, null, 2),
  }
}

export async function queryDirectPayment(profile: SandboxProfile, context: DirectQueryContext, provider: DirectWalletProvider): Promise<DirectTransaction> {
  return readDirectQueryResponse(await postDirect(profile, '/v1/txn/list', buildCreationQueryPayload(profile, context.merchantTxnId), provider), profile.merchantNo, { ...context, appId: profile.appId }, provider)
}
