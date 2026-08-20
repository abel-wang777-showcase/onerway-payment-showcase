import { describe, expect, it } from 'vitest'
import { verifyBearerToken } from '../server/utils/access'

describe('internal payment route access', () => {
  const token = 'a'.repeat(32)

  it('uses an exact bearer token and fails closed when configuration is absent', () => {
    expect(verifyBearerToken(`Bearer ${token}`, token)).toBe(true)
    expect(verifyBearerToken(`Bearer ${token}x`, token)).toBe(false)
    expect(verifyBearerToken(token, token)).toBe(false)
    expect(verifyBearerToken(`Bearer ${token}`, undefined)).toBe(false)
    expect(verifyBearerToken('Bearer short', 'short')).toBe(false)
  })
})
