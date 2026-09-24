import { describe, expect, it } from 'vitest'
import { applePayExamples } from '../app/utils/apple-pay-evidence'
import { applePayFlowActors, applePayFlows } from '../app/utils/apple-pay-flow'

describe('Apple Pay five-party flow', () => {
  it('defines the five parties and identifies the merchant-owned surfaces', () => {
    expect(applePayFlowActors.map(actor => actor.id)).toEqual(['customer', 'client', 'server', 'apple', 'onerway'])
    expect(applePayFlowActors.filter(actor => actor.merchant).map(actor => actor.id)).toEqual(['client', 'server'])
  })

  it('keeps six main stages plus a separate teaching cancel branch', () => {
    expect(applePayFlows.map(flow => flow.id)).toEqual(['prepare', 'begin', 'validate', 'authorize', 'submit', 'result', 'cancel'])
    const cancel = applePayFlows.at(-1)!
    expect(cancel.note).toMatch(/Teaching branch only/)
    expect(cancel.server).toMatch(/Do not invent/)
  })

  it('shows merchant validation as the complete Apple callback round trip', () => {
    const validate = applePayFlows.find(flow => flow.id === 'validate')!
    expect(validate.edges.map(edge => [edge.from, edge.to, edge.label])).toEqual([
      ['apple', 'client', 'onvalidatemerchant'],
      ['client', 'server', 'validationURL'],
      ['server', 'apple', 'mTLS startSession'],
      ['apple', 'server', 'merchantSession'],
      ['server', 'client', 'merchantSession'],
      ['client', 'apple', 'completeMerchantValidation'],
    ])
    expect(validate.note).toMatch(/complete merchantSession passes back to Apple ephemerally/)
  })

  it('shows authorization and tokenInfo submission without exposing token values', () => {
    const authorize = applePayFlows.find(flow => flow.id === 'authorize')!
    const submit = applePayFlows.find(flow => flow.id === 'submit')!
    expect(authorize.edges).toContainEqual({ from: 'apple', to: 'client', label: 'onpaymentauthorized', detail: 'event.payment.token' })
    expect(submit.edges).toContainEqual({ from: 'server', to: 'onerway', label: '/v1/txn/doTransaction', detail: 'tokenInfo provider + tokenId' })
    expect(submit.serverCode).toMatch(/provider: 'ApplePay'[\s\S]*tokenId: JSON\.stringify\(paymentToken\)/)
  })

  it('keeps payment observations independent from Apple sheet completion', () => {
    const result = applePayFlows.find(flow => flow.id === 'result')!
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'onerway', to: 'server', label: 'Synchronous response' }),
      expect.objectContaining({ from: 'onerway', to: 'server', label: 'Matched query result' }),
      expect.objectContaining({ from: 'onerway', to: 'server', label: 'Verified webhook' }),
      expect.objectContaining({ from: 'client', to: 'apple', label: 'completePayment' }),
    ]))
    expect(result.note).toMatch(/independent paths with no assumed delivery order/)
    expect(result.note).toMatch(/does not replace the saved order result/)
    expect(result.client).toMatch(/25-second budget while the order stays pending/)
  })

  it('uses structural placeholders for synthetic sessions and EC_v1 tokens', () => {
    const session = JSON.parse(applePayExamples.validate!.response!)
    const token = JSON.parse(applePayExamples.authorize!.response!)
    const submission = JSON.parse(applePayExamples.submit!.request!)
    const tokenInfo = JSON.parse(submission.tokenInfo)
    const submittedToken = JSON.parse(tokenInfo.tokenId)
    expect(session).toMatchObject({
      epochTimestamp: '[epoch milliseconds]',
      merchantSessionIdentifier: '[session identifier omitted]',
      signature: '[signature omitted]',
    })
    expect(token.paymentData).toMatchObject({
      version: 'EC_v1',
      data: '[encrypted payment data omitted]',
      header: {
        ephemeralPublicKey: '[ephemeral public key omitted]',
        publicKeyHash: '[public key hash omitted]',
        transactionId: '[cryptographic transaction id omitted]',
      },
    })
    expect(tokenInfo.provider).toBe('ApplePay')
    expect(submittedToken.paymentData).toEqual(token.paymentData)
    expect(JSON.stringify({ session, token, submission })).not.toMatch(/BEGIN (?:CERTIFICATE|PRIVATE KEY)|eyJ[A-Za-z0-9_-]+\.|merchant\.com\.onerway/)
  })
})
