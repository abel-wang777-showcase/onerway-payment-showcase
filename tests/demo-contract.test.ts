import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fixtures from '../docs/api/demo-v1.examples.json'
import { assertDemoRequest, assertDemoResponse, assertDemoSchema } from './demo-schema'

interface Example {
  name: string
  path: string
  method: string
  request: { body?: unknown, parameters?: Record<string, unknown>, headers?: Record<string, unknown>, schema?: string }
  response: { status: number, body?: unknown, headers: Record<string, unknown>, schema?: string }
}
const examples = fixtures.examples as Example[]

describe('Demo v1 shared contract', () => {
  it.each(examples)('$name conforms to the operation, schema and response headers', (example) => {
    assertDemoRequest(example.path, example.method, example.request)
    const { response } = example
    assertDemoResponse(example.path, example.method, response.status, response.body, response.headers)
    if (example.request.schema) assertDemoSchema(example.request.schema, example.request.body)
    if (response.schema) assertDemoSchema(response.schema, response.body)
  })

  it('keeps example names unambiguous', () => {
    expect(new Set(examples.map(example => example.name)).size).toBe(examples.length)
  })

  it('matches the handoff SHA-256 snapshots', () => {
    const plan = readFileSync(new URL('../docs/demo-expansion-discussion.md', import.meta.url), 'utf8')
    for (const path of ['docs/showcase-contract.md', 'docs/api/demo-v1.openapi.json', 'docs/api/demo-v1.examples.json']) {
      const hash = createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')
      expect(plan).toContain(`| \`${path}\` | \`${hash}\` |`)
    }
  })

  it('rejects malformed server output and mismatched response headers', () => {
    const ready = examples.find(example => example.name === 'payment-ready')!
    expect(() => assertDemoSchema('PaymentView', { ...ready.response.body as object, revision: 0 })).toThrow()
    expect(() => assertDemoSchema('PaymentView', { ...ready.response.body as object, secret: 'must-not-be-exposed' })).toThrow()
    expect(() => assertDemoResponse(ready.path, ready.method, 418, ready.response.body, ready.response.headers)).toThrow()
    expect(() => assertDemoResponse(ready.path, ready.method, 201, ready.response.body, { 'Cache-Control': 'no-store' })).toThrow()
    const limited = examples.find(example => example.name === 'application-rate-limit')!
    expect(() => assertDemoResponse(limited.path, limited.method, 429, limited.response.body, { ...limited.response.headers, 'Retry-After': 999 })).toThrow()
  })

  it.each(['checkout-window-expired', 'checkout-window-expired-replay'])('%s preserves query access without SDK launch data', (name) => {
    const example = examples.find(item => item.name === name)!
    const body = example.response.body as { error: { code: string, currentView: { attention: unknown, allowedActions: unknown[] } } }
    expect(example.response.status).toBe(409)
    expect(body.error.code).toBe('PAYMENT_EXPIRED')
    expect(body.error.currentView.attention).toBeNull()
    expect(body.error.currentView.allowedActions).toContainEqual({ type: 'QUERY', enabled: true, reasonCode: null })
    expect(body.error.currentView.allowedActions).toContainEqual({ type: 'CONTINUE_SDK', enabled: false, reasonCode: 'PAYMENT_EXPIRED' })
    expect(body).not.toHaveProperty('sdk')
  })
})
