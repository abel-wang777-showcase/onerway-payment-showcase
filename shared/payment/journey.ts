import type { IntegrationId, PaymentMethodId, SceneId } from './capability'
import type { Currency, Order } from './order'
import type { DemoStage } from './state'

export const JOURNEY_IDS = [
  'apple-pay-direct',
  'hosted-checkout',
  'hosted-checkout-three-ds',
  'hosted-authorization',
  'standard-success',
  'three-ds-success',
  'processing-recovery',
  'cancelled-retry',
  'deterministic-failure',
  'form-load-recovery',
] as const
export type JourneyId = typeof JOURNEY_IDS[number]

export interface Journey {
  readonly id: JourneyId
  readonly label: string
  readonly description: string
  readonly scene: SceneId
  readonly integration: IntegrationId
  readonly method: PaymentMethodId
  readonly sandboxMethods: readonly PaymentMethodId[]
  readonly country: 'US'
  readonly currency: Currency
  readonly amount: number
  readonly orderId: string
  readonly sku: string
  readonly item: string
  readonly variant: string
  readonly modes: readonly ('simulation' | 'sandbox')[]
  readonly stages: readonly DemoStage[]
}

export const JOURNEYS = Object.freeze({
  'apple-pay-direct': Object.freeze({
    id: 'apple-pay-direct',
    label: 'USD 5.00 · Apple Pay Direct',
    description: 'Authorize with Apple Pay and follow the merchant validation, Direct API payment and server verification steps.',
    scene: 'ecommerce',
    integration: 'direct-api',
    method: 'apple-pay',
    sandboxMethods: Object.freeze(['apple-pay'] as const),
    country: 'US',
    currency: 'USD',
    amount: 500,
    orderId: 'HLD-APPLE-500',
    sku: 'HL-APPLE-005',
    item: 'Halden sample',
    variant: 'Apple Pay Direct',
    modes: Object.freeze(['sandbox'] as const),
    stages: Object.freeze([]),
  }),
  'hosted-authorization': Object.freeze({
    id: 'hosted-authorization',
    label: 'USD 5.00 · Card pre-authorization',
    description: 'Reserve funds on Onerway Checkout, then capture the full amount or release the hold.',
    scene: 'ecommerce',
    integration: 'checkout',
    method: 'card',
    sandboxMethods: Object.freeze(['card'] as const),
    country: 'US',
    currency: 'USD',
    amount: 500,
    orderId: 'HLD-AUTH-500',
    sku: 'HL-AUTH-005',
    item: 'Halden reservation',
    variant: 'Card pre-authorization',
    modes: Object.freeze(['sandbox'] as const),
    stages: Object.freeze([]),
  }),
  'hosted-checkout': Object.freeze({
    id: 'hosted-checkout',
    label: 'USD 5.00 · Hosted Checkout',
    description: 'Choose from the payment methods available on Onerway Checkout, then return to Halden for server verification.',
    scene: 'ecommerce',
    integration: 'checkout',
    method: 'all',
    sandboxMethods: Object.freeze(['all'] as const),
    country: 'US',
    currency: 'USD',
    amount: 500,
    orderId: 'HLD-HOSTED-500',
    sku: 'HL-CHECKOUT-005',
    item: 'Halden sample',
    variant: 'Hosted checkout',
    modes: Object.freeze(['sandbox'] as const),
    stages: Object.freeze([]),
  }),
  'hosted-checkout-three-ds': Object.freeze({
    id: 'hosted-checkout-three-ds',
    label: 'USD 50.00 · Hosted Checkout 3DS',
    description: 'Select Card on Onerway Checkout to exercise the Sandbox 3DS challenge, then return to Halden for server verification. Other methods depend on eligibility.',
    scene: 'ecommerce',
    integration: 'checkout',
    method: 'all',
    sandboxMethods: Object.freeze(['all'] as const),
    country: 'US',
    currency: 'USD',
    amount: 5_000,
    orderId: 'HLD-HOSTED-5000',
    sku: 'HL-CHECKOUT-050',
    item: 'Halden sample',
    variant: 'Hosted checkout 3DS',
    modes: Object.freeze(['sandbox'] as const),
    stages: Object.freeze([]),
  }),
  'standard-success': Object.freeze({
    id: 'standard-success',
    label: 'USD 5.00 · Standard success',
    description: 'A controlled one-time journey that completes without a 3DS challenge.',
    scene: 'ecommerce',
    integration: 'web-js-sdk',
    method: 'card',
    sandboxMethods: Object.freeze(['card', 'google-pay', 'apple-pay'] as const),
    country: 'US',
    currency: 'USD',
    amount: 500,
    orderId: 'HLD-DEMO-500',
    sku: 'HL-SAMPLE-005',
    item: 'Halden sample',
    variant: 'Travel size',
    modes: Object.freeze(['simulation', 'sandbox'] as const),
    stages: Object.freeze(['loading', 'ready', 'submitting', 'succeeded'] as const),
  }),
  'three-ds-success': Object.freeze({
    id: 'three-ds-success',
    label: 'USD 50.00 · 3DS Challenge',
    description: 'A controlled high-value journey that exercises the 3DS Challenge handoff and server-verified return.',
    scene: 'ecommerce',
    integration: 'web-js-sdk',
    method: 'card',
    sandboxMethods: Object.freeze(['card'] as const),
    country: 'US',
    currency: 'USD',
    amount: 5_000,
    orderId: 'HLD-DEMO-5000',
    sku: 'HL-SAMPLE-050',
    item: 'Halden sample',
    variant: 'Full size',
    modes: Object.freeze(['simulation', 'sandbox'] as const),
    stages: Object.freeze([
      'loading',
      'ready',
      'submitting',
      'redirecting',
      'verifying',
      'succeeded',
    ] as const),
  }),
  'processing-recovery': Object.freeze({
    id: 'processing-recovery',
    label: 'USD 5.00 · Processing recovery',
    description: 'A simulation-only payment that remains processing across refresh until explicitly verified.',
    scene: 'ecommerce',
    integration: 'web-js-sdk',
    method: 'card',
    sandboxMethods: Object.freeze([] as const),
    country: 'US',
    currency: 'USD',
    amount: 500,
    orderId: 'HLD-DEMO-PROCESSING',
    sku: 'HL-SIM-PROCESSING',
    item: 'Halden sample',
    variant: 'Processing fixture',
    modes: Object.freeze(['simulation'] as const),
    stages: Object.freeze(['loading', 'ready', 'submitting', 'processing', 'succeeded'] as const),
  }),
  'cancelled-retry': Object.freeze({
    id: 'cancelled-retry',
    label: 'USD 5.00 · Cancelled retry',
    description: 'A simulation-only cancelled outcome that demonstrates a linked same-order retry.',
    scene: 'ecommerce',
    integration: 'web-js-sdk',
    method: 'card',
    sandboxMethods: Object.freeze([] as const),
    country: 'US',
    currency: 'USD',
    amount: 500,
    orderId: 'HLD-DEMO-CANCELLED',
    sku: 'HL-SIM-CANCELLED',
    item: 'Halden sample',
    variant: 'Cancelled fixture',
    modes: Object.freeze(['simulation'] as const),
    stages: Object.freeze(['loading', 'ready', 'submitting', 'cancelled'] as const),
  }),
  'deterministic-failure': Object.freeze({
    id: 'deterministic-failure',
    label: 'USD 5.00 · Deterministic failure',
    description: 'A simulation-only failed outcome with no provider status or real Sandbox transaction.',
    scene: 'ecommerce',
    integration: 'web-js-sdk',
    method: 'card',
    sandboxMethods: Object.freeze([] as const),
    country: 'US',
    currency: 'USD',
    amount: 500,
    orderId: 'HLD-DEMO-FAILED',
    sku: 'HL-SIM-FAILED',
    item: 'Halden sample',
    variant: 'Failure fixture',
    modes: Object.freeze(['simulation'] as const),
    stages: Object.freeze(['loading', 'ready', 'submitting', 'failed'] as const),
  }),
  'form-load-recovery': Object.freeze({
    id: 'form-load-recovery',
    label: 'USD 5.00 · Form load recovery',
    description: 'A simulation-only pre-confirm load failure that reloads the same PaymentAttempt.',
    scene: 'ecommerce',
    integration: 'web-js-sdk',
    method: 'card',
    sandboxMethods: Object.freeze([] as const),
    country: 'US',
    currency: 'USD',
    amount: 500,
    orderId: 'HLD-DEMO-LOAD',
    sku: 'HL-SIM-LOAD',
    item: 'Halden sample',
    variant: 'Load fixture',
    modes: Object.freeze(['simulation'] as const),
    stages: Object.freeze(['loading', 'not_completed', 'ready', 'submitting', 'succeeded'] as const),
  }),
}) satisfies Readonly<Record<JourneyId, Journey>>

export function getJourney(id: JourneyId): Journey {
  return JOURNEYS[id]
}

export function isJourneyId(value: unknown): value is JourneyId {
  return typeof value === 'string' && JOURNEY_IDS.includes(value as JourneyId)
}

export function supportsSandboxMethod(journey: Journey, method: PaymentMethodId): boolean {
  return journey.modes.includes('sandbox') && journey.sandboxMethods.includes(method)
}

export function findOrderJourney(order: Order): Journey | null {
  return JOURNEY_IDS
    .map(getJourney)
    .find(journey =>
      journey.scene === order.scene
      && journey.sku === order.item.sku
      && journey.item === order.item.name
      && journey.variant === order.item.variant
      && order.item.quantity === 1
      && journey.amount === order.item.unitAmount.minor
      && journey.currency === order.item.unitAmount.currency
      && journey.amount === order.amount.minor
      && journey.currency === order.amount.currency,
    ) ?? null
}
