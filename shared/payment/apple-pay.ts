import type { RecoverSdkPaymentResponse } from './sdk'

export interface ApplePayRequest {
  readonly countryCode: string
  readonly currencyCode: string
  readonly supportedNetworks: readonly string[]
  readonly merchantCapabilities: readonly string[]
  readonly total: { readonly label: string, readonly amount: string, readonly type?: 'final' }
}

export interface DirectRecoveryResponse extends RecoverSdkPaymentResponse {
  readonly verificationPending?: boolean
}

export interface PrepareApplePayResponse extends DirectRecoveryResponse {
  readonly paymentRequest: ApplePayRequest
  readonly merchantIdentifier: string
  readonly canAuthorize: boolean
}

export interface ValidateApplePayResponse {
  readonly merchantSession: Record<string, unknown>
}

export type PayApplePayResponse = DirectRecoveryResponse
export type ApplePayStepState = 'waiting' | 'active' | 'completed' | 'interrupted'
export interface ApplePayStep {
  readonly id: string
  readonly title: string
  readonly actor: string
  readonly input: string
  readonly output: string
  readonly failure: string
  readonly documentation: string
  readonly state: ApplePayStepState
}
