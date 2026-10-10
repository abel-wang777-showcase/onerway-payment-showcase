import { describe, expect, it } from 'vitest'
import type { DirectRecoveryResponse } from '../shared/payment/apple-pay'
import type { PrepareGooglePayResponse } from '../shared/payment/google-pay'
import { googleAuthorizationEvidence, googlePreparationEvidence, googleReadinessEvidence, googleResultEvidence, googleSubmissionEvidence } from '../app/utils/google-pay-evidence'
import { googlePayFlowActors, googlePayFlows, googlePaySteps } from '../app/utils/google-pay-flow'

const recovery = {
  order: { id: 'order-reference-private-middle-1234' },
  attempt: { id: 'attempt-reference', merchantTxnId: 'merchant-private-middle-1234', transactionId: 'txn-private-middle-5678', status: 'succeeded', statusSource: 'query', actualWallet: 'google-pay', fundingNetwork: 'VISA', updatedAt: '2026-10-09T00:00:00.000Z' },
  paymentId: 'payment-private-middle-9012',
  events: [{ source: 'query', status: 'succeeded', rawStatus: 'S', occurredAt: '2026-10-09T00:00:00.000Z', raw: 'SECRET_EVENT' }],
} as unknown as DirectRecoveryResponse

describe('Google Pay explanation and safe evidence', () => {
  it('shows observed preparation and readiness separately from processor acceptance', () => {
    const prepared = { ...recovery, canAuthorize: true, config: { environment: 'TEST', gateway: 'synthetic', gatewayMerchantId: 'gateway-private-middle-1234', allowedCardNetworks: ['VISA', 'MASTERCARD'], allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], countryCode: 'US', currencyCode: 'USD', totalPrice: '5.00', secret: 'SECRET_CONFIG' } } as PrepareGooglePayResponse
    const evidence = googlePreparationEvidence(prepared)
    expect(JSON.parse(evidence.response!)).toMatchObject({ environment: 'TEST', gateway: 'synthetic', allowedCardNetworks: ['VISA', 'MASTERCARD'], allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], canAuthorize: true })
    expect(JSON.stringify(evidence)).not.toMatch(/private-middle|SECRET_CONFIG/)
    expect(JSON.parse(googleReadinessEvidence(false).response!)).toEqual({ result: false })
  })
  it.each(['SECRET_OPAQUE_TOKEN', '{"signedMessage":"SECRET_CIPHERTEXT","signature":"SECRET_SIGNATURE"}', '["SECRET_ARRAY"]'])('stores metadata without retaining any token content', token => {
    const evidence = googleAuthorizationEvidence(token, true)
    expect(JSON.stringify(evidence)).not.toContain('SECRET_')
    expect(JSON.parse(evidence.response!)).toMatchObject({ tokenReceived: true, byteLength: new TextEncoder().encode(token).length })
    expect(JSON.stringify(evidence)).not.toContain('paymentMethodData')
  })
  it('only projects the actual safe server request and drops added fields', () => {
    const raw = JSON.stringify({ method: 'POST', path: '/v1/txn/doTransaction', body: { orderAmount: '5.00', orderCurrency: 'USD', productType: 'CARD', subProductType: 'DIRECT', txnType: 'SALE', tokenInfo: 'SECRET_TOKEN', sign: 'SECRET_SIGNATURE', actionURL: 'https://secret.example/SECRET_URL' } })
    const evidence = googleSubmissionEvidence(recovery, raw)
    expect(evidence.request).toContain('/v1/txn/doTransaction')
    expect(JSON.stringify(evidence)).not.toMatch(/SECRET_|secret.example|private-middle/)
    expect(googleSubmissionEvidence(recovery, 'SECRET_NON_JSON').request).toBeUndefined()
  })
  it('restores only whitelisted server facts without reconstructing browser authorization', () => {
    const evidence = googleResultEvidence(recovery, 'stored')
    expect(evidence.source).toBe('stored')
    expect(evidence.occurredAt).toBe(recovery.attempt.updatedAt)
    expect(JSON.parse(evidence.response!)).toMatchObject({ status: 'succeeded', source: 'query', observations: [{ source: 'query', status: 'succeeded', rawStatus: 'S' }] })
    expect(JSON.stringify(evidence)).not.toMatch(/SECRET_|private-middle/)
    expect(evidence).not.toHaveProperty('token')
  })
  it('uses five Google actors, independent result paths and no Apple handshake', () => {
    expect(googlePayFlowActors.map(actor => actor.id)).toEqual(['customer', 'browser', 'google', 'server', 'onerway'])
    const flows = googlePayFlows('automatic')
    expect(flows.find(flow => flow.id === 'result')?.edges.map(edge => edge.label)).toEqual(expect.arrayContaining(['Synchronous response', 'Query original transaction', 'Verified Webhook']))
    expect(JSON.stringify(flows)).not.toMatch(/completePayment|merchantSession|onvalidatemerchant/)
    expect(googlePayFlows('manual').filter(flow => ['submit', 'result'].includes(flow.id)).every(flow => flow.edges.length === 0)).toBe(true)
    expect(googlePaySteps('manual').find(step => step.id === 'authorize')?.output).toContain('No claim, submission or result polling')
  })
})
