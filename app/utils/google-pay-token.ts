import { readGooglePayToken, googlePayTokenInfo } from '#shared/payment/google-pay'

export function googlePayTokenFormats(value: string) {
  const raw = readGooglePayToken(value)
  let json: string | null = null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) json = JSON.stringify(parsed, null, 2)
  }
  catch { /* Opaque gateway strings are valid and have no JSON object view. */ }
  return { json, stringify: JSON.stringify(raw), apifox: JSON.stringify({ tokenInfo: { provider: 'GooglePay', tokenId: raw } }, null, 2), direct: JSON.stringify({ tokenInfo: googlePayTokenInfo(raw) }, null, 2) }
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
/** Debugging admits encrypted envelopes only; submission still uses the original string. */
export function canDisplayGooglePayToken(raw: string): boolean {
  try { readGooglePayToken(raw) } catch { return false }
  if (/\b(?:pan|cvv|cvc|cardnumber|card_number|paymentMethodData|billingAddress)\b/i.test(raw)) return false
  let token: unknown
  try { token = JSON.parse(raw) }
  catch { return /^[A-Za-z0-9+/_=.:\s-]+$/.test(raw) && !/(?:\d[ -]?){13,19}/.test(raw) }
  if (!record(token) || !['ECv1', 'ECv2'].includes(String(token.protocolVersion)) || typeof token.signature !== 'string' || typeof token.signedMessage !== 'string') return false
  if (Object.keys(token).some(key => !['signature', 'protocolVersion', 'signedMessage', 'intermediateSigningKey'].includes(key))) return false
  try {
    const message: unknown = JSON.parse(token.signedMessage)
    if (!record(message) || !['encryptedMessage', 'ephemeralPublicKey', 'tag'].every(key => typeof message[key] === 'string') || Object.keys(message).some(key => !['encryptedMessage', 'ephemeralPublicKey', 'tag'].includes(key))) return false
    if (token.intermediateSigningKey !== undefined) {
      const key = token.intermediateSigningKey
      if (!record(key) || Object.keys(key).some(name => !['signedKey', 'signatures'].includes(name)) || typeof key.signedKey !== 'string' || !Array.isArray(key.signatures) || !key.signatures.every(value => typeof value === 'string')) return false
      const signed: unknown = JSON.parse(key.signedKey)
      if (!record(signed) || Object.keys(signed).some(name => !['keyValue', 'keyExpiration'].includes(name)) || typeof signed.keyValue !== 'string' || typeof signed.keyExpiration !== 'string') return false
    }
    return true
  }
  catch { return false }
}
