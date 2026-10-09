import { DirectGatewayError, buildDirectPayload, directRequestEvidence, postDirect, queryDirectPayment, readDirectCreateResponse, readDirectQueryResponse, type DirectQueryContext, type DirectTransaction } from './direct-gateway'
import { request } from 'node:https'
import type { PaymentStatus } from '../../shared/payment/attempt'
import type { Order } from '../../shared/payment/order'
import { mapDirectTransactionStatus } from '../../shared/payment/merge'
import type { CreateContext } from './gateway'
import type { ServerProfile } from './profile'

type SandboxProfile = Extract<ServerProfile, { profile: 'sandbox' }>
type Payload = Readonly<Record<string, unknown>>


function fail(code: string): never { throw new DirectGatewayError(code) }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}
function sandbox(profile: ServerProfile): asserts profile is SandboxProfile {
  if (profile.profile !== 'sandbox' || profile.transactionPolicy !== 'sandbox-only') fail('PROFILE_PRODUCTION_LOCKED')
}
function orderAmount(order: Order): string {
  if (order.scene !== 'ecommerce' || order.amount.currency !== 'USD' || order.amount.minor !== 500
    || order.item.unitAmount.currency !== 'USD' || order.item.quantity * order.item.unitAmount.minor !== 500) fail('PAYMENT_ORDER_INVALID')
  return '5.00'
}
function responseData(value: unknown): unknown {
  if (!record(value) || value.respCode !== '20000') fail('APPLE_PAY_GATEWAY_REJECTED')
  return value.data
}

export function mapApplePayStatus(value: unknown): PaymentStatus {
  if (typeof value !== 'string') fail('APPLE_PAY_RESPONSE_INVALID')
  try { return mapDirectTransactionStatus(value) }
  catch { return fail('APPLE_PAY_RESPONSE_INVALID') }
}

/** Only the two documented Sandbox hosts; never rewrite an Apple event URL. */
export function readApplePayValidationUrl(value: unknown): URL {
  if (typeof value !== 'string') fail('APPLE_PAY_VALIDATION_URL_INVALID')
  let url: URL
  try { url = new URL(value) }
  catch { return fail('APPLE_PAY_VALIDATION_URL_INVALID') }
  if (url.href !== value || url.protocol !== 'https:' || url.username || url.password || url.port
    || url.search || url.hash
    || !['apple-pay-gateway-cert.apple.com', 'cn-apple-pay-gateway-cert.apple.com'].includes(url.hostname)
    || !['/paymentservices/startSession', '/paymentservices/paymentSession'].includes(url.pathname)) fail('APPLE_PAY_VALIDATION_URL_INVALID')
  return url
}

type ValidationDiagnostic = 'url-invalid' | 'production-url' | 'not-configured' | 'http-rejected' | 'response-too-large' | 'response-invalid' | 'transport-error' | 'timeout' | 'tls-error'
function validationDiagnostic(reason: ValidationDiagnostic, status?: number): void {
  // Fixed categories only: never log an event URL, identity, body, session or raw error.
  console.warn('[apple-pay-validation]', { reason, ...(status !== undefined ? { status } : {}) })
}
function transportDiagnostic(error: unknown): ValidationDiagnostic {
  const code = record(error) && typeof error.code === 'string' ? error.code : ''
  if (code === 'ABORT_ERR' || code === 'ETIMEDOUT') return 'timeout'
  if (code.startsWith('ERR_SSL_') || code.startsWith('ERR_TLS_') || code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return 'tls-error'
  return 'transport-error'
}

/** Node https does not follow redirects. A total deadline includes DNS and TLS. */
export async function validateApplePayMerchant(profile: SandboxProfile, validationURL: unknown): Promise<Record<string, unknown>> {
  sandbox(profile)
  let url: URL
  try { url = readApplePayValidationUrl(validationURL) }
  catch (error) {
    let production = false
    try {
      const candidate = new URL(typeof validationURL === 'string' ? validationURL : '')
      production = ['apple-pay-gateway.apple.com', 'cn-apple-pay-gateway.apple.com'].includes(candidate.hostname)
    }
    catch { /* Invalid input remains an opaque category. */ }
    validationDiagnostic(production ? 'production-url' : 'url-invalid')
    throw error
  }
  if (!profile.applePay) {
    validationDiagnostic('not-configured')
    fail('APPLE_PAY_NOT_CONFIGURED')
  }
  const body = JSON.stringify({ merchantIdentifier: profile.applePay.merchantIdentifier, displayName: 'Halden', initiative: 'web', initiativeContext: new URL(profile.showcaseOrigin).hostname })
  try {
    return await new Promise((resolve, reject) => {
      const req = request(url, {
        method: 'POST', cert: profile.applePay!.certificatePem, key: profile.applePay!.privateKeyPem,
        minVersion: 'TLSv1.2', rejectUnauthorized: true,
        signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, (res) => {
        if (res.statusCode !== 200) {
          validationDiagnostic('http-rejected', res.statusCode)
          res.destroy()
          reject(new DirectGatewayError('APPLE_PAY_VALIDATION_FAILED'))
          return
        }
        let bytes = 0
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 65_536) {
            validationDiagnostic('response-too-large')
            res.destroy()
            reject(new DirectGatewayError('APPLE_PAY_VALIDATION_FAILED'))
          }
          else chunks.push(chunk)
        })
        res.on('error', (error) => {
          validationDiagnostic(transportDiagnostic(error))
          reject(new DirectGatewayError('APPLE_PAY_VALIDATION_FAILED'))
        })
        res.on('end', () => {
          try {
            const session: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            if (!record(session) || Object.keys(session).length === 0) fail('APPLE_PAY_VALIDATION_FAILED')
            resolve(session)
          }
          catch {
            validationDiagnostic('response-invalid')
            reject(new DirectGatewayError('APPLE_PAY_VALIDATION_FAILED'))
          }
        })
      })
      req.on('error', (error) => {
        validationDiagnostic(transportDiagnostic(error))
        reject(new DirectGatewayError('APPLE_PAY_VALIDATION_FAILED'))
      })
      req.end(body)
    })
  }
  catch (error) {
    if (!(error instanceof DirectGatewayError)) validationDiagnostic(transportDiagnostic(error))
    return fail('APPLE_PAY_VALIDATION_FAILED')
  }
}

export interface ApplePayConfiguration {
  readonly merchantIdentifier: string
  readonly countryCode: string
  readonly supportedNetworks: string[]
  readonly currencyCode: 'USD'
  readonly amount: string
}
export function readApplePayConfiguration(value: unknown, profile: SandboxProfile, order: Order): ApplePayConfiguration {
  sandbox(profile)
  const amount = orderAmount(order)
  if (!profile.applePay) fail('APPLE_PAY_NOT_CONFIGURED')
  const data = responseData(value)
  if (!Array.isArray(data)) fail('APPLE_PAY_CONFIGURATION_INVALID')
  const matches = data.filter(item => record(item) && item.paymentMethod === 'ApplePay')
  if (matches.length !== 1) fail('APPLE_PAY_UNAVAILABLE')
  const method = matches[0] as Record<string, unknown>
  if (typeof method.countryCode !== 'string' || !/^[A-Z]{2}$/.test(method.countryCode)
    || !Array.isArray(method.subCardTypes) || !method.subCardTypes.length
    || !method.subCardTypes.every(network => typeof network === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(network))) fail('APPLE_PAY_CONFIGURATION_INVALID')
  return { merchantIdentifier: profile.applePay.merchantIdentifier, countryCode: method.countryCode, supportedNetworks: [...new Set(method.subCardTypes as string[])], currencyCode: 'USD', amount }
}
export async function consultApplePay(profile: SandboxProfile, order: Order): Promise<ApplePayConfiguration> {
  sandbox(profile)
  if (!profile.applePay) fail('APPLE_PAY_NOT_CONFIGURED')
  return readApplePayConfiguration(await postDirect(profile, '/v1/txn/consultPaymentMethod', {
    merchantNo: profile.merchantNo, appId: profile.appId, country: 'US', orderAmount: orderAmount(order), orderCurrency: 'USD', paymentMode: 'WEB', subProductType: 'DIRECT',
  }, 'ApplePay'), profile, order)
}

export type ApplePayCreateContext = CreateContext & { readonly token: unknown }
export function buildApplePayPayload(profile: SandboxProfile, context: ApplePayCreateContext): Payload {
  sandbox(profile)
  orderAmount(context.order)
  const token = context.token
  if (!record(token) || !record(token.paymentData) || !record(token.paymentMethod)
    || typeof token.transactionIdentifier !== 'string' || !token.transactionIdentifier
    || !id(context.merchantTxnId) || !id(context.merchantCustId)) fail('APPLE_PAY_REQUEST_INVALID')
  let tokenId: string
  try { tokenId = JSON.stringify(token) }
  catch { return fail('APPLE_PAY_REQUEST_INVALID') }
  if (Buffer.byteLength(tokenId) > 65_536) fail('APPLE_PAY_REQUEST_INVALID')
  return buildDirectPayload(profile, context, JSON.stringify({ provider: 'ApplePay', tokenId }), 'ApplePay')
}

export type ApplePayQueryContext = DirectQueryContext
export type ApplePayTransaction = DirectTransaction & { readonly transactionId: string, readonly actualWallet?: 'apple-pay' }
export function readApplePayCreateResponse(value: unknown, merchantNo: string, context: DirectQueryContext): ApplePayTransaction {
  return readDirectCreateResponse(value, merchantNo, context, 'ApplePay') as ApplePayTransaction
}
export function readApplePayQueryResponse(value: unknown, merchantNo: string, context: DirectQueryContext): ApplePayTransaction {
  return readDirectQueryResponse(value, merchantNo, context, 'ApplePay') as ApplePayTransaction
}
export async function createApplePayPayment(profile: SandboxProfile, context: ApplePayCreateContext): Promise<ApplePayTransaction & { readonly evidence: { readonly request: string } }> {
  const payload = buildApplePayPayload(profile, context)
  const result = readApplePayCreateResponse(await postDirect(profile, '/v1/txn/doTransaction', payload, 'ApplePay'), profile.merchantNo, { merchantTxnId: context.merchantTxnId, amountMinor: context.order.amount.minor, currency: context.order.amount.currency, appId: profile.appId })
  return { ...result, evidence: directRequestEvidence(payload, 'ApplePay') }
}
export async function queryApplePayPayment(profile: SandboxProfile, context: DirectQueryContext): Promise<ApplePayTransaction> {
  return await queryDirectPayment(profile, context, 'ApplePay') as ApplePayTransaction
}
