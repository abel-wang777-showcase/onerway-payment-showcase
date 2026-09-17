import type { PaymentAttempt, PaymentStatus } from './attempt'

// This URL carries a checkout session. Validate it for navigation only; never
// include it in persisted payment facts or technical details.
export function readCheckoutRedirectUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\\p{C}]/u.test(value)) {
    return null
  }

  try {
    const url = new URL(value)
    if (
      url.origin !== 'https://sandbox-checkout.onerway.com'
      || url.username || url.password || url.hash
      || !['/checkout', '/aggregate'].includes(url.pathname)
    ) {
      return null
    }
    return url.href
  }
  catch {
    return null
  }
}

export function paymentPath(attempt: PaymentAttempt): string {
  const page = ['succeeded', 'failed', 'cancelled'].includes(attempt.status)
    ? 'result'
    : attempt.integration === 'checkout' ? 'hosted' : 'sdk'
  return `/halden/${page}/${attempt.orderId}`
}

export function mapCheckoutTransactionStatus(rawStatus: string, paymentStatus?: string): PaymentStatus {
  if (!['S', 'N', 'F', 'P', 'I', 'U', 'R'].includes(rawStatus)) throw new TypeError('PAYMENT_STATUS_UNKNOWN')
  if (paymentStatus === 'S') return 'succeeded'
  if (paymentStatus === 'N') return 'cancelled'
  if (paymentStatus === 'O') return 'processing'
  if (paymentStatus !== undefined) throw new TypeError('PAYMENT_STATUS_UNKNOWN')

  const statuses: Readonly<Record<string, PaymentStatus>> = {
    S: 'succeeded',
    N: 'cancelled',
    // A failed transaction can leave its Payment open. It does not establish
    // eligibility to create a new charge on the same order.
    F: 'processing',
    P: 'processing',
    I: 'processing',
    U: 'processing',
    R: 'requires_action',
  }
  const status = statuses[rawStatus]
  if (!status) throw new TypeError('PAYMENT_STATUS_UNKNOWN')
  return status
}
