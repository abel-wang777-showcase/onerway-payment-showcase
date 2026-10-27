import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoTestDatabase } from './demo-database'
import { assertDemoSchema } from './demo-schema'
import { recordDemoWebhook, runDemoMaintenance } from '../server/utils/demo/maintenance'
import type { PaymentWebhook } from '../server/utils/webhook'
import type { PaymentCreate } from '../shared/payment/demo'
import type { CreatedPayment, MobileCreateContext, RecoveredPaymentCreation } from '../server/utils/gateway'
import { createDemoCustomer, createDemoSession, getDemoSession, readDemoOperation, type DemoSession } from '../server/utils/demo/identity'
import {
  createDemoPayment,
  enqueuePayment,
  getDemoPayment,
  listDemoPayments,
  recoverDemoPayment,
  runPaymentJob,
  type SandboxProfile,
} from '../server/utils/demo/payment'

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), create: vi.fn(), query: vi.fn(), recover: vi.fn() }))
vi.mock('../server/utils/demo/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/utils/demo/database')>()
  return { ...actual, demoTransaction: mocks.transaction }
})
vi.mock('../server/utils/gateway', () => ({
  createMobilePayment: mocks.create,
  queryPayment: mocks.query,
  queryPaymentCreation: mocks.recover,
}))

const profile: SandboxProfile = {
  profile: 'sandbox', apiBaseUrl: 'https://sandbox-acq.onerway.com', sdkUrl: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js',
  showcaseOrigin: 'https://showcase.example', notifyUrl: 'https://showcase.example/api/webhooks/onerway/payment', transactionIp: null,
  merchantNo: 'merchant-test', appId: 'app-test', secret: 'invalid-local-fixture', transactionPolicy: 'sandbox-only',
}
interface ProviderFixture {
  paymentId: string
  transactionId: string
  merchantTxnId: string
  amount: number
  paymentStatus: string
  transactionStatus: string
}
const provider = new Map<string, ProviderFixture>()
let sequence = 0
let database: Awaited<ReturnType<typeof createDemoTestDatabase>>
beforeAll(async () => {
  database = await createDemoTestDatabase()
  mocks.transaction.mockImplementation(database.transaction)
}, 60_000)
afterAll(async () => { await database.close() })
beforeEach(async () => {
  await database.db.exec('TRUNCATE demo_sessions, demo_claims, demo_limits, payment_orders CASCADE')
  provider.clear()
  mocks.create.mockReset()
  mocks.query.mockReset()
  mocks.recover.mockReset()
  mocks.create.mockImplementation(async (_profile: SandboxProfile, context: MobileCreateContext): Promise<CreatedPayment> => {
    const fixture = acceptCreation(context)
    return { paymentId: fixture.paymentId, transactionId: fixture.transactionId, rawStatus: 'U' }
  })
  mocks.recover.mockImplementation(async (_profile: SandboxProfile, merchantTxnId: string, amount: number, currency: string): Promise<RecoveredPaymentCreation> => {
    const fixture = provider.get(merchantTxnId)
    if (!fixture || fixture.amount !== amount || currency !== 'USD') throw new Error('CONTROLLED_NOT_FOUND')
    return { paymentId: fixture.paymentId, transactionId: fixture.transactionId, rawStatus: fixture.transactionStatus, status: 'processing' }
  })
  mocks.query.mockImplementation(async (_profile: SandboxProfile, paymentId: string) => {
    const fixture = [...provider.values()].find(item => item.paymentId === paymentId)
    if (!fixture) throw new Error('CONTROLLED_NOT_FOUND')
    return { paymentId, transactionId: fixture.transactionId, rawStatus: fixture.paymentStatus, status: 'processing' }
  })
})

function acceptCreation(context: MobileCreateContext): ProviderFixture {
  sequence += 1
  const fixture: ProviderFixture = {
    paymentId: `9${String(sequence).padStart(10, '0')}`, transactionId: `8${String(sequence).padStart(10, '0')}`,
    merchantTxnId: context.merchantTxnId, amount: context.order.amount.minor, paymentStatus: 'U', transactionStatus: 'P',
  }
  provider.set(context.merchantTxnId, fixture)
  return fixture
}
function input(overrides: Partial<PaymentCreate> = {}): PaymentCreate {
  return { requestId: randomUUID(), sceneId: 'one_time', integration: 'native-sdk', amount: { minor: 1234, currency: 'USD' }, customer: { kind: 'current' }, returnTarget: { kind: 'preset', id: 'app_android' }, ...overrides }
}
async function session(): Promise<DemoSession> { return (await createDemoSession('ANDROID')).session }
function code(value: string, statusCode?: number) { return { ...(statusCode ? { statusCode } : {}), body: { error: { code: value } } } }
async function storedJob(id: string) { return (await database.db.query('SELECT * FROM demo_jobs WHERE payment_id = $1', [id])).rows[0]! }

/** This suite exercises real local PostgreSQL SQL; all Provider I/O is controlled and cannot reach a network. */
describe('Native SALE application persistence', () => {
  it('claims concurrent identical requests once and preserves one order/attempt/provider creation', async () => {
    const owner = await session()
    const request = input()
    const results = await Promise.all([createDemoPayment(owner, request, profile), createDemoPayment(owner, request, profile)])
    expect(new Set(results.map(result => result.body.id)).size).toBe(1)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect((await database.db.query('SELECT * FROM payment_orders')).rows).toHaveLength(1)
    expect((await database.db.query('SELECT * FROM payment_attempts')).rows).toHaveLength(1)
    const replay = await createDemoPayment(owner, request, profile, false)
    expect(replay.status).toBe(200)
    expect(replay.body.amount).toEqual(request.amount)
    assertDemoSchema('PaymentView', replay.body)
    const ready = await getDemoPayment(owner.id, replay.body.id, profile, { refresh: true })
    expect(ready.allowedActions).toContainEqual({ type: 'CONTINUE_SDK', enabled: true, reasonCode: null })
    expect(ready.providerExpiresAt).toBeNull()
    const createContext = mocks.create.mock.calls[0]![1] as MobileCreateContext
    expect(new URL(createContext.returnUrl).searchParams.get('merchantTxnId')).toBe(ready.merchantTxnId)
  })

  it('rejects changed intent, foreign global keys and foreign resource reads without leaking views', async () => {
    const owner = await session()
    const request = input()
    const created = await createDemoPayment(owner, request, profile)
    await expect(createDemoPayment(owner, { ...request, amount: { minor: 555, currency: 'USD' } }, profile)).rejects.toMatchObject(code('IDEMPOTENCY_CONFLICT', 409))
    const foreign = await session()
    await expect(createDemoPayment(foreign, request, profile)).rejects.toMatchObject({ ...code('IDEMPOTENCY_KEY_UNAVAILABLE', 409), body: { error: { code: 'IDEMPOTENCY_KEY_UNAVAILABLE', currentView: null } } })
    await expect(recoverDemoPayment(foreign.id, request.requestId, profile)).rejects.toMatchObject(code('IDEMPOTENCY_KEY_UNAVAILABLE', 409))
    await expect(getDemoPayment(foreign.id, created.body.id, profile)).rejects.toMatchObject(code('RESOURCE_UNAVAILABLE', 403))
    await expect(getDemoPayment(foreign.id, randomUUID(), profile)).rejects.toMatchObject(code('RESOURCE_UNAVAILABLE', 403))
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('freezes the first resolved customer and return URL while replay reports the current selection', async () => {
    const owner = await session()
    const request = input({ customer: { kind: 'new', label: '  Original  ' }, returnTarget: { kind: 'custom', url: 'https://merchant.example/result?order=42' } })
    const first = await createDemoPayment(owner, request, profile)
    const selected = await createDemoCustomer(owner.id, { operationId: randomUUID(), label: 'Later' })
    const replay = await createDemoPayment(owner, { ...request, customer: { kind: 'new', label: 'Original' } }, { ...profile, showcaseOrigin: 'https://changed.example' })
    expect(replay.body.customerId).toBe(first.body.customerId)
    expect(replay.body.currentCustomerId).toBe(selected.body.id)
    expect((await getDemoSession(owner.id)).currentCustomerId).toBe(selected.body.id)
    expect((await database.db.query('SELECT * FROM demo_customers')).rows).toHaveLength(2)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const context = mocks.create.mock.calls[0]![1] as MobileCreateContext
    expect(new URL(context.returnUrl).searchParams.get('order')).toBe('42')
    expect(new URL(context.returnUrl).origin).toBe('https://merchant.example')
  })

  it('recovers an unknown creation through original merchant reference without resending', async () => {
    mocks.create.mockImplementationOnce(async (_profile: SandboxProfile, context: MobileCreateContext) => {
      acceptCreation(context)
      throw new Error('CONTROLLED_RESPONSE_LOST')
    })
    const owner = await session()
    const request = input()
    const accepted = await createDemoPayment(owner, request, profile)
    expect(accepted.status).toBe(202)
    expect(accepted.body.creationState).toBe('unknown')
    expect(accepted.body.provider).toBeNull()
    expect(accepted.body.attention).toEqual({ kind: 'creation_unknown' })
    const repeated = await createDemoPayment(owner, request, profile)
    expect(repeated.status).toBe(202)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const recovered = await recoverDemoPayment(owner.id, request.requestId, profile)
    expect(recovered.id).toBe(accepted.body.id)
    expect(recovered.creationState).toBe('ready')
    expect(recovered.status.rawPaymentStatus).toBe('U')
    expect(mocks.recover).toHaveBeenCalledWith(profile, accepted.body.merchantTxnId, request.amount.minor, 'USD')
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const operation = (await database.db.query('SELECT execution,outcome FROM demo_operations WHERE id=$1', [request.requestId])).rows[0]
    expect(operation).toEqual({ execution: 'completed', outcome: 'effective' })
  })

  it('allows only correlated funded S to correct N and never regresses confirmed success', async () => {
    const owner = await session()
    const created = await createDemoPayment(owner, input(), profile)
    const fixture = provider.get(created.body.merchantTxnId)!
    fixture.paymentStatus = 'N'
    fixture.transactionStatus = 'N'
    const closed = await getDemoPayment(owner.id, created.body.id, profile, { refresh: true })
    expect(closed.status.normalized).toBe('cancelled')
    fixture.paymentStatus = 'S'
    fixture.transactionStatus = 'F'
    const unproven = await getDemoPayment(owner.id, created.body.id, profile, { refresh: true })
    expect(unproven.status.rawPaymentStatus).toBe('N')
    expect(unproven.refresh.state).toBe('failed')
    fixture.transactionStatus = 'S'
    const succeeded = await getDemoPayment(owner.id, created.body.id, profile, { refresh: true })
    expect(succeeded.status.normalized).toBe('succeeded')
    expect(succeeded.revision).toBeGreaterThan(closed.revision)
    expect((await database.db.query("SELECT * FROM demo_events WHERE payment_id=$1 AND kind='late_success'", [created.body.id])).rows).toHaveLength(1)
    fixture.paymentStatus = 'N'
    fixture.transactionStatus = 'N'
    const stale = await getDemoPayment(owner.id, created.body.id, profile, { refresh: true })
    expect(stale.status.rawPaymentStatus).toBe('S')
    expect(stale.status.observedAt).toBe(succeeded.status.observedAt)
  })

  it('retains trusted state and observation time on unknown provider status', async () => {
    const owner = await session()
    const created = await createDemoPayment(owner, input(), profile)
    const known = await getDemoPayment(owner.id, created.body.id, profile, { refresh: true })
    provider.get(created.body.merchantTxnId)!.paymentStatus = 'F'
    const unknown = await getDemoPayment(owner.id, created.body.id, profile, { refresh: true })
    expect(unknown.status).toEqual(known.status)
    expect(unknown.refresh.state).toBe('failed')
    expect(unknown.allowedActions).toContainEqual({ type: 'CONTINUE_SDK', enabled: false, reasonCode: 'PROVIDER_UNAVAILABLE' })
    assertDemoSchema('PaymentView', unknown)
  })

  it('retains failed jobs, reclaims expired worker leases and does not create another upstream payment', async () => {
    const owner = await session()
    const created = await createDemoPayment(owner, input(), profile)
    mocks.recover.mockRejectedValueOnce(new Error('CONTROLLED_TIMEOUT'))
    await runPaymentJob(profile, created.body.id)
    const failed = await storedJob(created.body.id)
    expect(failed).toMatchObject({ state: 'pending', last_error_code: 'PROVIDER_UNAVAILABLE', attempts: 1, lease_until: null })
    await database.db.query("UPDATE demo_jobs SET state='running',lease_until=now()-interval '1 second',due_at=now()-interval '1 second' WHERE payment_id=$1", [created.body.id])
    expect(await runPaymentJob(profile, created.body.id)).toBe(true)
    const recovered = await storedJob(created.body.id)
    expect(recovered).toMatchObject({ state: 'pending', last_error_code: null, attempts: 2, lease_until: null })
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('preserves a new notification revision arriving during an in-flight query', async () => {
    const owner = await session()
    const created = await createDemoPayment(owner, input(), profile)
    const fixture = provider.get(created.body.merchantTxnId)!
    fixture.paymentStatus = 'S'
    fixture.transactionStatus = 'S'
    let started!: () => void
    const start = new Promise<void>((resolve) => { started = resolve })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    mocks.query.mockImplementationOnce(async () => {
      started()
      await gate
      return { paymentId: fixture.paymentId, transactionId: fixture.transactionId, rawStatus: 'S', status: 'succeeded' }
    })
    const running = runPaymentJob(profile, created.body.id)
    await start
    const before = await storedJob(created.body.id)
    await database.transaction(client => enqueuePayment(client, created.body.id))
    release()
    await running
    const after = await storedJob(created.body.id)
    expect(Number(after.revision)).toBeGreaterThan(Number(before.revision))
    expect(after.state).toBe('pending')
    expect(await runPaymentJob(profile, created.body.id)).toBe(true)
    expect((await storedJob(created.body.id)).state).toBe('completed')
  })

  it('does not let an expired worker lease overwrite the replacement worker observation', async () => {
    const owner = await session()
    const created = await createDemoPayment(owner, input(), profile)
    const fixture = provider.get(created.body.merchantTxnId)!
    let started!: () => void
    const start = new Promise<void>((resolve) => { started = resolve })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    mocks.query.mockImplementationOnce(async () => {
      started()
      await gate
      return { paymentId: fixture.paymentId, transactionId: fixture.transactionId, rawStatus: 'U', status: 'processing' }
    })
    const staleWorker = runPaymentJob(profile, created.body.id)
    await start
    await database.db.query("UPDATE demo_jobs SET lease_until=now()-interval '1 second',due_at=now()-interval '1 second' WHERE payment_id=$1", [created.body.id])
    fixture.paymentStatus = 'P'
    await runPaymentJob(profile, created.body.id)
    const replacementView = await getDemoPayment(owner.id, created.body.id, profile, { process: false })
    expect(replacementView.status.rawPaymentStatus).toBe('P')
    release()
    await staleWorker
    const finalView = await getDemoPayment(owner.id, created.body.id, profile, { process: false })
    expect(finalView.status.rawPaymentStatus).toBe('P')
    expect(finalView.allowedActions).toContainEqual({ type: 'CONTINUE_SDK', enabled: false, reasonCode: 'PAYMENT_PROCESSING' })
  })

  it('returns the most recent actionable payment before pagination and filters by customer', async () => {
    const owner = await session()
    const first = await createDemoPayment(owner, input({ customer: { kind: 'new', label: 'First buyer' } }), profile)
    await getDemoPayment(owner.id, first.body.id, profile, { refresh: true })
    const second = await createDemoPayment(owner, input({ customer: { kind: 'new', label: 'Second buyer' } }), profile)
    await getDemoPayment(owner.id, second.body.id, profile, { refresh: true })
    const processing = await createDemoPayment(owner, input(), profile)
    provider.get(processing.body.merchantTxnId)!.paymentStatus = 'P'
    await getDemoPayment(owner.id, processing.body.id, profile, { refresh: true })
    // Explicit timestamps make recency deterministic without timing sleeps.
    await database.db.query("UPDATE demo_payments SET created_at=now()-interval '3 minutes' WHERE id=$1", [first.body.id])
    await database.db.query("UPDATE demo_payments SET created_at=now()-interval '2 minutes' WHERE id=$1", [second.body.id])
    await database.db.query("UPDATE demo_payments SET created_at=now()-interval '1 minute' WHERE id=$1", [processing.body.id])
    const attention = await listDemoPayments(owner.id, { limit: 1, filter: 'needs-attention' }, profile)
    expect(attention.items.map(item => item.id)).toEqual([second.body.id])
    const filtered = await listDemoPayments(owner.id, { customerId: first.body.customerId }, profile)
    expect(filtered.items.map(item => item.id)).toEqual([first.body.id])
    const otherPage = await listDemoPayments(owner.id, { limit: 1, cursor: attention.nextCursor!, filter: 'needs-attention' }, profile)
    expect(otherPage.items.map(item => item.id)).toEqual([first.body.id])
    assertDemoSchema('PaymentPage', attention)
  })

  it('durably records a safely associated webhook and pending job before any provider query', async () => {
    const owner = await session()
    const created = await createDemoPayment(owner, input(), profile)
    const fixture = provider.get(created.body.merchantTxnId)!
    const fact: PaymentWebhook = {
      merchantTxnId: fixture.merchantTxnId, paymentId: fixture.paymentId, transactionId: fixture.transactionId,
      amountMinor: fixture.amount, currency: 'USD', transactionStatus: 'S', paymentStatus: 'S',
      status: 'succeeded', occurredAt: new Date().toISOString(),
    }
    const before = await storedJob(created.body.id)
    expect(await recordDemoWebhook(fact)).toBe(created.body.id)
    expect(mocks.query).not.toHaveBeenCalled()
    const after = await storedJob(created.body.id)
    expect(Number(after.revision)).toBe(Number(before.revision) + 1)
    expect(after.state).toBe('pending')
    expect((await getDemoPayment(owner.id, created.body.id, profile, { process: false })).status.verified).toBe(false)
    const events = await database.db.query("SELECT * FROM demo_events WHERE payment_id=$1 AND source='webhook'", [created.body.id])
    expect(events.rows).toHaveLength(1)
    expect(Object.keys(events.rows[0]!).sort()).toEqual(['id', 'kind', 'occurred_at', 'payment_id', 'raw_status', 'source'])
    await expect(recordDemoWebhook({ ...fact, amountMinor: fact.amountMinor + 1 })).rejects.toMatchObject(code('PAYMENT_ASSOCIATION_CONFLICT', 409))
    expect(Number((await storedJob(created.body.id)).revision)).toBe(Number(after.revision))
    expect(await recordDemoWebhook({ ...fact, merchantTxnId: 'not-a-demo-payment' })).toBeNull()
    fixture.paymentStatus = 'S'
    fixture.transactionStatus = 'S'
    expect(await runPaymentJob(profile, created.body.id)).toBe(true)
    expect((await getDemoPayment(owner.id, created.body.id, profile, { process: false })).status.normalized).toBe('succeeded')
  })

  it('bounds repeated refresh queries while keeping the pending job and accepted payment readable', async () => {
    const owner = await session()
    const request = input()
    const created = await createDemoPayment(owner, request, profile)
    let lastVerified = created.body
    for (let index = 0; index < 12; index++) {
      const view = await getDemoPayment(owner.id, created.body.id, profile, { refresh: true })
      expect(view.id).toBe(created.body.id)
      expect(view.creationState).toBe('ready')
      expect(view.status.rawPaymentStatus).toBe('U')
      if (index === 9) lastVerified = view
      if (index >= 10) expect(view.status).toEqual(lastVerified.status)
    }
    expect(mocks.query).toHaveBeenCalledTimes(10)
    expect(mocks.recover).toHaveBeenCalledTimes(10)
    const deferred = await storedJob(created.body.id)
    expect(deferred).toMatchObject({ state: 'pending', lease_until: null, attempts: 10 })
    expect(new Date(deferred.due_at as Date).getTime()).toBeGreaterThan(Date.now())
    const readable = await getDemoPayment(owner.id, created.body.id, profile)
    expect(readable.status).toEqual(lastVerified.status)
    assertDemoSchema('PaymentView', readable)
    const replay = await createDemoPayment(owner, request, profile)
    expect(replay.status).toBe(200)
    expect(replay.body.id).toBe(created.body.id)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.query).toHaveBeenCalledTimes(10)
    // Advancing the database window, without sleeping or touching real Provider services,
    // proves that a deferred job can resume after the quota becomes available.
    await database.db.exec("UPDATE demo_limits SET reset_at=now()-interval '1 second'")
    await getDemoPayment(owner.id, created.body.id, profile, { refresh: true })
    expect(mocks.query).toHaveBeenCalledTimes(11)
    expect((await storedJob(created.body.id)).attempts).toBe(11)
  })

  it('keeps unfinished daily work durable under time and batch budgets', async () => {
    const owner = await session()
    for (let count = 0; count < 3; count++) {
      const created = await createDemoPayment(owner, input(), profile)
      const fixture = provider.get(created.body.merchantTxnId)!
      fixture.paymentStatus = 'S'
      fixture.transactionStatus = 'S'
    }
    expect(await runDemoMaintenance(profile, 0, 2)).toMatchObject({ processed: 0, deleted: 0 })
    expect(await runDemoMaintenance(profile, 60_000, 2)).toMatchObject({ processed: 2, deleted: 0 })
    const remaining = await database.db.query("SELECT * FROM demo_jobs WHERE state='pending'")
    expect(remaining.rows).toHaveLength(1)
    expect(await runDemoMaintenance(profile, 60_000, 2)).toMatchObject({ processed: 1, deleted: 0 })
    expect((await database.db.query("SELECT * FROM demo_jobs WHERE state='completed'")).rows).toHaveLength(3)
    expect(mocks.create).toHaveBeenCalledTimes(3)
  })

  it('cleans expired details and operations but preserves owner-specific permanent claim responses', async () => {
    const owner = await session()
    const request = input()
    const created = await createDemoPayment(owner, request, profile)
    await database.db.query("UPDATE demo_payments SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE id=$1", [created.body.id])
    await database.db.query("UPDATE demo_operations SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE id=$1", [request.requestId])
    expect(await runDemoMaintenance(profile, 0)).toMatchObject({ processed: 0, deleted: 1 })
    expect((await database.db.query('SELECT * FROM demo_payments')).rows).toHaveLength(0)
    expect((await database.db.query('SELECT * FROM demo_jobs')).rows).toHaveLength(0)
    expect((await database.db.query('SELECT * FROM demo_operations')).rows).toHaveLength(0)
    const claims = (await database.db.query('SELECT * FROM demo_claims')).rows
    expect(claims).toHaveLength(1)
    expect(claims[0]!.expired).toBe(true)
    await expect(recoverDemoPayment(owner.id, request.requestId, profile)).rejects.toMatchObject(code('RECORD_EXPIRED', 410))
    await expect(createDemoPayment(owner, request, profile)).rejects.toMatchObject(code('RECORD_EXPIRED', 410))
    const other = await session()
    await expect(database.transaction(client => readDemoOperation(client, other.id, request.requestId))).rejects.toMatchObject(code('IDEMPOTENCY_KEY_UNAVAILABLE', 409))
  })

  it('excludes expired details while retaining global claim recovery barriers', async () => {
    const owner = await session()
    const request = input()
    const created = await createDemoPayment(owner, request, profile)
    await database.db.query("UPDATE demo_payments SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE id=$1", [created.body.id])
    await expect(getDemoPayment(owner.id, created.body.id, profile)).rejects.toMatchObject(code('RECORD_EXPIRED', 410))
    await expect(createDemoPayment(owner, request, profile)).rejects.toMatchObject(code('RECORD_EXPIRED', 410))
    expect((await listDemoPayments(owner.id, {}, profile)).items).toHaveLength(0)
    expect((await database.db.query('SELECT * FROM demo_claims')).rows).toHaveLength(1)
  })
})
