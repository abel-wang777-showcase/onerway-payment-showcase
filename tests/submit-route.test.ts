import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class PaymentStoreError extends Error {
    readonly code: string

    constructor(code: string) {
      super(code)
      this.name = 'PaymentStoreError'
      this.code = code
    }
  }

  return {
    claimPaymentSubmission: vi.fn(),
    PaymentStoreError,
    readPaymentRecovery: vi.fn(),
    requireCanonicalPaymentOrigin: vi.fn(),
    requireServerProfile: vi.fn(),
  }
})

vi.mock('../server/utils/limit', () => ({
  requireCanonicalPaymentOrigin: mocks.requireCanonicalPaymentOrigin,
  withPaymentLimit: (_event: unknown, _kind: string, task: () => Promise<unknown>) => task(),
}))

vi.mock('../server/utils/profile', () => ({
  requireServerProfile: mocks.requireServerProfile,
}))

vi.mock('../server/utils/recovery', () => ({
  readPaymentRecovery: mocks.readPaymentRecovery,
}))

vi.mock('../server/utils/store', () => ({
  claimPaymentSubmission: mocks.claimPaymentSubmission,
  PaymentStoreError: mocks.PaymentStoreError,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))

  mocks.requireServerProfile.mockReturnValue({
    profile: 'sandbox',
    secret: 'test-secret',
    showcaseOrigin: 'https://showcase.example',
  })
  mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: 'attempt-1' })
  mocks.claimPaymentSubmission.mockResolvedValue({
    attempt: {
      id: 'attempt-1',
      orderId: 'order-1',
      paymentId: '9000000000000000001',
      status: 'processing',
      submissionStartedAt: '2026-08-10T08:00:00.000Z',
    },
    claimed: true,
  })
})

describe('payment submit route', () => {
  it.each([
    undefined,
    null,
    [],
    {},
    { orderId: 'order-1', attemptId: 'attempt-1' },
    { orderId: '', attemptId: 'attempt-1', paymentId: '9000000000000000001' },
    { orderId: 'order-1', attemptId: 'attempt_1', paymentId: '9000000000000000001' },
    { orderId: 'order-1', attemptId: 'attempt-1', paymentId: 'payment-1' },
    { orderId: 'order-1', attemptId: 'attempt-1', paymentId: '9000000000000000001', extra: true },
  ])('rejects invalid input %#', async (body) => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue(body))

    const { default: handler } = await import('../server/api/payment/submit.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 400, statusMessage: 'PAYMENT_INPUT_INVALID' })
    expect(mocks.claimPaymentSubmission).not.toHaveBeenCalled()
  })

  it.each([
    { orderId: 'order-2', attemptId: 'attempt-1' },
    { orderId: 'order-1', attemptId: 'attempt-2' },
  ])('requires the recovery cookie to bind order and attempt %#', async ({ orderId, attemptId }) => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      orderId,
      attemptId,
      paymentId: '9000000000000000001',
    }))

    const { default: handler } = await import('../server/api/payment/submit.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })
    expect(mocks.claimPaymentSubmission).not.toHaveBeenCalled()
  })

  it('claims submission for the cookie-bound attempt and returns the persisted attempt', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      orderId: 'order-1',
      attemptId: 'attempt-1',
      paymentId: '9000000000000000001',
    }))

    const { default: handler } = await import('../server/api/payment/submit.post')
    const result = await (handler as (event: unknown) => Promise<unknown>)({})

    expect(mocks.readPaymentRecovery).toHaveBeenCalledWith(expect.anything(), 'test-secret')
    expect(mocks.claimPaymentSubmission).toHaveBeenCalledWith(
      'attempt-1',
      '9000000000000000001',
    )
    expect(result).toEqual({
      attempt: {
        id: 'attempt-1',
        orderId: 'order-1',
        paymentId: '9000000000000000001',
        status: 'processing',
        submissionStartedAt: '2026-08-10T08:00:00.000Z',
      },
      claimed: true,
    })
  })

  it.each([
    ['PAYMENT_ATTEMPT_NOT_FOUND', 404],
    ['PAYMENT_ATTEMPT_MISMATCH', 409],
    ['PAYMENT_SUBMISSION_NOT_ALLOWED', 409],
  ])('maps %s to HTTP %i', async (code, statusCode) => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      orderId: 'order-1',
      attemptId: 'attempt-1',
      paymentId: '9000000000000000001',
    }))
    mocks.claimPaymentSubmission.mockRejectedValue(new mocks.PaymentStoreError(code))

    const { default: handler } = await import('../server/api/payment/submit.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode, statusMessage: code })
  })
})
