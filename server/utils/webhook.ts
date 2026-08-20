import { createHash, timingSafeEqual } from 'node:crypto'
import { mapWebhookStatus } from '../../shared/payment/merge'
import type { PaymentStatus } from '../../shared/payment/attempt'
import {
  projectSubscriptionState,
  SUBSCRIPTION_DATA_STATUSES,
  SUBSCRIPTION_STATUSES,
  type SubscriptionDataStatus,
  type SubscriptionState,
  type SubscriptionStatus,
} from '../../shared/payment/subscription'

const WEBHOOK_EXCLUDED_FIELDS = new Set([
  'originTransactionId',
  'originMerchantTxnId',
  'customsDeclarationAmount',
  'customsDeclarationCurrency',
  'paymentMethod',
  'walletTypeName',
  'periodValue',
  'tokenExpireTime',
  'sign',
])

const MAX_WEBHOOK_BYTES = 64 * 1024

export interface PaymentWebhook {
  readonly transactionId: string
  readonly paymentId?: string
  readonly merchantTxnId: string
  readonly amountMinor: number
  readonly currency: 'USD'
  readonly transactionStatus: 'S' | 'F' | 'N'
  readonly paymentStatus?: 'S' | 'O' | 'N'
  readonly status: PaymentStatus
  readonly occurredAt: string
}

export interface SubscriptionPaymentWebhook extends PaymentWebhook {
  readonly kind: 'subscription'
  readonly scenario: 'SUBSCRIPTION_INITIAL'
  readonly contractId?: string
  readonly tokenId?: string
  readonly productName: string
  readonly productAmountMinor: number
  readonly productCurrency: 'USD'
  readonly dataStatus: SubscriptionDataStatus
  readonly subscriptionStatus: SubscriptionStatus
  readonly subscriptionState: SubscriptionState
}

export type WebhookErrorCode
  = | 'PAYMENT_WEBHOOK_BODY_INVALID'
    | 'PAYMENT_WEBHOOK_SIGNATURE_INVALID'
    | 'PAYMENT_WEBHOOK_FIELDS_INVALID'

export class WebhookError extends Error {
  readonly code: WebhookErrorCode

  constructor(code: WebhookErrorCode) {
    super(code)
    this.name = 'WebhookError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readText(
  body: Record<string, unknown>,
  key: string,
  pattern: RegExp,
  optional = false,
): string | undefined {
  const value = body[key]

  if (optional && (value === undefined || value === null || value === '')) {
    return undefined
  }

  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  return value
}

function canonicalValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new WebhookError('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
  }

  return String(value)
}

function digest(body: Record<string, unknown>, secret: string): string {
  const canonical = Object.entries(body)
    .filter(([key]) => !WEBHOOK_EXCLUDED_FIELDS.has(key))
    .map(([key, value]) => [key, canonicalValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, value]) => value)
    .join('')

  return createHash('sha256')
    .update(`${canonical}${secret}`, 'utf8')
    .digest('hex')
}

export function verifyWebhookSignature(body: Record<string, unknown>, secret: string): boolean {
  const sign = body.sign

  if (typeof sign !== 'string' || !/^[a-f0-9]{64}$/.test(sign)) {
    return false
  }

  let actual: string

  try {
    actual = digest(body, secret)
  }
  catch {
    return false
  }

  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(sign, 'hex'))
}

export function parseWebhookBody(raw: string | undefined): Record<string, unknown> {
  if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_WEBHOOK_BYTES) {
    throw new WebhookError('PAYMENT_WEBHOOK_BODY_INVALID')
  }

  try {
    const parsed: unknown = JSON.parse(raw)

    if (!isRecord(parsed)) {
      throw new WebhookError('PAYMENT_WEBHOOK_BODY_INVALID')
    }

    return parsed
  }
  catch (error) {
    if (error instanceof WebhookError) {
      throw error
    }

    throw new WebhookError('PAYMENT_WEBHOOK_BODY_INVALID')
  }
}

export async function readWebhookBody(
  chunks: AsyncIterable<string | Uint8Array>,
  contentLength?: string,
): Promise<Record<string, unknown>> {
  if (
    contentLength !== undefined
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_WEBHOOK_BYTES)
  ) {
    throw new WebhookError('PAYMENT_WEBHOOK_BODY_INVALID')
  }

  const body: Buffer[] = []
  let bytes = 0

  for await (const chunk of chunks) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)

    bytes += buffer.byteLength

    if (bytes > MAX_WEBHOOK_BYTES) {
      throw new WebhookError('PAYMENT_WEBHOOK_BODY_INVALID')
    }

    body.push(buffer)
  }

  return parseWebhookBody(Buffer.concat(body, bytes).toString('utf8'))
}

function readMinorAmount(value: string): number {
  const match = /^(0|[1-9]\d{0,13})\.(\d{2})$/.exec(value)

  if (!match) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  const minor = Number(`${match[1]}${match[2]}`)

  if (!Number.isSafeInteger(minor)) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  return minor
}

function readOpaqueText(value: unknown, maxBytes: number, optional = false): string | undefined {
  if (optional && (value === undefined || value === null || value === '')) {
    return undefined
  }

  if (
    typeof value !== 'string'
    || Buffer.byteLength(value, 'utf8') > maxBytes
    || value.length === 0
    || [...value].some((character) => {
      const code = character.codePointAt(0)!
      return code <= 31 || code === 127
    })
  ) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  return value
}

function readSubscriptionProduct(body: Record<string, unknown>): {
  readonly name: string
  readonly amountMinor: number
  readonly currency: 'USD'
} {
  const wire = body.products

  if (typeof wire !== 'string' || Buffer.byteLength(wire, 'utf8') > 16_384) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(wire)
  }
  catch {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  const product = parsed[0]
  const name = readOpaqueText(product.name, 128)!
  const price = readText(product, 'price', /^(?:0|[1-9]\d{0,13})\.\d{2}$/)!
  const currency = readText(product, 'currency', /^USD$/) as 'USD'
  const num = readText(product, 'num', /^1$/)

  if (num !== '1') {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  return Object.freeze({ name, amountMinor: readMinorAmount(price), currency })
}

function readOccurredAt(body: Record<string, unknown>): string {
  const time = readText(body, 'txnTime', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  const zone = readText(body, 'txnTimeZone', /^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/)
  const local = time!.replace(' ', 'T')
  const calendar = new Date(`${local}Z`)

  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== local) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  const date = new Date(`${time!.replace(' ', 'T')}${zone}`)

  if (!Number.isFinite(date.getTime())) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  return date.toISOString()
}

export function readPaymentWebhook(
  body: Record<string, unknown>,
  secret: string,
  merchantNo: string,
): PaymentWebhook {
  if (!verifyWebhookSignature(body, secret)) {
    throw new WebhookError('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
  }

  if (body.notifyType !== 'TXN' || body.txnType !== 'SALE' || body.merchantNo !== merchantNo) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  const transactionId = readText(body, 'transactionId', /^\d{1,20}$/)!
  const paymentId = readText(body, 'paymentId', /^\d{1,20}$/, true)
  const merchantTxnId = readText(body, 'merchantTxnId', /^[A-Za-z0-9_-]{1,64}$/)!
  const amount = readText(body, 'orderAmount', /^(?:0|[1-9]\d{0,13})\.\d{2}$/)!
  const currency = readText(body, 'orderCurrency', /^USD$/) as 'USD'
  const transactionStatus = readText(body, 'status', /^[SFN]$/) as 'S' | 'F' | 'N'
  const paymentStatus = readText(body, 'paymentStatus', /^[SON]$/, true) as 'S' | 'O' | 'N' | undefined

  return Object.freeze({
    transactionId,
    ...(paymentId ? { paymentId } : {}),
    merchantTxnId,
    amountMinor: readMinorAmount(amount),
    currency,
    transactionStatus,
    ...(paymentStatus ? { paymentStatus } : {}),
    status: mapWebhookStatus(transactionStatus, paymentStatus),
    occurredAt: readOccurredAt(body),
  })
}

export function readSubscriptionPaymentWebhook(
  body: Record<string, unknown>,
  secret: string,
  merchantNo: string,
): SubscriptionPaymentWebhook {
  if (!verifyWebhookSignature(body, secret)) {
    throw new WebhookError('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
  }

  if (
    body.notifyType !== 'TXN'
    || body.txnType !== 'SALE'
    || body.merchantNo !== merchantNo
    || body.scenarios !== 'SUBSCRIPTION_INITIAL'
  ) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  const transactionId = readText(body, 'transactionId', /^\d{1,20}$/)!
  const paymentId = readText(body, 'paymentId', /^\d{1,20}$/)!
  const merchantTxnId = readText(body, 'merchantTxnId', /^[A-Za-z0-9_-]{1,64}$/)!
  const amount = readText(body, 'orderAmount', /^(?:0|[1-9]\d{0,13})\.\d{2}$/)!
  const currency = readText(body, 'orderCurrency', /^USD$/) as 'USD'
  const transactionStatus = readText(body, 'status', /^[SFN]$/) as 'S' | 'F' | 'N'
  const paymentStatus = readText(body, 'paymentStatus', /^[SON]$/, true) as 'S' | 'O' | 'N' | undefined
  const contractId = readText(body, 'contractId', /^[A-Za-z0-9_-]{1,128}$/, true)
  const tokenId = readOpaqueText(body.tokenId, 512, true)
  const dataStatus = readText(body, 'dataStatus', /^[0-3]$/) as SubscriptionDataStatus
  const subscriptionStatus = readText(
    body,
    'subscriptionStatus',
    /^(?:trialing|paymentdue|active|pastdue|paused|canceled|ended)$/,
  ) as SubscriptionStatus
  const product = readSubscriptionProduct(body)

  if (
    !SUBSCRIPTION_DATA_STATUSES.includes(dataStatus)
    || !SUBSCRIPTION_STATUSES.includes(subscriptionStatus)
    || (paymentStatus === 'S' && (!contractId || !tokenId))
    || (subscriptionStatus === 'active' && (!contractId || !tokenId))
  ) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID')
  }

  return Object.freeze({
    kind: 'subscription',
    scenario: 'SUBSCRIPTION_INITIAL',
    transactionId,
    paymentId,
    merchantTxnId,
    amountMinor: readMinorAmount(amount),
    currency,
    transactionStatus,
    ...(paymentStatus ? { paymentStatus } : {}),
    status: mapWebhookStatus(transactionStatus, paymentStatus),
    occurredAt: readOccurredAt(body),
    ...(contractId ? { contractId } : {}),
    ...(tokenId ? { tokenId } : {}),
    productName: product.name,
    productAmountMinor: product.amountMinor,
    productCurrency: product.currency,
    dataStatus,
    subscriptionStatus,
    subscriptionState: projectSubscriptionState(dataStatus, subscriptionStatus),
  })
}
