import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoTestDatabase } from './demo-database'
import { assertDemoSchema } from './demo-schema'
import {
  authenticateDemoSession,
  claimDemoOperation,
  consumeDemoLimit,
  createDemoCustomer,
  createDemoSession,
  demoKeyHash,
  getDemoSession,
  hashDemo,
  listDemoCustomers,
  normalizeCustomerLabel,
  readDemoOperation,
  resolveCustomer,
  setCurrentCustomer,
} from '../server/utils/demo/identity'

const mocked = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('../server/utils/demo/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/utils/demo/database')>()
  return { ...actual, demoTransaction: mocked.transaction }
})

let database: Awaited<ReturnType<typeof createDemoTestDatabase>>
beforeAll(async () => {
  database = await createDemoTestDatabase()
  mocked.transaction.mockImplementation(database.transaction)
}, 60_000)
afterAll(async () => { await database.close() })
beforeEach(async () => {
  await database.db.exec('TRUNCATE demo_sessions, demo_claims, demo_limits CASCADE')
})

function expectCode(code: string, statusCode?: number) {
  return { ...(statusCode ? { statusCode } : {}), body: { error: { code } } }
}

async function newSession() { return (await createDemoSession('ANDROID')).session.id }

describe('Demo session and customer persistence', () => {
  it('issues only a token hash and renews without creating customers or rotating identity', async () => {
    const { session, sessionToken } = await createDemoSession('IOS')
    expect(session.currentCustomerId).toBeNull()
    const rows = await database.db.query<{ token_hash: string }>('SELECT token_hash FROM demo_sessions')
    expect(rows.rows[0]!.token_hash).toHaveLength(64)
    expect(rows.rows[0]!.token_hash).not.toContain(sessionToken)
    await database.db.query("UPDATE demo_sessions SET created_at = now() - interval '2 days', expires_at = now() + interval '1 day' WHERE id = $1", [session.id])
    const renewed = await authenticateDemoSession(sessionToken)
    expect(renewed.id).toBe(session.id)
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000)
    expect((await database.db.query('SELECT * FROM demo_customers')).rows).toHaveLength(0)
    const again = await authenticateDemoSession(sessionToken)
    expect(again.expiresAt >= renewed.expiresAt).toBe(true)
  })

  it('distinguishes missing, invalid and expired credentials and never revives expired sessions', async () => {
    await expect(authenticateDemoSession(null)).rejects.toMatchObject(expectCode('SESSION_MISSING', 401))
    await expect(authenticateDemoSession('wrong')).rejects.toMatchObject(expectCode('SESSION_INVALID', 401))
    const { session, sessionToken } = await createDemoSession('ANDROID')
    await database.db.query("UPDATE demo_sessions SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE id = $1", [session.id])
    const before = await getDemoSession(session.id)
    await expect(authenticateDemoSession(sessionToken)).rejects.toMatchObject(expectCode('SESSION_EXPIRED', 401))
    expect((await getDemoSession(session.id)).expiresAt).toBe(before.expiresAt)
  })

  it('replays normalized customer intent without switching the current customer again', async () => {
    const sessionId = await newSession()
    const operationId = randomUUID()
    const first = await createDemoCustomer(sessionId, { operationId, label: '  Buyer 😀  ' })
    const second = await createDemoCustomer(sessionId, { operationId: randomUUID(), label: 'Second' })
    const replay = await createDemoCustomer(sessionId, { operationId: operationId.toUpperCase(), label: 'Buyer 😀' }, { compatible: false })
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(replay.body.id).toBe(first.body.id)
    expect(replay.body.currentCustomerId).toBe(second.body.id)
    assertDemoSchema('CustomerCreated', replay.body)
    await expect(createDemoCustomer(sessionId, { operationId, label: 'Changed' })).rejects.toMatchObject(expectCode('IDEMPOTENCY_CONFLICT', 409))
    await expect(createDemoCustomer(await newSession(), { operationId, label: 'Buyer 😀' })).rejects.toMatchObject(expectCode('IDEMPOTENCY_KEY_UNAVAILABLE', 409))
  })

  it('protects quota, current selection, ownership and first default resolution atomically', async () => {
    const sessionId = await newSession()
    const defaults = await Promise.all([1, 2].map(() => database.transaction(client => resolveCustomer(client, sessionId, { kind: 'current' }))))
    expect(defaults[0]!.id).toBe(defaults[1]!.id)
    const selected = await createDemoCustomer(sessionId, { operationId: randomUUID(), label: 'Selected' }, { limit: 2 })
    await expect(createDemoCustomer(sessionId, { operationId: randomUUID(), label: 'Excess' }, { limit: 2 })).rejects.toMatchObject(expectCode('CUSTOMER_LIMIT_REACHED', 409))
    expect((await getDemoSession(sessionId)).currentCustomerId).toBe(selected.body.id)
    await setCurrentCustomer(sessionId, defaults[0]!.id)
    expect((await getDemoSession(sessionId)).currentCustomerId).toBe(defaults[0]!.id)
    await expect(setCurrentCustomer(await newSession(), defaults[0]!.id)).rejects.toMatchObject(expectCode('RESOURCE_UNAVAILABLE', 403))
    await expect(setCurrentCustomer(sessionId, randomUUID())).rejects.toMatchObject(expectCode('RESOURCE_UNAVAILABLE', 403))
  })

  it('paginates only the owning session and never exposes merchant customer identifiers', async () => {
    const sessionId = await newSession()
    for (const label of ['First', 'Second', 'Third']) await createDemoCustomer(sessionId, { operationId: randomUUID(), label })
    await createDemoCustomer(await newSession(), { operationId: randomUUID(), label: 'Foreign' })
    const first = await listDemoCustomers(sessionId, { limit: 2 })
    const last = await listDemoCustomers(sessionId, { limit: 2, cursor: first.nextCursor! })
    expect(new Set([...first.items, ...last.items].map(item => item.id)).size).toBe(3)
    expect(last.nextCursor).toBeNull()
    assertDemoSchema('CustomerPage', first)
    assertDemoSchema('CustomerPage', last)
    await expect(listDemoCustomers(sessionId, { cursor: 'bad' })).rejects.toMatchObject(expectCode('INVALID_REQUEST', 400))
  })
})

describe('global claims and rate buckets', () => {
  it('keeps permanent minimal hashes after details expire; other owners cannot learn the result', async () => {
    const sessionId = await newSession()
    const id = randomUUID()
    await createDemoCustomer(sessionId, { operationId: id, label: 'Customer' })
    await database.db.query('DELETE FROM demo_operations WHERE id = $1', [id])
    const claim = (await database.db.query('SELECT * FROM demo_claims')).rows[0]!
    expect(Object.keys(claim).sort()).toEqual(['created_at', 'expired', 'intent_hash', 'key_hash', 'owner_hash', 'type'])
    expect(claim.key_hash).toBe(demoKeyHash(id))
    await expect(database.transaction(client => readDemoOperation(client, sessionId, id))).rejects.toMatchObject(expectCode('RECORD_EXPIRED', 410))
    const foreign = await newSession()
    await expect(database.transaction(client => readDemoOperation(client, foreign, id))).rejects.toMatchObject(expectCode('IDEMPOTENCY_KEY_UNAVAILABLE', 409))
    await expect(createDemoCustomer(sessionId, { operationId: id, label: 'Customer' })).rejects.toMatchObject(expectCode('RECORD_EXPIRED', 410))
  })

  it('shares the same UUID namespace across operation types and orders intent fields canonically', async () => {
    const sessionId = await newSession()
    const id = randomUUID()
    await createDemoCustomer(sessionId, { operationId: id, label: 'Customer' })
    await expect(database.transaction(client => claimDemoOperation(client, { sessionId, id, type: 'payment_create', intent: { label: 'Customer' } }))).rejects.toMatchObject(expectCode('IDEMPOTENCY_CONFLICT', 409))
    expect(hashDemo({ b: 1, a: { d: 2, c: 3 } })).toBe(hashDemo({ a: { c: 3, d: 2 }, b: 1 }))
    await expect(database.transaction(client => readDemoOperation(client, sessionId, randomUUID()))).rejects.toMatchObject(expectCode('REQUEST_NOT_FOUND', 404))
  })

  it('enforces persistent limits while accepted customer replays bypass new-action limits', async () => {
    await database.transaction(client => consumeDemoLimit(client, 'test', 1, 60))
    await expect(database.transaction(client => consumeDemoLimit(client, 'test', 1, 60))).rejects.toMatchObject({ statusCode: 429, body: { error: { code: 'RATE_LIMITED', execution: 'not_started', retryAfter: expect.any(Number) } } })
    const sessionId = await newSession()
    const id = randomUUID()
    await createDemoCustomer(sessionId, { operationId: id, label: 'Customer' })
    await database.db.query('UPDATE demo_limits SET count = 999')
    expect((await createDemoCustomer(sessionId, { operationId: id, label: 'Customer' })).status).toBe(200)
    await expect(createDemoCustomer(sessionId, { operationId: randomUUID(), label: 'New' })).rejects.toMatchObject(expectCode('RATE_LIMITED', 429))
  })
})

it('normalizes labels by Unicode codepoints and rejects controls before trimming', () => {
  expect(normalizeCustomerLabel(`  ${'😀'.repeat(40)}  `)).toHaveLength(80)
  expect(() => normalizeCustomerLabel('😀'.repeat(41))).toThrow()
  expect(() => normalizeCustomerLabel('\nCustomer')).toThrow()
  expect(() => normalizeCustomerLabel('   ')).toThrow()
})
