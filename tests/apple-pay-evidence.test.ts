import { describe, expect, it } from 'vitest'
import { authorizationEvidence, maskPaymentReference, preparationEvidence, resultEvidence, validationEvidence } from '../app/utils/apple-pay-evidence'

describe('Apple Pay demonstration safe projections', () => {
  it('keeps long references recognizable without exposing short references', () => {
    expect(maskPaymentReference('merchant-123456789')).toBe('merc…6789')
    expect(maskPaymentReference('12345678')).toBe('••••')
  })
  it('projects real session times and public fields without retaining session credentials', () => {
    const result = validationEvidence('https://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession', 'merchant.example', 'shop.example', {
      epochTimestamp: 1790168840000, expiresAt: 1790169140000, domainName: 'shop.example', displayName: 'Halden',
      signature: 'SECRET_SIGNATURE_MARKER', nonce: 'SECRET_NONCE_MARKER', merchantSessionIdentifier: 'SECRET_SESSION_MARKER', merchantIdentifier: 'SECRET_OPAQUE_ID_MARKER', unknown: 'SECRET_EXTRA_MARKER',
    })
    const text = JSON.stringify(result)
    expect(text).not.toContain('SECRET_')
    expect(text).toContain('merchant.example')
    expect(JSON.parse(result.response!).expiresAt).toBe(1790169140000)
  })
  it('never displays an unapproved event address, even when it contains secrets', () => {
    const result = validationEvidence('https://evil.example/SECRET_VALUE?token=SECRET', 'merchant.example', 'shop.example')
    expect(JSON.stringify(result)).not.toMatch(/SECRET|evil/)
  })
  it('preserves recognized wallet facts while omitting all token and card-label content', () => {
    const result = authorizationEvidence({ paymentMethod: { network: 'MasterCard', type: 'credit', displayName: 'SECRET_CARD_LABEL' }, transactionIdentifier: 'SECRET_TRANSACTION', paymentData: { version: 'EC_v1', data: 'SECRET_ENCRYPTED', signature: 'SECRET_SIGNATURE', header: { ephemeralPublicKey: 'SECRET_KEY' } } })
    const text = JSON.stringify(result)
    expect(text).not.toContain('SECRET_')
    expect(text).toContain('MasterCard')
    expect(text).toContain('credit')
    expect(text).toContain('EC_v1')
    expect(result.fields[0]?.networks).toEqual([{ value: 'MasterCard', icon: 'i-simple-icons-mastercard' }])
  })
  it('does not project unexpected metadata supplied in a wallet callback', () => {
    const result = authorizationEvidence({ paymentMethod: { network: 'SECRET_VALUE', type: 'SECRET_VALUE' }, paymentData: { version: 'SECRET_VALUE' } })
    expect(JSON.stringify(result)).not.toContain('SECRET_VALUE')
    expect(result.fields[0]?.networks).toEqual([{ value: 'Not returned', icon: 'i-lucide-credit-card' }])
  })
  it('maps only bundled card brands while preserving the exact reported network text', () => {
    const prepared = preparationEvidence({
      order: {} as never, attempt: {} as never, events: [], merchantIdentifier: 'merchant.example', canAuthorize: true,
      paymentRequest: { countryCode: 'US', currencyCode: 'USD', supportedNetworks: ['visa', 'MASTERCARD', 'UnionPay'], merchantCapabilities: ['supports3DS'], total: { label: 'Halden', amount: '5.00' } },
    })
    expect(prepared.fields[2]?.networks).toEqual([
      { value: 'visa', icon: 'i-simple-icons-visa' },
      { value: 'MASTERCARD', icon: 'i-simple-icons-mastercard' },
      { value: 'UnionPay', icon: 'i-lucide-credit-card' },
    ])
  })
  it('adds an icon only for the verified funding network in result evidence', () => {
    const result = resultEvidence({
      order: { id: 'order-1', amount: { currency: 'USD', minor: 500 } },
      attempt: { merchantTxnId: 'merchant-1', integration: 'direct-api', status: 'succeeded', statusSource: 'query', updatedAt: '2026-09-23T08:00:00.000Z', actualWallet: 'apple-pay', fundingNetwork: 'VISA' },
      events: [],
    } as never, 'stored')
    expect(result.fields[2]).toMatchObject({ value: 'apple-pay / VISA', networks: [{ value: 'VISA', icon: 'i-simple-icons-visa' }] })
  })
})
