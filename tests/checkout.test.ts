import { describe, expect, it } from 'vitest'
import { readCheckoutRedirectUrl, mapCheckoutTransactionStatus, paymentPath } from '../shared/payment/checkout'
import { createAttempt } from '../shared/payment/attempt'
import { createSession } from '../shared/demo/session'
import { getCapability } from '../shared/payment/capability'

describe('Hosted Checkout boundaries', () => {
  it.each(['/checkout', '/aggregate'])('accepts the exact Sandbox origin and %s path', (path) => {
    const url = `https://sandbox-checkout.onerway.com${path}?key=fixture`
    expect(readCheckoutRedirectUrl(url)).toBe(url)
  })

  it.each([
    'javascript:alert(1)',
    'http://sandbox-checkout.onerway.com/checkout',
    'https://sandbox-checkout.onerway.com.attacker.example/checkout',
    'https://attacker.example/checkout',
    'https://sandbox-checkout.onerway.com@attacker.example/checkout',
    'https://user:password@sandbox-checkout.onerway.com/checkout',
    'https://sandbox-checkout.onerway.com:444/checkout',
    'https://sandbox-checkout.onerway.com/unknown',
    'https://sandbox-checkout.onerway.com/checkout#fragment',
    ' https://sandbox-checkout.onerway.com/checkout',
    null,
  ])('rejects unsafe navigation input %s', (value) => {
    expect(readCheckoutRedirectUrl(value)).toBeNull()
  })

  it('does not turn a failed transaction into eligibility for another charge', () => {
    expect(mapCheckoutTransactionStatus('S')).toBe('succeeded')
    expect(mapCheckoutTransactionStatus('N')).toBe('cancelled')
    expect(mapCheckoutTransactionStatus('F')).toBe('processing')
    expect(mapCheckoutTransactionStatus('F', 'O')).toBe('processing')
    expect(() => mapCheckoutTransactionStatus('unexpected')).toThrow()
  })

  it('routes persisted integration and status, without reading browser selections', () => {
    const attempt = createAttempt({ id: 'a', orderId: 'o', integration: 'checkout', method: 'all', createdAt: '2026-09-14T00:00:00.000Z' })
    expect(paymentPath(attempt)).toBe('/halden/hosted/o')
    expect(paymentPath({ ...attempt, status: 'cancelled' })).toBe('/halden/result/o')
  })

  it.each(['hosted-checkout', 'hosted-checkout-three-ds'] as const)('keeps %s conditional and Sandbox-only', (journeyId) => {
    expect(getCapability('ecommerce', 'checkout', 'all').status).toBe('conditional')
    expect(() => createSession(journeyId)).toThrow('SIMULATION_JOURNEY_UNAVAILABLE')
  })
})
