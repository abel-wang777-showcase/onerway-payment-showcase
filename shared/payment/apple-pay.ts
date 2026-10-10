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
  readonly transactionNotFound?: boolean
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

export type { PaymentNetworkIcon as ApplePayNetworkIcon, PaymentNetworkEvidence as ApplePayNetworkEvidence, PaymentEvidenceField as ApplePayEvidenceField, PaymentEvidence as ApplePayEvidence, PaymentStepState as ApplePayStepState, PaymentStep as ApplePayStep } from './protocol'
