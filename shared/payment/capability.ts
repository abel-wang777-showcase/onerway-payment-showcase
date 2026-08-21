export const SCENES = ['ecommerce', 'game', 'live', 'ai'] as const
export type SceneId = typeof SCENES[number]

export const INTEGRATIONS = ['web-js-sdk', 'checkout', 'direct-api'] as const
export type IntegrationId = typeof INTEGRATIONS[number]

export const PAYMENT_METHODS = ['card', 'apm', 'google-pay', 'apple-pay'] as const
export type PaymentMethodId = typeof PAYMENT_METHODS[number]

export const WALLET_PAYMENT_METHODS = ['google-pay', 'apple-pay'] as const
export type WalletPaymentMethodId = typeof WALLET_PAYMENT_METHODS[number]

export const CAPABILITY_STATUSES = [
  'available',
  'conditional',
  'planned',
  'unavailable',
] as const
export type CapabilityStatus = typeof CAPABILITY_STATUSES[number]

export interface Capability {
  readonly scene: SceneId
  readonly integration: IntegrationId
  readonly method: PaymentMethodId
  readonly status: CapabilityStatus
  readonly runnable: boolean
  readonly condition?: string
}

const walletConditions: Partial<Record<PaymentMethodId, string>> = {
  'google-pay': 'Requires an eligible Google Pay wallet, supported browser and merchant enablement.',
  'apple-pay': 'Requires an eligible Apple Pay wallet, supported Apple device and merchant enablement.',
}

function defineCapability(
  scene: SceneId,
  integration: IntegrationId,
  method: PaymentMethodId,
): Capability {
  if (scene === 'ecommerce' && integration === 'web-js-sdk' && method === 'card') {
    return Object.freeze({
      scene,
      integration,
      method,
      status: 'available',
      runnable: true,
    })
  }

  const condition = scene === 'ecommerce' && integration === 'web-js-sdk'
    ? walletConditions[method]
    : undefined

  return Object.freeze({
    scene,
    integration,
    method,
    status: condition ? 'conditional' : 'planned',
    runnable: Boolean(condition),
    ...(condition ? { condition } : {}),
  })
}

export const CAPABILITIES: readonly Capability[] = Object.freeze(
  SCENES.flatMap(scene =>
    INTEGRATIONS.flatMap(integration =>
      PAYMENT_METHODS.map(method => defineCapability(scene, integration, method)),
    ),
  ),
)

export function getCapability(
  scene: SceneId,
  integration: IntegrationId,
  method: PaymentMethodId,
): Capability {
  const capability = CAPABILITIES.find(item =>
    item.scene === scene
    && item.integration === integration
    && item.method === method,
  )

  if (!capability) {
    throw new Error(`Unknown capability: ${scene}/${integration}/${method}`)
  }

  return capability
}

export function isAvailable(
  scene: SceneId,
  integration: IntegrationId,
  method: PaymentMethodId,
): boolean {
  return getCapability(scene, integration, method).status === 'available'
}

export function isRunnable(
  scene: SceneId,
  integration: IntegrationId,
  method: PaymentMethodId,
): boolean {
  return getCapability(scene, integration, method).runnable
}
