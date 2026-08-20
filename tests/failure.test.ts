import { describe, expect, it } from 'vitest'
import {
  getPaymentFailure,
  getSdkPaymentActions,
  isPaymentRestorationAction,
  PAYMENT_FAILURE_SOURCES,
} from '../shared/payment/failure'

describe('payment failure actions', () => {
  it.each([
    ['recover_attempt', true],
    ['retry_restoration', true],
    ['start_clean_order', false],
    [undefined, false],
  ] as const)('classifies %s as restoration=%s', (action, expected) => {
    expect(isPaymentRestorationAction(action)).toBe(expected)
  })

  it.each([
    ['load', 'reload_element'],
    ['create', 'recover_attempt'],
    ['query', 'verify_attempt'],
    ['confirm', 'verify_attempt'],
    ['retry', 'recover_attempt'],
  ] as const)('maps %s to its only safe action', (source, action) => {
    expect(getPaymentFailure(source)).toMatchObject({ source, action })
  })

  it.each([400, 401, 403, 404])('fails closed for unauthorized recovery status %s', (status) => {
    expect(getPaymentFailure('recovery', { status })).toMatchObject({
      source: 'recovery',
      action: 'return_hub',
    })
  })

  it('keeps transient recovery bound to the same order', () => {
    expect(getPaymentFailure('recovery', { status: 503 })).toMatchObject({
      source: 'recovery',
      action: 'retry_restoration',
    })
  })

  it('returns only fixed allowlisted fields', () => {
    for (const source of PAYMENT_FAILURE_SOURCES) {
      const failure = getPaymentFailure(source, { status: 502 })

      expect(Object.keys(failure).sort()).toEqual([
        'action',
        'description',
        'source',
        'title',
      ])
      expect(JSON.stringify(failure)).not.toContain('payload')
    }
  })

  it('permits a clean run only before submission after an Element load failure', () => {
    expect(getSdkPaymentActions({
      failure: getPaymentFailure('load'),
      canVerify: true,
      submitted: false,
    })).toEqual(['reload_element', 'start_clean_order'])
  })

  it.each(['confirm', 'query'] as const)('keeps %s uncertainty verify-only', (source) => {
    expect(getSdkPaymentActions({
      failure: getPaymentFailure(source),
      canVerify: true,
      submitted: true,
    })).toEqual(['verify_attempt'])
  })

  it.each([
    ['create', 'recover_attempt'],
    ['retry', 'recover_attempt'],
    ['recovery', 'retry_restoration'],
  ] as const)('keeps %s restoration ahead of stale verify eligibility', (source, action) => {
    expect(getSdkPaymentActions({
      failure: getPaymentFailure(source, { status: 503 }),
      canVerify: true,
      submitted: true,
    })).toEqual([action])
  })

  it('uses verify eligibility only when no structured failure is active', () => {
    expect(getSdkPaymentActions({
      failure: null,
      canVerify: true,
      submitted: true,
    })).toEqual(['verify_attempt'])
  })

})
