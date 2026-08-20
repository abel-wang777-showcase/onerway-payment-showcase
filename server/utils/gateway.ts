import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { mapQueryStatus } from '../../shared/payment/sdk'
import type { PaymentStatus } from '../../shared/payment/attempt'
import type { WalletPaymentMethodId } from '../../shared/payment/capability'
import { findOrderJourney } from '../../shared/payment/journey'
import type { Order } from '../../shared/payment/order'
import {
  projectSubscriptionState,
  SUBSCRIPTION_DATA_STATUSES,
  SUBSCRIPTION_STATUSES,
  type SubscriptionDataStatus,
  type SubscriptionPlan,
  type SubscriptionState,
  type SubscriptionStatus,
} from '../../shared/payment/subscription'
import type { ServerProfile } from './profile'

type Payload = Readonly<Record<string, unknown>>
type WirePayload = Readonly<Record<string, string>>

export interface CreateContext {
  readonly merchantTxnId: string
  readonly merchantCustId: string
  readonly order: Order
  readonly returnUrl: string
  readonly transactionIp: string
  readonly accept: string
  readonly javaEnabled: boolean
  readonly colorDepth: string
  readonly screenHeight: string
  readonly screenWidth: string
  readonly timeZoneOffset: string
  readonly contentLength: string
  readonly language: string
  readonly userAgent: string
}

function formatAmount(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new TypeError('PAYMENT_ORDER_INVALID')
  }

  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`
}

export interface CreatedPayment {
  readonly transactionId: string
  readonly paymentId: string
  readonly rawStatus: 'U'
}

export interface CreatedSubscriptionPayment extends CreatedPayment {
  readonly rawPaymentStatus: 'U'
}

export interface QueriedPayment {
  readonly paymentId: string
  readonly transactionId?: string
  readonly rawStatus: string
  readonly status: PaymentStatus
}

export interface RecoveredPaymentCreation {
  readonly paymentId: string
  readonly transactionId: string
  readonly rawStatus: string
  readonly status: PaymentStatus
}

export interface QueriedPaymentMethod {
  readonly paymentId: string
  readonly transactionId: string
  readonly actualWallet?: WalletPaymentMethodId
  readonly fundingNetwork?: string
}

export interface SubscriptionDetails {
  readonly contractId: string
  readonly merchantCustomerId: string
  readonly productName: string
  readonly amountMinor: number
  readonly currency: 'USD'
  readonly frequencyType: 'D' | 'M' | 'Y'
  readonly frequencyPoint: number
  readonly expireDate: string
  readonly dataStatus: SubscriptionDataStatus
  readonly subscriptionStatus: SubscriptionStatus
  readonly state: SubscriptionState
  readonly tokenId?: string
}

export type GatewayErrorCode
  = | 'PAYMENT_CREATE_REJECTED'
    | 'PAYMENT_CREATE_RESPONSE_INVALID'
    | 'PAYMENT_CREATION_QUERY_NOT_FOUND'
    | 'PAYMENT_CREATION_QUERY_REJECTED'
    | 'PAYMENT_CREATION_QUERY_RESPONSE_INVALID'
    | 'PAYMENT_NETWORK_ERROR'
    | 'PAYMENT_QUERY_NOT_FOUND'
    | 'PAYMENT_QUERY_REJECTED'
    | 'PAYMENT_QUERY_RESPONSE_INVALID'
    | 'PAYMENT_METHOD_QUERY_NOT_FOUND'
    | 'PAYMENT_METHOD_QUERY_REJECTED'
    | 'PAYMENT_METHOD_QUERY_RESPONSE_INVALID'
    | 'SUBSCRIPTION_CREATE_RESPONSE_INVALID'
    | 'SUBSCRIPTION_QUERY_REJECTED'
    | 'SUBSCRIPTION_QUERY_RESPONSE_INVALID'

export class GatewayError extends Error {
  readonly code: GatewayErrorCode

  constructor(code: GatewayErrorCode) {
    super(code)
    this.name = 'GatewayError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeNested(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeNested)
  }

  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    isRecord(child) || Array.isArray(child)
      ? JSON.stringify(normalizeNested(child))
      : child,
  ]))
}

function normalizeValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (isRecord(value) || Array.isArray(value)) {
    return JSON.stringify(normalizeNested(value))
  }

  return String(value)
}

export function normalizePayload(payload: Payload): WirePayload {
  return Object.freeze(Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => key !== 'sign')
      .map(([key, value]) => [key, normalizeValue(value)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null),
  ))
}

export function signPayload(payload: Payload, secret: string): WirePayload {
  const normalized = normalizePayload(payload)
  const canonical = Object.keys(normalized)
    .sort()
    .map(key => normalized[key])
    .join('')
  const sign = createHash('sha256')
    .update(`${canonical}${secret}`, 'utf8')
    .digest('hex')

  return Object.freeze({ ...normalized, sign })
}

export function buildCreatePayload(profile: Extract<ServerProfile, { profile: 'sandbox' }>, context: CreateContext): Payload {
  const { order } = context
  const journey = findOrderJourney(order)
  const itemTotal = order.item.unitAmount.minor * order.item.quantity

  if (
    !journey
    || !/^[A-Za-z0-9_-]{1,63}$/.test(context.merchantCustId)
    || !journey.modes.includes('sandbox')
    || order.amount.currency !== 'USD'
    || order.item.unitAmount.currency !== order.amount.currency
    || !Number.isSafeInteger(itemTotal)
    || itemTotal !== order.amount.minor
  ) {
    throw new TypeError('PAYMENT_ORDER_INVALID')
  }

  const address = {
    country: 'US',
    email: 'customer@test.com',
    province: 'CA',
  }

  return Object.freeze({
    billingInformation: address,
    merchantCustId: context.merchantCustId,
    merchantNo: profile.merchantNo,
    merchantTxnId: context.merchantTxnId,
    orderAmount: formatAmount(order.amount.minor),
    orderCurrency: order.amount.currency,
    paymentMode: 'WEB',
    productType: 'ALL',
    risk3dsStrategy: 'DEFAULT',
    shippingInformation: address,
    subProductType: 'DIRECT',
    txnOrderMsg: {
      returnUrl: context.returnUrl,
      products: [{
        currency: order.item.unitAmount.currency,
        name: order.item.name,
        num: String(order.item.quantity),
        price: formatAmount(order.item.unitAmount.minor),
      }],
      transactionIp: context.transactionIp,
      appId: profile.appId,
      javaEnabled: context.javaEnabled,
      colorDepth: context.colorDepth,
      screenHeight: context.screenHeight,
      screenWidth: context.screenWidth,
      timeZoneOffset: context.timeZoneOffset,
      accept: context.accept,
      userAgent: context.userAgent,
      contentLength: context.contentLength,
      language: context.language,
      notifyUrl: profile.notifyUrl,
    },
    txnType: 'SALE',
  })
}

export interface SubscriptionCreateContext extends CreateContext {
  readonly plan: SubscriptionPlan
}

export function buildSubscriptionCreatePayload(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  context: SubscriptionCreateContext,
): Payload {
  const { order, plan } = context
  const itemTotal = order.item.unitAmount.minor * order.item.quantity

  if (
    !/^[A-Za-z0-9_-]{1,63}$/.test(context.merchantCustId)
    || order.scene !== 'ecommerce'
    || order.item.sku !== 'HL-SUB-DAILY-005'
    || order.item.name !== plan.productName
    || order.item.variant !== 'Daily subscription'
    || order.item.quantity !== 1
    || order.item.unitAmount.minor !== plan.amount.minor
    || order.item.unitAmount.currency !== plan.amount.currency
    || order.amount.minor !== plan.amount.minor
    || order.amount.currency !== plan.amount.currency
    || !Number.isSafeInteger(itemTotal)
    || itemTotal !== order.amount.minor
  ) {
    throw new TypeError('PAYMENT_ORDER_INVALID')
  }

  const address = {
    country: 'US',
    email: 'customer@test.com',
    province: 'CA',
  }

  return Object.freeze({
    billingInformation: address,
    merchantCustId: context.merchantCustId,
    merchantNo: profile.merchantNo,
    merchantTxnId: context.merchantTxnId,
    orderAmount: formatAmount(order.amount.minor),
    orderCurrency: order.amount.currency,
    paymentMode: 'WEB',
    productType: 'ALL',
    risk3dsStrategy: 'DEFAULT',
    shippingInformation: address,
    subProductType: 'SUBSCRIBE',
    subscription: {
      requestType: '0',
      merchantCustId: context.merchantCustId,
      selfExecute: '2',
      mode: '2',
      productName: plan.productName,
      frequencyType: plan.frequencyType,
      frequencyPoint: String(plan.frequencyPoint),
      expireDate: plan.expireDate,
    },
    txnOrderMsg: {
      returnUrl: context.returnUrl,
      products: [{
        currency: order.item.unitAmount.currency,
        name: order.item.name,
        num: String(order.item.quantity),
        price: formatAmount(order.item.unitAmount.minor),
      }],
      transactionIp: context.transactionIp,
      appId: profile.appId,
      javaEnabled: context.javaEnabled,
      colorDepth: context.colorDepth,
      screenHeight: context.screenHeight,
      screenWidth: context.screenWidth,
      timeZoneOffset: context.timeZoneOffset,
      accept: context.accept,
      userAgent: context.userAgent,
      contentLength: context.contentLength,
      language: context.language,
      notifyUrl: profile.notifyUrl,
    },
    txnType: 'SALE',
  })
}

export function buildQueryPayload(profile: Extract<ServerProfile, { profile: 'sandbox' }>, paymentId: string): Payload {
  return Object.freeze({
    current: '1',
    merchantNo: profile.merchantNo,
    paymentId,
    size: '10',
  })
}

export function buildCreationQueryPayload(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  merchantTxnId: string,
): Payload {
  return Object.freeze({
    current: '1',
    merchantNo: profile.merchantNo,
    merchantTxnIds: merchantTxnId,
    size: '10',
  })
}

export function buildPaymentMethodQueryPayload(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  transactionId: string,
): Payload {
  if (!isProviderId(transactionId)) {
    throw new GatewayError('PAYMENT_METHOD_QUERY_RESPONSE_INVALID')
  }

  return Object.freeze({
    current: '1',
    merchantNo: profile.merchantNo,
    size: '10',
    transactionIds: transactionId,
  })
}

export function buildSubscriptionQueryPayload(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  contractId: string,
): Payload {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(contractId)) {
    throw new GatewayError('SUBSCRIPTION_QUERY_RESPONSE_INVALID')
  }

  return Object.freeze({ merchantNo: profile.merchantNo, contractId })
}

function readText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function isProviderId(value: string | null): value is string {
  return value !== null && /^\d{1,20}$/.test(value)
}

function readResponse(value: unknown, rejected: GatewayErrorCode): Record<string, unknown> {
  if (!isRecord(value) || readText(value, 'respCode') !== '20000') {
    throw new GatewayError(rejected)
  }

  return value
}

export function readCreateResponse(value: unknown): CreatedPayment {
  const response = readResponse(value, 'PAYMENT_CREATE_REJECTED')
  const data = response.data

  if (!isRecord(data)) {
    throw new GatewayError('PAYMENT_CREATE_RESPONSE_INVALID')
  }

  const transactionId = readText(data, 'transactionId')
  const paymentId = readText(data, 'paymentId')
  const rawStatus = readText(data, 'status')

  if (!isProviderId(transactionId) || !isProviderId(paymentId) || rawStatus !== 'U') {
    throw new GatewayError('PAYMENT_CREATE_RESPONSE_INVALID')
  }

  return Object.freeze({ transactionId, paymentId, rawStatus })
}

export function readSubscriptionCreateResponse(value: unknown): CreatedSubscriptionPayment {
  const response = readResponse(value, 'PAYMENT_CREATE_REJECTED')
  const data = response.data

  if (!isRecord(data)) {
    throw new GatewayError('SUBSCRIPTION_CREATE_RESPONSE_INVALID')
  }

  const transactionId = readText(data, 'transactionId')
  const paymentId = readText(data, 'paymentId')

  if (
    !isProviderId(transactionId)
    || !isProviderId(paymentId)
    || data.status !== 'U'
    || data.paymentStatus !== 'U'
    || data.contractId !== null
    || data.tokenId !== null
    || 'dataStatus' in data
    || 'subscriptionStatus' in data
  ) {
    throw new GatewayError('SUBSCRIPTION_CREATE_RESPONSE_INVALID')
  }

  return Object.freeze({
    transactionId,
    paymentId,
    rawStatus: 'U',
    rawPaymentStatus: 'U',
  })
}

export function readQueryResponse(value: unknown, expectedPaymentId: string): QueriedPayment {
  const response = readResponse(value, 'PAYMENT_QUERY_REJECTED')
  const data = response.data
  const content = isRecord(data) ? data.content : null

  if (!Array.isArray(content)) {
    throw new GatewayError('PAYMENT_QUERY_RESPONSE_INVALID')
  }

  if (!isProviderId(expectedPaymentId)) {
    throw new GatewayError('PAYMENT_QUERY_RESPONSE_INVALID')
  }

  const record = content.find(item => isRecord(item) && item.paymentId === expectedPaymentId)

  if (!isRecord(record)) {
    throw new GatewayError('PAYMENT_QUERY_NOT_FOUND')
  }

  const rawStatus = readText(record, 'paymentStatus')
  const transactionId = readText(record, 'lastTransactionId')

  if (!rawStatus || (transactionId !== null && !isProviderId(transactionId))) {
    throw new GatewayError('PAYMENT_QUERY_RESPONSE_INVALID')
  }

  try {
    return Object.freeze({
      paymentId: expectedPaymentId,
      ...(transactionId ? { transactionId } : {}),
      rawStatus,
      status: mapQueryStatus(rawStatus),
    })
  }
  catch {
    throw new GatewayError('PAYMENT_QUERY_RESPONSE_INVALID')
  }
}

function readUsdMinor(value: string | null): number | null {
  if (!value || !/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) {
    return null
  }

  const [major = '', fraction = ''] = value.split('.')
  const minor = Number(major) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}

function readPositiveInteger(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : value

  if (typeof text !== 'string' || !/^[1-9]\d{0,8}$/.test(text)) {
    return null
  }

  const parsed = Number(text)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function readOpaqueToken(value: unknown): string | null {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= 512
    && value.length > 0
    && ![...value].some(character => {
      const code = character.codePointAt(0)!
      return code <= 31 || code === 127
    })
    ? value
    : null
}

function readSubscriptionProducts(value: unknown): readonly Record<string, unknown>[] | null {
  if (typeof value !== 'string' || value.length > 16_384) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every(isRecord) ? parsed : null
  }
  catch {
    return null
  }
}

export function readSubscriptionQueryResponse(
  value: unknown,
  expectedContractId: string,
  expectedMerchantNo: string,
): SubscriptionDetails {
  const response = readResponse(value, 'SUBSCRIPTION_QUERY_REJECTED')
  const data = response.data

  if (!isRecord(data) || data.contractId !== expectedContractId) {
    throw new GatewayError('SUBSCRIPTION_QUERY_RESPONSE_INVALID')
  }

  const merchantNo = readText(data, 'merchantNo')
  const merchantCustomerId = readText(data, 'merchantCustomerId')
  const products = readSubscriptionProducts(data.products)
  const product = products?.length === 1 ? products[0] : null
  const productName = product ? readText(product, 'name') : null
  const productAmount = product ? readUsdMinor(readText(product, 'price')) : null
  const productCurrency = product ? readText(product, 'currency') : null
  const productQuantity = product ? readPositiveInteger(product.num) : null
  const amountMinor = readUsdMinor(readText(data, 'orderAmount'))
  const currency = readText(data, 'orderCurrency')
  const frequencyType = readText(data, 'frequencyType')
  const frequencyPoint = readPositiveInteger(data.frequencyPoint)
  const expireDate = readText(data, 'expireDate')
  const dataStatus = readText(data, 'dataStatus')
  const subscriptionStatus = readText(data, 'subscriptionStatus')
  const tokenId = data.tokenId === null || data.tokenId === undefined || data.tokenId === ''
    ? undefined
    : readOpaqueToken(data.tokenId) ?? undefined

  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(expectedContractId)
    || merchantNo !== expectedMerchantNo
    || !merchantCustomerId
    || !/^[A-Za-z0-9_-]{1,63}$/.test(merchantCustomerId)
    || !productName
    || productAmount === null
    || productAmount !== amountMinor
    || productQuantity !== 1
    || productCurrency !== 'USD'
    || amountMinor === null
    || currency !== 'USD'
    || !frequencyType
    || !['D', 'M', 'Y'].includes(frequencyType)
    || frequencyPoint === null
    || !expireDate
    || !/^\d{4}-\d{2}-\d{2}$/.test(expireDate)
    || !dataStatus
    || !SUBSCRIPTION_DATA_STATUSES.includes(dataStatus as SubscriptionDataStatus)
    || !subscriptionStatus
    || !SUBSCRIPTION_STATUSES.includes(subscriptionStatus as SubscriptionStatus)
    || (data.tokenId !== null && data.tokenId !== undefined && data.tokenId !== '' && !tokenId)
  ) {
    throw new GatewayError('SUBSCRIPTION_QUERY_RESPONSE_INVALID')
  }

  const normalizedDataStatus = dataStatus as SubscriptionDataStatus
  const normalizedSubscriptionStatus = subscriptionStatus as SubscriptionStatus

  return Object.freeze({
    contractId: expectedContractId,
    merchantCustomerId,
    productName,
    amountMinor,
    currency: 'USD',
    frequencyType: frequencyType as 'D' | 'M' | 'Y',
    frequencyPoint,
    expireDate,
    dataStatus: normalizedDataStatus,
    subscriptionStatus: normalizedSubscriptionStatus,
    state: projectSubscriptionState(normalizedDataStatus, normalizedSubscriptionStatus),
    ...(tokenId ? { tokenId } : {}),
  })
}

export function readCreationQueryResponse(
  value: unknown,
  expectedMerchantTxnId: string,
  expectedAmountMinor: number,
  expectedCurrency: string,
): RecoveredPaymentCreation {
  const response = readResponse(value, 'PAYMENT_CREATION_QUERY_REJECTED')
  const data = response.data
  const content = isRecord(data) ? data.content : null

  if (!Array.isArray(content)) {
    throw new GatewayError('PAYMENT_CREATION_QUERY_RESPONSE_INVALID')
  }

  const matches = content.filter(item => isRecord(item) && item.merchantTxnId === expectedMerchantTxnId)

  if (matches.length === 0) {
    throw new GatewayError('PAYMENT_CREATION_QUERY_NOT_FOUND')
  }

  if (matches.length !== 1 || !isRecord(matches[0])) {
    throw new GatewayError('PAYMENT_CREATION_QUERY_RESPONSE_INVALID')
  }

  const record = matches[0]
  const paymentId = readText(record, 'paymentId')
  const transactionId = readText(record, 'transactionId')
  const rawStatus = readText(record, 'status')
  const amountMinor = readUsdMinor(readText(record, 'orderAmount'))
  const currency = readText(record, 'orderCurrency')
  const statuses: Readonly<Record<string, PaymentStatus>> = {
    S: 'processing',
    N: 'processing',
    R: 'requires_action',
    F: 'processing',
    P: 'processing',
    I: 'processing',
    U: 'processing',
  }

  if (
    !paymentId
    || !transactionId
    || !isProviderId(paymentId)
    || !isProviderId(transactionId)
    || !rawStatus
    || !statuses[rawStatus]
    || amountMinor !== expectedAmountMinor
    || currency !== expectedCurrency
  ) {
    throw new GatewayError('PAYMENT_CREATION_QUERY_RESPONSE_INVALID')
  }

  return Object.freeze({
    paymentId,
    transactionId,
    rawStatus,
    status: statuses[rawStatus],
  })
}

export function readPaymentMethodQueryResponse(
  value: unknown,
  expectedPaymentId: string,
  expectedTransactionId: string,
): QueriedPaymentMethod {
  const response = readResponse(value, 'PAYMENT_METHOD_QUERY_REJECTED')
  const data = response.data
  const content = isRecord(data) ? data.content : null

  if (
    !Array.isArray(content)
    || !isProviderId(expectedPaymentId)
    || !isProviderId(expectedTransactionId)
  ) {
    throw new GatewayError('PAYMENT_METHOD_QUERY_RESPONSE_INVALID')
  }

  const matches = content.filter(item =>
    isRecord(item) && item.transactionId === expectedTransactionId,
  )

  if (matches.length === 0) {
    throw new GatewayError('PAYMENT_METHOD_QUERY_NOT_FOUND')
  }

  if (matches.length !== 1 || !isRecord(matches[0])) {
    throw new GatewayError('PAYMENT_METHOD_QUERY_RESPONSE_INVALID')
  }

  const record = matches[0]
  const paymentId = readText(record, 'paymentId')
  const walletTypeName = readText(record, 'walletTypeName')
  const paymentMethod = readText(record, 'paymentMethod')
  const wallets: Readonly<Record<string, WalletPaymentMethodId>> = {
    GooglePay: 'google-pay',
    ApplePay: 'apple-pay',
  }
  const actualWallet = walletTypeName ? wallets[walletTypeName] : undefined
  const fundingNetwork = paymentMethod?.normalize('NFKC').trim().toUpperCase()

  if (
    paymentId !== expectedPaymentId
    || record.subProductType !== 'DIRECT'
    || record.txnType !== 'SALE'
    || (walletTypeName !== null && !actualWallet)
    || (fundingNetwork !== undefined && !/^[A-Z0-9][A-Z0-9 _-]{0,31}$/.test(fundingNetwork))
    || (!actualWallet && !fundingNetwork)
  ) {
    throw new GatewayError('PAYMENT_METHOD_QUERY_RESPONSE_INVALID')
  }

  return Object.freeze({
    paymentId: expectedPaymentId,
    transactionId: expectedTransactionId,
    ...(actualWallet ? { actualWallet } : {}),
    ...(fundingNetwork ? { fundingNetwork } : {}),
  })
}

async function post(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  path: string,
  payload: Payload,
  timeoutMs = 12_000,
): Promise<unknown> {
  try {
    const response = await fetch(`${profile.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(signPayload(payload, profile.secret)),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      throw new GatewayError('PAYMENT_NETWORK_ERROR')
    }

    return await response.json()
  }
  catch (error) {
    if (error instanceof GatewayError) {
      throw error
    }

    throw new GatewayError('PAYMENT_NETWORK_ERROR')
  }
}

export async function createPayment(profile: Extract<ServerProfile, { profile: 'sandbox' }>, context: CreateContext): Promise<CreatedPayment> {
  const response = await post(profile, '/v1/sdkTxn/doTransaction', buildCreatePayload(profile, context))
  return readCreateResponse(response)
}

export async function createSubscriptionPayment(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  context: SubscriptionCreateContext,
): Promise<CreatedSubscriptionPayment> {
  const response = await post(profile, '/v1/sdkTxn/doTransaction', buildSubscriptionCreatePayload(profile, context))
  return readSubscriptionCreateResponse(response)
}

export async function queryPayment(profile: Extract<ServerProfile, { profile: 'sandbox' }>, paymentId: string): Promise<QueriedPayment> {
  const response = await post(profile, '/v1/txn/queryPayments', buildQueryPayload(profile, paymentId))
  return readQueryResponse(response, paymentId)
}

export async function queryPaymentCreation(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  merchantTxnId: string,
  amountMinor: number,
  currency: string,
): Promise<RecoveredPaymentCreation> {
  const response = await post(profile, '/v1/txn/list', buildCreationQueryPayload(profile, merchantTxnId))
  return readCreationQueryResponse(response, merchantTxnId, amountMinor, currency)
}

export async function queryPaymentMethod(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  paymentId: string,
  transactionId: string,
): Promise<QueriedPaymentMethod> {
  const response = await post(
    profile,
    '/v1/txn/list',
    buildPaymentMethodQueryPayload(profile, transactionId),
    3_000,
  )
  return readPaymentMethodQueryResponse(response, paymentId, transactionId)
}

export async function querySubscription(
  profile: Extract<ServerProfile, { profile: 'sandbox' }>,
  contractId: string,
): Promise<SubscriptionDetails> {
  const response = await post(profile, '/v1/txn/sub/detail', buildSubscriptionQueryPayload(profile, contractId))
  return readSubscriptionQueryResponse(response, contractId, profile.merchantNo)
}

function tokenInput(attemptId: string, paymentId: string): string {
  return `onerway-showcase-query-v2\0${attemptId}\0${paymentId}`
}

export const QUERY_TOKEN_TTL_MS = 5 * 60_000
const QUERY_TOKEN_CLOCK_SKEW_MS = 30_000

function capabilityInput(attemptId: string, paymentId: string, expiresAt: string): string {
  return `${tokenInput(attemptId, paymentId)}\0${expiresAt}`
}

function readExpiry(expiresAt: string): number | null {
  const expires = Date.parse(expiresAt)

  return Number.isFinite(expires) && new Date(expires).toISOString() === expiresAt
    ? expires
    : null
}

export function createQueryExpiry(now = Date.now()): string {
  return new Date(now + QUERY_TOKEN_TTL_MS).toISOString()
}

export function createQueryToken(secret: string, attemptId: string, paymentId: string, expiresAt: string): string {
  return createHmac('sha256', secret)
    .update(capabilityInput(attemptId, paymentId, expiresAt), 'utf8')
    .digest('base64url')
}

export function verifyQueryToken(
  secret: string,
  attemptId: string,
  paymentId: string,
  expiresAt: string,
  token: string,
  now = Date.now(),
): boolean {
  const expires = readExpiry(expiresAt)

  if (
    expires === null
    || expires <= now
    || expires - now > QUERY_TOKEN_TTL_MS + QUERY_TOKEN_CLOCK_SKEW_MS
    || !/^[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    return false
  }

  const expected = Buffer.from(createQueryToken(secret, attemptId, paymentId, expiresAt))
  const actual = Buffer.from(token)

  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
