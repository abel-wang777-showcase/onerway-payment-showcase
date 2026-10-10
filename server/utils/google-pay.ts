import { DirectGatewayError, buildDirectPayload, directRequestEvidence, postDirect, queryDirectPayment, readDirectCreateResponse, readDirectQueryResponse, type DirectQueryContext, type DirectTransaction } from './direct-gateway'
import type { GooglePayConfiguration } from '../../shared/payment/google-pay'
import type { Order } from '../../shared/payment/order'
import type { CreateContext } from './gateway'
import { googlePayTokenInfo, readGooglePayRedirectUrl } from '../../shared/payment/google-pay'
import type { ServerProfile } from './profile'


const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const networks = new Set(['AMEX', 'DISCOVER', 'INTERAC', 'JCB', 'MASTERCARD', 'VISA'])

function assertContext(profile: ServerProfile, order: Order): void {
  if (profile.profile !== 'sandbox' || profile.transactionPolicy !== 'sandbox-only') {
    throw new DirectGatewayError('PROFILE_PRODUCTION_LOCKED')
  }
  if (order.scene !== 'ecommerce' || order.amount.currency !== 'USD' || order.amount.minor !== 500
    || order.item.unitAmount.currency !== 'USD' || order.item.quantity * order.item.unitAmount.minor !== 500) {
    throw new DirectGatewayError('PAYMENT_ORDER_INVALID')
  }
}

/** Only the current transaction's unambiguous gateway configuration reaches the client. */
export function readGooglePayConfiguration(value: unknown, profile: ServerProfile, order: Order): GooglePayConfiguration {
  assertContext(profile, order)
  if (!record(value) || value.respCode !== '20000' || !Array.isArray(value.data)) {
    throw new DirectGatewayError('GOOGLE_PAY_CONFIGURATION_INVALID')
  }
  const matches = value.data.filter(item => record(item) && item.paymentMethod === 'GooglePay')
  if (matches.length !== 1) throw new DirectGatewayError('GOOGLE_PAY_UNAVAILABLE')
  const method = matches[0] as Record<string, unknown>
  if (method.countryCode !== 'US'
    || typeof method.gatewayName !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(method.gatewayName)
    || method.gatewayName === 'example'
    || typeof method.gatewayMerchantId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(method.gatewayMerchantId)
    || !Array.isArray(method.subCardTypes) || !method.subCardTypes.length
    || !method.subCardTypes.every(network => typeof network === 'string' && networks.has(network))) {
    throw new DirectGatewayError('GOOGLE_PAY_CONFIGURATION_INVALID')
  }
  return {
    environment: 'TEST', gateway: method.gatewayName, gatewayMerchantId: method.gatewayMerchantId,
    allowedCardNetworks: [...new Set(method.subCardTypes as string[])],
    // Required by Onerway's Google Pay contract, not inferred from consult's network list.
    allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
    countryCode: 'US', currencyCode: 'USD', totalPrice: '5.00',
  }
}

export async function consultGooglePay(profile: ServerProfile, order: Order): Promise<GooglePayConfiguration> {
  assertContext(profile, order)
  if (profile.profile !== 'sandbox') throw new DirectGatewayError('PROFILE_PRODUCTION_LOCKED')
  const value = await postDirect(profile, '/v1/txn/consultPaymentMethod', {
    merchantNo: profile.merchantNo, appId: profile.appId,
    country: 'US', orderAmount: '5.00', orderCurrency: 'USD', paymentMode: 'WEB', subProductType: 'DIRECT',
  }, 'GooglePay')
  return readGooglePayConfiguration(value, profile, order)
}

type SandboxProfile = Extract<ServerProfile, { profile: 'sandbox' }>
type Payload = Readonly<Record<string, unknown>>
export type GooglePayCreateContext = CreateContext & { readonly token: unknown }
export function buildGooglePayPayload(profile: SandboxProfile, context: GooglePayCreateContext): Payload {
  assertContext(profile, context.order)
  return buildDirectPayload(profile, context, googlePayTokenInfo(context.token), 'GooglePay')
}
export type GooglePayQueryContext = DirectQueryContext
export type GooglePayTransaction = DirectTransaction & { readonly actualWallet?: 'google-pay'; readonly redirectUrl?: string }
export function readGooglePayCreateResponse(value: unknown, merchantNo: string, context: DirectQueryContext, expectedReturnUrl?: string): GooglePayTransaction {
  const result = readDirectCreateResponse(value, merchantNo, context, 'GooglePay') as GooglePayTransaction
  const redirectUrl = result.status === 'requires_action' && expectedReturnUrl !== undefined && record(value) && record(value.data)
    ? readGooglePayRedirectUrl(value.data.redirectUrl, expectedReturnUrl) : undefined
  return { ...result, ...(redirectUrl ? { redirectUrl } : {}) }
}
export function readGooglePayQueryResponse(value: unknown, merchantNo: string, context: DirectQueryContext): GooglePayTransaction {
  return readDirectQueryResponse(value, merchantNo, context, 'GooglePay') as GooglePayTransaction
}
export async function createGooglePayPayment(profile: SandboxProfile, context: GooglePayCreateContext): Promise<GooglePayTransaction & { readonly evidence: { readonly request: string } }> {
  const payload = buildGooglePayPayload(profile, context)
  const result = readGooglePayCreateResponse(await postDirect(profile, '/v1/txn/doTransaction', payload, 'GooglePay'), profile.merchantNo, { merchantTxnId: context.merchantTxnId, amountMinor: context.order.amount.minor, currency: context.order.amount.currency, appId: profile.appId }, context.returnUrl)
  return { ...result, evidence: directRequestEvidence(payload, 'GooglePay') }
}
export async function queryGooglePayPayment(profile: SandboxProfile, context: DirectQueryContext): Promise<GooglePayTransaction> {
  return await queryDirectPayment(profile, context, 'GooglePay') as GooglePayTransaction
}
