import type { Money } from './order'

export const SUBSCRIPTION_PLAN_IDS = [
  'halden-daily-essentials-v1',
] as const
export type SubscriptionPlanId = typeof SUBSCRIPTION_PLAN_IDS[number]

export type SubscriptionFrequencyType = 'D' | 'M' | 'Y'

export interface SubscriptionPlan {
  readonly id: SubscriptionPlanId
  readonly version: number
  readonly productName: string
  readonly amount: Money
  readonly frequencyType: SubscriptionFrequencyType
  readonly frequencyPoint: number
  readonly expireDate: string
}

export const SUBSCRIPTION_PLANS = Object.freeze({
  'halden-daily-essentials-v1': Object.freeze({
    id: 'halden-daily-essentials-v1',
    version: 1,
    productName: 'Halden Daily Essentials',
    amount: Object.freeze({ minor: 500, currency: 'USD' }),
    frequencyType: 'D',
    frequencyPoint: 1,
    expireDate: '2099-12-31',
  }),
}) satisfies Readonly<Record<SubscriptionPlanId, SubscriptionPlan>>

export function isSubscriptionPlanId(value: unknown): value is SubscriptionPlanId {
  return typeof value === 'string'
    && SUBSCRIPTION_PLAN_IDS.includes(value as SubscriptionPlanId)
}

export function getSubscriptionPlan(id: SubscriptionPlanId): SubscriptionPlan {
  return SUBSCRIPTION_PLANS[id]
}

export const SUBSCRIPTION_DATA_STATUSES = ['0', '1', '2', '3'] as const
export type SubscriptionDataStatus = typeof SUBSCRIPTION_DATA_STATUSES[number]

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'paymentdue',
  'active',
  'pastdue',
  'paused',
  'canceled',
  'ended',
] as const
export type SubscriptionStatus = typeof SUBSCRIPTION_STATUSES[number]

export const SUBSCRIPTION_STATES = [
  'pending',
  'active',
  'needs_attention',
  'terminal',
] as const
export type SubscriptionState = typeof SUBSCRIPTION_STATES[number]
export type SubscriptionStatusSource = 'placeholder' | 'query' | 'webhook'

const SUBSCRIPTION_STATUS_SOURCE_LABELS = Object.freeze({
  placeholder: 'Pending Provider contract evidence',
  query: 'Verified by contract query',
  webhook: 'Verified by Subscription Webhook',
}) satisfies Readonly<Record<SubscriptionStatusSource, string>>

export function subscriptionStatusSourceLabel(source: SubscriptionStatusSource): string {
  return SUBSCRIPTION_STATUS_SOURCE_LABELS[source]
}

export interface SubscriptionContract {
  readonly id: string
  readonly planId: SubscriptionPlanId
  readonly planVersion: number
  readonly productName: string
  readonly amount: Money
  readonly frequencyType: SubscriptionFrequencyType
  readonly frequencyPoint: number
  readonly expireDate: string
  readonly initialOrderId: string
  readonly initialAttemptId: string
  readonly state: SubscriptionState
  readonly statusSource: SubscriptionStatusSource
  readonly dataStatus: SubscriptionDataStatus
  readonly subscriptionStatus: SubscriptionStatus
  readonly contractId?: string
  readonly tokenId?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly terminalAt?: string
}

export interface SubscriptionSummary {
  readonly planId: SubscriptionPlanId
  readonly productName: string
  readonly amount: Money
  readonly frequencyType: SubscriptionFrequencyType
  readonly frequencyPoint: number
  readonly expireDate: string
  readonly state: SubscriptionState
  readonly statusSource: SubscriptionStatusSource
}

export function projectSubscriptionState(
  dataStatus: SubscriptionDataStatus,
  subscriptionStatus: SubscriptionStatus,
): SubscriptionState {
  if (dataStatus === '3' || ['canceled', 'ended'].includes(subscriptionStatus)) {
    return 'terminal'
  }

  if (dataStatus === '0' && subscriptionStatus === 'paymentdue') {
    return 'pending'
  }

  if (dataStatus === '1' && subscriptionStatus === 'active') {
    return 'active'
  }

  return 'needs_attention'
}

export function createSubscriptionPlaceholder(input: {
  readonly id: string
  readonly plan: SubscriptionPlan
  readonly initialOrderId: string
  readonly initialAttemptId: string
  readonly createdAt: string
}): SubscriptionContract {
  return Object.freeze({
    id: input.id,
    planId: input.plan.id,
    planVersion: input.plan.version,
    productName: input.plan.productName,
    amount: Object.freeze({ ...input.plan.amount }),
    frequencyType: input.plan.frequencyType,
    frequencyPoint: input.plan.frequencyPoint,
    expireDate: input.plan.expireDate,
    initialOrderId: input.initialOrderId,
    initialAttemptId: input.initialAttemptId,
    state: 'pending',
    statusSource: 'placeholder',
    dataStatus: '0',
    subscriptionStatus: 'paymentdue',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })
}

export function toSubscriptionSummary(contract: SubscriptionContract): SubscriptionSummary {
  return Object.freeze({
    planId: contract.planId,
    productName: contract.productName,
    amount: Object.freeze({ ...contract.amount }),
    frequencyType: contract.frequencyType,
    frequencyPoint: contract.frequencyPoint,
    expireDate: contract.expireDate,
    state: contract.state,
    statusSource: contract.statusSource,
  })
}
