import { describe, expect, it } from 'vitest'
import { isPaymentAmount, parsePaymentAmount, paymentAmountText } from '../shared/payment/amount'

describe('one-time Sandbox USD amount', () => {
  it.each([['0.01', 1], ['12.34', 1234], ['5', 500], ['5.1', 510], ['10000.00', 1_000_000]] as const)(
    'parses %s into exact cents', (text, minor) => {
      expect(parsePaymentAmount(text)).toBe(minor)
      expect(parsePaymentAmount(paymentAmountText(minor))).toBe(minor)
    },
  )
  it.each(['', '0', '0.00', '-1', '+1', '.50', '1.', '1.001', ' 1', '1 ', '1e2', '1,000', '10000.01', '999999999999999999'])('rejects %s without rounding', (text) => {
    expect(parsePaymentAmount(text)).toBeNull()
  })
  it.each([0, -1, 1.1, 1_000_001, Number.MAX_SAFE_INTEGER, Number.NaN, Infinity, '1234', null, undefined])('rejects invalid minor units %s', (value) => {
    expect(isPaymentAmount(value)).toBe(false)
  })
  it('formats both inclusive limits and rejects values outside them', () => {
    expect(paymentAmountText(1)).toBe('0.01')
    expect(paymentAmountText(1_000_000)).toBe('10000.00')
    expect(() => paymentAmountText(0)).toThrow('PAYMENT_AMOUNT_INVALID')
  })
})
