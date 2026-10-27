import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import examples from '../docs/api/demo-v1.examples.json'
import { DemoError } from '../server/utils/demo/errors'
import { assertDemoResponse } from './demo-schema'

const mocks = vi.hoisted(() => ({
  authenticateDemoSession: vi.fn(), createDemoSession: vi.fn(), getDemoSession: vi.fn(),
  createDemoCustomer: vi.fn(), setCurrentCustomer: vi.fn(), listDemoCustomers: vi.fn(),
  consumeDemoLimit: vi.fn(), createDemoPayment: vi.fn(), getDemoPayment: vi.fn(),
  recoverDemoPayment: vi.fn(), listDemoPayments: vi.fn(), getDemoOperation: vi.fn(),
  createDemoCheckout: vi.fn(), releaseDemoCheckout: vi.fn(), requireServerProfile: vi.fn(),
}))
vi.mock('../server/utils/demo/identity', async (original) => ({ ...await original<object>(), ...mocks }))
vi.mock('../server/utils/demo/payment', () => mocks)
vi.mock('../server/utils/demo/lease', () => mocks)
vi.mock('../server/utils/profile', () => mocks)
vi.mock('../server/utils/demo/database', () => ({ demoTransaction: (task: (db: object) => unknown) => task({}) }))

const session = { id: 'ses_example', platform: 'ANDROID', currentCustomerId: null, expiresAt: '2026-11-24T00:00:00Z', createdAt: '2026-10-25T00:00:00Z' }
const token = 't'.repeat(43)
const payment = examples.examples.find(example => example.name === 'payment-ready')!
const lease = examples.examples.find(example => example.name === 'checkout-session-created')!
const customer = examples.examples.find(example => example.name === 'customer-create')!
let server: Server
let origin: string

beforeAll(async () => {
  const { handleDemoRequest } = await import('../server/utils/demo/http')
  server = createServer(toNodeListener(createApp().use(defineEventHandler(handleDemoRequest))))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local test address')
  origin = `http://127.0.0.1:${address.port}/api/demo/v1`
})
afterAll(async () => {
  vi.unstubAllEnvs()
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  mocks.authenticateDemoSession.mockImplementation(async (value) => {
    if (!value) throw new DemoError(401, 'SESSION_MISSING')
    if (value !== token) throw new DemoError(401, 'SESSION_INVALID')
    return session
  })
  mocks.createDemoSession.mockResolvedValue({ session, sessionToken: token })
  mocks.getDemoSession.mockResolvedValue(session)
  mocks.requireServerProfile.mockReturnValue({ profile: 'sandbox', merchantNo: 'merchant_public_example', secret: 'SECRET_NOT_FOR_HTTP' })
  mocks.createDemoPayment.mockResolvedValue({ status: 201, body: payment.response.body })
  mocks.getDemoPayment.mockResolvedValue(payment.response.body)
  mocks.recoverDemoPayment.mockResolvedValue(payment.response.body)
  mocks.createDemoCheckout.mockResolvedValue({ status: 201, body: lease.response.body })
  mocks.createDemoCustomer.mockResolvedValue({ status: 201, body: customer.response.body })
  mocks.listDemoCustomers.mockResolvedValue({ items: [], nextCursor: null })
})

async function request(path: string, options: { method?: string, body?: unknown, headers?: Record<string, string>, authenticated?: boolean, raw?: string } = {}) {
  const headers: Record<string, string> = { 'X-Demo-Client': 'ANDROID/1', ...(options.authenticated === false ? {} : { Authorization: `Bearer ${token}` }), ...options.headers }
  if (options.body !== undefined || options.raw !== undefined) headers['Content-Type'] ??= 'application/json'
  const response = await fetch(origin + path, { method: options.method ?? 'GET', headers, body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)) })
  const raw = await response.text()
  return { status: response.status, body: raw ? JSON.parse(raw) : undefined, headers: Object.fromEntries(response.headers) }
}

function conforms(path: string, method: string, response: Awaited<ReturnType<typeof request>>, authenticated = true) {
  assertDemoResponse(path, method, response.status, response.body, response.headers, { authenticated })
}

describe('Demo v1 HTTP boundary', () => {
  it('issues only a native credential and uses a persistent global signup bucket', async () => {
    const response = await request('/sessions', { method: 'POST', body: { platform: 'ANDROID', clientBuild: 1 }, authenticated: false })
    conforms('/sessions', 'POST', response, false)
    expect(response.body).toEqual({ sessionRef: session.id, sessionToken: token })
    expect(mocks.consumeDemoLimit).toHaveBeenCalledWith({}, 'session_create:global', 120, 60)
    expect(mocks.authenticateDemoSession).not.toHaveBeenCalled()
  })

  it('rejects WEB issuance without inventing a cookie/CSRF protocol', async () => {
    const response = await request('/sessions', { method: 'POST', headers: { 'X-Demo-Client': 'WEB/1' }, body: { platform: 'WEB', clientBuild: 1 }, authenticated: false })
    conforms('/sessions', 'POST', response, false)
    expect(response.status).toBe(400)
    expect(mocks.createDemoSession).not.toHaveBeenCalled()
  })

  it('returns public Sandbox config and requires matching connection metadata', async () => {
    const response = await request('/connection?platform=ANDROID&clientBuild=1', { authenticated: false })
    conforms('/connection', 'GET', response, false)
    expect(response.body.minimumClientBuild).toBe(0)
    expect(JSON.stringify(response.body)).not.toContain('SECRET')
    expect((await request('/connection?platform=IOS&clientBuild=1', { authenticated: false })).status).toBe(400)
    expect(mocks.authenticateDemoSession).not.toHaveBeenCalled()
  })

  it.each([undefined, 'Basic abc', 'Bearer invalid'])('returns structured 401 without renewal for %s', async (authorization) => {
    const response = await request('/session', { authenticated: false, headers: authorization ? { Authorization: authorization } : {} })
    conforms('/session', 'GET', response, false)
    expect(response.status).toBe(401)
    expect(response.headers['x-demo-session-expires-at']).toBeUndefined()
  })

  it('renews before rejecting platform mismatch or malformed client metadata', async () => {
    for (const header of ['IOS/1', 'bad']) {
      const response = await request('/session', { headers: { 'X-Demo-Client': header } })
      conforms('/session', 'GET', response)
      expect(response.status).toBe(400)
      expect(response.headers['x-demo-session-expires-at']).toBe(session.expiresAt)
    }
  })

  it('keeps expiry only in headers and emits no body for renewal/release', async () => {
    const view = await request('/session')
    conforms('/session', 'GET', view)
    expect(view.body).not.toHaveProperty('expiresAt')
    const renewed = await request('/session/renew', { method: 'POST' })
    conforms('/session/renew', 'POST', renewed)
    expect(renewed.status).toBe(204)
    const released = await request('/payments/pay_example/checkout-sessions/lease_example', { method: 'DELETE' })
    conforms('/payments/{id}/checkout-sessions/{checkoutSessionId}', 'DELETE', released)
    expect(released.body).toBeUndefined()
  })

  it('passes original intent and compatibility to services so replay precedes version rejection', async () => {
    vi.stubEnv('DEMO_MIN_CLIENT_BUILD_ANDROID', '10')
    const response = await request('/payments', { method: 'POST', body: payment.request.body })
    conforms('/payments', 'POST', response)
    expect(mocks.createDemoPayment).toHaveBeenCalledWith(session, payment.request.body, expect.anything(), false)
    expect((await request('/session')).status).toBe(200)
    expect((await request('/session/renew', { method: 'POST' })).status).toBe(204)
  })

  it('normalizes labels before schema length and intent comparison', async () => {
    const response = await request('/customers', { method: 'POST', body: { ...customer.request.body, label: `  ${'测'.repeat(40)}  ` } })
    conforms('/customers', 'POST', response)
    expect(mocks.createDemoCustomer).toHaveBeenCalledWith(session.id, { ...customer.request.body, label: '测'.repeat(40) }, { compatible: true })
  })

  it.each([
    { ...payment.request.body, secret: 'must-not-pass' },
    { ...payment.request.body, amount: { minor: 1.2, currency: 'USD' } },
    { ...payment.request.body, customer: { kind: 'new', label: 'bad\u0000' } },
    { ...payment.request.body, integration: 'direct-api' },
  ])('rejects invalid input before dispatch %#', async (body) => {
    const response = await request('/payments', { method: 'POST', body })
    conforms('/payments', 'POST', response)
    expect(response.status).toBe(400)
    expect(mocks.createDemoPayment).not.toHaveBeenCalled()
  })

  it('rejects malformed, oversized, and wrong-content-type bodies without dispatch', async () => {
    for (const options of [{ raw: '{broken' }, { raw: JSON.stringify({ padding: 'x'.repeat(17000) }) }, { raw: '{}', headers: { 'Content-Type': 'text/plain' } }]) {
      const response = await request('/payments', { method: 'POST', ...options })
      expect(response.status).toBe(400)
      conforms('/payments', 'POST', response)
    }
    expect(mocks.createDemoPayment).not.toHaveBeenCalled()
  })

  it('rejects credential values in custom return URLs regardless of query name or percent encoding', async () => {
    const encoded = [...token].map(character => `%${character.charCodeAt(0).toString(16)}`).join('')
    for (const value of [token, encoded, encoded.replaceAll('%', '%25')]) {
      const response = await request('/payments', {
        method: 'POST',
        body: { ...payment.request.body, returnTarget: { kind: 'custom', url: `https://merchant.example/return?order=${value}` } },
      })
      conforms('/payments', 'POST', response)
      expect(response.status).toBe(400)
      expect(response.body.error.fieldErrors).toEqual([{ field: 'returnTarget.url', code: 'FIELD_INVALID' }])
      expect(JSON.stringify(response.body)).not.toContain(token)
    }
    expect(mocks.createDemoPayment).not.toHaveBeenCalled()
    const safe = await request('/payments', {
      method: 'POST',
      body: { ...payment.request.body, returnTarget: { kind: 'custom', url: 'https://merchant.example/return?order=public-order-reference' } },
    })
    expect(safe.status).toBe(201)
  })

  it('validates pagination query before service and rejects unknown query fields', async () => {
    expect((await request('/customers?limit=51')).status).toBe(400)
    expect((await request('/customers?unknown=yes')).status).toBe(400)
    const response = await request('/customers?limit=2')
    conforms('/customers', 'GET', response)
    expect(mocks.listDemoCustomers).toHaveBeenCalledWith(session.id, { limit: 2 })
  })

  it('preserves structured application error headers and never leaks storage details', async () => {
    mocks.createDemoCustomer.mockRejectedValueOnce(new DemoError(429, 'RATE_LIMITED', { retryAfter: 4, retryable: true, action: 'RETRY_SAME_REQUEST' }))
    const limited = await request('/customers', { method: 'POST', body: customer.request.body })
    conforms('/customers', 'POST', limited)
    expect(limited.headers['retry-after']).toBe('4')
    mocks.createDemoCustomer.mockRejectedValueOnce(new Error('SQL secret token'))
    const failed = await request('/customers', { method: 'POST', body: customer.request.body })
    conforms('/customers', 'POST', failed)
    expect(failed.status).toBe(503)
    expect(failed.body.error.execution).toBe('unknown')
    expect(failed.body.error.action).toBe('RECOVER_OPERATION')
    expect(JSON.stringify(failed.body)).not.toContain('SQL')
  })

  it('returns a structured query failure and does not let async rejections escape the envelope', async () => {
    mocks.getDemoPayment.mockRejectedValueOnce(new Error('private driver data'))
    const response = await request('/payments/pay_example')
    conforms('/payments/{id}', 'GET', response)
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('does not invent an expiry when authentication storage fails', async () => {
    mocks.authenticateDemoSession.mockRejectedValueOnce(new Error('private driver data'))
    const response = await request('/session')
    conforms('/session', 'GET', response, false)
    expect(response.status).toBe(503)
    expect(response.headers['x-demo-session-expires-at']).toBeUndefined()
  })

  it('delegates lease creation and owned release with correct resource identifiers', async () => {
    const response = await request('/payments/pay_example/checkout-session', { method: 'POST', body: lease.request.body })
    conforms('/payments/{id}/checkout-session', 'POST', response)
    expect(mocks.createDemoCheckout).toHaveBeenCalledWith(session, 'pay_example', lease.request.body, expect.anything(), true)
    await request('/payments/pay_example/checkout-sessions/lease_example', { method: 'DELETE' })
    expect(mocks.releaseDemoCheckout).toHaveBeenCalledWith(session.id, 'pay_example', 'lease_example')
  })
})
