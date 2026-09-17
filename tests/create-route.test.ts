import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCheckoutPayment: vi.fn(), createPayment: vi.fn(), completePaymentRecord: vi.fn(),
  claimPaymentCreation: vi.fn(), getPaymentRecovery: vi.fn(), requireIp: vi.fn(), ensurePaymentCustomer: vi.fn(),
}))
vi.mock('../server/utils/gateway', () => ({
  ...mocks, GatewayError: class extends Error {},
  createQueryExpiry: () => '2026-09-14T00:05:00.000Z', createQueryToken: () => 'q'.repeat(43),
}))
vi.mock('../server/utils/store', () => ({ ...mocks, PaymentStoreError: class extends Error {} }))
vi.mock('../server/utils/profile', () => ({ requireServerProfile: () => ({ profile: 'sandbox', merchantNo: 'merchant-1', appId: 'app-1', secret: 'secret', showcaseOrigin: 'https://showcase.example' }) }))
vi.mock('../server/utils/recovery', () => ({
  readPaymentRecovery: () => ({ orderId: 'order-1', attemptId: 'attempt-1' }), setPaymentRecovery: vi.fn(),
}))
vi.mock('../server/utils/limit', () => ({
  requireCanonicalPaymentOrigin: vi.fn(), requireIp: mocks.requireIp,
  withPaymentLimit: (_event: unknown, _kind: string, task: (ip: string) => unknown) => task('127.0.0.1'),
}))

const customer = { environment: 'sandbox', merchantNo: 'merchant-1', appId: 'app-1', merchantCustId: 'cust_existing' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({}))
  vi.stubGlobal('getHeader', vi.fn())
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))
  const attempt = { id: 'attempt-1', orderId: 'order-1', integration: 'checkout', method: 'all', merchantTxnId: 'merchant-txn-1', status: 'created' }
  mocks.getPaymentRecovery.mockResolvedValue({ order: { id: 'order-1' }, attempt, attempts: [attempt], events: [], customer })
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
      order: { id: 'order-1' }, merchantTxnId: 'merchant-txn-1', merchantCustId: customer.merchantCustId, returnUrl: 'https://showcase.example/halden/return/order-1',
    })
    expect(mocks.ensurePaymentCustomer).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain(customer.merchantCustId)
    expect(JSON.stringify(result)).not.toContain('merchantCustId')
    expect(mocks.createPayment).not.toHaveBeenCalled()
    expect(mocks.requireIp).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.completePaymentRecord.mock.calls)).not.toContain('ephemeral')
    expect(JSON.stringify(result.event)).not.toContain('ephemeral')
  })

  it.each([
    [500, 'HL-CHECKOUT-005'],
    [5_000, 'HL-CHECKOUT-050'],
  ])('passes the persisted USD %s order unchanged to the Checkout gateway', async (minor, sku) => {
    const recovery = await mocks.getPaymentRecovery()
    const order = {
      id: 'order-1', scene: 'ecommerce', amount: { minor, currency: 'USD' },
      item: { sku, name: 'Halden sample', variant: minor === 500 ? 'Hosted checkout' : 'Hosted checkout 3DS', quantity: 1, unitAmount: { minor, currency: 'USD' } },
    }
    mocks.getPaymentRecovery.mockResolvedValue({ ...recovery, order })
    const { default: handler } = await import('../server/api/payment/create.post')
    const result = await (handler as (event: unknown) => Promise<Record<string, unknown>>)({})

    expect(mocks.createCheckoutPayment.mock.calls[0]?.[1].order).toBe(order)
    expect(result.order).toBe(order)
    expect(mocks.createCheckoutPayment).toHaveBeenCalledWith(expect.anything(), {
      order, merchantTxnId: 'merchant-txn-1', merchantCustId: customer.merchantCustId, returnUrl: 'https://showcase.example/halden/return/order-1',
    })
    expect(mocks.createPayment).not.toHaveBeenCalled()
  })

  it.each([
    { merchantCustId: 'cust_client_override' }, { tokenId: 'token_client' }, { integration: 'web-js-sdk' }, { language: 'en-US' }, { amountMinor: 500 },
    { amount: { minor: 5_000, currency: 'USD' } }, { journeyId: 'three-ds-success' }, null,
  ])('rejects nonempty browser inputs before claiming creation %#', async (input) => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue(input))
    const { default: handler } = await import('../server/api/payment/create.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.claimPaymentCreation).not.toHaveBeenCalled()
    expect(mocks.createCheckoutPayment).not.toHaveBeenCalled()
  })

  it('backfills a legacy customer before claiming creation and sends the stored winner', async () => {
    const recovery = await mocks.getPaymentRecovery()
    mocks.getPaymentRecovery.mockResolvedValue({ ...recovery, customer: null })
    const winner = { ...customer, merchantCustId: 'cust_atomic_winner' }
    mocks.ensurePaymentCustomer.mockResolvedValue(winner)
    const { default: handler } = await import('../server/api/payment/create.post')
    const result = await (handler as (event: unknown) => Promise<unknown>)({})

    expect(mocks.ensurePaymentCustomer).toHaveBeenCalledWith('order-1', expect.objectContaining({
      environment: 'sandbox', merchantNo: 'merchant-1', appId: 'app-1', merchantCustId: expect.stringMatching(/^cust_/),
    }))
    expect(mocks.ensurePaymentCustomer.mock.invocationCallOrder[0]).toBeLessThan(mocks.claimPaymentCreation.mock.invocationCallOrder[0]!)
    expect(mocks.createCheckoutPayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ merchantCustId: winner.merchantCustId }))
    expect(JSON.stringify(result)).not.toContain(winner.merchantCustId)
  })

  it.each([
    { environment: 'production' }, { merchantNo: 'another-merchant' }, { appId: 'another-app' }, { merchantCustId: 'invalid customer' },
  ])('rejects customer scope mismatch before claiming or contacting Provider %#', async (override) => {
    const recovery = await mocks.getPaymentRecovery()
    mocks.getPaymentRecovery.mockResolvedValue({ ...recovery, customer: { ...customer, ...override } })
    const { default: handler } = await import('../server/api/payment/create.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
    expect(mocks.claimPaymentCreation).not.toHaveBeenCalled()
    expect(mocks.createCheckoutPayment).not.toHaveBeenCalled()
    expect(mocks.ensurePaymentCustomer).not.toHaveBeenCalled()
  })

  it('checks the scope returned by atomic legacy backfill', async () => {
    const recovery = await mocks.getPaymentRecovery()
    mocks.getPaymentRecovery.mockResolvedValue({ ...recovery, customer: null })
    mocks.ensurePaymentCustomer.mockResolvedValue({ ...customer, appId: 'another-app' })
    const { default: handler } = await import('../server/api/payment/create.post')
    await expect((handler as (event: unknown) => Promise<unknown>)({})).rejects.toMatchObject({ statusMessage: 'PAYMENT_CUSTOMER_SCOPE_MISMATCH' })
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
