import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoTestDatabase } from './demo-database'
import { assertDemoResponse } from './demo-schema'
import type { CheckoutSession, CustomerCreated, NativeSessionIssued, PaymentCreate, PaymentView } from '../shared/payment/demo'

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), create: vi.fn(), query: vi.fn(), recover: vi.fn() }))
vi.mock('../server/utils/demo/database', async (original) => ({
  ...await original<typeof import('../server/utils/demo/database')>(), demoTransaction: mocks.transaction,
}))
vi.mock('../server/utils/gateway', () => ({ createMobilePayment: mocks.create, queryPayment: mocks.query, queryPaymentCreation: mocks.recover }))
vi.mock('../server/utils/profile', () => ({ requireServerProfile: () => ({ profile: 'sandbox', merchantNo: 'test-merchant', appId: 'test-app', showcaseOrigin: 'https://demo.example.test' }) }))

let database: Awaited<ReturnType<typeof createDemoTestDatabase>>
let server: Server
let origin: string
let status = 'U'
let sequence = 0
const payments = new Map<string, { paymentId: string, transactionId: string }>()

beforeAll(async () => {
  database = await createDemoTestDatabase()
  mocks.transaction.mockImplementation(database.transaction)
  const { handleDemoRequest } = await import('../server/utils/demo/http')
  server = createServer(toNodeListener(createApp().use(defineEventHandler(handleDemoRequest))))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local test address')
  origin = `http://127.0.0.1:${address.port}/api/demo/v1`
}, 60_000)
afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await database?.close()
})
beforeEach(async () => {
  vi.unstubAllEnvs()
  await database.db.exec('TRUNCATE demo_sessions, demo_claims, demo_limits, payment_orders CASCADE')
  payments.clear()
  status = 'U'
  mocks.create.mockReset().mockImplementation(async (_profile, context) => {
    const result = { paymentId: String(++sequence), transactionId: String(++sequence) }
    payments.set(context.merchantTxnId, result)
    return { ...result, rawStatus: 'U' }
  })
  mocks.recover.mockReset().mockImplementation(async (_profile, reference) => ({ ...payments.get(reference), rawStatus: status, status: status === 'S' ? 'succeeded' : 'processing' }))
  mocks.query.mockReset().mockImplementation(async (_profile, paymentId) => ({ ...[...payments.values()].find(value => value.paymentId === paymentId), rawStatus: status, status: status === 'S' ? 'succeeded' : 'processing' }))
})

/** Every observed wire response is checked against its declared status/body/header schema. */
async function request<T>(method: string, template: string, options: { token?: string, body?: unknown, parameters?: Record<string, string>, query?: string } = {}) {
  let path = template
  for (const [name, value] of Object.entries(options.parameters ?? {})) path = path.replace(`{${name}}`, encodeURIComponent(value))
  const response = await fetch(origin + path + (options.query ?? ''), {
    method,
    headers: { 'X-Demo-Client': 'ANDROID/1', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const raw = await response.text()
  const body = raw ? JSON.parse(raw) : undefined
  assertDemoResponse(template, method, response.status, body, Object.fromEntries(response.headers), { authenticated: !!options.token && response.status !== 401 })
  return { status: response.status, body: body as T }
}
async function newSession() {
  const result = await request<NativeSessionIssued>('POST', '/sessions', { body: { platform: 'ANDROID', clientBuild: 1 } })
  expect(result.status).toBe(201)
  return result.body
}
function createInput(): PaymentCreate {
  return { requestId: randomUUID(), sceneId: 'one_time', integration: 'native-sdk', amount: { minor: 500, currency: 'USD' }, customer: { kind: 'current' }, returnTarget: { kind: 'preset', id: 'app_android' } }
}

describe('Native SALE HTTP → services → PostgreSQL with controlled Provider', () => {
  it('runs session/customer/create/recovery/query/lease/release and trustworthy success end to end', async () => {
    const session = await newSession()
    const token = session.sessionToken
    await request('GET', '/session', { token })
    await request('POST', '/session/renew', { token })
    await request('GET', '/capabilities', { token })
    const customer = await request<CustomerCreated>('POST', '/customers', { token, body: { operationId: randomUUID(), label: 'Local test customer' } })
    expect(customer.status).toBe(201)
    await request('GET', '/customers', { token })
    await request('PUT', '/session/current-customer', { token, body: { customerId: customer.body.id } })
    const input = createInput()
    const created = await request<PaymentView>('POST', '/payments', { token, body: input })
    expect(created.status).toBe(201)
    expect(created.body.customerId).toBe(customer.body.id)
    const replay = await request<PaymentView>('POST', '/payments', { token, body: input })
    expect(replay.status).toBe(200)
    expect(replay.body.id).toBe(created.body.id)
    const recovered = await request<PaymentView>('GET', '/payment-requests/{requestId}', { token, parameters: { requestId: input.requestId } })
    expect(recovered.body.id).toBe(created.body.id)
    const parameters = { id: created.body.id }
    await request('GET', '/payments/{id}', { token, parameters })
    await request('GET', '/payments', { token, query: `?merchantTxnId=${created.body.merchantTxnId}` })
    const operationId = randomUUID()
    const checkout = await request<CheckoutSession>('POST', '/payments/{id}/checkout-session', { token, parameters, body: { operationId } })
    expect(checkout.status).toBe(201)
    await request('GET', '/operations/{operationId}', { token, parameters: { operationId } })
    const released = await request('DELETE', '/payments/{id}/checkout-sessions/{checkoutSessionId}', { token, parameters: { ...parameters, checkoutSessionId: checkout.body.checkoutSessionId } })
    expect(released.status).toBe(204)
    status = 'S'
    const success = await request<PaymentView>('POST', '/payments/{id}/refresh', { token, parameters })
    expect(success.body.status).toMatchObject({ rawPaymentStatus: 'S', normalized: 'succeeded', verified: true })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    const attempts = await database.db.query('SELECT * FROM payment_attempts')
    expect(attempts.rows).toHaveLength(1)
  })

  it('recovers an unknown create through query without replaying the Provider write', async () => {
    const { sessionToken: token } = await newSession()
    const input = createInput()
    mocks.create.mockImplementationOnce(async (_profile, context) => {
      payments.set(context.merchantTxnId, { paymentId: '91001', transactionId: '92001' })
      throw new Error('response lost after Provider accepted')
    })
    const created = await request<PaymentView>('POST', '/payments', { token, body: input })
    expect(created.status).toBe(202)
    expect(created.body.creationState).toBe('unknown')
    const recovered = await request<PaymentView>('GET', '/payment-requests/{requestId}', { token, parameters: { requestId: input.requestId } })
    expect(recovered.body.creationState).toBe('ready')
    expect(recovered.body.id).toBe(created.body.id)
    expect(recovered.body.provider?.paymentId).toBe('91001')
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('keeps cross-session data hidden, rejects changed intent, and enforces 409 continuation expiry', async () => {
    const { sessionToken: token } = await newSession()
    const input = createInput()
    const created = await request<PaymentView>('POST', '/payments', { token, body: input })
    const parameters = { id: created.body.id }
    const foreign = await newSession()
    expect((await request('GET', '/payments/{id}', { token: foreign.sessionToken, parameters })).status).toBe(403)
    expect((await request('POST', '/payments', { token: foreign.sessionToken, body: input })).status).toBe(409)
    expect((await request('POST', '/payments', { token, body: { ...input, amount: { minor: 600, currency: 'USD' } } })).status).toBe(409)
    await database.db.query("UPDATE demo_payments SET sent_at=now()-interval '31 minutes',continue_until=now()-interval '1 minute' WHERE id=$1", [created.body.id])
    const expired = await request<{ error: { code: string, currentView: PaymentView } }>('POST', '/payments/{id}/checkout-session', { token, parameters, body: { operationId: randomUUID() } })
    expect(expired.status).toBe(409)
    expect(expired.body.error.code).toBe('PAYMENT_EXPIRED')
    expect(expired.body.error.currentView.id).toBe(created.body.id)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
