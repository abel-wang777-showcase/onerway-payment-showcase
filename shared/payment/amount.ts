export const MIN_PAYMENT_AMOUNT = 1
export const MAX_PAYMENT_AMOUNT = 1_000_000

export function isPaymentAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= MIN_PAYMENT_AMOUNT && value <= MAX_PAYMENT_AMOUNT
}

/** Parse USD display units without floating-point rounding or silent truncation. */
export function parsePaymentAmount(value: string): number | null {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value)) return null
  const [whole = '', fraction = ''] = value.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return isPaymentAmount(minor) ? minor : null
}

export function paymentAmountText(minor: number): string {
  if (!isPaymentAmount(minor)) throw new TypeError('PAYMENT_AMOUNT_INVALID')
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
}
