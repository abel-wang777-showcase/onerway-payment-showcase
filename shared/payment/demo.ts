/** Demo v1 transport types. Runtime constraints remain authoritative in docs/api/demo-v1.openapi.json. */
export type Platform = 'WEB' | 'ANDROID' | 'IOS'
export type Integration = 'native-sdk' | 'web-sdk' | 'checkout' | 'direct-api'
export type SceneId = 'one_time' | 'pre_auth' | 'subscription_hosted' | 'subscription_merchant'
export type Availability = 'available' | 'conditional' | 'planned' | 'unavailable'
export type Verification = 'user_confirmed' | 'documented' | 'source_checked' | 'sandbox_verified' | 'unverified'

export interface Amount {
  minor: number
  currency: 'USD'
}
export interface SdkConfig {
  merchantNo: string
  environment: 'sandbox'
  configRevision: string
}
export interface Connection {
  environment: 'sandbox'
  apiVersion: 'v1'
  minimumClientBuild: number
  compatible: boolean
  capabilitiesRevision: string
  sdk: SdkConfig
}
export interface SessionCreate {
  platform: Platform
  clientBuild: number
}
export interface NativeSessionIssued {
  sessionRef: string
  sessionToken: string
}
export interface WebSessionIssued {
  sessionRef: string
}
export type SessionIssued = NativeSessionIssued | WebSessionIssued
export interface SessionView {
  sessionRef: string
  currentCustomerId: string | null
  capabilitiesRevision: string
}
export interface Customer {
  id: string
  label: string
  createdAt: string
}
export interface CustomerCreated extends Customer {
  currentCustomerId: string | null
}
export interface CustomerCreate {
  operationId: string
  label: string
}
export interface CurrentCustomerSet {
  customerId: string
}
export type CustomerChoice = { kind: 'current' } | { kind: 'existing', id: string } | { kind: 'new', label: string }
export type ReturnTarget = { kind: 'preset', id: 'app_android' | 'app_ios' } | { kind: 'custom', url: string }
export interface PaymentCreate {
  requestId: string
  sceneId: 'one_time'
  integration: 'native-sdk'
  amount: Amount
  customer: CustomerChoice
  returnTarget: ReturnTarget
}
export interface Refresh {
  state: 'idle' | 'queued' | 'running' | 'failed'
  lastAttemptAt: string | null
  lastErrorCode: string | null
  pollAfterSeconds: number | null
}
export interface StatusSummary {
  normalized: 'created' | 'requires_action' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  source: 'server' | 'query' | 'webhook'
  verified: boolean
  observedAt: string | null
  isTerminal: boolean
}
export interface PaymentStatus extends StatusSummary {
  rawPaymentStatus: 'I' | 'U' | 'P' | 'A' | 'O' | 'R' | 'N' | 'S' | null
  rawTransactionStatus: string | null
}
export type ActionReason =
  | 'PAYMENT_PROCESSING'
  | 'EXTERNAL_ACTION_IN_PROGRESS'
  | 'PAYMENT_TERMINAL'
  | 'PAYMENT_AUTHORIZED'
  | 'PAYMENT_NOT_COMPLETED'
  | 'CREATION_NOT_READY'
  | 'CHECKOUT_IN_USE'
  | 'CHECKOUT_SESSION_ENDED'
  | 'PROVIDER_UNAVAILABLE'
  | 'CAPABILITY_UNVERIFIED'
  | 'CLIENT_UPGRADE_REQUIRED'
  | 'FUNDS_OPERATION_PENDING'
  | 'PAYMENT_EXPIRED'
export type PaymentAction = {
  type: 'CONTINUE_SDK' | 'OPEN_CHECKOUT' | 'QUERY' | 'CAPTURE' | 'VOID' | 'VIEW_SUBSCRIPTION'
} & ({ enabled: true, reasonCode: null } | { enabled: false, reasonCode: ActionReason })
export type Attention = { kind: 'creation_unknown' | 'continue_sdk' | 'continue_checkout' } | null
export interface PaymentSummary {
  id: string
  merchantTxnId: string
  sceneId: SceneId
  integration: Integration
  txnType: 'SALE' | 'AUTH'
  amount: Amount
  createdAt: string
  creationState: 'pending' | 'ready' | 'unknown' | 'rejected'
  status: StatusSummary
  attention: Attention
  allowedActions: PaymentAction[]
  revision: number
  recordExpiresAt: string
  refresh: Refresh
}
export interface PaymentView extends PaymentSummary {
  status: PaymentStatus
  requestId: string
  platform: Platform
  customerId: string
  provider: { merchantNo: string, paymentId: string } | null
  fundsState: 'not_applicable' | 'authorized' | 'captured' | 'voided' | 'unknown'
  providerExpiresAt: string | null
  /** Session state at response time; deliberately outside the payment revision. */
  currentCustomerId: string | null
}
export interface PaymentPage {
  items: PaymentSummary[]
  nextCursor: string | null
}
export interface CustomerPage {
  items: Customer[]
  nextCursor: string | null
}
export interface CheckoutSessionCreate {
  operationId: string
  supersedes?: string
}
export interface CheckoutSession {
  checkoutSessionId: string
  leaseExpiresAt: string
  revision: number
  sdk: SdkConfig & { paymentId: string }
}
export type ErrorAction = 'NONE' | 'RETRY_SAME_REQUEST' | 'REFRESH' | 'RECOVER_OPERATION' | 'RENEW_SESSION' | 'START_NEW_SESSION' | 'UPGRADE_CLIENT'
export interface DemoApiError {
  code: string
  retryable: boolean
  action: ErrorAction
  retryAfter: number | null
  execution: 'not_started' | 'accepted' | 'unknown' | 'completed' | 'not_applicable'
  fieldErrors: { field: string, code: string }[]
  currentView: PaymentView | null
  operationId: string | null
  checkoutSessionId: string | null
  leaseExpiresAt: string | null
}
export interface ErrorEnvelope {
  error: DemoApiError
}
export type OperationType = 'payment_create' | 'subscription_create' | 'checkout_session' | 'capture' | 'void' | 'subscription_change' | 'subscription_cancel' | 'subscription_renewal' | 'customer_create'
export type LeaseState = 'active' | 'released' | 'expired' | 'superseded'
export type Operation = {
  operationId: string
  resource: { kind: 'payment' | 'subscription' | 'checkout_session' | 'customer', id: string } | null
  error: DemoApiError | null
} & (
  | { type: 'checkout_session', leaseState: LeaseState | null }
  | { type: Exclude<OperationType, 'checkout_session'>, leaseState?: never }
) & (
  | { execution: 'accepted' | 'unknown', outcome: null }
  | { execution: 'completed', outcome: 'scheduled' | 'effective' | 'rejected' }
)

type RuleValue = string | number | boolean | null
export type RequiredWhen = { field: string } & (
  | { equals: RuleValue, in?: never }
  | { in: RuleValue[], equals?: never }
)
export interface ParameterRule {
  field: string
  type: 'amount' | 'enum' | 'integer' | 'date' | 'text' | 'httpsUrl'
  min?: number
  max?: number
  precision?: number
  enum?: RuleValue[]
  requiredWhen?: RequiredWhen
  errorCode: string
}
export interface CapabilityCombination {
  sceneId: SceneId
  integration: Integration
  platform: Platform
  availability: Availability
  verification: Verification
  reasonCode: string | null
  rules: ParameterRule[]
}
export interface Scene {
  id: SceneId
}
export interface Preset {
  id: 'usd_standard_5' | 'usd_3ds_50'
  sceneIds: SceneId[]
  integrations: Integration[]
  platforms: Platform[]
  defaults: { amount?: Amount }
  availability: Availability
  verification: Verification
  reasonCode: string | null
}
export interface Capabilities {
  capabilitiesRevision: string
  scenes: Scene[]
  presets: Preset[]
  combinations: CapabilityCombination[]
  limits: { customersPerSession: number }
}
