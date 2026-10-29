import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DemoDatabaseError } from '../server/utils/demo/database'
import { createDemoTestDatabase } from './demo-database'

describe('demo PostgreSQL transactions and retention constraints', () => {
  let database: Awaited<ReturnType<typeof createDemoTestDatabase>>
  const createdAt = '2026-10-27T00:00:00Z'
  const expiresAt = '2026-11-26T00:00:00Z'

  beforeAll(async () => { database = await createDemoTestDatabase() }, 30_000)
  afterAll(async () => { await database?.close() })

  it('replays the migration without losing permanent claims', async () => {
    await database.transaction(async (client) => {
      await client.query(`INSERT INTO demo_claims (key_hash, owner_hash, intent_hash, type, created_at)
        VALUES ($1, $2, $3, 'payment_create', $4)`, ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), createdAt])
    })
    await database.db.exec(await readFile(new URL('../server/db/migrations/0010_demo_v1.sql', import.meta.url), 'utf8'))
    const result = await database.db.query('SELECT key_hash FROM demo_claims')
    expect(result.rows).toEqual([{ key_hash: 'a'.repeat(64) }])
  })

  it('rolls back business errors without converting them into storage failures', async () => {
    const conflict = new Error('CUSTOMER_LIMIT_REACHED')
    await expect(database.transaction(async (client) => {
      await client.query(`INSERT INTO demo_sessions (id, token_hash, platform, expires_at, created_at)
        VALUES ('rollback', $1, 'ANDROID', $2, $3)`, ['1'.repeat(64), expiresAt, createdAt])
      throw conflict
    })).rejects.toBe(conflict)
    expect((await database.db.query("SELECT id FROM demo_sessions WHERE id = 'rollback'")).rows).toEqual([])
  })

  it('prevents a current customer reference from crossing session ownership', async () => {
    await database.transaction(async (client) => {
      await client.query(`INSERT INTO demo_sessions (id, token_hash, platform, expires_at, created_at)
        VALUES ('owner', $1, 'ANDROID', $3, $4), ('other', $2, 'ANDROID', $3, $4)`,
      ['2'.repeat(64), '3'.repeat(64), expiresAt, createdAt])
      await client.query(`INSERT INTO demo_customers (id, session_id, label, merchant_cust_id, created_at)
        VALUES ('customer', 'owner', 'Test', 'merchant-customer', $1)`, [createdAt])
      await client.query("UPDATE demo_sessions SET current_customer_id = 'customer' WHERE id = 'owner'")
    })
    await expect(database.transaction(client => client.query(
      "UPDATE demo_sessions SET current_customer_id = 'customer' WHERE id = 'other'",
    ))).rejects.toBeInstanceOf(DemoDatabaseError)
    expect((await database.db.query("SELECT current_customer_id FROM demo_sessions WHERE id = 'other'")).rows)
      .toEqual([{ current_customer_id: null }])
  })

  it('sanitizes database errors and leaves the next transaction usable', async () => {
    let observed: unknown
    try {
      await database.transaction(client => client.query("SELECT 'sensitive-example' FROM missing_demo_table"))
    }
    catch (error) { observed = error }
    expect(observed).toBeInstanceOf(DemoDatabaseError)
    expect(JSON.stringify(observed)).not.toContain('sensitive-example')
    expect(String(observed)).toBe('DemoDatabaseError: DEMO_DATABASE_UNAVAILABLE')
    await expect(database.transaction(client => client.query('SELECT 1 AS value')))
      .resolves.toMatchObject({ rows: [{ value: 1 }] })
  })

  it('retains claims when associated detail is removed', async () => {
    await database.transaction(async (client) => {
      await client.query(`INSERT INTO demo_operations (key_hash, session_id, id, type, execution, outcome, created_at, expires_at)
        VALUES ($1, 'owner', '22222222-2222-4222-8222-222222222222', 'payment_create', 'completed', 'rejected', $2, $3)`,
      ['a'.repeat(64), createdAt, expiresAt])
      await client.query("DELETE FROM demo_operations WHERE session_id = 'owner'")
      await client.query('UPDATE demo_claims SET expired = true WHERE key_hash = $1', ['a'.repeat(64)])
    })
    expect((await database.db.query('SELECT expired FROM demo_claims')).rows).toEqual([{ expired: true }])
    await expect(database.transaction(client => client.query(`INSERT INTO demo_claims
      (key_hash, owner_hash, intent_hash, type, created_at) VALUES ($1, $2, $3, 'payment_create', $4)`,
    ['a'.repeat(64), 'd'.repeat(64), 'e'.repeat(64), createdAt]))).rejects.toBeInstanceOf(DemoDatabaseError)
  })
})
