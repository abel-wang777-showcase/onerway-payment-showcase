import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../relay/pages/_worker.js'

const relayUrl = 'https://onerway-showcase-relay.pages.dev/onerway/payment'

function request(path = '/onerway/payment', init = {}) {
  return new Request(`https://onerway-showcase-relay.pages.dev${path}`, init)
}

describe('Pages Webhook Relay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    request('/onerway/payment', { method: 'GET' }),
    request('/onerway/payment/', { method: 'POST' }),
    request('/onerway/payment?forward=true', { method: 'POST' }),
    request('/other', { method: 'POST' }),
  ])('exposes only the exact POST route', async (incoming) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const response = await worker.fetch(incoming)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires a JSON content type without reading the body', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const response = await worker.fetch(request('/onerway/payment', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'synthetic',
    }))

    expect(response.status).toBe(415)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { headers: { 'content-length': String(64 * 1024 + 1) }, body: '{}' },
    { headers: {}, body: 'x'.repeat(64 * 1024 + 1) },
  ])('rejects an oversized body before forwarding', async ({ headers, body }) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    const response = await worker.fetch(request('/onerway/payment', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body,
    }))

    expect(response.status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('forwards exact bytes and returns the upstream status and ACK', async () => {
    const raw = '{"event":"synthetic","value":"001"}'
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://onerway-payment-showcase.vercel.app/api/webhooks/onerway/payment')
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({ 'content-type': 'application/json; charset=utf-8' })
      expect(new TextDecoder().decode(init.body as Uint8Array)).toBe(raw)
      expect(init.redirect).toBe('manual')

      return new Response('synthetic-ack', {
        status: 202,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'x-upstream-private': 'drop-me',
        },
      })
    })
    vi.stubGlobal('fetch', fetch)

    const response = await worker.fetch(new Request(relayUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: raw,
    }))

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('synthetic-ack')
    expect(response.headers.get('x-upstream-private')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('fails closed when the canonical upstream cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('synthetic network failure')))

    const response = await worker.fetch(request('/onerway/payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))

    expect(response.status).toBe(502)
    expect(await response.text()).toBe('Bad Gateway')
  })
})
