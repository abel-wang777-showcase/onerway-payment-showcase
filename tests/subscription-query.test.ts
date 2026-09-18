import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSubscriptionPlaceholder, getSubscriptionPlan } from '../shared/payment/subscription'
import type { ServerProfile } from '../server/utils/profile'

const mocks = vi.hoisted(() => ({ querySubscription: vi.fn(), recordSubscriptionQueryDetails: vi.fn(), getSubscriptionForAttempt: vi.fn() }))
vi.mock('../server/utils/gateway', () => ({ querySubscription: mocks.querySubscription }))
vi.mock('../server/utils/store', () => ({
  getSubscriptionForAttempt: mocks.getSubscriptionForAttempt,
  PaymentStoreError: class PaymentStoreError extends Error {},
  recordSubscriptionQueryDetails: mocks.recordSubscriptionQueryDetails,
}))

const profile = { profile: 'sandbox' } as Extract<ServerProfile, { profile: 'sandbox' }>
const contract = createSubscriptionPlaceholder({
  id: 'contract-local', plan: getSubscriptionPlan('halden-daily-essentials-v1'),
  initialOrderId: 'order-1', initialAttemptId: 'attempt-1', initialIntegration: 'checkout', createdAt: '2026-09-17T00:00:00.000Z',
})
const now = '2026-09-17T01:00:00.000Z'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSubscriptionForAttempt.mockResolvedValue(contract)
  mocks.querySubscription.mockResolvedValue({ contractId: 'provider-contract', tokenId: 'provider-token', state: 'active' })
  mocks.recordSubscriptionQueryDetails.mockResolvedValue({ ...contract, state: 'active' })
})

describe('subscription discovery from Checkout transaction query', () => {
  it('keeps successful payment separate from an undiscovered contract', async () => {
    const { refreshSubscription } = await import('../server/utils/subscription')
    expect(await refreshSubscription(profile, contract, { rawStatus: 'S', status: 'succeeded' }, now)).toBe(contract)
    expect(mocks.querySubscription).not.toHaveBeenCalled()
    expect(mocks.recordSubscriptionQueryDetails).not.toHaveBeenCalled()
  })

  it('queries newly discovered contract and delegates customer-plan correlation before persisting', async () => {
    const { refreshSubscription } = await import('../server/utils/subscription')
    await refreshSubscription(profile, contract, {
      rawStatus: 'S', status: 'succeeded', subscription: { contractId: 'provider-contract', tokenId: 'provider-token' },
    }, now)
    expect(mocks.querySubscription).toHaveBeenCalledWith(profile, 'provider-contract')
    expect(mocks.recordSubscriptionQueryDetails).toHaveBeenCalledWith('attempt-1', {
      contractId: 'provider-contract', tokenId: 'provider-token', state: 'active',
    }, now)
  })

  it.each([
    { contractId: 'different-contract' },
    { contractId: 'provider-contract', tokenId: 'different-token' },
  ])('rejects a discovered identifier conflict %j before querying', async (subscription) => {
    const { refreshSubscription } = await import('../server/utils/subscription')
    await expect(refreshSubscription(profile, { ...contract, contractId: 'provider-contract', tokenId: 'provider-token' }, {
      rawStatus: 'S', status: 'succeeded', subscription,
    }, now)).rejects.toThrow('PAYMENT_ATTEMPT_MISMATCH')
    expect(mocks.querySubscription).not.toHaveBeenCalled()
  })

  it('rejects disagreement between transaction token and contract query token', async () => {
    const { refreshSubscription } = await import('../server/utils/subscription')
    await expect(refreshSubscription(profile, contract, {
      rawStatus: 'S', status: 'succeeded', subscription: { contractId: 'provider-contract', tokenId: 'different-token' },
    }, now)).rejects.toThrow('PAYMENT_ATTEMPT_MISMATCH')
    expect(mocks.recordSubscriptionQueryDetails).not.toHaveBeenCalled()
  })
})

it('returns the freshly persisted contract when Payment query terminalized its placeholder', async () => {
  const terminal = { ...contract, state: 'terminal', statusSource: 'query' }
  mocks.getSubscriptionForAttempt.mockResolvedValue(terminal)
  const { refreshSubscription } = await import('../server/utils/subscription')
  expect(await refreshSubscription(profile, contract, { rawStatus: 'N', status: 'cancelled' }, now)).toBe(terminal)
})

it('returns early Webhook activation instead of the stale pending snapshot', async () => {
  const active = { ...contract, state: 'active', statusSource: 'webhook', contractId: 'known-contract', tokenId: 'known-token' }
  mocks.getSubscriptionForAttempt.mockResolvedValue(active)
  const { refreshSubscription } = await import('../server/utils/subscription')
  expect(await refreshSubscription(profile, contract, { rawStatus: 'S', status: 'succeeded' }, now)).toBe(active)
})

it('requires independently confirmed token for a newly discovered active contract', async () => {
  mocks.querySubscription.mockResolvedValue({ contractId: 'provider-contract', state: 'active' })
  const { refreshSubscription } = await import('../server/utils/subscription')
  await expect(refreshSubscription(profile, contract, {
    rawStatus: 'S', status: 'succeeded', subscription: { contractId: 'provider-contract', tokenId: 'provider-token' },
  }, now)).rejects.toThrow('PAYMENT_ATTEMPT_MISMATCH')
  expect(mocks.recordSubscriptionQueryDetails).not.toHaveBeenCalled()
})
