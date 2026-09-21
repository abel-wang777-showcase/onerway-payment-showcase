import { describe, expect, it } from 'vitest'
import {
  canClaimAuthorizationOperation,
  claimAuthorizationOperation,
  createAuthorizationState,
  mapAuthorizationStatus,
  mergeAuthorization,
  type AuthorizationFact,
  type AuthorizationState,
} from '../shared/payment/authorization'

const createdAt = '2026-09-18T08:00:00.000Z'
const occurredAt = '2026-09-18T08:01:00.000Z'

function state(overrides: Partial<AuthorizationState> = {}): AuthorizationState {
  return Object.freeze({
    paymentId: '2000000000000000001',
    authTransactionId: '2000000000000000002',
    authMerchantTxnId: 'showcase-auth-1',
    amountMinor: 500,
    currency: 'USD',
    fundsStatus: 'pending',
    updatedAt: createdAt,
    ...overrides,
  })
}

function fact(overrides: Partial<AuthorizationFact> = {}): AuthorizationFact {
  return Object.freeze({
    source: 'webhook',
    txnType: 'AUTH',
    transactionId: '2000000000000000002',
    paymentId: '2000000000000000001',
    merchantTxnId: 'showcase-auth-1',
    amountMinor: 500,
    currency: 'USD',
    transactionStatus: 'S',
    paymentStatus: 'A',
    occurredAt,
    ...overrides,
  })
}

function claimed(type: 'CAPTURE' | 'VOID' = 'CAPTURE'): AuthorizationState {
  return claimAuthorizationOperation(state({ fundsStatus: 'authorized' }), {
    type,
    merchantTxnId: 'showcase-operation-1',
    occurredAt,
  })
}

function operationFact(type: 'CAPTURE' | 'VOID' = 'CAPTURE'): AuthorizationFact {
  return fact({
    txnType: type,
    transactionId: '2000000000000000003',
    paymentStatus: type === 'CAPTURE' ? 'S' : 'N',
  })
}

describe('authorization funds projection', () => {
  it.each([
    ['AUTH', 'S', 'A', 'authorized', 'processing'],
    ['AUTH', 'F', 'O', 'pending', 'processing'],
    ['CAPTURE', 'S', 'S', 'captured', 'succeeded'],
    ['VOID', 'S', 'N', 'voided', 'cancelled'],
  ])('maps only confirmed %s %s/%s evidence', (txnType, transactionStatus, paymentStatus, fundsStatus, status) => {
    expect(mapAuthorizationStatus(txnType, transactionStatus, paymentStatus)).toEqual({ fundsStatus, status })
  })

  it('rejects every unconfirmed status combination, including AUTH N and operation F/A', () => {
    const accepted = new Set(['AUTH:S:A', 'AUTH:F:O', 'CAPTURE:S:S', 'VOID:S:N'])

    for (const txnType of ['AUTH', 'CAPTURE', 'VOID']) {
      for (const transactionStatus of ['S', 'F', 'N']) {
        for (const paymentStatus of ['A', 'S', 'O', 'N']) {
          if (!accepted.has(`${txnType}:${transactionStatus}:${paymentStatus}`)) {
            expect(() => mapAuthorizationStatus(txnType, transactionStatus, paymentStatus))
              .toThrow('AUTHORIZATION_STATUS_UNKNOWN')
          }
        }
      }
    }

    expect(() => mapAuthorizationStatus('SALE', 'S', 'S')).toThrow('AUTHORIZATION_STATUS_UNKNOWN')
    expect(() => mapAuthorizationStatus('AUTH', 'S', '')).toThrow('AUTHORIZATION_STATUS_UNKNOWN')
  })

  it('records an authorization as frozen funds without collecting payment', () => {
    const original = state()
    const result = mergeAuthorization(original, fact())

    expect(result).toMatchObject({ accepted: true, conflict: false, authorization: { fundsStatus: 'authorized' } })
    expect(mapAuthorizationStatus('AUTH', 'S', 'A').status).not.toBe('succeeded')
    expect(original.fundsStatus).toBe('pending')
    expect(Object.isFrozen(result.authorization)).toBe(true)
  })

  it('binds only the first successful AUTH transaction, not a failed attempt', () => {
    const pending = createAuthorizationState({ merchantTxnId: 'showcase-auth-1', amountMinor: 500, currency: 'USD', occurredAt })
    const failed = mergeAuthorization(pending, fact({ transactionStatus: 'F', paymentStatus: 'O' })).authorization
    expect(failed.paymentId).toBe('2000000000000000001')
    expect(failed.authTransactionId).toBeUndefined()
    const authorized = mergeAuthorization(failed, fact({ transactionId: '2000000000000000008' })).authorization
    expect(authorized.authTransactionId).toBe('2000000000000000008')
    const conflict = mergeAuthorization(authorized, fact())
    expect(conflict.conflict).toBe(true)
    expect(conflict.authorization).toMatchObject({ authTransactionId: '2000000000000000008', conflict: true })
    expect(canClaimAuthorizationOperation(conflict.authorization)).toBe(false)
  })

  it('keeps initial transaction failure open and prevents a late failure from unfreezing funds', () => {
    const failedAttempt = fact({ transactionStatus: 'F', paymentStatus: 'O' })
    expect(mergeAuthorization(state(), failedAttempt).authorization.fundsStatus).toBe('pending')

    const authorized = state({ fundsStatus: 'authorized' })
    expect(mergeAuthorization(authorized, failedAttempt)).toEqual({
      authorization: authorized,
      accepted: true,
      conflict: false,
    })
  })

  it.each(['server', 'client', 'return', 'simulation'])('rejects %s as a funds authority', (source) => {
    const original = state()
    const result = mergeAuthorization(original, { ...fact(), source } as AuthorizationFact)
    expect(result).toEqual({ authorization: original, accepted: false, conflict: false })
  })
})

describe('authorization query reconciliation', () => {
  it('accepts a verified AUTH query as frozen funds and establishes its successful anchor', () => {
    const pending = createAuthorizationState({ merchantTxnId: 'showcase-auth-1', amountMinor: 500, currency: 'USD', occurredAt: createdAt })
    const result = mergeAuthorization(pending, fact({ source: 'query' }))
    expect(result.authorization).toMatchObject({ fundsStatus: 'authorized', authTransactionId: fact().transactionId })
    expect(canClaimAuthorizationOperation(result.authorization)).toBe(true)
    expect(mapAuthorizationStatus('AUTH', 'S', 'A').status).toBe('processing')
  })

  it.each(['CAPTURE', 'VOID'] as const)('confirms the exact unknown %s operation while preserving the AUTH anchor', (type) => {
    const original = claimed(type)
    const unknown = { ...original, operation: { ...original.operation!, status: 'unknown' as const } }
    const queried = { ...operationFact(type), source: 'query' as const, merchantTxnId: 'showcase-operation-1' }
    const result = mergeAuthorization(unknown, queried)
    expect(result.authorization).toMatchObject({
      authTransactionId: original.authTransactionId,
      fundsStatus: type === 'CAPTURE' ? 'captured' : 'voided',
      operation: { merchantTxnId: 'showcase-operation-1', transactionId: queried.transactionId, status: 'confirmed' },
    })
    expect(canClaimAuthorizationOperation(result.authorization)).toBe(false)
    expect(mergeAuthorization(result.authorization, fact({ source: 'query' })).authorization).toBe(result.authorization)
  })

  it('requires the operation merchant id for query even when the same id is allowed on a signed webhook', () => {
    const original = claimed()
    expect(mergeAuthorization(original, { ...operationFact(), source: 'query' }).accepted).toBe(false)
    expect(mergeAuthorization(original, operationFact()).accepted).toBe(true)
  })

  it('never clears an existing claim when a delayed AUTH query completes', () => {
    const original = claimed()
    const result = mergeAuthorization(original, fact({ source: 'query' }))
    expect(result.authorization).toBe(original)
    expect(canClaimAuthorizationOperation(result.authorization)).toBe(false)
  })

  it('rejects transaction failure as an authoritative query fact', () => {
    const original = claimed()
    expect(mergeAuthorization(original, fact({ source: 'query', transactionStatus: 'F', paymentStatus: 'O' })))
      .toEqual({ authorization: original, accepted: false, conflict: false })
  })

  it('keeps conflicting query evidence locked without replacing the successful anchor or final funds', () => {
    const original = state({ fundsStatus: 'authorized' })
    const conflict = mergeAuthorization(original, fact({ source: 'query', transactionId: '2000000000000000008' }))
    expect(conflict.authorization).toMatchObject({ authTransactionId: original.authTransactionId, conflict: true })
    const completed = mergeAuthorization(claimed(), operationFact()).authorization
    const finalConflict = mergeAuthorization(completed, {
      ...operationFact('VOID'), source: 'query', merchantTxnId: 'showcase-operation-1',
    })
    expect(finalConflict.authorization).toMatchObject({ fundsStatus: 'captured', conflict: true, operation: { type: 'CAPTURE' } })
    expect(canClaimAuthorizationOperation(finalConflict.authorization)).toBe(false)
  })
})

describe('authorization operation claim', () => {
  it.each(['CAPTURE', 'VOID'] as const)('claims %s once with a fresh merchant request id', (type) => {
    const original = state({ fundsStatus: 'authorized' })
    const result = claimAuthorizationOperation(original, {
      type,
      merchantTxnId: 'showcase-operation-1',
      occurredAt,
    })

    expect(canClaimAuthorizationOperation(original)).toBe(true)
    expect(result.operation).toEqual({ type, merchantTxnId: 'showcase-operation-1', status: 'pending' })
    expect(result.fundsStatus).toBe('authorized')
    expect(Object.isFrozen(result.operation)).toBe(true)
    expect(original.operation).toBeUndefined()
    expect(canClaimAuthorizationOperation(result)).toBe(false)
  })

  it.each(['pending', 'captured', 'voided'] as const)('does not claim when funds are %s', (fundsStatus) => {
    const original = state({ fundsStatus })
    expect(canClaimAuthorizationOperation(original)).toBe(false)
    expect(() => claimAuthorizationOperation(original, {
      type: 'CAPTURE', merchantTxnId: 'showcase-operation-1', occurredAt,
    })).toThrow('AUTHORIZATION_OPERATION_UNAVAILABLE')
  })

  it.each(['pending', 'unknown', 'confirmed'] as const)('does not re-claim either action after a %s operation', (status) => {
    const original = state({
      fundsStatus: 'authorized',
      operation: { type: 'CAPTURE', merchantTxnId: 'showcase-operation-1', status },
    })

    for (const type of ['CAPTURE', 'VOID'] as const) {
      expect(canClaimAuthorizationOperation(original)).toBe(false)
      expect(() => claimAuthorizationOperation(original, {
        type, merchantTxnId: 'showcase-operation-2', occurredAt,
      })).toThrow('AUTHORIZATION_OPERATION_UNAVAILABLE')
    }
  })

  it.each(['', 'showcase-auth-1', 'invalid id', 'x'.repeat(65)])('rejects an invalid or reused operation request id', (merchantTxnId) => {
    expect(() => claimAuthorizationOperation(state({ fundsStatus: 'authorized' }), {
      type: 'CAPTURE', merchantTxnId, occurredAt,
    })).toThrow('AUTHORIZATION_OPERATION_INVALID')
  })
})

describe('authorization notification correlation and ordering', () => {
  it.each([
    { paymentId: '2000000000000000099' },
    { merchantTxnId: 'another-order' },
    { amountMinor: 501 },
    { currency: 'EUR' },
  ])('rejects an AUTH fact outside the saved binding: %j', (overrides) => {
    const original = state()
    expect(mergeAuthorization(original, fact(overrides as Partial<AuthorizationFact>)))
      .toEqual({ authorization: original, accepted: false, conflict: false })
  })

  it.each(['CAPTURE', 'VOID'] as const)('requires a matching local claim before binding a %s transaction', (type) => {
    const original = state({ fundsStatus: 'authorized' })
    expect(mergeAuthorization(original, operationFact(type)).accepted).toBe(false)
    expect(mergeAuthorization(claimed(type === 'CAPTURE' ? 'VOID' : 'CAPTURE'), operationFact(type)).accepted).toBe(false)

    for (const merchantTxnId of ['showcase-auth-1', 'showcase-operation-1']) {
      const result = mergeAuthorization(claimed(type), { ...operationFact(type), merchantTxnId })
      expect(result).toMatchObject({
        accepted: true,
        conflict: false,
        authorization: {
          fundsStatus: type === 'CAPTURE' ? 'captured' : 'voided',
          operation: { type, status: 'confirmed', transactionId: '2000000000000000003' },
        },
      })
    }
  })

  it('allows the matching notification to resolve an unknown operation result', () => {
    const original = claimed()
    const unknown = { ...original, operation: { ...original.operation!, status: 'unknown' as const } }
    expect(mergeAuthorization(unknown, operationFact()).authorization.operation?.status).toBe('confirmed')
  })

  it.each([
    { paymentId: '2000000000000000099' },
    { merchantTxnId: 'another-operation' },
    { transactionId: '2000000000000000002' },
    { amountMinor: 501 },
    { currency: 'EUR' },
  ])('rejects uncorrelated operation fields: %j', (overrides) => {
    const original = claimed()
    expect(mergeAuthorization(original, { ...operationFact(), ...overrides } as AuthorizationFact))
      .toEqual({ authorization: original, accepted: false, conflict: false })
  })

  it('requires the saved operation transaction id when one already exists', () => {
    const original = claimed()
    const known = { ...original, operation: { ...original.operation!, transactionId: '2000000000000000004' } }
    expect(mergeAuthorization(known, operationFact()).accepted).toBe(false)
    expect(mergeAuthorization(known, { ...operationFact(), transactionId: '2000000000000000004' }).accepted).toBe(true)
  })

  it('refuses to bind a confirmed operation that has lost its provider id', () => {
    const original = claimed()
    const invalid = { ...original, operation: { ...original.operation!, status: 'confirmed' as const } }
    expect(mergeAuthorization(invalid, operationFact()).accepted).toBe(false)
  })

  it.each(['CAPTURE', 'VOID'] as const)('ignores late AUTH outcomes after %s and keeps duplicate completion stable', (type) => {
    const completed = mergeAuthorization(claimed(type), operationFact(type)).authorization

    for (const lateFact of [fact(), fact({ transactionStatus: 'F', paymentStatus: 'O' })]) {
      expect(mergeAuthorization(completed, lateFact).authorization).toBe(completed)
    }

    expect(mergeAuthorization(completed, operationFact(type))).toEqual({
      authorization: completed, accepted: true, conflict: false,
    })
    expect(canClaimAuthorizationOperation(completed)).toBe(false)
  })

  it.each(['CAPTURE', 'VOID'] as const)('records a conflicting terminal after %s without changing or binding funds', (type) => {
    const completed = mergeAuthorization(claimed(type), operationFact(type)).authorization
    const conflicting = operationFact(type === 'CAPTURE' ? 'VOID' : 'CAPTURE')
    expect(mergeAuthorization(completed, conflicting)).toEqual({
      authorization: { ...completed, conflict: true }, accepted: false, conflict: true,
    })
  })

  it('does not treat unrelated payment or merchant ids as a terminal conflict', () => {
    const completed = mergeAuthorization(claimed(), operationFact()).authorization
    for (const overrides of [{ paymentId: '2000000000000000099' }, { merchantTxnId: 'another-order' }]) {
      expect(mergeAuthorization(completed, { ...operationFact('VOID'), ...overrides }))
        .toEqual({ authorization: completed, accepted: false, conflict: false })
    }
  })

  it('does not regress the timestamp when a delayed operation notification arrives', () => {
    const original = { ...claimed(), updatedAt: '2026-09-18T08:02:00.000Z' }
    expect(mergeAuthorization(original, operationFact()).authorization.updatedAt).toBe(original.updatedAt)
  })
})
