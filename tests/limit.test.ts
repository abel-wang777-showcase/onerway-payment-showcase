import type { H3Event } from 'h3'
import { describe, expect, it } from 'vitest'
import {
  PaymentLimiter,
  requireCanonicalPaymentOrigin,
  requireIp,
  requireSameOriginBrowser,
  resolveClientIp,
  resolveRequestIp,
  withPaymentLimit,
} from '../server/utils/limit'

function event(headers: Record<string, string> = {}): H3Event {
  return {
    context: {
      clientAddress: '203.0.113.10',
    },
    path: '/api/payment/create',
    node: {
      req: {
        connection: { encrypted: true },
        headers: {
          host: 'showcase.example',
          ...headers,
        },
      },
    },
  } as unknown as H3Event
}

const testPolicies = {
  create: { max: 2, windowMs: 60_000, concurrent: 1 },
  query: { max: 3, windowMs: 60_000, concurrent: 2 },
  retry: { max: 1, windowMs: 60_000, concurrent: 1 },
  submit: { max: 2, windowMs: 60_000, concurrent: 1 },
} as const

describe('payment application safety valve', () => {
  it('limits rate and concurrency across create/query operations', () => {
    const limiter = new PaymentLimiter({
      policies: testPolicies,
      globalConcurrent: 2,
      clientConcurrent: 2,
    })
    const first = limiter.acquire('create', '203.0.113.10', 0)
    const duplicate = limiter.acquire('create', '203.0.113.10', 0)
    const query = limiter.acquire('query', '203.0.113.10', 0)
    const global = limiter.acquire('create', '198.51.100.8', 0)

    expect(first.allowed).toBe(true)
    expect(duplicate.allowed).toBe(false)
    expect(query.allowed).toBe(true)
    expect(global.allowed).toBe(false)

    if (first.allowed) {
      first.release()
      first.release()
    }
    if (query.allowed) {
      query.release()
    }

    const second = limiter.acquire('create', '203.0.113.10', 1)
    expect(second.allowed).toBe(true)
    if (second.allowed) {
      second.release()
    }
    expect(limiter.acquire('create', '203.0.113.10', 2).allowed).toBe(false)
    expect(limiter.acquire('create', '203.0.113.10', 60_000).allowed).toBe(true)
  })

  it('uses runtime clientAddress and ignores spoofed forwarding headers outside Vercel', async () => {
    const clientIp = await withPaymentLimit(
      event({
        'x-forwarded-for': '198.51.100.99',
        'x-vercel-forwarded-for': '198.51.100.100',
      }),
      'query',
      async ip => ip,
    )

    expect(clientIp).toBe('203.0.113.10')
  })

  it('trusts only Vercel-overwritten client IP in an explicit Vercel runtime', () => {
    const request = event({ 'x-vercel-forwarded-for': '198.51.100.99' })

    expect(resolveRequestIp(request, { vercel: true, development: false })).toBe('198.51.100.99')
    expect(resolveRequestIp(request, { vercel: false, development: false })).toBe('203.0.113.10')
    expect(() => resolveRequestIp(
      event({ 'x-vercel-forwarded-for': '198.51.100.99, 203.0.113.10' }),
      { vercel: true, development: false },
    )).toThrow('PAYMENT_IP_INVALID')
  })

  it('validates the final IP and rejects cross-origin browser requests', () => {
    expect(requireIp(' 2001:db8::1 ')).toBe('2001:db8::1')
    expect(() => requireIp('203.0.113.10, 198.51.100.1')).toThrow('PAYMENT_IP_INVALID')
    expect(resolveClientIp(undefined, true)).toBe('127.0.0.1')
    expect(() => resolveClientIp(undefined)).toThrow('PAYMENT_IP_UNAVAILABLE')
    expect(() => requireSameOriginBrowser(event({
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
    }))).toThrow('PAYMENT_ORIGIN_FORBIDDEN')
    expect(() => requireSameOriginBrowser(event({
      origin: 'https://showcase.example',
      'sec-fetch-site': 'same-origin',
    }))).not.toThrow()
  })

  it('allows payment mutation only on the canonical Showcase origin', () => {
    const preview = event({
      host: 'preview.example',
      origin: 'https://preview.example',
      'sec-fetch-site': 'same-origin',
    })
    const canonical = event({
      origin: 'https://showcase.example',
      'sec-fetch-site': 'same-origin',
    })

    expect(() => requireCanonicalPaymentOrigin(preview, 'https://showcase.example'))
      .toThrow('PAYMENT_CANONICAL_ORIGIN_REQUIRED')
    expect(() => requireCanonicalPaymentOrigin(canonical, 'https://showcase.example'))
      .not.toThrow()
  })
})
