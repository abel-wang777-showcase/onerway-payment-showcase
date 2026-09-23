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

export interface PayApplePayResponse extends DirectRecoveryResponse {
  readonly evidence?: { readonly request: string }
}
export interface ApplePayEvidence {
  readonly summary: string
  readonly source: 'live' | 'stored'
  readonly fields: readonly { readonly label: string, readonly value: string }[]
  readonly request?: string
  readonly response?: string
  readonly occurredAt?: string
  readonly durationMs?: number
}
export type ApplePayStepState = 'waiting' | 'active' | 'completed' | 'interrupted'
export interface ApplePayStep {
  readonly id: string
  readonly title: string
  readonly actor: string
  readonly input: string
  readonly output: string
  readonly failure: string
  readonly documentation: string
  readonly evidence?: ApplePayEvidence
  readonly example?: { readonly request?: string, readonly response?: string }
  readonly state: ApplePayStepState
}
