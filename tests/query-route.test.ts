import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSubscriptionForAttempt: vi.fn(), enrichDirectPaymentMethod: vi.fn(), querySubscription: vi.fn(), recordSubscriptionQueryDetails: vi.fn(),
  getPaymentQueryContext: vi.fn(), queryPayment: vi.fn(), queryCheckoutPayment: vi.fn(), recordQueryEvent: vi.fn(), verifyQueryToken: vi.fn(),
}))
vi.mock('../server/utils/gateway', () => ({ ...mocks, GatewayError: class extends Error {} }))
vi.mock('../server/utils/store', () => ({
  ...mocks, PaymentStoreError: class extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code } },
}))
vi.mock('../server/utils/method', () => ({ enrichDirectPaymentMethod: mocks.enrichDirectPaymentMethod }))
vi.mock('../server/utils/profile', () => ({ requireServerProfile: () => ({ profile: 'sandbox', secret: 'secret' }) }))
vi.mock('../server/utils/limit', () => ({ withPaymentLimit: (_event: unknown, _kind: string, task: () => unknown) => task() }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ attemptId: 'attempt-1', paymentId: '111', token: 'q'.repeat(43), expiresAt: '2026-09-14T00:05:00.000Z' }))
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))
  mocks.getSubscriptionForAttempt.mockResolvedValue(null)
  mocks.enrichDirectPaymentMethod.mockImplementation(async (_profile, attempt) => attempt)
  mocks.verifyQueryToken.mockReturnValue(true)
  mocks.getPaymentQueryContext.mockResolvedValue({
    order: { amount: { minor: 500, currency: 'USD' } },
    attempt: { integration: 'checkout', merchantTxnId: 'merchant-txn-1', paymentId: '111', transactionId: '222' },
  })
  mocks.queryCheckoutPayment.mockResolvedValue({ status: 'succeeded', rawStatus: 'S', transactionStatus: 'S', transactionId: '222', paymentId: '111' })
  mocks.recordQueryEvent.mockResolvedValue({ attempt: {}, event: {} })
})

describe('payment query dispatch', () => {
  it('uses the authenticated persisted integration and order values for transaction query', async () => {
    const { default: handler } = await import('../server/api/payment/query.post')
    await (handler as (event: unknown) => Promise<unknown>)({})
    expect(mocks.getPaymentQueryContext).toHaveBeenCalledWith('attempt-1', '111')
    expect(mocks.queryCheckoutPayment).toHaveBeenCalledWith(expect.anything(), {
      merchantTxnId: 'merchant-txn-1', amountMinor: 500, currency: 'USD', transactionId: '222', paymentId: '111',
    })
    expect(mocks.queryPayment).not.toHaveBeenCalled()
    expect(mocks.enrichDirectPaymentMethod).not.toHaveBeenCalled()
  })

  it('keeps SDK Payment query and its fresh transaction method attribution', async () => {
    mocks.getPaymentQueryContext.mockResolvedValue({
      order: { amount: { minor: 500, currency: 'USD' } },
      attempt: { integration: 'web-js-sdk', paymentId: '111', transactionId: '222' },
    })
    mocks.queryPayment.mockResolvedValue({ paymentId: '111', transactionId: '333', rawStatus: 'S', status: 'succeeded' })
    mocks.recordQueryEvent.mockResolvedValue({ attempt: { id: 'attempt-1', paymentId: '111', transactionId: '333' }, event: {} })

    const { default: handler } = await import('../server/api/payment/query.post')
    await (handler as (event: unknown) => Promise<unknown>)({})

    expect(mocks.queryPayment).toHaveBeenCalledWith(expect.anything(), '111')
    expect(mocks.queryCheckoutPayment).not.toHaveBeenCalled()
    expect(mocks.enrichDirectPaymentMethod).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ transactionId: '333' }), '333', expect.any(String),
    )
  })

  it('rejects invalid capability before reading storage or calling provider', async () => {
    mocks.verifyQueryToken.mockReturnValue(false)
    const { default: handler } = await import('../server/api/payment/query.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.getPaymentQueryContext).not.toHaveBeenCalled()
    expect(mocks.queryCheckoutPayment).not.toHaveBeenCalled()
  })

  it('rejects a missing persisted attempt before contacting provider', async () => {
    mocks.getPaymentQueryContext.mockResolvedValue(null)
    const { default: handler } = await import('../server/api/payment/query.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.queryCheckoutPayment).not.toHaveBeenCalled()
  })
})
