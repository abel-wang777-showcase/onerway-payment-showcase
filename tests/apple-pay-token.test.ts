import { describe, expect, it } from 'vitest'
import { applePayTokenFormats, canDisplayApplePayToken } from '../app/utils/apple-pay-token'

const token = {
  paymentData: { version: 'EC_v1', data: 'synthetic-encrypted-data', signature: 'synthetic-signature', header: { ephemeralPublicKey: 'synthetic-key', publicKeyHash: 'synthetic-hash', transactionId: 'synthetic-transaction' } },
  paymentMethod: { displayName: 'Visa 1234', network: 'Visa', type: 'credit' },
  transactionIdentifier: 'synthetic-wallet-id',
}

describe('Apple Pay token debugging', () => {
  it('round trips each format to the exact submitted token with one encoding per layer', () => {
    const serialized = JSON.stringify(token)
    const formats = applePayTokenFormats(serialized)
    expect(canDisplayApplePayToken(token, serialized)).toBe(true)
    expect(JSON.parse(formats.json)).toEqual(token)
    expect(JSON.parse(formats.stringify)).toBe(serialized)
    const apifox = JSON.parse(formats.apifox)
    expect(apifox.tokenInfo).toEqual({ provider: 'ApplePay', tokenId: serialized })
    const request = JSON.parse(formats.direct)
    const tokenInfo = JSON.parse(request.tokenInfo)
    expect(tokenInfo.provider).toBe('ApplePay')
    expect(tokenInfo.tokenId).toBe(serialized)
    expect(JSON.parse(tokenInfo.tokenId)).toEqual(token)
    expect(JSON.stringify(apifox.tokenInfo)).toBe(request.tokenInfo)
  })

  it('pastes stringify directly into a JSON string field without manual escaping or changing token bytes', () => {
    const value = { ...token, paymentData: { ...token.paymentData, data: 'synthetic "quote" / slash \\ and newline\n中文' } }
    const serialized = JSON.stringify(value)
    const formats = applePayTokenFormats(serialized)
    const body = JSON.parse(`{"tokenInfo":{"provider":"ApplePay","tokenId":${formats.stringify}}}`)
    expect(body.tokenInfo.tokenId).toBe(serialized)
    expect(JSON.parse(body.tokenInfo.tokenId)).toEqual(value)
    expect(JSON.stringify(body.tokenInfo)).toBe(JSON.parse(formats.direct).tokenInfo)
  })

  it.each([
    { ...token, billingContact: { email: 'synthetic-contact' } },
    { ...token, paymentMethod: { ...token.paymentMethod, pan: 'synthetic-pan' } },
    { ...token, paymentData: { ...token.paymentData, header: { cvv: 'synthetic-cvv' } } },
    { ...token, paymentData: { ...token.paymentData, data: { unexpected: 'synthetic-data' } } },
  ])('refuses to display unexpected fields without modifying the payment token', (value) => {
    const serialized = JSON.stringify(value)
    expect(canDisplayApplePayToken(value, serialized)).toBe(false)
    expect(JSON.stringify(value)).toBe(serialized)
  })

  it('applies the same UTF-8 byte limit as the server', () => {
    const value = { ...token, paymentData: { ...token.paymentData, data: 'é'.repeat(32_768) } }
    expect(canDisplayApplePayToken(value, JSON.stringify(value))).toBe(false)
  })
})
