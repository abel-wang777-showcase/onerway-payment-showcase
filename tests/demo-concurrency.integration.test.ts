import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireTestDatabaseUrl } from './db'
import { demoTransaction } from '../server/utils/demo/database'
import { createDemoSession, demoKeyHash, demoOwnerHash, hashDemo } from '../server/utils/demo/identity'
import { createDemoPayment, type SandboxProfile } from '../server/utils/demo/payment'
import { createDemoCheckout, getDemoOperation, releaseDemoCheckout } from '../server/utils/demo/lease'
import { DemoError } from '../server/utils/demo/errors'
import type { PaymentCreate } from '../shared/payment/demo'
import type { MobileCreateContext } from '../server/utils/gateway'

// The CI runner verifies the isolated DB guard and migrations before this file.
// No production profile or Provider transport is loaded by these fixtures.
requireTestDatabaseUrl()
const mocks = vi.hoisted(() => ({ create: vi.fn(), query: vi.fn(), recover: vi.fn() }))
vi.mock('../server/utils/gateway', () => ({ createMobilePayment: mocks.create, queryPayment: mocks.query, queryPaymentCreation: mocks.recover }))

const profile: SandboxProfile = {
  profile: 'sandbox', apiBaseUrl: 'https://sandbox-acq.onerway.com', sdkUrl: 'https://sdk.example.test',
  showcaseOrigin: 'https://demo.example.test', notifyUrl: 'https://demo.example.test/notify', transactionIp: null,
  merchantNo: 'isolated-test-merchant', appId: 'isolated-test-app', secret: 'invalid-test-fixture', transactionPolicy: 'sandbox-only',
}
const sessionIds: string[] = []
const operationIds: string[] = []
const provider = new Map<string, { paymentId: string, transactionId: string }>()
const providerId = () => BigInt(`0x${randomBytes(8).toString('hex')}`).toString()
function operationId() { const id = randomUUID(); operationIds.push(id); return id }
async function session() {
  const created = await createDemoSession('ANDROID')
  sessionIds.push(created.session.id)
  return created.session
}
function input(): PaymentCreate {
  return { requestId: operationId(), sceneId: 'one_time', integration: 'native-sdk', amount: { minor: 500, currency: 'USD' },
    customer: { kind: 'current' }, returnTarget: { kind: 'preset', id: 'app_android' } }
}
beforeEach(() => {
  mocks.create.mockClear()
  mocks.create.mockImplementation(async (_profile: SandboxProfile, context: MobileCreateContext) => {
    const result = { paymentId: providerId(), transactionId: providerId() }
    provider.set(context.merchantTxnId, result)
    return { ...result, rawStatus: 'U' }
  })
  mocks.recover.mockImplementation(async (_profile: SandboxProfile, reference: string) => {
    const result = provider.get(reference)
    if (!result) throw new Error('CONTROLLED_NOT_FOUND')
    return { ...result, rawStatus: 'P', status: 'processing' }
  })
  mocks.query.mockImplementation(async (_profile: SandboxProfile, id: string) => {
    const result = [...provider.values()].find(value => value.paymentId === id)
    if (!result) throw new Error('CONTROLLED_NOT_FOUND')
    return { ...result, rawStatus: 'U', status: 'processing' }
  })
})

afterAll(async () => {
  // Delete only this suite's randomly generated fixtures, never truncate a DB.
  if (!sessionIds.length) return
  await demoTransaction(async (client) => {
    await client.query('DELETE FROM demo_events WHERE payment_id IN (SELECT id FROM demo_payments WHERE session_id=ANY($1::text[]))', [sessionIds])
    await client.query('DELETE FROM demo_leases WHERE session_id=ANY($1::text[])', [sessionIds])
    await client.query('DELETE FROM demo_jobs WHERE payment_id IN (SELECT id FROM demo_payments WHERE session_id=ANY($1::text[]))', [sessionIds])
    const payments = await client.query<{ order_id: string }>('DELETE FROM demo_payments WHERE session_id=ANY($1::text[]) RETURNING order_id', [sessionIds])
    await client.query('DELETE FROM demo_operations WHERE session_id=ANY($1::text[])', [sessionIds])
    await client.query('UPDATE demo_sessions SET current_customer_id=NULL WHERE id=ANY($1::text[])', [sessionIds])
    await client.query('DELETE FROM demo_customers WHERE session_id=ANY($1::text[])', [sessionIds])
    await client.query('DELETE FROM demo_sessions WHERE id=ANY($1::text[])', [sessionIds])
    await client.query('DELETE FROM demo_claims WHERE key_hash=ANY($1::text[])', [operationIds.map(demoKeyHash)])
    await client.query('DELETE FROM demo_resource_tombstones WHERE owner_hash=ANY($1::text[])', [sessionIds.map(demoOwnerHash)])
    await client.query('DELETE FROM demo_limits WHERE key=ANY($1::text[])', [sessionIds.flatMap(id =>
      [`payment:${id}`, `${id}:checkout_session`].map(key => hashDemo(['demo-v1-limit', key])))])
    await client.query('DELETE FROM payment_orders WHERE id=ANY($1::text[])', [payments.rows.map(row => row.order_id)])
  })
})

describe('Demo Neon multiple-connection concurrency', () => {
  it('uses distinct PostgreSQL backends and claims a simultaneous payment only once', async () => {
    let arrivals = 0
    let ready!: () => void
    const gate = new Promise<void>((resolve) => { ready = resolve })
    const backends = await Promise.all([0, 1].map(() => demoTransaction(async (client) => {
      const result = await client.query<{ id: number }>('SELECT pg_backend_pid() AS id')
      if (++arrivals === 2) ready()
      await gate
      return result.rows[0]!.id
    })))
    expect(new Set(backends).size).toBe(2)
    const owner = await session()
    const request = input()
    const results = await Promise.all(Array.from({ length: 6 }, () => createDemoPayment(owner, request, profile)))
    expect(new Set(results.map(result => result.body.id)).size).toBe(1)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const customers = await demoTransaction(client => client.query('SELECT id FROM demo_customers WHERE session_id=$1', [owner.id]))
    expect(customers.rows).toHaveLength(1)
  })

  it('serializes distinct current-customer payments onto one default customer', async () => {
    const owner = await session()
    const results = await Promise.all(Array.from({ length: 4 }, () => createDemoPayment(owner, input(), profile)))
    expect(new Set(results.map(result => result.body.id)).size).toBe(4)
    expect(new Set(results.map(result => result.body.customerId)).size).toBe(1)
    expect(mocks.create).toHaveBeenCalledTimes(4)
    const customers = await demoTransaction(client => client.query('SELECT id FROM demo_customers WHERE session_id=$1', [owner.id]))
    expect(customers.rows).toHaveLength(1)
  })

  it('allows only one concurrent takeover and old release cannot clear the winner', async () => {
    const owner = await session()
    const payment = await createDemoPayment(owner, input(), profile)
    const initialId = operationId()
    const initial = await createDemoCheckout(owner, payment.body.id, { operationId: initialId }, profile)
    const candidates = [operationId(), operationId()]
    const attempts = await Promise.allSettled(candidates.map(id => createDemoCheckout(owner, payment.body.id, {
      operationId: id, supersedes: initial.body.checkoutSessionId,
    }, profile)))
    const succeeded = attempts.filter(result => result.status === 'fulfilled')
    expect(succeeded.length).toBeLessThanOrEqual(1)
    for (const result of attempts) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(DemoError)
        expect(result.reason.statusCode).toBe(409)
        expect(succeeded.length === 0 ? ['PROVIDER_UNAVAILABLE'] : ['PROVIDER_UNAVAILABLE', 'CHECKOUT_IN_USE'])
          .toContain(result.reason.body.error.code)
      }
    }
    let winnerIndex = attempts.findIndex(result => result.status === 'fulfilled')
    if (winnerIndex === -1) {
      const unchanged = await demoTransaction(client => client.query<{ id: string, state: string }>('SELECT id,state FROM demo_leases WHERE payment_id=$1', [payment.body.id]))
      expect(unchanged.rows).toEqual([{ id: initial.body.checkoutSessionId, state: 'active' }])
      const retried = await createDemoCheckout(owner, payment.body.id, {
        operationId: candidates[0]!, supersedes: initial.body.checkoutSessionId,
      }, profile)
      expect(retried.status).toBe(201)
      winnerIndex = 0
    }
    const loserIndex = winnerIndex === 0 ? 1 : 0
    await expect(createDemoCheckout(owner, payment.body.id, {
      operationId: candidates[loserIndex]!, supersedes: initial.body.checkoutSessionId,
    }, profile)).rejects.toMatchObject({ statusCode: 409, body: { error: { code: 'CHECKOUT_IN_USE' } } })
    await releaseDemoCheckout(owner.id, payment.body.id, initial.body.checkoutSessionId)
    const active = await demoTransaction(client => client.query<{ id: string }>("SELECT id FROM demo_leases WHERE payment_id=$1 AND state='active'", [payment.body.id]))
    expect(active.rows).toHaveLength(1)
    expect(active.rows[0]!.id).not.toBe(initial.body.checkoutSessionId)
    expect(await getDemoOperation(owner.id, initialId)).toMatchObject({ leaseState: 'superseded', outcome: 'effective' })
  })
})
