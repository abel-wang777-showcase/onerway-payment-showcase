import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError, type H3Event } from 'h3'
import { createAttempt } from '../shared/payment/attempt'
import { createEvent } from '../shared/payment/event'
import { createOrder } from '../shared/payment/order'
import { JOURNEYS } from '../shared/payment/journey'
import { createMerchantCustomer } from '../server/utils/customer'
import type { ServerProfile } from '../server/utils/profile'
import type { PaymentRecovery } from '../server/utils/store'
import { assertDirectRecovery, canAuthorizeDirect, refreshDirectRecovery, requireDirectRecovery } from '../server/utils/direct'

const mocks = vi.hoisted(() => ({
  readPaymentRecovery: vi.fn(), getPaymentRecovery: vi.fn(), completePaymentRecord: vi.fn(),
  recordPaymentMethodDetails: vi.fn(),
  claimPaymentCreation: vi.fn(), queryApplePayPayment: vi.fn(), createApplePayPayment: vi.fn(),
  consultApplePay: vi.fn(), validateApplePayMerchant: vi.fn(), requireServerProfile: vi.fn(),
  requireCanonicalPaymentOrigin: vi.fn(), readBody: vi.fn(),
}))
vi.mock('../server/utils/recovery', () => ({ readPaymentRecovery: mocks.readPaymentRecovery }))
vi.mock('../server/utils/store', async (original) => ({
  ...await original<typeof import('../server/utils/store')>(),
  getPaymentRecovery: mocks.getPaymentRecovery, completePaymentRecord: mocks.completePaymentRecord,
  claimPaymentCreation: mocks.claimPaymentCreation, recordPaymentMethodDetails: mocks.recordPaymentMethodDetails,
}))
vi.mock('../server/utils/apple-pay', async (original) => ({
  ...await original<typeof import('../server/utils/apple-pay')>(),
  queryApplePayPayment: mocks.queryApplePayPayment, createApplePayPayment: mocks.createApplePayPayment,
  consultApplePay: mocks.consultApplePay, validateApplePayMerchant: mocks.validateApplePayMerchant,
}))
vi.mock('../server/utils/profile', () => ({ requireServerProfile: mocks.requireServerProfile }))
vi.mock('../server/utils/limit', () => ({
  requireCanonicalPaymentOrigin: mocks.requireCanonicalPaymentOrigin,
  requireIp: (value: string) => value,
  withPaymentLimit: (_event: unknown, _kind: unknown, run: (ip: string) => unknown) => run('203.0.113.1'),
}))

const profile = {
  profile: 'sandbox', secret: 'test-secret', merchantNo: 'test-merchant', appId: 'test-app',
  transactionPolicy: 'sandbox-only', showcaseOrigin: 'https://showcase.example',
} as Extract<ServerProfile, { profile: 'sandbox' }>
const now = '2026-09-23T00:00:00.000Z'
const event = { node: { req: {} } } as H3Event
const browser = { javaEnabled: false, colorDepth: '24', screenHeight: '800', screenWidth: '1200', timeZoneOffset: '0', contentLength: '0', language: 'en-US' }
const token = { paymentData: { version: 'EC_v1', data: 'fixture-data', signature: 'fixture-signature', header: { ephemeralPublicKey: 'fixture-key', publicKeyHash: 'fixture-hash', transactionId: 'fixture-transaction' } }, paymentMethod: { displayName: 'Test', network: 'Visa', type: 'debit' }, transactionIdentifier: 'fixture-identifier' }

function fixture(): PaymentRecovery {
  const journey = JOURNEYS['apple-pay-direct']
  const order = createOrder({ id: 'HLD-DIRECT-TEST', scene: 'ecommerce', createdAt: now,
    amount: { minor: 500, currency: 'USD' },
    item: { sku: journey.sku, name: journey.item, variant: journey.variant, quantity: 1, unitAmount: { minor: 500, currency: 'USD' } },
  })
  const attempt = createAttempt({ id: 'direct-attempt', orderId: order.id, integration: 'direct-api', method: 'apple-pay', merchantTxnId: 'merchant-direct', createdAt: now })
  return { order, attempt, attempts: [attempt], events: [], customer: createMerchantCustomer(profile), subscription: null }
}
function submitted(recovery = fixture()): PaymentRecovery {
  return { ...recovery, events: [createEvent({ id: 'claim', attemptId: recovery.attempt.id, source: 'server', sourceKey: `create-claim:${recovery.attempt.id}`, status: 'created', occurredAt: now })] }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('readBody', mocks.readBody)
  vi.stubGlobal('getHeader', () => undefined)
  mocks.requireServerProfile.mockReturnValue(profile)
  mocks.requireCanonicalPaymentOrigin.mockImplementation(() => {})
  const recovery = fixture()
  mocks.readPaymentRecovery.mockReturnValue({ orderId: recovery.order.id, attemptId: recovery.attempt.id })
  mocks.getPaymentRecovery.mockResolvedValue(recovery)
  mocks.readBody.mockResolvedValue({ orderId: recovery.order.id, attemptId: recovery.attempt.id, token, browser })
  mocks.claimPaymentCreation.mockResolvedValue({ outcome: 'claimed' })
  mocks.consultApplePay.mockResolvedValue({ merchantIdentifier: 'merchant.test', countryCode: 'US', supportedNetworks: ['visa'] })
  mocks.createApplePayPayment.mockResolvedValue({ transactionId: '1001', rawStatus: 'S', status: 'succeeded' })
  mocks.queryApplePayPayment.mockResolvedValue({ transactionId: '1001', rawStatus: 'S', status: 'succeeded' })
  mocks.validateApplePayMerchant.mockResolvedValue({ opaqueSession: 'ephemeral' })
})
afterEach(() => vi.unstubAllGlobals())

describe('Direct recovery permissions', () => {
  it('binds the request order and attempt to the recovery cookie before loading payment data', async () => {
    const recovery = await requireDirectRecovery(event, profile, { orderId: 'HLD-DIRECT-TEST', attemptId: 'direct-attempt' }, ['orderId', 'attemptId'])
    expect(recovery.attempt.id).toBe('direct-attempt')
    expect(mocks.readPaymentRecovery).toHaveBeenCalledWith(event, profile.secret, 'HLD-DIRECT-TEST')
    expect(mocks.getPaymentRecovery).toHaveBeenCalledWith('HLD-DIRECT-TEST', 'direct-attempt')
    mocks.getPaymentRecovery.mockClear()
    await expect(requireDirectRecovery(event, profile, { orderId: 'HLD-DIRECT-TEST', attemptId: 'another-attempt' }, ['orderId', 'attemptId'])).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.getPaymentRecovery).not.toHaveBeenCalled()
    mocks.readPaymentRecovery.mockReturnValue(null)
    await expect(requireDirectRecovery(event, profile, { orderId: 'another-order' }, ['orderId'])).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.getPaymentRecovery).not.toHaveBeenCalled()
  })
  it.each([null, [], {}, { orderId: '../bad' }, { orderId: 'valid', merchantNo: 'override' }])('rejects malformed or extra inputs %j', async (body) => {
    await expect(requireDirectRecovery(event, profile, body, ['orderId'])).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.getPaymentRecovery).not.toHaveBeenCalled()
  })
  it('returns not found for an expired recovery record', async () => {
    mocks.getPaymentRecovery.mockResolvedValue(null)
    await expect(requireDirectRecovery(event, profile, { orderId: 'HLD-DIRECT-TEST' }, ['orderId'])).rejects.toMatchObject({ statusCode: 404 })
  })
  it.each(['environment', 'merchantNo', 'appId'] as const)('rejects customer %s scope mismatch', (key) => {
    const recovery = fixture()
    expect(() => assertDirectRecovery(profile, { ...recovery, customer: { ...recovery.customer!, [key]: 'other' } })).toThrow('APPLE_PAY_ORDER_MISMATCH')
  })
  it('rejects other integrations, methods, journeys and missing customer bindings', () => {
    const recovery = fixture()
    for (const invalid of [
      { ...recovery, attempt: { ...recovery.attempt, integration: 'web-js-sdk' as const } },
      { ...recovery, attempt: { ...recovery.attempt, method: 'card' as const } },
      { ...recovery, attempt: { ...recovery.attempt, merchantTxnId: undefined } },
      { ...recovery, order: { ...recovery.order, amount: { minor: 5000, currency: 'USD' as const } } },
      { ...recovery, customer: null },
    ]) expect(() => assertDirectRecovery(profile, invalid)).toThrow('APPLE_PAY_ORDER_MISMATCH')
  })
  it('persists every fresh query observation separately for S-F-S reconciliation', async () => {
    const pending = submitted()
    mocks.getPaymentRecovery.mockResolvedValue(pending)
    mocks.queryApplePayPayment.mockResolvedValueOnce({ transactionId: '1001', rawStatus: 'S', status: 'succeeded' })
      .mockResolvedValueOnce({ transactionId: '1001', rawStatus: 'F', status: 'failed' })
      .mockResolvedValueOnce({ transactionId: '1001', rawStatus: 'S', status: 'succeeded' })
    await refreshDirectRecovery(profile, pending)
    await refreshDirectRecovery(profile, pending)
    await refreshDirectRecovery(profile, pending)
    const observations = mocks.completePaymentRecord.mock.calls.map(call => call[3])
    expect(observations.map(item => item.transactionStatus)).toEqual(['S', 'F', 'S'])
    expect(new Set(observations.map(item => item.sourceKey)).size).toBe(3)
  })
  it('persists complete wallet attribution from the strictly correlated query only', async () => {
    const pending = submitted()
    mocks.getPaymentRecovery.mockResolvedValue(pending)
    mocks.queryApplePayPayment.mockResolvedValue({ transactionId: '1001', rawStatus: 'S', status: 'succeeded', actualWallet: 'apple-pay', fundingNetwork: 'VISA' })
    await refreshDirectRecovery(profile, pending)
    expect(mocks.recordPaymentMethodDetails).toHaveBeenCalledWith('direct-attempt', undefined, expect.objectContaining({ transactionId: '1001', actualWallet: 'apple-pay', fundingNetwork: 'VISA' }), expect.any(String))
    expect(mocks.completePaymentRecord.mock.invocationCallOrder[0]).toBeLessThan(mocks.recordPaymentMethodDetails.mock.invocationCallOrder[0]!)
  })
  it('does not query an unsubmitted order and makes a submitted unknown attempt query-only', async () => {
    const fresh = fixture()
    expect(canAuthorizeDirect(fresh)).toBe(true)
    expect((await refreshDirectRecovery(profile, fresh)).submitted).toBe(false)
    expect(mocks.queryApplePayPayment).not.toHaveBeenCalled()
    const pending = submitted(fresh)
    expect(canAuthorizeDirect(pending)).toBe(false)
    mocks.getPaymentRecovery.mockResolvedValue({ ...pending, attempt: { ...pending.attempt, status: 'succeeded', statusSource: 'query', transactionId: '1001' } })
    const result = await refreshDirectRecovery(profile, pending)
    expect(mocks.queryApplePayPayment).toHaveBeenCalledWith(profile, { merchantTxnId: 'merchant-direct', amountMinor: 500, currency: 'USD', transactionId: undefined, paymentId: undefined })
    expect(mocks.completePaymentRecord).toHaveBeenCalledWith('direct-attempt', undefined, '1001', expect.objectContaining({ source: 'query', transactionStatus: 'S', status: 'succeeded' }))
    expect(result).toMatchObject({ submitted: true, paymentId: null, attempt: { status: 'succeeded', transactionId: '1001' } })
  })
})

describe('Apple Pay routes', () => {
  it('prepare reads eligibility without claiming or creating a payment', async () => {
    mocks.readBody.mockResolvedValue({ orderId: 'HLD-DIRECT-TEST' })
    const { default: handler } = await import('../server/api/payment/apple-pay/prepare.post')
    const result = await handler(event)
    expect(result).toMatchObject({ canAuthorize: true, paymentRequest: { total: { amount: '5.00' } } })
    expect(mocks.requireCanonicalPaymentOrigin).toHaveBeenCalledWith(event, profile.showcaseOrigin)
    expect(mocks.claimPaymentCreation).not.toHaveBeenCalled()
    expect(mocks.createApplePayPayment).not.toHaveBeenCalled()
  })
  it('validation only returns an ephemeral merchant session and does not claim', async () => {
    const validationURL = 'https://apple-pay-gateway-cert.apple.com/paymentservices/startSession'
    mocks.readBody.mockResolvedValue({ orderId: 'HLD-DIRECT-TEST', attemptId: 'direct-attempt', validationURL })
    const { default: handler } = await import('../server/api/payment/apple-pay/validate.post')
    await expect(handler(event)).resolves.toEqual({ merchantSession: { opaqueSession: 'ephemeral' } })
    expect(mocks.validateApplePayMerchant).toHaveBeenCalledWith(profile, validationURL)
    expect(mocks.claimPaymentCreation).not.toHaveBeenCalled()
    expect(mocks.completePaymentRecord).not.toHaveBeenCalled()
  })
  it('pay claims before contacting Onerway and persists a no-paymentId terminal response', async () => {
    const { default: handler } = await import('../server/api/payment/apple-pay/pay.post')
    await handler(event)
    expect(mocks.claimPaymentCreation).toHaveBeenCalledWith('direct-attempt', expect.objectContaining({ sourceKey: 'create-claim:direct-attempt', status: 'created' }))
    expect(mocks.claimPaymentCreation.mock.invocationCallOrder[0]).toBeLessThan(mocks.createApplePayPayment.mock.invocationCallOrder[0]!)
    expect(mocks.completePaymentRecord).toHaveBeenCalledWith('direct-attempt', undefined, '1001', expect.objectContaining({ source: 'server', status: 'succeeded', transactionStatus: 'S', transactionId: '1001' }))
  })
  it('returns only the gateway evidence explicitly and never persists it in payment events', async () => {
    const evidence = { request: '{"method":"POST","body":{"sign":"[signature omitted]"}}' }
    mocks.createApplePayPayment.mockResolvedValueOnce({ transactionId: '1001', rawStatus: 'S', status: 'succeeded', evidence, rawPayload: 'FORBIDDEN_RAW_PAYLOAD_MARKER' })
    const { default: handler } = await import('../server/api/payment/apple-pay/pay.post')
    const result = await handler(event)
    expect(result.evidence).toEqual(evidence)
    expect(JSON.stringify(result)).not.toContain('FORBIDDEN_RAW_PAYLOAD_MARKER')
    expect(JSON.stringify(mocks.completePaymentRecord.mock.calls)).not.toContain(evidence.request)
    expect(mocks.completePaymentRecord.mock.calls[0]![3]).not.toHaveProperty('evidence')
  })
  it('rejects malformed token before the durable claim', async () => {
    mocks.readBody.mockResolvedValue({ orderId: 'HLD-DIRECT-TEST', attemptId: 'direct-attempt', token: { incomplete: true }, browser })
    const { default: handler } = await import('../server/api/payment/apple-pay/pay.post')
    await expect(handler(event)).rejects.toBeDefined()
    expect(mocks.claimPaymentCreation).not.toHaveBeenCalled()
    expect(mocks.createApplePayPayment).not.toHaveBeenCalled()
  })
  it('a submitted attempt cannot validate another Apple session and prepare stays query-only', async () => {
    mocks.getPaymentRecovery.mockResolvedValue(submitted())
    mocks.readBody.mockResolvedValue({ orderId: 'HLD-DIRECT-TEST' })
    const { default: prepare } = await import('../server/api/payment/apple-pay/prepare.post')
    expect(await prepare(event)).toMatchObject({ canAuthorize: false, submitted: true })
    mocks.readBody.mockResolvedValue({ orderId: 'HLD-DIRECT-TEST', attemptId: 'direct-attempt', validationURL: 'https://apple-pay-gateway-cert.apple.com/paymentservices/startSession' })
    const { default: validate } = await import('../server/api/payment/apple-pay/validate.post')
    await expect(validate(event)).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.validateApplePayMerchant).not.toHaveBeenCalled()
    expect(mocks.claimPaymentCreation).not.toHaveBeenCalled()
  })
  it('a losing concurrent claim cannot create a second transaction', async () => {
    mocks.claimPaymentCreation.mockResolvedValue({ outcome: 'existing' })
    const { default: handler } = await import('../server/api/payment/apple-pay/pay.post')
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 409, statusMessage: 'APPLE_PAY_ALREADY_SUBMITTED' })
    expect(mocks.createApplePayPayment).not.toHaveBeenCalled()
  })
  it('unknown create outcome remains submitted and only same-attempt query can recover it', async () => {
    mocks.createApplePayPayment.mockRejectedValueOnce(new Error('network-unknown'))
    const { default: handler } = await import('../server/api/payment/apple-pay/pay.post')
    await expect(handler(event)).rejects.toBeDefined()
    expect(mocks.completePaymentRecord).not.toHaveBeenCalled()
    const pending = submitted()
    mocks.getPaymentRecovery.mockResolvedValue(pending)
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.createApplePayPayment).toHaveBeenCalledOnce()
    expect(mocks.claimPaymentCreation).toHaveBeenCalledOnce()
    await refreshDirectRecovery(profile, pending)
    expect(mocks.queryApplePayPayment).toHaveBeenCalledOnce()
    expect(mocks.createApplePayPayment).toHaveBeenCalledOnce()
  })
  it('production profile and noncanonical origin cannot reach payment creation', async () => {
    const { default: handler } = await import('../server/api/payment/apple-pay/pay.post')
    mocks.requireServerProfile.mockReturnValue({ profile: 'production' })
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 })
    mocks.requireServerProfile.mockReturnValue(profile)
    mocks.requireCanonicalPaymentOrigin.mockImplementation(() => { throw createError({ statusCode: 403 }) })
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.claimPaymentCreation).not.toHaveBeenCalled()
    expect(mocks.createApplePayPayment).not.toHaveBeenCalled()
  })
})
