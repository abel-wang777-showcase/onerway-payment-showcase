import { describe, expect, it } from 'vitest'
import { canDisplayGooglePayToken, googlePayTokenFormats } from '../app/utils/google-pay-token'

describe('Google Pay token debugging', () => {
  it.each([' opaque-synthetic-token ', ' { "protocolVersion": "ECv2", "signature": "synthetic", "signedMessage": "{}" } '])('preserves original token bytes across copy formats', (raw) => {
    const formats = googlePayTokenFormats(raw)
    expect(JSON.parse(formats.stringify)).toBe(raw)
    expect(JSON.parse(formats.apifox).tokenInfo.tokenId).toBe(raw)
    expect(JSON.parse(JSON.parse(formats.direct).tokenInfo).tokenId).toBe(raw)
  })
  it('does not manufacture a JSON object from an opaque token', () => {
    expect(googlePayTokenFormats('opaque-synthetic-token').json).toBeNull()
  })
  it('only admits encrypted envelopes or constrained opaque strings for display', () => {
    const token = { protocolVersion: 'ECv2', signature: 'synthetic-signature', signedMessage: JSON.stringify({ encryptedMessage: 'synthetic-ciphertext', ephemeralPublicKey: 'synthetic-key', tag: 'synthetic-tag' }) }
    expect(canDisplayGooglePayToken(JSON.stringify(token))).toBe(true)
    expect(canDisplayGooglePayToken('synthetic-opaque-token')).toBe(true)
    expect(canDisplayGooglePayToken(JSON.stringify({ ...token, cardNumber: 'synthetic-card' }))).toBe(false)
    expect(canDisplayGooglePayToken(JSON.stringify({ ...token, signedMessage: JSON.stringify({ pan: 'synthetic-card' }) }))).toBe(false)
    expect(canDisplayGooglePayToken('4111111111111111')).toBe(false)
    expect(canDisplayGooglePayToken('x'.repeat(65537))).toBe(false)
  })
})
