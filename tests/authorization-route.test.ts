import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJourney } from '../shared/payment/journey'

const mocks = vi.hoisted(() => ({
  getPaymentRecovery: vi.fn(), claimStoredAuthorizationOperation: vi.fn(),
  recordAuthorizationOperationResponse: vi.fn(), executeAuthorizationOperation: vi.fn(),
  readPaymentRecovery: vi.fn(), requireServerProfile: vi.fn(), requireCanonicalPaymentOrigin: vi.fn(),
}))
vi.mock('../server/utils/store', () => ({
  ...mocks,
  PaymentStoreError: class extends Error { readonly code = 'PAYMENT_DATABASE_ERROR' },
}))
vi.mock('../server/utils/gateway', () => ({
  executeAuthorizationOperation: mocks.executeAuthorizationOperation,
  GatewayError: class extends Error {},
}))
vi.mock('../server/utils/profile', () => ({ requireServerProfile: mocks.requireServerProfile }))
vi.mock('../server/utils/recovery', () => ({ readPaymentRecovery: mocks.readPaymentRecovery }))
vi.mock('../server/utils/limit', () => ({
  requireCanonicalPaymentOrigin: mocks.requireCanonicalPaymentOrigin,
  withPaymentLimit: (_event: unknown, _kind: string, task: () => Promise<unknown>) => task(),
}))

const customer = { environment: 'sandbox', merchantNo: 'merchant-1', appId: 'app-1', merchantCustId: 'cust_1' }
const authorization = {
  fundsStatus: 'authorized', authTransactionId: '10001', paymentId: '20001',
  authMerchantTxnId: 'auth-merchant-1', amountMinor: 500, currency: 'USD', updatedAt: '2026-09-18T00:00:00.000Z',
}
function recovery() {
  const journey = getJourney('hosted-authorization')
  const attempt = {
    id: 'attempt-1', orderId: 'order-1', integration: 'checkout', method: 'card',
    paymentId: '20001', merchantTxnId: 'auth-merchant-1', status: 'processing', authorization,
  }
  return {
    order: {
      id: 'order-1', scene: journey.scene, amount: { minor: journey.amount, currency: journey.currency },
      item: { sku: journey.sku, name: journey.item, variant: journey.variant, quantity: 1, unitAmount: { minor: journey.amount, currency: journey.currency } },
    },
    attempt, attempts: [attempt], events: [], customer, subscription: null,
  }
}
async function request() {
  const { default: handler } = await import('../server/api/payment/authorization/[orderId].post')
  return (handler as (event: unknown) => Promise<Record<string, unknown>>)({})
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('getRouterParam', () => 'order-1')
  vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ type: 'CAPTURE' }))
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))
  mocks.requireServerProfile.mockReturnValue({ profile: 'sandbox', merchantNo: 'merchant-1', appId: 'app-1', secret: 'test-secret', showcaseOrigin: 'https://showcase.example' })
  mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: 'attempt-1' })
  mocks.getPaymentRecovery.mockResolvedValue(recovery())
  mocks.claimStoredAuthorizationOperation.mockResolvedValue({ claimed: true, attempt: recovery().attempt })
  mocks.recordAuthorizationOperationResponse.mockResolvedValue({ attempt: recovery().attempt })
  mocks.executeAuthorizationOperation.mockResolvedValue({ transactionId: '10002', paymentId: '20001', transactionStatus: 'S' })
})

describe('authorization operation route', () => {
  it.each(['CAPTURE', 'VOID'])('claims %s before sending only persisted IDs and amount to Provider', async (type) => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ type }))
    const result = await request()
    expect(mocks.readPaymentRecovery).toHaveBeenCalledWith({}, 'test-secret', 'order-1')
    expect(mocks.requireCanonicalPaymentOrigin).toHaveBeenCalledWith({}, 'https://showcase.example')
    expect(mocks.claimStoredAuthorizationOperation).toHaveBeenCalledWith('attempt-1', type, expect.stringMatching(/^showcase-/), expect.any(String))
    expect(mocks.executeAuthorizationOperation).toHaveBeenCalledWith(expect.anything(), {
      type, merchantTxnId: expect.stringMatching(/^showcase-/), originTransactionId: '10001',
      paymentId: '20001', amountMinor: 500, currency: 'USD',
    })
    expect(mocks.claimStoredAuthorizationOperation.mock.invocationCallOrder[0]).toBeLessThan(mocks.executeAuthorizationOperation.mock.invocationCallOrder[0]!)
    expect(mocks.executeAuthorizationOperation.mock.invocationCallOrder[0]).toBeLessThan(mocks.recordAuthorizationOperationResponse.mock.invocationCallOrder[0]!)
    expect(result.query).toBeNull()
    expect(JSON.stringify(result)).not.toContain('cust_1')
  })

  it('does not resend or switch an already claimed operation', async () => {
    mocks.claimStoredAuthorizationOperation.mockResolvedValue({ claimed: false, attempt: recovery().attempt })
    await request()
    expect(mocks.executeAuthorizationOperation).not.toHaveBeenCalled()
    expect(mocks.recordAuthorizationOperationResponse).not.toHaveBeenCalled()
  })

  it('persists an unknown outcome after a gateway error and returns the locked recovery', async () => {
    const { GatewayError } = await import('../server/utils/gateway')
    mocks.executeAuthorizationOperation.mockRejectedValue(new GatewayError('PAYMENT_NETWORK_ERROR'))
    const latest = recovery()
    mocks.getPaymentRecovery.mockResolvedValueOnce(latest).mockResolvedValueOnce({
      ...latest, attempt: { ...latest.attempt, authorization: { ...authorization, operation: { type: 'CAPTURE', merchantTxnId: 'capture-1', status: 'unknown' } } },
    })
    const result = await request()
    expect(mocks.recordAuthorizationOperationResponse).toHaveBeenCalledWith('attempt-1', expect.any(String), null, expect.any(String))
    expect(result.attempt).toMatchObject({ authorization: { fundsStatus: 'authorized', operation: { status: 'unknown' } } })
  })

  it.each([null, {}, { type: 'REFUND' }, { type: 'CAPTURE', amount: 1 }, { type: 'VOID', paymentId: 'other' }, { type: 'CAPTURE', customer: 'other' }])('rejects input overrides %#', async (body) => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue(body))
    await expect(request()).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.claimStoredAuthorizationOperation).not.toHaveBeenCalled()
  })

  it.each([null, { orderId: 'other-order', attemptId: 'other-attempt' }])('rejects missing, foreign or stale-tab recovery %#', async (ref) => {
    mocks.readPaymentRecovery.mockReturnValue(ref)
    await expect(request()).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.getPaymentRecovery).not.toHaveBeenCalled()
    expect(mocks.executeAuthorizationOperation).not.toHaveBeenCalled()
  })

  it.each([
    { customer: { ...customer, appId: 'other-app' } },
    { customer: null },
    { subscription: {} },
    { attempt: { ...recovery().attempt, authorization: undefined } },
    { attempt: { ...recovery().attempt, integration: 'web-js-sdk' } },
    { order: { ...recovery().order, amount: { minor: 50, currency: 'USD' } } },
  ])('rejects a different customer scope or non-authorization record %#', async (override) => {
    mocks.getPaymentRecovery.mockResolvedValue({ ...recovery(), ...override })
    await expect(request()).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.claimStoredAuthorizationOperation).not.toHaveBeenCalled()
    expect(mocks.executeAuthorizationOperation).not.toHaveBeenCalled()
  })

  it('keeps production locked', async () => {
    mocks.requireServerProfile.mockReturnValue({ profile: 'production' })
    await expect(request()).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.executeAuthorizationOperation).not.toHaveBeenCalled()
  })

  it('rejects a noncanonical origin before claiming', async () => {
    mocks.requireCanonicalPaymentOrigin.mockImplementationOnce(() => { throw Object.assign(new Error('origin'), { statusCode: 403 }) })
    await expect(request()).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.claimStoredAuthorizationOperation).not.toHaveBeenCalled()
  })
})
