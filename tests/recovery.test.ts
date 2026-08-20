import { describe, expect, it } from 'vitest'
import {
  createPaymentRecoveryToken,
  PAYMENT_RECOVERY_TTL_MS,
  verifyPaymentRecoveryToken,
} from '../server/utils/recovery'

describe('payment recovery capability', () => {
  const secret = 'server-secret'
  const now = Date.parse('2026-08-04T08:00:00.000Z')

  it('binds one order and attempt for the 30-day retention window', () => {
    const token = createPaymentRecoveryToken(secret, 'HLD-ORDER-1', 'HLD-ORDER-1-attempt-1', now)

    expect(verifyPaymentRecoveryToken(secret, token, 'HLD-ORDER-1', now)).toEqual({
      orderId: 'HLD-ORDER-1',
      attemptId: 'HLD-ORDER-1-attempt-1',
      expiresAt: now + PAYMENT_RECOVERY_TTL_MS,
    })
    expect(verifyPaymentRecoveryToken(secret, token, 'HLD-ORDER-2', now)).toBeNull()
  })

  it('rejects tampered, expired and implausibly future tokens', () => {
    const token = createPaymentRecoveryToken(secret, 'HLD-ORDER-1', 'HLD-ORDER-1-attempt-1', now)

    expect(verifyPaymentRecoveryToken(secret, `${token}x`, undefined, now)).toBeNull()
    expect(verifyPaymentRecoveryToken(secret, token, undefined, now + PAYMENT_RECOVERY_TTL_MS)).toBeNull()
    expect(verifyPaymentRecoveryToken(secret, token, undefined, now - 60_000)).toBeNull()
  })
})
