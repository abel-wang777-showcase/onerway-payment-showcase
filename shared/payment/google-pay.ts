import type { DirectRecoveryResponse } from './apple-pay'

/** Google returns a string, including for JSON-shaped gateway tokens. */
export function readGooglePayToken(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()
    || new TextEncoder().encode(value).length > 65_536) {
    throw new TypeError('GOOGLE_PAY_TOKEN_INVALID')
  }
  return value
}

/** Hosted action links are transient navigation data, never payment evidence. */
export function readGooglePayRedirectUrl(value: unknown, expectedReturnUrl?: string): string | undefined {
  if (typeof value !== 'string' || value.length > 8_192 || /[\\\s]/.test(value)) return undefined
  try {
    const url = new URL(value)
    if (url.origin !== 'https://sandbox-checkout.onerway.com'
      || url.pathname !== '/additional-information' || url.username || url.password || url.hash) return undefined
    const keys = url.searchParams.getAll('key')
    const returns = url.searchParams.getAll('returnUrl')
    if (keys.length !== 1 || !keys[0]?.trim() || returns.length !== 1 || !returns[0]) return undefined
    const returnUrl = new URL(returns[0])
    if (!['https:', 'http:'].includes(returnUrl.protocol) || returnUrl.username || returnUrl.password || returnUrl.hash
      || /[\\\s]/.test(returns[0]) || (expectedReturnUrl !== undefined && returns[0] !== expectedReturnUrl)) return undefined
    return value
  }
  catch { return undefined }
}

export function googlePayTokenInfo(value: unknown): string {
  return JSON.stringify({ provider: 'GooglePay', tokenId: readGooglePayToken(value) })
}

export interface GooglePayConfiguration {
  readonly environment: 'TEST'
  readonly gateway: string
  readonly gatewayMerchantId: string
  readonly allowedCardNetworks: readonly string[]
  readonly allowedAuthMethods: readonly ['PAN_ONLY', 'CRYPTOGRAM_3DS']
  readonly countryCode: 'US'
  readonly currencyCode: 'USD'
  readonly totalPrice: '5.00'
}

export interface PrepareGooglePayResponse extends DirectRecoveryResponse {
  readonly config: GooglePayConfiguration
  readonly canAuthorize: boolean
}

export interface PayGooglePayResponse extends DirectRecoveryResponse {
  readonly redirectUrl?: string
  readonly evidence?: { readonly request: string }
  readonly actionUnavailable?: boolean
}
