export const PAYMENT_FAILURE_SOURCES = [
  'load',
  'create',
  'query',
  'confirm',
  'recovery',
  'retry',
] as const
export type PaymentFailureSource = typeof PAYMENT_FAILURE_SOURCES[number]

export const PAYMENT_ACTIONS = [
  'reload_element',
  'recover_attempt',
  'verify_attempt',
  'retry_attempt',
  'retry_restoration',
  'start_clean_order',
  'return_hub',
] as const
export type PaymentAction = typeof PAYMENT_ACTIONS[number]
export type PaymentRestorationAction = Extract<PaymentAction, 'recover_attempt' | 'retry_restoration'>
export type SdkPaymentAction = Extract<
  PaymentAction,
  | 'reload_element'
  | 'recover_attempt'
  | 'verify_attempt'
  | 'retry_restoration'
  | 'start_clean_order'
>

export interface PaymentFailure {
  readonly source: PaymentFailureSource
  readonly action: PaymentAction
  readonly title: string
  readonly description: string
}

export function isPaymentRestorationAction(action?: PaymentAction): action is PaymentRestorationAction {
  return action === 'recover_attempt' || action === 'retry_restoration'
}

interface SdkPaymentActionContext {
  readonly failure: PaymentFailure | null
  readonly canVerify: boolean
  readonly submitted: boolean
}

interface FailureSignal {
  readonly status?: number
}

const views = Object.freeze({
  load: Object.freeze({
    action: 'reload_element',
    title: 'Secure form unavailable',
    description: 'Reload the hosted form for this existing payment. No new PaymentAttempt will be created.',
  }),
  create: Object.freeze({
    action: 'recover_attempt',
    title: 'Checkout creation interrupted',
    description: 'Restore the existing PaymentAttempt before any new Sandbox order is considered.',
  }),
  query: Object.freeze({
    action: 'verify_attempt',
    title: 'Verification interrupted',
    description: 'Refresh recovery authorization, then verify this same PaymentAttempt again.',
  }),
  confirm: Object.freeze({
    action: 'verify_attempt',
    title: 'Submission result unknown',
    description: 'Verify this same PaymentAttempt. Do not submit the hosted form again.',
  }),
  retry: Object.freeze({
    action: 'recover_attempt',
    title: 'Retry result unknown',
    description: 'Restore this order. The server will return the existing retry child if one was already created.',
  }),
} as const satisfies Record<Exclude<PaymentFailureSource, 'recovery'>, {
  readonly action: PaymentAction
  readonly title: string
  readonly description: string
}>)

export function getPaymentFailure(
  source: PaymentFailureSource,
  signal: FailureSignal = {},
): PaymentFailure {
  if (source === 'recovery') {
    const unauthorized = signal.status !== undefined
      && [400, 401, 403, 404].includes(signal.status)

    return Object.freeze({
      source,
      action: unauthorized ? 'return_hub' : 'retry_restoration',
      title: unauthorized ? 'Payment could not be restored' : 'Restoration interrupted',
      description: unauthorized
        ? 'No authorized persisted PaymentAttempt matched this browser session.'
        : 'Retry restoration for the same order without creating a new payment.',
    })
  }

  return Object.freeze({ source, ...views[source] })
}

export function getSdkPaymentActions(
  context: SdkPaymentActionContext,
): readonly SdkPaymentAction[] {
  const action = context.failure?.action

  if (isPaymentRestorationAction(action)) {
    return Object.freeze([action])
  }

  if (context.failure?.action === 'reload_element' && !context.submitted) {
    return Object.freeze(['reload_element', 'start_clean_order'])
  }

  if (context.failure?.action === 'verify_attempt' && context.canVerify) {
    return Object.freeze(['verify_attempt'])
  }

  if (context.failure) {
    return Object.freeze([])
  }

  return context.canVerify ? Object.freeze(['verify_attempt']) : Object.freeze([])
}
