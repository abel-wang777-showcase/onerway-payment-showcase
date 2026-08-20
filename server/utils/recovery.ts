import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  getCookie,
  getRequestURL,
  setCookie,
  type H3Event,
} from 'h3'

export const PAYMENT_RECOVERY_COOKIE = 'onerway_payment_recovery'
export const PAYMENT_RECOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1_000
const CLOCK_SKEW_MS = 30_000
const idPattern = /^[A-Za-z0-9-]{1,128}$/

export interface PaymentRecoveryRef {
  readonly orderId: string
  readonly attemptId: string
  readonly expiresAt: number
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decode(value: string): string | null {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    return encode(decoded) === value && idPattern.test(decoded) ? decoded : null
  }
  catch {
    return null
  }
}

function input(orderId: string, attemptId: string, expiresAt: number): string {
  return `onerway-showcase-recovery-v1\0${orderId}\0${attemptId}\0${expiresAt}`
}

function signature(secret: string, orderId: string, attemptId: string, expiresAt: number): string {
  return createHmac('sha256', secret)
    .update(input(orderId, attemptId, expiresAt), 'utf8')
    .digest('base64url')
}

export function createPaymentRecoveryToken(
  secret: string,
  orderId: string,
  attemptId: string,
  now = Date.now(),
): string {
  if (!idPattern.test(orderId) || !idPattern.test(attemptId)) {
    throw new TypeError('PAYMENT_RECOVERY_ID_INVALID')
  }

  const expiresAt = now + PAYMENT_RECOVERY_TTL_MS
  const sign = signature(secret, orderId, attemptId, expiresAt)
  return `v1.${encode(orderId)}.${encode(attemptId)}.${expiresAt}.${sign}`
}

export function verifyPaymentRecoveryToken(
  secret: string,
  token: string | undefined,
  expectedOrderId?: string,
  now = Date.now(),
): PaymentRecoveryRef | null {
  if (!token || token.length > 512) {
    return null
  }

  const [version, encodedOrderId, encodedAttemptId, rawExpiry, sign, ...extra] = token.split('.')
  const orderId = encodedOrderId ? decode(encodedOrderId) : null
  const attemptId = encodedAttemptId ? decode(encodedAttemptId) : null
  const expiresAt = rawExpiry && /^\d{13}$/.test(rawExpiry) ? Number(rawExpiry) : NaN

  if (
    version !== 'v1'
    || extra.length > 0
    || !orderId
    || !attemptId
    || (expectedOrderId !== undefined && orderId !== expectedOrderId)
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= now
    || expiresAt - now > PAYMENT_RECOVERY_TTL_MS + CLOCK_SKEW_MS
    || !sign
    || !/^[A-Za-z0-9_-]{43}$/.test(sign)
  ) {
    return null
  }

  const expected = Buffer.from(signature(secret, orderId, attemptId, expiresAt))
  const actual = Buffer.from(sign)

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null
  }

  return Object.freeze({ orderId, attemptId, expiresAt })
}

export function readPaymentRecovery(
  event: H3Event,
  secret: string,
  expectedOrderId?: string,
): PaymentRecoveryRef | null {
  return verifyPaymentRecoveryToken(
    secret,
    getCookie(event, PAYMENT_RECOVERY_COOKIE),
    expectedOrderId,
  )
}

export function setPaymentRecovery(
  event: H3Event,
  secret: string,
  orderId: string,
  attemptId: string,
): void {
  setCookie(event, PAYMENT_RECOVERY_COOKIE, createPaymentRecoveryToken(secret, orderId, attemptId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestURL(event).protocol === 'https:',
    path: '/api/payment',
    maxAge: PAYMENT_RECOVERY_TTL_MS / 1_000,
  })
}
