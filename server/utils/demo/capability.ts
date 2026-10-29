import type { Capabilities, Platform } from '../../../shared/payment/demo'
import { DEMO_CUSTOMER_LIMIT } from './identity'

export const DEMO_REVISION = 'native-sale-v1'
export const DEMO_CONTINUE_MS = 30 * 60_000

export function demoCapabilities(): Capabilities {
  const scenes = ['one_time', 'pre_auth', 'subscription_hosted', 'subscription_merchant'] as const
  return {
    capabilitiesRevision: DEMO_REVISION,
    scenes: scenes.map(id => ({ id })),
    presets: [500, 5000].map((minor, index) => ({
      id: index === 0 ? 'usd_standard_5' : 'usd_3ds_50',
      sceneIds: ['one_time'], integrations: ['native-sdk'], platforms: ['ANDROID', 'IOS'],
      defaults: { amount: { minor, currency: 'USD' } },
      availability: 'conditional', verification: 'user_confirmed', reasonCode: 'SANDBOX_NOT_VERIFIED',
    })),
    combinations: scenes.flatMap(sceneId => (['ANDROID', 'IOS', 'WEB'] as Platform[]).map(platform => ({
      sceneId, platform, integration: 'native-sdk' as const,
      availability: sceneId === 'one_time' && platform !== 'WEB' ? 'conditional' as const : 'planned' as const,
      verification: 'user_confirmed' as const,
      reasonCode: sceneId === 'one_time' && platform !== 'WEB' ? 'SANDBOX_NOT_VERIFIED' : 'NOT_IMPLEMENTED',
      rules: [{ field: 'amount', type: 'amount' as const, min: 1, max: 1_000_000, precision: 2, errorCode: 'AMOUNT_INVALID' }],
    }))),
    limits: { customersPerSession: DEMO_CUSTOMER_LIMIT },
  }
}

export function canExecute(availability: string): boolean {
  return availability === 'available' || availability === 'conditional'
}
