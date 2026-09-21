import { createHash, timingSafeEqual } from 'node:crypto'
import { mapWebhookStatus } from '../../shared/payment/merge'
import type { PaymentStatus } from '../../shared/payment/attempt'
import {
  mapAuthorizationStatus,
  type AuthorizationFact,
  type AuthorizationProjection,
} from '../../shared/payment/authorization'
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

export interface AuthorizationWebhook extends Omit<AuthorizationFact, 'occurredAt'>, AuthorizationProjection {
  readonly source: 'webhook'
  readonly kind: 'authorization'
  // CAPTURE/VOID may omit the transaction time. Persistence then records the
  // notification's server receipt time, not an invented Provider transaction time.
  readonly occurredAt?: string
}

export type WebhookErrorCode
  = | 'PAYMENT_WEBHOOK_BODY_INVALID'
    | 'PAYMENT_WEBHOOK_SIGNATURE_INVALID'
    | 'PAYMENT_WEBHOOK_FIELDS_INVALID'

// Fixed internal codes identify validation sites without logging payload keys or values.
const FIELD_DIAGNOSTICS = {
  transactionId: 'P01',
  paymentId: 'P02',
  merchantTxnId: 'P03',
  orderAmount: 'P04',
  orderCurrency: 'P05',
  status: 'P06',
  paymentStatus: 'P07',
  txnTime: 'T01',
  txnTimeZone: 'T02',
  contractId: 'S02',
  dataStatus: 'S03',
  subscriptionStatus: 'S04',
  price: 'S05',
  currency: 'S06',
  num: 'S07',
} as const

type WebhookDiagnosticCode
  = | typeof FIELD_DIAGNOSTICS[keyof typeof FIELD_DIAGNOSTICS]
    | 'F00' // Unclassified field rejection.
    | 'E01' // Notification category.
    | 'E02' // Transaction category.
    | 'E03' // Merchant binding.
    | 'P08' // Minor amount conversion or safe integer range.
    | 'T03' // Calendar or offset conversion.
    | 'S01' // Subscription scenario.
    | 'S08' // Opaque subscription text.
    | 'S09' // Subscription product structure.
    | 'S10' // Subscription state/identifier consistency.
    | 'A01' // Unconfirmed authorization status combination.

export class WebhookError extends Error {
  readonly code: WebhookErrorCode
  readonly diagnosticCode?: WebhookDiagnosticCode

  constructor(code: WebhookErrorCode, diagnosticCode?: WebhookDiagnosticCode) {
    super(code)
    this.name = 'WebhookError'
    this.code = code
    this.diagnosticCode = diagnosticCode
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
    const diagnosticCode = Object.hasOwn(FIELD_DIAGNOSTICS, key)
      ? FIELD_DIAGNOSTICS[key as keyof typeof FIELD_DIAGNOSTICS]
      : 'F00'
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', diagnosticCode)
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

export function verifyWebhookSignature(
  body: Record<string, unknown>,
  secret: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader || signatureHeader.length > MAX_WEBHOOK_BYTES) {
    return false
  }

  const signatures = signatureHeader.split(',').map(item => item.trim())

  if (signatures.some(item => !/^v1=[a-f0-9]{64}$/.test(item))) {
    return false
  }

  let actual: string

  try {
    actual = digest(body, secret)
  }
  catch {
    return false
  }

  const expected = Buffer.from(actual, 'hex')

  return signatures.some(item => timingSafeEqual(expected, Buffer.from(item.slice(3), 'hex')))
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
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'P08')
  }

  const minor = Number(`${match[1]}${match[2]}`)

  if (!Number.isSafeInteger(minor)) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'P08')
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
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'S08')
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
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'S09')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(wire)
  }
  catch {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'S09')
  }

  if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'S09')
  }

  const product = parsed[0]
  const name = readOpaqueText(product.name, 128)!
  const price = readText(product, 'price', /^(?:0|[1-9]\d{0,13})\.\d{2}$/)!
  const currency = readText(product, 'currency', /^USD$/) as 'USD'
  const num = readText(product, 'num', /^1$/)

  if (num !== '1') {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'S07')
  }

  return Object.freeze({ name, amountMinor: readMinorAmount(price), currency })
}

function readOccurredAt(body: Record<string, unknown>): string {
  const time = readText(body, 'txnTime', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  const zone = readText(body, 'txnTimeZone', /^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/)
  const local = time!.replace(' ', 'T')
  const calendar = new Date(`${local}Z`)

  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== local) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'T03')
  }

  const date = new Date(`${time!.replace(' ', 'T')}${zone}`)

  if (!Number.isFinite(date.getTime())) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'T03')
  }

  return date.toISOString()
}

function readEnvelope(body: Record<string, unknown>, merchantNo: string): void {
  if (body.notifyType !== 'TXN') {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'E01')
  }

  if (body.txnType !== 'SALE') {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'E02')
  }

  if (body.merchantNo !== merchantNo) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'E03')
  }
}

export function readPaymentWebhook(
  body: Record<string, unknown>,
  secret: string,
  merchantNo: string,
  signatureHeader: string | undefined,
): PaymentWebhook {
  if (!verifyWebhookSignature(body, secret, signatureHeader)) {
    throw new WebhookError('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
  }

  readEnvelope(body, merchantNo)

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
  signatureHeader: string | undefined,
): SubscriptionPaymentWebhook {
  if (!verifyWebhookSignature(body, secret, signatureHeader)) {
    throw new WebhookError('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
  }

  readEnvelope(body, merchantNo)

  if (body.scenarios !== 'SUBSCRIPTION_INITIAL') {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'S01')
  }

  const transactionId = readText(body, 'transactionId', /^\d{1,20}$/)!
  const paymentId = readText(body, 'paymentId', /^\d{1,20}$/, true)
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
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'S10')
  }

  return Object.freeze({
    kind: 'subscription',
    scenario: 'SUBSCRIPTION_INITIAL',
    transactionId,
    ...(paymentId ? { paymentId } : {}),
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

export function readAuthorizationWebhook(
  body: Record<string, unknown>,
  secret: string,
  merchantNo: string,
  signatureHeader: string | undefined,
): AuthorizationWebhook {
  if (!verifyWebhookSignature(body, secret, signatureHeader)) {
    throw new WebhookError('PAYMENT_WEBHOOK_SIGNATURE_INVALID')
  }

  if (body.notifyType !== 'TXN') {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'E01')
  }

  if (!['AUTH', 'CAPTURE', 'VOID'].includes(body.txnType as string)) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'E02')
  }

  if (body.merchantNo !== merchantNo) {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'E03')
  }

  const txnType = body.txnType as AuthorizationFact['txnType']
  const transactionId = readText(body, 'transactionId', /^\d{1,20}$/)!
  const paymentId = readText(body, 'paymentId', /^\d{1,20}$/)!
  const merchantTxnId = readText(body, 'merchantTxnId', /^[A-Za-z0-9_-]{1,64}$/)!
  const amount = readText(body, 'orderAmount', /^(?:0|[1-9]\d{0,13})\.\d{2}$/)!
  const currency = readText(body, 'orderCurrency', /^USD$/) as 'USD'
  const transactionStatus = readText(body, 'status', /^[SFN]$/) as AuthorizationFact['transactionStatus']
  const paymentStatus = readText(body, 'paymentStatus', /^[ASON]$/) as AuthorizationFact['paymentStatus']
  let projection: AuthorizationProjection

  try {
    projection = mapAuthorizationStatus(txnType, transactionStatus, paymentStatus)
  }
  catch {
    throw new WebhookError('PAYMENT_WEBHOOK_FIELDS_INVALID', 'A01')
  }

  const hasTransactionTime = body.txnTime !== undefined && body.txnTime !== null && body.txnTime !== ''
  const occurredAt = txnType === 'AUTH' || hasTransactionTime ? readOccurredAt(body) : undefined

  return Object.freeze({
    kind: 'authorization',
    source: 'webhook',
    txnType,
    transactionId,
    paymentId,
    merchantTxnId,
    amountMinor: readMinorAmount(amount),
    currency,
    transactionStatus,
    paymentStatus,
    ...projection,
    ...(occurredAt ? { occurredAt } : {}),
  })
}
