import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoTestDatabase } from './demo-database'
import { assertDemoSchema } from './demo-schema'
import { createDemoSession, hashDemo } from '../server/utils/demo/identity'
import { createDemoPayment, enqueuePayment, type SandboxProfile } from '../server/utils/demo/payment'
import { createDemoCheckout, getDemoOperation, releaseDemoCheckout } from '../server/utils/demo/lease'

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), create: vi.fn(), query: vi.fn(), recover: vi.fn() }))
vi.mock('../server/utils/demo/database', async (importOriginal) => ({
  ...await importOriginal<typeof import('../server/utils/demo/database')>(), demoTransaction: mocks.transaction,
}))
vi.mock('../server/utils/gateway', () => ({ createMobilePayment: mocks.create, queryPayment: mocks.query, queryPaymentCreation: mocks.recover }))

const profile = { profile: 'sandbox', merchantNo: 'test-merchant', appId: 'test-app', showcaseOrigin: 'https://demo.example.test' } as SandboxProfile
let database: Awaited<ReturnType<typeof createDemoTestDatabase>>
let sequence = 0
const payments = new Map<string, { paymentId: string, transactionId: string }>()
beforeAll(async () => {
  database = await createDemoTestDatabase()
  mocks.transaction.mockImplementation(database.transaction)
}, 60_000)
afterAll(async () => { await database.close() })
beforeEach(async () => {
  await database.db.exec('TRUNCATE demo_sessions, demo_claims, demo_limits, payment_orders CASCADE')
  payments.clear()
  mocks.create.mockImplementation(async (_profile, context) => {
    const result = { paymentId: String(++sequence), transactionId: String(++sequence), rawStatus: 'U' }
    payments.set(context.merchantTxnId, result)
    return result
  })
  mocks.recover.mockImplementation(async (_profile, reference) => ({ ...payments.get(reference), rawStatus: 'U', status: 'processing' }))
  mocks.query.mockImplementation(async (_profile, paymentId) => ({ paymentId, ...[...payments.values()].find(row => row.paymentId === paymentId), rawStatus: 'U', status: 'processing' }))
})

async function fixture() {
  const { session } = await createDemoSession('ANDROID')
  const payment = await createDemoPayment(session, {
    requestId: randomUUID(), sceneId: 'one_time', integration: 'native-sdk',
    amount: { minor: 500, currency: 'USD' }, customer: { kind: 'current' }, returnTarget: { kind: 'preset', id: 'app_android' },
  }, profile)
  return { session, payment: payment.body }
}
const code = (value: string, status = 409) => ({ statusCode: status, body: { error: { code: value } } })

describe('persistent checkout leases', () => {
  it('replays a lease without extending expiry and lets old clients recover it', async () => {
    const { session, payment } = await fixture()
    const input = { operationId: randomUUID() }
    const first = await createDemoCheckout(session, payment.id, input, profile)
    const replay = await createDemoCheckout(session, payment.id, input, profile, false)
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(replay.body.checkoutSessionId).toBe(first.body.checkoutSessionId)
    expect(replay.body.leaseExpiresAt).toBe(first.body.leaseExpiresAt)
    assertDemoSchema('CheckoutSession', first.body)
    const operation = await getDemoOperation(session.id, input.operationId)
    assertDemoSchema('Operation', operation)
    expect(operation).toMatchObject({ execution: 'completed', outcome: 'effective', leaseState: 'active' })
    await expect(createDemoCheckout(session, payment.id, { operationId: randomUUID() }, profile, false)).rejects.toMatchObject(code('CLIENT_VERSION_UNSUPPORTED', 426))
  })

  it('rejects competing claims and atomically supersedes only the current lease', async () => {
    const { session, payment } = await fixture()
    const original = { operationId: randomUUID() }
    const first = await createDemoCheckout(session, payment.id, original, profile)
    const competing = { operationId: randomUUID() }
    await expect(createDemoCheckout(session, payment.id, competing, profile)).rejects.toMatchObject({
      ...code('CHECKOUT_IN_USE'), body: { error: { code: 'CHECKOUT_IN_USE', checkoutSessionId: first.body.checkoutSessionId, leaseExpiresAt: first.body.leaseExpiresAt } },
    })
    // The rejected intent left no permanent claim; this key can now be accepted.
    const next = await createDemoCheckout(session, payment.id, { ...competing, supersedes: first.body.checkoutSessionId }, profile)
    expect(next.body.checkoutSessionId).not.toBe(first.body.checkoutSessionId)
    await releaseDemoCheckout(session.id, payment.id, first.body.checkoutSessionId)
    expect(await getDemoOperation(session.id, competing.operationId)).toMatchObject({ leaseState: 'active' })
    expect(await getDemoOperation(session.id, original.operationId)).toMatchObject({ leaseState: 'superseded', outcome: 'effective' })
    await expect(createDemoCheckout(session, payment.id, original, profile)).rejects.toMatchObject({
      statusCode: 409, body: { error: { code: 'CHECKOUT_SESSION_ENDED', operationId: original.operationId, checkoutSessionId: first.body.checkoutSessionId, currentView: { id: payment.id } } },
    })
  })

  it('releases idempotently and never revives an ended operation', async () => {
    const { session, payment } = await fixture()
    const input = { operationId: randomUUID() }
    const first = await createDemoCheckout(session, payment.id, input, profile)
    await releaseDemoCheckout(session.id, payment.id, first.body.checkoutSessionId)
    await releaseDemoCheckout(session.id, payment.id, first.body.checkoutSessionId)
    expect(await getDemoOperation(session.id, input.operationId)).toMatchObject({ leaseState: 'released', outcome: 'effective' })
    await expect(createDemoCheckout(session, payment.id, input, profile)).rejects.toMatchObject({
      statusCode: 409, body: { error: { code: 'CHECKOUT_SESSION_ENDED', operationId: input.operationId, checkoutSessionId: first.body.checkoutSessionId, currentView: { id: payment.id } } },
    })
    await expect(createDemoCheckout(session, payment.id, { operationId: randomUUID(), supersedes: first.body.checkoutSessionId }, profile)).resolves.toMatchObject({ status: 201 })
  })

  it('lets only one competing takeover replace the same prior lease', async () => {
    const { session, payment } = await fixture()
    const first = await createDemoCheckout(session, payment.id, { operationId: randomUUID() }, profile)
    const results = await Promise.allSettled([randomUUID(), randomUUID()].map(operationId =>
      createDemoCheckout(session, payment.id, { operationId, supersedes: first.body.checkoutSessionId }, profile)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const active = await database.db.query("SELECT id FROM demo_leases WHERE payment_id=$1 AND state='active'", [payment.id])
    expect(active.rows).toHaveLength(1)
    expect(active.rows[0]).not.toEqual({ id: first.body.checkoutSessionId })
  })

  it('enforces the conservative window before replaying active or ended leases', async () => {
    const { session, payment } = await fixture()
    const input = { operationId: randomUUID() }
    await database.db.query("UPDATE demo_payments SET continue_until=now()+interval '20 seconds' WHERE id=$1", [payment.id])
    const first = await createDemoCheckout(session, payment.id, input, profile)
    expect(Date.parse(first.body.leaseExpiresAt) - Date.now()).toBeLessThanOrEqual(20_000)
    await database.db.query("UPDATE demo_payments SET sent_at=now()-interval '31 minutes',continue_until=now()-interval '1 minute' WHERE id=$1", [payment.id])
    await expect(createDemoCheckout(session, payment.id, input, profile)).rejects.toMatchObject({
      ...code('PAYMENT_EXPIRED'), body: { error: { code: 'PAYMENT_EXPIRED', operationId: input.operationId, currentView: { id: payment.id, attention: null } } },
    })
    const nextOperationId = randomUUID()
    await expect(createDemoCheckout(session, payment.id, { operationId: nextOperationId }, profile)).rejects.toMatchObject({
      statusCode: 409, body: { error: { code: 'PAYMENT_EXPIRED', operationId: nextOperationId, currentView: { id: payment.id } } },
    })
  })

  it('echoes the operation when a verified U has no reliable continuation window', async () => {
    const { session, payment } = await fixture()
    const input = { operationId: randomUUID() }
    await database.db.query('UPDATE demo_payments SET sent_at=NULL,continue_until=NULL WHERE id=$1', [payment.id])
    await expect(createDemoCheckout(session, payment.id, input, profile)).rejects.toMatchObject({
      statusCode: 409,
      body: { error: { code: 'PAYMENT_EXPIRED', operationId: input.operationId, currentView: {
        id: payment.id, status: { verified: true, rawPaymentStatus: 'U' },
      } } },
    })
    expect((await database.db.query('SELECT * FROM demo_leases WHERE payment_id=$1', [payment.id])).rows).toHaveLength(0)
  })

  it('echoes the operation when the window expires during the launch query', async () => {
    const { session, payment } = await fixture()
    const input = { operationId: randomUUID() }
    mocks.query.mockImplementationOnce(async (_profile, paymentId) => {
      await database.db.query("UPDATE demo_payments SET sent_at=now()-interval '31 minutes',continue_until=now()-interval '1 second' WHERE id=$1", [payment.id])
      return { paymentId, ...[...payments.values()].find(row => row.paymentId === paymentId), rawStatus: 'U', status: 'processing' }
    })
    await expect(createDemoCheckout(session, payment.id, input, profile)).rejects.toMatchObject({
      statusCode: 409, body: { error: { code: 'PAYMENT_EXPIRED', operationId: input.operationId, currentView: { id: payment.id } } },
    })
    expect((await database.db.query('SELECT * FROM demo_leases WHERE payment_id=$1', [payment.id])).rows).toHaveLength(0)
  })

  it('projects lease expiry without rewriting its successful operation outcome', async () => {
    const { session, payment } = await fixture()
    const input = { operationId: randomUUID() }
    const first = await createDemoCheckout(session, payment.id, input, profile)
    await database.db.query("UPDATE demo_leases SET expires_at=now()-interval '1 second' WHERE id=$1", [first.body.checkoutSessionId])
    expect(await getDemoOperation(session.id, input.operationId)).toMatchObject({ leaseState: 'expired', outcome: 'effective' })
    await expect(createDemoCheckout(session, payment.id, input, profile)).rejects.toMatchObject({
      statusCode: 409, body: { error: { code: 'CHECKOUT_SESSION_ENDED', operationId: input.operationId, checkoutSessionId: first.body.checkoutSessionId, currentView: { id: payment.id } } },
    })
    await expect(createDemoCheckout(session, payment.id, { operationId: randomUUID() }, profile)).resolves.toMatchObject({ status: 201 })
  })

  it.each(['expired', 'released', 'superseded'] as const)('preserves the %s outcome after launch details are purged', async (state) => {
    const { session, payment } = await fixture()
    const input = { operationId: randomUUID() }
    const first = await createDemoCheckout(session, payment.id, input, profile)
    await database.db.query('UPDATE demo_operations SET lease_state=$2 WHERE id=$1', [input.operationId, state])
    await database.db.query('DELETE FROM demo_leases WHERE id=$1', [first.body.checkoutSessionId])
    const operation = await getDemoOperation(session.id, input.operationId)
    expect(operation).toMatchObject({ execution: 'completed', outcome: 'effective', leaseState: state })
    assertDemoSchema('Operation', operation)
  })

  it('rejects cross-session payments, supersedes and global key reuse without views', async () => {
    const first = await fixture()
    const other = await fixture()
    const input = { operationId: randomUUID() }
    const lease = await createDemoCheckout(first.session, first.payment.id, input, profile)
    await expect(createDemoCheckout(other.session, first.payment.id, { operationId: randomUUID() }, profile)).rejects.toMatchObject(code('RESOURCE_UNAVAILABLE', 403))
    await expect(createDemoCheckout(other.session, other.payment.id, { operationId: randomUUID(), supersedes: lease.body.checkoutSessionId }, profile)).rejects.toMatchObject(code('RESOURCE_UNAVAILABLE', 403))
    await expect(createDemoCheckout(other.session, other.payment.id, input, profile)).rejects.toMatchObject(code('IDEMPOTENCY_KEY_UNAVAILABLE'))
    await expect(releaseDemoCheckout(other.session.id, other.payment.id, lease.body.checkoutSessionId)).rejects.toMatchObject(code('RESOURCE_UNAVAILABLE', 403))
  })

  it('checks same-key intent and does not issue stale launch data after query failure', async () => {
    const { session, payment } = await fixture()
    const input = { operationId: randomUUID() }
    const first = await createDemoCheckout(session, payment.id, input, profile)
    await expect(createDemoCheckout(session, payment.id, { ...input, supersedes: first.body.checkoutSessionId }, profile)).rejects.toMatchObject(code('IDEMPOTENCY_CONFLICT'))
    mocks.query.mockRejectedValue(new Error('upstream unavailable'))
    await expect(createDemoCheckout(session, payment.id, input, profile)).rejects.toMatchObject(code('PROVIDER_UNAVAILABLE'))
  })

  it('does not allow takeover to bypass a newly observed processing state', async () => {
    const { session, payment } = await fixture()
    const first = await createDemoCheckout(session, payment.id, { operationId: randomUUID() }, profile)
    mocks.query.mockResolvedValue({ paymentId: payment.provider!.paymentId, rawStatus: 'P', status: 'processing' })
    await expect(createDemoCheckout(session, payment.id, { operationId: randomUUID(), supersedes: first.body.checkoutSessionId }, profile)).rejects.toMatchObject(code('PAYMENT_PROCESSING'))
  })

  it('does not issue or replay launch data from old U when the query bucket is exhausted', async () => {
    const { session, payment } = await fixture()
    const input = { operationId: randomUUID() }
    const first = await createDemoCheckout(session, payment.id, input, profile)
    await database.db.query("UPDATE demo_payments SET observed_at=now()-interval '1 second' WHERE id=$1", [payment.id])
    await database.db.query("UPDATE demo_limits SET count=10,reset_at=now()+interval '1 minute' WHERE key=$1", [hashDemo(['demo-v1-limit', `query:${payment.id}`])])
    const queryCount = mocks.query.mock.calls.length
    const nextId = randomUUID()
    await expect(createDemoCheckout(session, payment.id, { operationId: nextId, supersedes: first.body.checkoutSessionId }, profile)).rejects.toMatchObject(code('PROVIDER_UNAVAILABLE'))
    await expect(createDemoCheckout(session, payment.id, input, profile)).rejects.toMatchObject(code('PROVIDER_UNAVAILABLE'))
    expect(mocks.query).toHaveBeenCalledTimes(queryCount)
    await expect(getDemoOperation(session.id, nextId)).rejects.toMatchObject(code('REQUEST_NOT_FOUND', 404))
    expect(await getDemoOperation(session.id, input.operationId)).toMatchObject({ leaseState: 'active', outcome: 'effective' })
  })

  it('requires a new query when a notification arrives while the launch query is in flight', async () => {
    const { session, payment } = await fixture()
    const input = { operationId: randomUUID() }
    let started!: () => void
    const start = new Promise<void>((resolve) => { started = resolve })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    mocks.query.mockImplementationOnce(async (_profile, paymentId) => {
      started()
      await gate
      return { paymentId, ...[...payments.values()].find(row => row.paymentId === paymentId), rawStatus: 'U', status: 'processing' }
    })
    const attempt = createDemoCheckout(session, payment.id, input, profile)
    const rejected = expect(attempt).rejects.toMatchObject(code('PROVIDER_UNAVAILABLE'))
    await start
    await database.transaction(client => enqueuePayment(client, payment.id))
    release()
    await rejected
    expect((await database.db.query('SELECT * FROM demo_leases WHERE payment_id=$1', [payment.id])).rows).toHaveLength(0)
    const next = await createDemoCheckout(session, payment.id, input, profile)
    expect(next.status).toBe(201)
    const job = (await database.db.query<{ revision: number, claimed_revision: number, state: string }>('SELECT revision,claimed_revision,state FROM demo_jobs WHERE payment_id=$1', [payment.id])).rows[0]!
    expect(job.state).toBe('pending')
    expect(String(job.revision)).toBe(String(job.claimed_revision))
  })
})
