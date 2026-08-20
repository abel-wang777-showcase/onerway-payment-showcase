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
    createPaymentRetry: vi.fn(),
    getPaymentRecovery: vi.fn(),
    PaymentStoreError,
    readPaymentRecovery: vi.fn(),
    requireCanonicalPaymentOrigin: vi.fn(),
    requireServerProfile: vi.fn(),
    setPaymentRecovery: vi.fn(),
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
  setPaymentRecovery: mocks.setPaymentRecovery,
}))

vi.mock('../server/utils/store', () => ({
  createPaymentRetry: mocks.createPaymentRetry,
  getPaymentRecovery: mocks.getPaymentRecovery,
  PaymentStoreError: mocks.PaymentStoreError,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-10T08:00:00.000Z'))
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))

  mocks.requireServerProfile.mockReturnValue({
    profile: 'sandbox',
    secret: 'test-secret',
    showcaseOrigin: 'https://showcase.example',
  })
  mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: 'attempt-1' })
  mocks.getPaymentRecovery.mockResolvedValue(null)
  mocks.createPaymentRetry.mockResolvedValue({
    attempt: {
      id: 'attempt-2',
      orderId: 'order-1',
      retryOf: 'attempt-1',
      status: 'created',
    },
    create: true,
    created: true,
  })
})

describe('payment retry route', () => {
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

    const { default: handler } = await import('../server/api/payment/retry.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 400, statusMessage: 'PAYMENT_INPUT_INVALID' })
    expect(mocks.createPaymentRetry).not.toHaveBeenCalled()
    expect(mocks.setPaymentRecovery).not.toHaveBeenCalled()
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

    const { default: handler } = await import('../server/api/payment/retry.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 401, statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' })
    expect(mocks.createPaymentRetry).not.toHaveBeenCalled()
    expect(mocks.setPaymentRecovery).not.toHaveBeenCalled()
  })

  it('delegates candidate creation to the store and rebinds recovery to the retry attempt', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      orderId: 'order-1',
      attemptId: 'attempt-1',
      paymentId: '9000000000000000001',
    }))

    const { default: handler } = await import('../server/api/payment/retry.post')
    const event = {}
    const result = await (handler as (event: unknown) => Promise<unknown>)(event)

    expect(mocks.createPaymentRetry).toHaveBeenCalledTimes(1)
    expect(mocks.createPaymentRetry).toHaveBeenCalledWith(
      'order-1',
      'attempt-1',
      '9000000000000000001',
      '2026-08-10T08:00:00.000Z',
    )
    expect(mocks.createPaymentRetry.mock.calls[0]).toHaveLength(4)
    expect(mocks.setPaymentRecovery).toHaveBeenCalledWith(
      event,
      'test-secret',
      'order-1',
      'attempt-2',
    )
    expect(mocks.createPaymentRetry.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.setPaymentRecovery.mock.invocationCallOrder[0]!)
    expect(result).toEqual({
      orderId: 'order-1',
      attemptId: 'attempt-2',
      create: true,
      reused: false,
    })
  })

  it('reports an existing retry candidate as reused and preserves its create decision', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      orderId: 'order-1',
      attemptId: 'attempt-1',
      paymentId: '9000000000000000001',
    }))
    mocks.createPaymentRetry.mockResolvedValue({
      attempt: {
        id: 'attempt-2',
        orderId: 'order-1',
        retryOf: 'attempt-1',
        status: 'created',
      },
      create: false,
      created: false,
    })

    const { default: handler } = await import('../server/api/payment/retry.post')
    const result = await (handler as (event: unknown) => Promise<unknown>)({})

    expect(result).toEqual({
      orderId: 'order-1',
      attemptId: 'attempt-2',
      create: false,
      reused: true,
    })
  })

  it('replays the parent request when recovery already points at its retry child', async () => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      orderId: 'order-1',
      attemptId: 'attempt-1',
      paymentId: '9000000000000000001',
    }))
    mocks.readPaymentRecovery.mockReturnValue({ orderId: 'order-1', attemptId: 'attempt-2' })
    mocks.getPaymentRecovery.mockResolvedValue({
      attempt: {
        id: 'attempt-2',
        orderId: 'order-1',
        retryOf: 'attempt-1',
      },
    })
    mocks.createPaymentRetry.mockResolvedValue({
      attempt: {
        id: 'attempt-2',
        orderId: 'order-1',
        retryOf: 'attempt-1',
        status: 'created',
      },
      create: true,
      created: false,
    })

    const { default: handler } = await import('../server/api/payment/retry.post')
    const result = await (handler as (event: unknown) => Promise<unknown>)({})

    expect(mocks.getPaymentRecovery).toHaveBeenCalledWith('order-1', 'attempt-2')
    expect(mocks.createPaymentRetry).toHaveBeenCalledWith(
      'order-1',
      'attempt-1',
      '9000000000000000001',
      '2026-08-10T08:00:00.000Z',
    )
    expect(result).toEqual({
      orderId: 'order-1',
      attemptId: 'attempt-2',
      create: true,
      reused: true,
    })
  })

  it.each([
    ['PAYMENT_ATTEMPT_NOT_FOUND', 404],
    ['PAYMENT_ATTEMPT_MISMATCH', 409],
    ['PAYMENT_RETRY_NOT_ALLOWED', 409],
  ])('maps %s to HTTP %i without rebinding recovery', async (code, statusCode) => {
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({
      orderId: 'order-1',
      attemptId: 'attempt-1',
      paymentId: '9000000000000000001',
    }))
    mocks.createPaymentRetry.mockRejectedValue(new mocks.PaymentStoreError(code))

    const { default: handler } = await import('../server/api/payment/retry.post')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode, statusMessage: code })
    expect(mocks.setPaymentRecovery).not.toHaveBeenCalled()
  })
})
