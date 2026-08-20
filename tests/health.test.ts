import { Pool } from '@neondatabase/serverless'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkPaymentDatabase: vi.fn(),
  requireServerProfile: vi.fn(),
}))

vi.mock('../server/utils/profile', () => ({
  requireServerProfile: mocks.requireServerProfile,
}))

vi.mock('../server/utils/store', () => ({
  checkPaymentDatabase: mocks.checkPaymentDatabase,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
  vi.stubGlobal('createError', (input: object) => Object.assign(new Error('HTTP_ERROR'), input))
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '07F4E48EBBD9BE8B5779E0F0C8C974DAE7612D78')

  mocks.requireServerProfile.mockReturnValue({ transactionPolicy: 'sandbox-only' })
  mocks.checkPaymentDatabase.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('database health probe', () => {
  it('uses the bounded payment pool for SELECT 1', async () => {
    const query = vi.fn(async (statement: string) => ({
      rows: statement === 'SELECT 1 AS ready' ? [{ ready: 1 }] : [],
    }))
    const release = vi.fn()
    vi.spyOn(Pool.prototype, 'connect').mockResolvedValue({ query, release } as never)
    vi.stubEnv('DATABASE_URL', 'postgres://health.invalid/showcase')
    const { checkPaymentDatabase } = await vi.importActual<typeof import('../server/utils/store')>(
      '../server/utils/store',
    )

    await expect(checkPaymentDatabase()).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledWith('SELECT 1 AS ready')
    expect(release).toHaveBeenCalledWith(false)
  })

  it('redacts database failures behind PaymentStoreError', async () => {
    vi.spyOn(Pool.prototype, 'connect').mockRejectedValue(new Error('sensitive database detail'))
    vi.stubEnv('DATABASE_URL', 'postgres://health.invalid/showcase')
    const { checkPaymentDatabase } = await vi.importActual<typeof import('../server/utils/store')>(
      '../server/utils/store',
    )

    await expect(checkPaymentDatabase()).rejects.toMatchObject({
      name: 'PaymentStoreError',
      code: 'PAYMENT_DATABASE_ERROR',
      message: 'PAYMENT_DATABASE_ERROR',
    })
  })
})

describe('health route', () => {
  it('reports profile and database readiness with the deployment commit', async () => {
    const { default: handler } = await import('../server/api/health.get')
    const event = {}
    const result = await (handler as (event: unknown) => Promise<unknown>)(event)

    expect(setResponseHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'no-store')
    expect(mocks.requireServerProfile).toHaveBeenCalledOnce()
    expect(mocks.checkPaymentDatabase).toHaveBeenCalledOnce()
    expect(result).toEqual({
      status: 'ok',
      checks: {
        profile: 'ready',
        database: 'ready',
      },
      transactionPolicy: 'sandbox-only',
      commitSha: '07f4e48ebbd9be8b5779e0f0c8c974dae7612d78',
    })
  })

  it.each(['', 'not-a-commit'])('omits an unavailable or invalid commit SHA: %j', async (commit) => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', commit)
    const { default: handler } = await import('../server/api/health.get')
    const result = await (handler as (event: unknown) => Promise<Record<string, unknown>>)({})

    expect(result).not.toHaveProperty('commitSha')
  })

  it('returns a generic 503 when the profile is not ready', async () => {
    mocks.requireServerProfile.mockImplementation(() => {
      throw new Error('sensitive profile detail')
    })
    const { default: handler } = await import('../server/api/health.get')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 503, statusMessage: 'SERVICE_UNAVAILABLE' })
    expect(mocks.checkPaymentDatabase).not.toHaveBeenCalled()
  })

  it('returns a generic 503 when the database is not ready', async () => {
    mocks.checkPaymentDatabase.mockRejectedValue(new Error('sensitive database detail'))
    const { default: handler } = await import('../server/api/health.get')

    await expect((handler as (event: unknown) => Promise<unknown>)({}))
      .rejects.toMatchObject({ statusCode: 503, statusMessage: 'SERVICE_UNAVAILABLE' })
  })
})
