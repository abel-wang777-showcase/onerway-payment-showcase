import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCheckoutPayment: vi.fn(), createPayment: vi.fn(), completePaymentRecord: vi.fn(),
  claimPaymentCreation: vi.fn(), getPaymentRecovery: vi.fn(), requireIp: vi.fn(),
}))
vi.mock('../server/utils/gateway', () => ({
  ...mocks, GatewayError: class extends Error {},
  createQueryExpiry: () => '2026-09-14T00:05:00.000Z', createQueryToken: () => 'q'.repeat(43),
}))
vi.mock('../server/utils/store', () => ({ ...mocks, PaymentStoreError: class extends Error {} }))
vi.mock('../server/utils/profile', () => ({ requireServerProfile: () => ({ profile: 'sandbox', secret: 'secret', showcaseOrigin: 'https://showcase.example' }) }))
vi.mock('../server/utils/recovery', () => ({
  readPaymentRecovery: () => ({ orderId: 'order-1', attemptId: 'attempt-1' }), setPaymentRecovery: vi.fn(),
}))
vi.mock('../server/utils/limit', () => ({
  requireCanonicalPaymentOrigin: vi.fn(), requireIp: mocks.requireIp,
  withPaymentLimit: (_event: unknown, _kind: string, task: (ip: string) => unknown) => task('127.0.0.1'),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({}))
  vi.stubGlobal('getHeader', vi.fn())
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))
  const attempt = { id: 'attempt-1', orderId: 'order-1', integration: 'checkout', method: 'all', merchantTxnId: 'merchant-txn-1', status: 'created' }
  mocks.getPaymentRecovery.mockResolvedValue({ order: { id: 'order-1' }, attempt, attempts: [attempt], events: [] })
  mocks.claimPaymentCreation.mockResolvedValue({ outcome: 'claimed' })
  mocks.createCheckoutPayment.mockResolvedValue({ paymentId: '111', transactionId: '222', rawStatus: 'U', redirectUrl: 'https://sandbox-checkout.onerway.com/checkout?session=ephemeral' })
  mocks.completePaymentRecord.mockResolvedValue({ ...attempt, paymentId: '111', transactionId: '222' })
})

describe('Hosted Checkout create route', () => {
  it('dispatches from persisted integration, returns the URL only to this request, and omits device collection', async () => {
    const { default: handler } = await import('../server/api/payment/create.post')
    const result = await (handler as (event: unknown) => Promise<Record<string, unknown>>)({})
    expect(result.redirectUrl).toBe('https://sandbox-checkout.onerway.com/checkout?session=ephemeral')
    expect(mocks.createCheckoutPayment).toHaveBeenCalledWith(expect.anything(), {
      order: { id: 'order-1' }, merchantTxnId: 'merchant-txn-1', returnUrl: 'https://showcase.example/halden/return/order-1',
    })
    expect(mocks.createPayment).not.toHaveBeenCalled()
    expect(mocks.requireIp).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.completePaymentRecord.mock.calls)).not.toContain('ephemeral')
    expect(JSON.stringify(result.event)).not.toContain('ephemeral')
  })

  it.each([{ integration: 'checkout' }, { language: 'en-US' }, null])('rejects nonempty browser inputs before claiming creation %#', async (input) => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue(input))
    const { default: handler } = await import('../server/api/payment/create.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.claimPaymentCreation).not.toHaveBeenCalled()
    expect(mocks.createCheckoutPayment).not.toHaveBeenCalled()
  })

  it('does not resend an already claimed or unknown create', async () => {
    mocks.claimPaymentCreation.mockResolvedValue({ outcome: 'existing' })
    const { default: handler } = await import('../server/api/payment/create.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusMessage: 'PAYMENT_CREATE_IN_PROGRESS' })
    expect(mocks.createCheckoutPayment).not.toHaveBeenCalled()
  })
})
