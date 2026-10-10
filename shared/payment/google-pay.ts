import type { DirectRecoveryResponse } from './apple-pay'

/** Google returns a string, including for JSON-shaped gateway tokens. */
export function readGooglePayToken(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()
    || new TextEncoder().encode(value).length > 65_536) {
    throw new TypeError('GOOGLE_PAY_TOKEN_INVALID')
  }
  return value
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
  readonly evidence?: { readonly request: string }
  readonly actionUnavailable?: boolean
}
