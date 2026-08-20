import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryPaymentMethod: vi.fn(),
  recordPaymentMethodDetails: vi.fn(),
}))

vi.mock('../server/utils/gateway', () => ({
  GatewayError: class GatewayError extends Error {},
  queryPaymentMethod: mocks.queryPaymentMethod,
}))

vi.mock('../server/utils/store', () => ({
  PaymentStoreError: class PaymentStoreError extends Error {},
  recordPaymentMethodDetails: mocks.recordPaymentMethodDetails,
}))

const profile = { profile: 'sandbox' } as const
const attempt = {
  id: 'attempt-1',
  orderId: 'order-1',
  integration: 'web-js-sdk',
  method: 'google-pay',
  status: 'succeeded',
  statusSource: 'query',
  merchantTxnId: 'showcase-1',
  paymentId: '9000000000000000001',
  transactionId: '9000000000000000002',
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
} as const

describe('server payment method enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treats transaction-list gateway failures as missing metadata, not payment failure', async () => {
    const { GatewayError } = await import('../server/utils/gateway')
    const { findDirectPaymentMethod } = await import('../server/utils/method')
    mocks.queryPaymentMethod.mockRejectedValue(new GatewayError('unavailable'))

    await expect(findDirectPaymentMethod(
      profile as never,
      attempt.paymentId,
      attempt.transactionId,
    )).resolves.toBeNull()
  })

  it('persists only the strictly projected transaction-list metadata', async () => {
    const details = {
      paymentId: attempt.paymentId,
      transactionId: attempt.transactionId,
      actualWallet: 'google-pay' as const,
      fundingNetwork: 'VISA',
    }
    const enriched = { ...attempt, ...details }
    mocks.queryPaymentMethod.mockResolvedValue(details)
    mocks.recordPaymentMethodDetails.mockResolvedValue(enriched)

    const { enrichDirectPaymentMethod } = await import('../server/utils/method')
    await expect(enrichDirectPaymentMethod(
      profile as never,
      attempt,
      attempt.transactionId,
      '2026-08-19T00:00:01.000Z',
    )).resolves.toEqual(enriched)
    expect(mocks.recordPaymentMethodDetails).toHaveBeenCalledWith(
      attempt.id,
      attempt.paymentId,
      details,
      '2026-08-19T00:00:01.000Z',
    )
  })

  it('does not query again after the current transaction is attributed', async () => {
    const { enrichDirectPaymentMethod } = await import('../server/utils/method')
    const attributed = {
      ...attempt,
      actualWallet: 'google-pay' as const,
      fundingNetwork: 'VISA',
      attributionTransactionId: attempt.transactionId,
    }

    await expect(enrichDirectPaymentMethod(
      profile as never,
      attributed,
      attempt.transactionId,
      '2026-08-19T00:00:01.000Z',
    )).resolves.toBe(attributed)
    expect(mocks.queryPaymentMethod).not.toHaveBeenCalled()
  })

  it('queries again when a fresh payment query advances the transaction', async () => {
    const details = {
      paymentId: attempt.paymentId,
      transactionId: attempt.transactionId,
      fundingNetwork: 'MASTERCARD',
    }
    const staleAttribution = {
      ...attempt,
      actualWallet: 'google-pay' as const,
      fundingNetwork: 'VISA',
      attributionTransactionId: '9000000000000000001',
    }
    mocks.queryPaymentMethod.mockResolvedValue(details)
    mocks.recordPaymentMethodDetails.mockResolvedValue({
      ...attempt,
      fundingNetwork: 'MASTERCARD',
      attributionTransactionId: attempt.transactionId,
    })

    const { enrichDirectPaymentMethod } = await import('../server/utils/method')
    await enrichDirectPaymentMethod(
      profile as never,
      staleAttribution,
      attempt.transactionId,
      '2026-08-19T00:00:01.000Z',
    )

    expect(mocks.queryPaymentMethod).toHaveBeenCalledWith(
      profile,
      attempt.paymentId,
      attempt.transactionId,
    )
  })

  it('does not attribute when the fresh query transaction does not match the attempt', async () => {
    const { enrichDirectPaymentMethod } = await import('../server/utils/method')

    await expect(enrichDirectPaymentMethod(
      profile as never,
      attempt,
      '9000000000000000003',
      '2026-08-19T00:00:01.000Z',
    )).resolves.toBe(attempt)
    expect(mocks.queryPaymentMethod).not.toHaveBeenCalled()
  })

  it('keeps the persisted payment truth when method attribution cannot be stored', async () => {
    const { PaymentStoreError } = await import('../server/utils/store')
    const details = {
      paymentId: attempt.paymentId,
      transactionId: attempt.transactionId,
      actualWallet: 'google-pay' as const,
      fundingNetwork: 'VISA',
    }
    mocks.queryPaymentMethod.mockResolvedValue(details)
    mocks.recordPaymentMethodDetails.mockRejectedValue(new PaymentStoreError('mismatch'))

    const { enrichDirectPaymentMethod } = await import('../server/utils/method')
    await expect(enrichDirectPaymentMethod(
      profile as never,
      attempt,
      attempt.transactionId,
      '2026-08-19T00:00:01.000Z',
    )).resolves.toBe(attempt)
  })
})
