import { randomUUID } from 'node:crypto'
import { Pool } from '@neondatabase/serverless'
import type { PoolClient, QueryResultRow } from '@neondatabase/serverless'
import {
  createAttempt,
  getRetryDecision,
  type PaymentAttempt,
  type PaymentStatus,
} from '../../shared/payment/attempt'
import type { PaymentEvent, PaymentEventSource } from '../../shared/payment/event'
import { createEvent } from '../../shared/payment/event'
import { mergeAttempt } from '../../shared/payment/merge'
import type { Order } from '../../shared/payment/order'
import {
  isSubscriptionPlanId,
  type SubscriptionContract,
} from '../../shared/payment/subscription'
import type {
  QueriedPayment,
  QueriedPaymentMethod,
  SubscriptionDetails,
} from './gateway'
import type { PaymentWebhook, SubscriptionPaymentWebhook } from './webhook'
import {
  restoreMerchantCustomer,
  type MerchantCustomer,
} from './customer'

export const PAYMENT_RETENTION_DAYS = 30
export const PAYMENT_DATABASE_TIMEOUT_MS = 8_000

export type PaymentStoreErrorCode
  = | 'PAYMENT_DATABASE_UNAVAILABLE'
    | 'PAYMENT_DATABASE_ERROR'
    | 'PAYMENT_ATTEMPT_NOT_FOUND'
    | 'PAYMENT_ATTEMPT_MISMATCH'
    | 'PAYMENT_RETRY_NOT_ALLOWED'
    | 'PAYMENT_SUBMISSION_NOT_ALLOWED'
    | 'PAYMENT_TIMELINE_AMBIGUOUS'
    | 'PAYMENT_SUBSCRIPTION_CONFLICT'

export class PaymentStoreError extends Error {
  readonly code: PaymentStoreErrorCode

  constructor(code: PaymentStoreErrorCode) {
    super(code)
    this.name = 'PaymentStoreError'
    this.code = code
  }
}

interface AttemptRow extends QueryResultRow {
  id: string
  order_id: string
  integration: PaymentAttempt['integration']
  method: PaymentAttempt['method']
  status: PaymentStatus
  status_source: PaymentEventSource | null
  retry_of: string | null
  merchant_txn_id: string
  payment_id: string | null
  transaction_id: string | null
  actual_wallet: PaymentAttempt['actualWallet'] | null
  funding_network: string | null
  attribution_transaction_id: string | null
  submission_started_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface OrderRow extends QueryResultRow {
  id: string
  scene: Order['scene']
  item_sku: string
  item_name: string
  item_variant: string
  item_quantity: string | number
  item_unit_minor: string | number
  amount_minor: string | number
  currency: Order['amount']['currency']
  fulfillment: Order['fulfillment']
  customer_environment: MerchantCustomer['environment'] | null
  customer_merchant_no: string | null
  customer_app_id: string | null
  merchant_cust_id: string | null
  created_at: Date | string
}

interface CorrelatedAttemptRow extends AttemptRow {
  amount_minor: string | number
  currency: Order['amount']['currency']
}

interface RecoveryAttemptRow extends AttemptRow {
  chain_count: string | number
  order_count: string | number
}

interface EventRow extends QueryResultRow {
  id: string
  attempt_id: string
  source: PaymentEventSource
  source_key: string
  status: PaymentStatus
  raw_status: string | null
  transaction_id: string | null
  transaction_status: string | null
  payment_status: string | null
  conflict: boolean
  occurred_at: Date | string
}

interface SubscriptionRow extends QueryResultRow {
  id: string
  environment: MerchantCustomer['environment']
  merchant_no: string
  app_id: string
  merchant_cust_id: string
  plan_id: string
  plan_version: string | number
  product_name: string
  initial_amount_minor: string | number
  currency: Order['amount']['currency']
  frequency_type: SubscriptionContract['frequencyType']
  frequency_point: string | number
  expire_date: Date | string
  initial_order_id: string
  initial_attempt_id: string
  merchant_txn_id: string
  payment_id: string | null
  initial_webhook_transaction_id: string | null
  establishment_state: SubscriptionContract['state']
  status_source: SubscriptionContract['statusSource']
  data_status: SubscriptionContract['dataStatus']
  subscription_status: SubscriptionContract['subscriptionStatus']
  contract_id: string | null
  token_id: string | null
  terminal_at: Date | string | null
  cleanup_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}

export interface PaymentTimeline {
  readonly attempt: PaymentAttempt
  readonly events: readonly PaymentEvent[]
}

export interface PaymentRecovery extends PaymentTimeline {
  readonly order: Order
  readonly customer: MerchantCustomer | null
  readonly attempts: readonly PaymentAttempt[]
  readonly subscription: SubscriptionContract | null
}

export interface RetainedSubscriptionRecovery {
  readonly contract: SubscriptionContract
  readonly customer: MerchantCustomer
  readonly orderId: string
  readonly attemptId: string
  readonly paymentId: string | null
}

export type SubscriptionPaymentRecord
  = | { readonly created: true, readonly contract: SubscriptionContract }
    | {
      readonly created: false
      readonly contract: SubscriptionContract
      readonly orderId: string
      readonly attemptId: string
    }

export interface PaymentRetry {
  readonly attempt: PaymentAttempt
  readonly create: boolean
  readonly created: boolean
}

export type PaymentCreationClaim
  = | { readonly outcome: 'claimed' }
    | { readonly outcome: 'existing' }
    | { readonly outcome: 'retry_rejected', readonly parentId: string }

export function paymentRetryRejectionKey(attemptId: string): string {
  return `retry-create-rejected:${attemptId}`
}

export function subscriptionCreationRejectionKey(attemptId: string): string {
  return `subscription-create-contract-rejected:${attemptId}`
}

export function subscriptionCreationRecoveryAllowedKey(attemptId: string): string {
  return `subscription-create-recovery-allowed:${attemptId}`
}

export function subscriptionScopeLockKey(
  customer: MerchantCustomer,
  planId: string,
): string {
  return JSON.stringify([
    customer.environment,
    customer.merchantNo,
    customer.appId,
    customer.merchantCustId,
    planId,
  ])
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim()

  if (!value) {
    throw new PaymentStoreError('PAYMENT_DATABASE_UNAVAILABLE')
  }

  return value
}

let pool: Pool | null = null

function paymentPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      connectionTimeoutMillis: PAYMENT_DATABASE_TIMEOUT_MS,
      query_timeout: PAYMENT_DATABASE_TIMEOUT_MS,
      idle_in_transaction_session_timeout: PAYMENT_DATABASE_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: true,
      max: 4,
    })
    pool.on('error', () => {})
  }

  return pool
}

async function transaction<T>(task: (client: PoolClient) => Promise<T>): Promise<T> {
  const activePool = paymentPool()
  let client: PoolClient | undefined
  let begun = false
  let discard = false

  try {
    client = await activePool.connect()
    await client.query('BEGIN')
    begun = true
    await client.query(`SET LOCAL statement_timeout = '${PAYMENT_DATABASE_TIMEOUT_MS}ms'`)
    const result = await task(client)
    await client.query('COMMIT')
    return result
  }
  catch (error) {
    discard = !(error instanceof PaymentStoreError)

    if (begun && client) {
      await client.query('ROLLBACK').catch(() => {})
    }

    if (error instanceof PaymentStoreError) {
      throw error
    }

    throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
  }
  finally {
    client?.release(discard)
  }
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)

  if (!Number.isFinite(date.getTime())) {
    throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
  }

  return date.toISOString()
}

function attemptFromRow(row: AttemptRow): PaymentAttempt {
  return Object.freeze({
    id: row.id,
    orderId: row.order_id,
    integration: row.integration,
    method: row.method,
    status: row.status,
    ...(row.status_source ? { statusSource: row.status_source } : {}),
    ...(row.retry_of ? { retryOf: row.retry_of } : {}),
    merchantTxnId: row.merchant_txn_id,
    ...(row.payment_id ? { paymentId: row.payment_id } : {}),
    ...(row.transaction_id ? { transactionId: row.transaction_id } : {}),
    ...(row.actual_wallet ? { actualWallet: row.actual_wallet } : {}),
    ...(row.funding_network ? { fundingNetwork: row.funding_network } : {}),
    ...(row.attribution_transaction_id ? { attributionTransactionId: row.attribution_transaction_id } : {}),
    ...(row.submission_started_at ? { submissionStartedAt: iso(row.submission_started_at) } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  })
}

function integer(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value)

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
  }

  return parsed
}

function positiveInteger(value: string | number): number {
  const parsed = integer(value)

  if (parsed < 1) {
    throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
  }

  return parsed
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  const parsed = new Date(value)

  if (!Number.isFinite(parsed.getTime())) {
    throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
  }

  return parsed.toISOString().slice(0, 10)
}

function orderFromRow(row: OrderRow): Order {
  return Object.freeze({
    id: row.id,
    scene: row.scene,
    item: Object.freeze({
      sku: row.item_sku,
      name: row.item_name,
      variant: row.item_variant,
      quantity: integer(row.item_quantity),
      unitAmount: Object.freeze({
        minor: integer(row.item_unit_minor),
        currency: row.currency,
      }),
    }),
    amount: Object.freeze({
      minor: integer(row.amount_minor),
      currency: row.currency,
    }),
    fulfillment: row.fulfillment,
    createdAt: iso(row.created_at),
  })
}

function customerFromRow(row: OrderRow): MerchantCustomer | null {
  const values = [
    row.customer_environment,
    row.customer_merchant_no,
    row.customer_app_id,
    row.merchant_cust_id,
  ]

  if (values.every(value => value === null)) {
    return null
  }

  if (values.some(value => value === null)) {
    throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
  }

  try {
    return restoreMerchantCustomer({
      environment: row.customer_environment!,
      merchantNo: row.customer_merchant_no!,
      appId: row.customer_app_id!,
      merchantCustId: row.merchant_cust_id!,
    })
  }
  catch {
    throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
  }
}

function subscriptionFromRow(row: SubscriptionRow): SubscriptionContract {
  if (!isSubscriptionPlanId(row.plan_id)) {
    throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
  }

  return Object.freeze({
    id: row.id,
    planId: row.plan_id,
    planVersion: positiveInteger(row.plan_version),
    productName: row.product_name,
    amount: Object.freeze({
      minor: integer(row.initial_amount_minor),
      currency: row.currency,
    }),
    frequencyType: row.frequency_type,
    frequencyPoint: positiveInteger(row.frequency_point),
    expireDate: dateOnly(row.expire_date),
    initialOrderId: row.initial_order_id,
    initialAttemptId: row.initial_attempt_id,
    state: row.establishment_state,
    statusSource: row.status_source,
    dataStatus: row.data_status,
    subscriptionStatus: row.subscription_status,
    ...(row.contract_id ? { contractId: row.contract_id } : {}),
    ...(row.token_id ? { tokenId: row.token_id } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.terminal_at ? { terminalAt: iso(row.terminal_at) } : {}),
  })
}

function eventFromRow(row: EventRow): PaymentEvent {
  return createEvent({
    id: row.id,
    attemptId: row.attempt_id,
    source: row.source,
    sourceKey: row.source_key,
    status: row.status,
    ...(row.raw_status ? { rawStatus: row.raw_status } : {}),
    ...(row.transaction_id ? { transactionId: row.transaction_id } : {}),
    ...(row.transaction_status ? { transactionStatus: row.transaction_status } : {}),
    ...(row.payment_status ? { paymentStatus: row.payment_status } : {}),
    ...(row.conflict ? { conflict: true } : {}),
    occurredAt: iso(row.occurred_at),
  })
}

export async function checkPaymentDatabase(): Promise<void> {
  await transaction(async (client) => {
    const result = await client.query<{ ready: number }>('SELECT 1 AS ready')

    if (result.rows[0]?.ready !== 1) {
      throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
    }
  })
}

async function findEvent(
  client: PoolClient,
  source: PaymentEventSource,
  sourceKey: string,
): Promise<PaymentEvent | null> {
  const result = await client.query<EventRow>(`
    SELECT id, attempt_id, source, source_key, status, raw_status,
           transaction_id, transaction_status, payment_status, conflict, occurred_at
    FROM payment_events
    WHERE source = $1 AND source_key = $2
  `, [source, sourceKey])

  return result.rows[0] ? eventFromRow(result.rows[0]) : null
}

async function insertEvent(client: PoolClient, event: PaymentEvent): Promise<void> {
  if (!event.sourceKey) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }

  await client.query(`
    INSERT INTO payment_events (
      id, attempt_id, source, source_key, status, raw_status,
      transaction_id, transaction_status, payment_status, conflict, occurred_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `, [
    event.id,
    event.attemptId,
    event.source,
    event.sourceKey,
    event.status,
    event.rawStatus ?? null,
    event.transactionId ?? null,
    event.transactionStatus ?? null,
    event.paymentStatus ?? null,
    event.conflict ?? false,
    event.occurredAt,
  ])
}

async function updateAttempt(client: PoolClient, attempt: PaymentAttempt): Promise<void> {
  await client.query(`
    UPDATE payment_attempts
    SET status = $2,
        status_source = $3,
        payment_id = COALESCE($4, payment_id),
        transaction_id = COALESCE($5, transaction_id),
        actual_wallet = $6,
        funding_network = $7,
        attribution_transaction_id = $8,
        updated_at = $9
    WHERE id = $1
  `, [
    attempt.id,
    attempt.status,
    attempt.statusSource ?? null,
    attempt.paymentId ?? null,
    attempt.transactionId ?? null,
    attempt.actualWallet ?? null,
    attempt.fundingNetwork ?? null,
    attempt.attributionTransactionId ?? null,
    attempt.updatedAt,
  ])
}

async function insertAttempt(client: PoolClient, attempt: PaymentAttempt): Promise<void> {
  if (
    !attempt.merchantTxnId
    || attempt.paymentId
    || attempt.transactionId
    || attempt.actualWallet
    || attempt.fundingNetwork
    || attempt.attributionTransactionId
    || attempt.submissionStartedAt
    || attempt.status !== 'created'
  ) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }

  await client.query(`
    INSERT INTO payment_attempts (
      id, order_id, integration, method, status, status_source, retry_of,
      merchant_txn_id, payment_id, transaction_id, submission_started_at,
      created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, NULL, NULL, NULL, $8, $8)
  `, [
    attempt.id,
    attempt.orderId,
    attempt.integration,
    attempt.method,
    attempt.status,
    attempt.retryOf ?? null,
    attempt.merchantTxnId,
    attempt.createdAt,
  ])
}

async function insertOrder(
  client: PoolClient,
  order: Order,
  customer: MerchantCustomer,
): Promise<void> {
  await client.query(`
    INSERT INTO payment_orders (
      id, scene, item_sku, item_name, item_variant, item_quantity,
      item_unit_minor, amount_minor, currency, fulfillment,
      customer_environment, customer_merchant_no, customer_app_id, merchant_cust_id,
      created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
  `, [
    order.id,
    order.scene,
    order.item.sku,
    order.item.name,
    order.item.variant,
    order.item.quantity,
    order.item.unitAmount.minor,
    order.amount.minor,
    order.amount.currency,
    order.fulfillment,
    customer.environment,
    customer.merchantNo,
    customer.appId,
    customer.merchantCustId,
    order.createdAt,
  ])
}

async function insertSubscription(
  client: PoolClient,
  contract: SubscriptionContract,
  customer: MerchantCustomer,
  merchantTxnId: string,
): Promise<void> {
  if (
    contract.state !== 'pending'
    || contract.statusSource !== 'placeholder'
    || contract.dataStatus !== '0'
    || contract.subscriptionStatus !== 'paymentdue'
    || contract.contractId
    || contract.tokenId
    || contract.terminalAt
  ) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }

  await client.query(`
    INSERT INTO subscription_contracts (
      id, environment, merchant_no, app_id, merchant_cust_id,
      plan_id, plan_version, product_name, initial_amount_minor, currency,
      frequency_type, frequency_point, expire_date,
      initial_order_id, initial_attempt_id, merchant_txn_id,
      payment_id, initial_webhook_transaction_id,
      establishment_state, status_source, status_observed_at,
      data_status, subscription_status, contract_id, token_id,
      terminal_at, cleanup_at, created_at, updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13,
      $14, $15, $16,
      NULL, NULL,
      $17, $18, $19,
      $20, $21, NULL, NULL,
      NULL, NULL, $19, $19
    )
  `, [
    contract.id,
    customer.environment,
    customer.merchantNo,
    customer.appId,
    customer.merchantCustId,
    contract.planId,
    contract.planVersion,
    contract.productName,
    contract.amount.minor,
    contract.amount.currency,
    contract.frequencyType,
    contract.frequencyPoint,
    contract.expireDate,
    contract.initialOrderId,
    contract.initialAttemptId,
    merchantTxnId,
    contract.state,
    contract.statusSource,
    contract.createdAt,
    contract.dataStatus,
    contract.subscriptionStatus,
  ])
}

export async function createPaymentRecord(
  order: Order,
  attempt: PaymentAttempt,
  customer: MerchantCustomer,
): Promise<void> {
  if (!attempt.merchantTxnId) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }

  await transaction(async (client) => {
    await insertOrder(client, order, customer)
    await insertAttempt(client, attempt)
  })
}

export async function createSubscriptionPaymentRecord(
  order: Order,
  attempt: PaymentAttempt,
  customer: MerchantCustomer,
  contract: SubscriptionContract,
): Promise<SubscriptionPaymentRecord> {
  if (
    attempt.orderId !== order.id
    || contract.initialOrderId !== order.id
    || contract.initialAttemptId !== attempt.id
    || contract.amount.minor !== order.amount.minor
    || contract.amount.currency !== order.amount.currency
  ) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }

  return transaction(async (client) => {
    const scopeKey = subscriptionScopeLockKey(customer, contract.planId)

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))',
      [scopeKey],
    )

    const existing = await client.query<SubscriptionRow>(`
      SELECT *
      FROM subscription_contracts
      WHERE environment = $1
        AND merchant_no = $2
        AND app_id = $3
        AND merchant_cust_id = $4
        AND plan_id = $5
        AND terminal_at IS NULL
      LIMIT 2
      FOR UPDATE
    `, [
      customer.environment,
      customer.merchantNo,
      customer.appId,
      customer.merchantCustId,
      contract.planId,
    ])

    if (existing.rows.length > 1) {
      throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
    }

    if (existing.rows[0]) {
      const active = subscriptionFromRow(existing.rows[0])
      return Object.freeze({
        created: false as const,
        contract: active,
        orderId: active.initialOrderId,
        attemptId: active.initialAttemptId,
      })
    }

    await insertOrder(client, order, customer)
    await insertAttempt(client, attempt)
    await insertSubscription(client, contract, customer, attempt.merchantTxnId!)

    return Object.freeze({ created: true as const, contract })
  })
}

export async function ensurePaymentCustomer(
  orderId: string,
  proposed: MerchantCustomer,
): Promise<MerchantCustomer> {
  return transaction(async (client) => {
    const found = await client.query<OrderRow>(`
      SELECT id, scene, item_sku, item_name, item_variant, item_quantity,
             item_unit_minor, amount_minor, currency, fulfillment,
             customer_environment, customer_merchant_no, customer_app_id, merchant_cust_id,
             created_at
      FROM payment_orders
      WHERE id = $1
      FOR UPDATE
    `, [orderId])
    const order = found.rows[0]

    if (!order) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    const existing = customerFromRow(order)

    if (existing) {
      return existing
    }

    const updated = await client.query<OrderRow>(`
      UPDATE payment_orders
      SET customer_environment = $2,
          customer_merchant_no = $3,
          customer_app_id = $4,
          merchant_cust_id = $5,
          updated_at = GREATEST(updated_at, now())
      WHERE id = $1
      RETURNING id, scene, item_sku, item_name, item_variant, item_quantity,
                item_unit_minor, amount_minor, currency, fulfillment,
                customer_environment, customer_merchant_no, customer_app_id, merchant_cust_id,
                created_at
    `, [
      orderId,
      proposed.environment,
      proposed.merchantNo,
      proposed.appId,
      proposed.merchantCustId,
    ])

    return customerFromRow(updated.rows[0]!)!
  })
}

export async function claimPaymentSubmission(
  attemptId: string,
  paymentId: string,
): Promise<{ readonly attempt: PaymentAttempt, readonly claimed: boolean }> {
  return transaction(async (client) => {
    const found = await client.query<AttemptRow>(`
      SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE
    `, [attemptId])
    const row = found.rows[0]

    if (!row) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    if (
      row.payment_id !== paymentId
      || row.status !== 'processing'
    ) {
      throw new PaymentStoreError('PAYMENT_SUBMISSION_NOT_ALLOWED')
    }

    if (row.submission_started_at) {
      return Object.freeze({ attempt: attemptFromRow(row), claimed: false })
    }

    const updated = await client.query<AttemptRow>(`
      UPDATE payment_attempts
      SET submission_started_at = now(),
          updated_at = GREATEST(updated_at, now())
      WHERE id = $1
      RETURNING *
    `, [attemptId])

    return Object.freeze({ attempt: attemptFromRow(updated.rows[0]!), claimed: true })
  })
}

export async function createPaymentRetry(
  orderId: string,
  attemptId: string,
  paymentId: string,
  occurredAt: string,
): Promise<PaymentRetry> {
  return transaction(async (client) => {
    const found = await client.query<AttemptRow>(`
      SELECT *
      FROM payment_attempts
      WHERE id = $1 AND order_id = $2
      FOR UPDATE
    `, [attemptId, orderId])
    const row = found.rows[0]

    if (!row) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    if (row.payment_id !== paymentId) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const subscription = await client.query<{ id: string }>(`
      SELECT id
      FROM subscription_contracts
      WHERE initial_attempt_id = $1
      LIMIT 1
    `, [attemptId])

    if (subscription.rows[0]) {
      throw new PaymentStoreError('PAYMENT_RETRY_NOT_ALLOWED')
    }

    const previous = attemptFromRow(row)
    const decision = getRetryDecision(previous)

    const existing = await client.query<AttemptRow>(`
      SELECT *
      FROM payment_attempts
      WHERE retry_of = $1
      LIMIT 1
    `, [attemptId])

    if (existing.rows[0]) {
      const child = attemptFromRow(existing.rows[0])

      if (
        child.orderId !== orderId
        || child.retryOf !== attemptId
        || child.integration !== previous.integration
        || child.method !== previous.method
      ) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      if (await findEvent(client, 'server', paymentRetryRejectionKey(child.id))) {
        throw new PaymentStoreError('PAYMENT_RETRY_NOT_ALLOWED')
      }

      const claimed = Boolean(child.paymentId) || Boolean(await findEvent(
        client,
        'server',
        `create-claim:${child.id}`,
      ))

      if (!decision.allowed && !claimed) {
        throw new PaymentStoreError('PAYMENT_RETRY_NOT_ALLOWED')
      }

      return Object.freeze({
        attempt: child,
        create: !claimed,
        created: false,
      })
    }

    if (!decision.allowed) {
      throw new PaymentStoreError('PAYMENT_RETRY_NOT_ALLOWED')
    }

    const attempt = createAttempt({
      id: `${orderId}-attempt-${randomUUID().slice(0, 8).toUpperCase()}`,
      orderId,
      integration: previous.integration,
      method: previous.method,
      retryOf: attemptId,
      merchantTxnId: `showcase-${randomUUID()}`,
      createdAt: occurredAt,
    })

    await insertAttempt(client, attempt)
    return Object.freeze({ attempt, create: true, created: true })
  })
}

export async function claimPaymentCreation(
  attemptId: string,
  event: PaymentEvent,
): Promise<PaymentCreationClaim> {
  const sourceKey = event.sourceKey

  if (
    event.attemptId !== attemptId
    || event.source !== 'server'
    || event.status !== 'created'
    || !sourceKey
  ) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }

  return transaction(async (client) => {
    const found = await client.query<AttemptRow>(`
      SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE
    `, [attemptId])
    const row = found.rows[0]

    if (!row) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    const rejectionKey = paymentRetryRejectionKey(attemptId)
    const rejected = await findEvent(client, 'server', rejectionKey)

    if (rejected) {
      if (!row.retry_of) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      return Object.freeze({ outcome: 'retry_rejected', parentId: row.retry_of })
    }

    if (row.payment_id || await findEvent(client, event.source, sourceKey)) {
      return Object.freeze({ outcome: 'existing' })
    }

    if (row.retry_of) {
      const parents = await client.query<AttemptRow>(`
        SELECT *
        FROM payment_attempts
        WHERE id = $1 AND order_id = $2
        FOR UPDATE
      `, [row.retry_of, row.order_id])
      const parent = parents.rows[0]

      if (
        !parent
        || parent.integration !== row.integration
        || parent.method !== row.method
      ) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      if (!getRetryDecision(attemptFromRow(parent)).allowed) {
        await insertEvent(client, createEvent({
          id: randomUUID(),
          attemptId,
          source: 'server',
          sourceKey: rejectionKey,
          status: 'created',
          occurredAt: event.occurredAt,
        }))
        return Object.freeze({ outcome: 'retry_rejected', parentId: parent.id })
      }
    }

    await insertEvent(client, event)
    return Object.freeze({ outcome: 'claimed' })
  })
}

export async function recordSubscriptionCreationRejection(
  attemptId: string,
  occurredAt: string,
): Promise<void> {
  return transaction(async (client) => {
    const attempts = await client.query<AttemptRow>(`
      SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE
    `, [attemptId])
    const attempt = attempts.rows[0]
    const contracts = await client.query<{ id: string }>(`
      SELECT id
      FROM subscription_contracts
      WHERE initial_attempt_id = $1
      FOR UPDATE
    `, [attemptId])

    if (!attempt || !contracts.rows[0]) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    const sourceKey = subscriptionCreationRejectionKey(attemptId)

    if (await findEvent(client, 'server', sourceKey)) {
      return
    }

    await insertEvent(client, createEvent({
      id: randomUUID(),
      attemptId,
      source: 'server',
      sourceKey,
      status: 'created',
      occurredAt,
    }))
  })
}

export async function recordSubscriptionCreationRecoveryAllowed(
  attemptId: string,
  occurredAt: string,
): Promise<void> {
  return transaction(async (client) => {
    const attempts = await client.query<AttemptRow>(`
      SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE
    `, [attemptId])
    const attempt = attempts.rows[0]
    const contracts = await client.query<{ id: string }>(`
      SELECT id
      FROM subscription_contracts
      WHERE initial_attempt_id = $1
      FOR UPDATE
    `, [attemptId])

    if (!attempt || !contracts.rows[0]) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    const sourceKey = subscriptionCreationRecoveryAllowedKey(attemptId)

    if (await findEvent(client, 'server', sourceKey)) {
      return
    }

    await insertEvent(client, createEvent({
      id: randomUUID(),
      attemptId,
      source: 'server',
      sourceKey,
      status: 'created',
      occurredAt,
    }))
  })
}

export async function completePaymentRecord(
  attemptId: string,
  paymentId: string,
  transactionId: string,
  event: PaymentEvent,
): Promise<PaymentAttempt> {
  const sourceKey = event.sourceKey

  if (
    event.attemptId !== attemptId
    || !sourceKey
    || !['server', 'query'].includes(event.source)
  ) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }

  return transaction(async (client) => {
    const result = await client.query<AttemptRow>(`
      SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE
    `, [attemptId])
    const row = result.rows[0]

    if (!row) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    const current = attemptFromRow(row)

    if (current.paymentId && current.paymentId !== paymentId) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const contracts = await client.query<SubscriptionRow>(`
      SELECT *
      FROM subscription_contracts
      WHERE initial_attempt_id = $1
      FOR UPDATE
    `, [attemptId])
    const contract = contracts.rows[0]

    if (contract?.payment_id && contract.payment_id !== paymentId) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const duplicate = await findEvent(client, event.source, sourceKey)

    if (duplicate) {
      if (duplicate.attemptId !== attemptId) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      return current
    }

    const correlated = Object.freeze({
      ...current,
      paymentId,
      transactionId: current.transactionId ?? transactionId,
    })
    const merged = mergeAttempt(correlated, event)

    if (merged.attempt !== current) {
      await updateAttempt(client, merged.attempt)
    }

    if (contract && !contract.payment_id) {
      await client.query(`
        UPDATE subscription_contracts
        SET payment_id = $2,
            updated_at = GREATEST(updated_at, $3::timestamptz)
        WHERE id = $1
      `, [contract.id, paymentId, event.occurredAt])
    }

    await insertEvent(client, event)
    return merged.attempt
  })
}

export async function recordQueryEvent(
  attemptId: string,
  paymentId: string,
  result: QueriedPayment,
  occurredAt: string,
): Promise<{ readonly attempt: PaymentAttempt, readonly event: PaymentEvent, readonly duplicate: boolean }> {
  return transaction(async (client) => {
    const found = await client.query<AttemptRow>(`
      SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE
    `, [attemptId])
    const row = found.rows[0]

    if (!row) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    const current = attemptFromRow(row)

    if (current.paymentId !== paymentId || result.paymentId !== paymentId) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const sourceKey = `${paymentId}:${result.transactionId ?? '-'}:${result.rawStatus}`
    const duplicate = await findEvent(client, 'query', sourceKey)

    if (duplicate) {
      return Object.freeze({ attempt: current, event: duplicate, duplicate: true })
    }

    const incoming = createEvent({
      id: randomUUID(),
      attemptId,
      source: 'query',
      sourceKey,
      status: result.status,
      rawStatus: result.rawStatus,
      paymentStatus: result.rawStatus,
      ...(result.transactionId ? { transactionId: result.transactionId } : {}),
      occurredAt,
    })
    const merged = mergeAttempt(current, incoming)
    const event = createEvent({ ...incoming, ...(merged.conflict ? { conflict: true } : {}) })

    await insertEvent(client, event)

    if (merged.attempt !== current) {
      await updateAttempt(client, merged.attempt)
    }

    if (merged.attempt.status === 'cancelled') {
      await terminalizeSubscriptionPlaceholder(client, attemptId, occurredAt, 'query')
    }

    return Object.freeze({ attempt: merged.attempt, event, duplicate: false })
  })
}

export async function recordPaymentMethodDetails(
  attemptId: string,
  paymentId: string,
  details: QueriedPaymentMethod,
  occurredAt: string,
): Promise<PaymentAttempt> {
  return transaction(async (client) => {
    const found = await client.query<AttemptRow>(`
      SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE
    `, [attemptId])
    const row = found.rows[0]

    if (!row) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    const current = attemptFromRow(row)

    if (
      current.paymentId !== paymentId
      || details.paymentId !== paymentId
      || current.transactionId !== details.transactionId
    ) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const sameAttribution = current.attributionTransactionId === details.transactionId

    if (
      sameAttribution
      && (
        (current.actualWallet && details.actualWallet && current.actualWallet !== details.actualWallet)
        || (current.fundingNetwork && details.fundingNetwork && current.fundingNetwork !== details.fundingNetwork)
      )
    ) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const actualWallet = sameAttribution
      ? current.actualWallet ?? details.actualWallet
      : details.actualWallet
    const fundingNetwork = sameAttribution
      ? current.fundingNetwork ?? details.fundingNetwork
      : details.fundingNetwork

    if (
      sameAttribution
      &&
      actualWallet === current.actualWallet
      && fundingNetwork === current.fundingNetwork
    ) {
      return current
    }

    const enriched = Object.freeze({
      ...current,
      actualWallet,
      fundingNetwork,
      attributionTransactionId: details.transactionId,
      updatedAt: Date.parse(current.updatedAt) >= Date.parse(occurredAt)
        ? current.updatedAt
        : occurredAt,
    })

    await updateAttempt(client, enriched)
    return enriched
  })
}

export async function recordReturnEvent(
  attemptId: string,
  occurredAt: string,
): Promise<{ readonly event: PaymentEvent, readonly duplicate: boolean }> {
  return transaction(async (client) => {
    const found = await client.query<AttemptRow>(`
      SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE
    `, [attemptId])
    const row = found.rows[0]

    if (!row) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    const sourceKey = attemptId
    const duplicate = await findEvent(client, 'return', sourceKey)

    if (duplicate) {
      if (duplicate.attemptId !== attemptId) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      return Object.freeze({ event: duplicate, duplicate: true })
    }

    const event = createEvent({
      id: randomUUID(),
      attemptId,
      source: 'return',
      sourceKey,
      status: 'processing',
      occurredAt,
    })

    await insertEvent(client, event)
    return Object.freeze({ event, duplicate: false })
  })
}

function subscriptionCleanupAt(terminalAt: string): string {
  const parsed = Date.parse(terminalAt)

  if (!Number.isFinite(parsed)) {
    throw new PaymentStoreError('PAYMENT_DATABASE_ERROR')
  }

  return new Date(parsed + PAYMENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString()
}

async function terminalizeSubscriptionPlaceholder(
  client: PoolClient,
  attemptId: string,
  occurredAt: string,
  source: Extract<SubscriptionContract['statusSource'], 'query' | 'webhook'>,
): Promise<void> {
  await client.query(`
    UPDATE subscription_contracts
    SET establishment_state = 'terminal',
        status_source = $4,
        status_observed_at = $2,
        token_id = NULL,
        terminal_at = COALESCE(terminal_at, $2),
        cleanup_at = COALESCE(cleanup_at, $3),
        updated_at = GREATEST(updated_at, $2::timestamptz)
    WHERE initial_attempt_id = $1
      AND contract_id IS NULL
      AND terminal_at IS NULL
  `, [attemptId, occurredAt, subscriptionCleanupAt(occurredAt), source])
}

function assertSubscriptionDetails(
  row: SubscriptionRow,
  details: SubscriptionDetails,
): void {
  if (
    (row.contract_id && row.contract_id !== details.contractId)
    || row.merchant_cust_id !== details.merchantCustomerId
    || row.product_name !== details.productName
    || Number(row.initial_amount_minor) !== details.amountMinor
    || row.currency !== details.currency
    || row.frequency_type !== details.frequencyType
    || Number(row.frequency_point) !== details.frequencyPoint
    || dateOnly(row.expire_date) !== details.expireDate
    || (row.token_id && details.tokenId && row.token_id !== details.tokenId)
  ) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }
}

async function applySubscriptionDetails(
  client: PoolClient,
  row: SubscriptionRow,
  details: SubscriptionDetails,
  source: Extract<SubscriptionContract['statusSource'], 'query' | 'webhook'>,
  observedAt: string,
): Promise<SubscriptionContract> {
  assertSubscriptionDetails(row, details)

  const current = subscriptionFromRow(row)

  if (current.state === 'terminal') {
    if (details.state !== 'terminal') {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    return current
  }

  const terminalAt = details.state === 'terminal' ? observedAt : null
  const cleanupAt = terminalAt ? subscriptionCleanupAt(terminalAt) : null
  const tokenId = details.state === 'terminal'
    ? null
    : details.tokenId ?? current.tokenId ?? null
  const updated = await client.query<SubscriptionRow>(`
    UPDATE subscription_contracts
    SET establishment_state = $2,
        status_source = $3,
        status_observed_at = $4,
        data_status = $5,
        subscription_status = $6,
        contract_id = COALESCE(contract_id, $7),
        token_id = $8,
        terminal_at = $9,
        cleanup_at = $10,
        updated_at = GREATEST(updated_at, $4::timestamptz)
    WHERE id = $1
    RETURNING *
  `, [
    current.id,
    details.state,
    source,
    observedAt,
    details.dataStatus,
    details.subscriptionStatus,
    details.contractId,
    tokenId,
    terminalAt,
    cleanupAt,
  ])

  return subscriptionFromRow(updated.rows[0]!)
}

export async function getSubscriptionForAttempt(
  attemptId: string,
): Promise<SubscriptionContract | null> {
  return transaction(async (client) => {
    const found = await client.query<SubscriptionRow>(`
      SELECT *
      FROM subscription_contracts
      WHERE initial_attempt_id = $1
    `, [attemptId])

    return found.rows[0] ? subscriptionFromRow(found.rows[0]) : null
  })
}

export async function getRetainedSubscriptionRecovery(
  orderId: string,
  attemptId: string,
): Promise<RetainedSubscriptionRecovery | null> {
  return transaction(async (client) => {
    const found = await client.query<SubscriptionRow>(`
      SELECT *
      FROM subscription_contracts
      WHERE initial_order_id = $1 AND initial_attempt_id = $2
      LIMIT 2
    `, [orderId, attemptId])

    if (found.rows.length > 1) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const row = found.rows[0]

    if (!row) {
      return null
    }

    return Object.freeze({
      contract: subscriptionFromRow(row),
      customer: restoreMerchantCustomer({
        environment: row.environment,
        merchantNo: row.merchant_no,
        appId: row.app_id,
        merchantCustId: row.merchant_cust_id,
      }),
      orderId: row.initial_order_id,
      attemptId: row.initial_attempt_id,
      paymentId: row.payment_id,
    })
  })
}

export async function recordSubscriptionQueryDetails(
  attemptId: string,
  details: SubscriptionDetails,
  observedAt: string,
): Promise<SubscriptionContract> {
  return transaction(async (client) => {
    const found = await client.query<SubscriptionRow>(`
      SELECT *
      FROM subscription_contracts
      WHERE initial_attempt_id = $1
      FOR UPDATE
    `, [attemptId])
    const row = found.rows[0]

    if (!row) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    return applySubscriptionDetails(client, row, details, 'query', observedAt)
  })
}

export async function recordWebhookEvent(
  fact: PaymentWebhook,
): Promise<{ readonly attempt: PaymentAttempt, readonly event: PaymentEvent, readonly duplicate: boolean }> {
  return transaction(async (client) => {
    const found = await client.query<CorrelatedAttemptRow>(`
      SELECT a.*, o.amount_minor, o.currency
      FROM payment_attempts a
      JOIN payment_orders o ON o.id = a.order_id
      WHERE a.merchant_txn_id = $1
      FOR UPDATE OF a
    `, [fact.merchantTxnId])
    const row = found.rows[0]

    if (!row) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    const current = attemptFromRow(row)

    if (
      Number(row.amount_minor) !== fact.amountMinor
      || row.currency !== fact.currency
      || !fact.paymentId
      || (current.paymentId && current.paymentId !== fact.paymentId)
    ) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const duplicate = await findEvent(client, 'webhook', fact.transactionId)

    if (duplicate) {
      if (duplicate.attemptId !== current.id) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      return Object.freeze({ attempt: current, event: duplicate, duplicate: true })
    }

    const correlated = fact.paymentId && !current.paymentId
      ? Object.freeze({ ...current, paymentId: fact.paymentId })
      : current
    const incoming = createEvent({
      id: randomUUID(),
      attemptId: current.id,
      source: 'webhook',
      sourceKey: fact.transactionId,
      status: fact.status,
      rawStatus: fact.paymentStatus ?? fact.transactionStatus,
      transactionId: fact.transactionId,
      transactionStatus: fact.transactionStatus,
      ...(fact.paymentStatus ? { paymentStatus: fact.paymentStatus } : {}),
      occurredAt: fact.occurredAt,
    })
    const merged = mergeAttempt(correlated, incoming)
    const event = createEvent({ ...incoming, ...(merged.conflict ? { conflict: true } : {}) })

    await insertEvent(client, event)

    if (merged.attempt !== current) {
      await updateAttempt(client, merged.attempt)
    }

    return Object.freeze({ attempt: merged.attempt, event, duplicate: false })
  })
}

function assertSubscriptionWebhookCorrelation(
  row: SubscriptionRow,
  fact: SubscriptionPaymentWebhook,
): void {
  if (
    row.merchant_txn_id !== fact.merchantTxnId
    || (row.payment_id && row.payment_id !== fact.paymentId)
    || Number(row.initial_amount_minor) !== fact.amountMinor
    || row.currency !== fact.currency
    || row.product_name !== fact.productName
    || Number(row.initial_amount_minor) !== fact.productAmountMinor
    || row.currency !== fact.productCurrency
    || (row.contract_id && row.contract_id !== fact.contractId)
  ) {
    throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
  }
}

function isTerminalSubscriptionPlaceholderFact(
  fact: SubscriptionPaymentWebhook,
): boolean {
  return fact.subscriptionState === 'terminal'
    || fact.status === 'cancelled'
    || (fact.transactionStatus === 'F' && fact.paymentStatus === undefined)
}

export async function isSubscriptionWebhookProcessed(
  fact: SubscriptionPaymentWebhook,
): Promise<boolean> {
  return transaction(async (client) => {
    const found = await client.query<SubscriptionRow>(`
      SELECT *
      FROM subscription_contracts
      WHERE initial_webhook_transaction_id = $1
    `, [fact.transactionId])
    const row = found.rows[0]

    if (!row) {
      return false
    }

    assertSubscriptionWebhookCorrelation(row, fact)
    return true
  })
}

export async function recordSubscriptionWebhookEvent(
  fact: SubscriptionPaymentWebhook,
  details: SubscriptionDetails | null,
  observedAt: string,
): Promise<{
  readonly attempt?: PaymentAttempt
  readonly contract: SubscriptionContract
  readonly event?: PaymentEvent
  readonly duplicate: boolean
}> {
  return transaction(async (client) => {
    const contracts = await client.query<SubscriptionRow>(`
      SELECT *
      FROM subscription_contracts
      WHERE merchant_txn_id = $1
      FOR UPDATE
    `, [fact.merchantTxnId])
    let contractRow = contracts.rows[0]

    if (!contractRow) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_NOT_FOUND')
    }

    assertSubscriptionWebhookCorrelation(contractRow, fact)

    const attempts = await client.query<AttemptRow>(`
      SELECT *
      FROM payment_attempts
      WHERE id = $1 AND order_id = $2
      FOR UPDATE
    `, [contractRow.initial_attempt_id, contractRow.initial_order_id])
    const attemptRow = attempts.rows[0]
    const current = attemptRow ? attemptFromRow(attemptRow) : null

    if (
      (current && current.merchantTxnId !== fact.merchantTxnId)
      || (current?.paymentId && current.paymentId !== fact.paymentId)
    ) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const storedDuplicate = contractRow.initial_webhook_transaction_id === fact.transactionId
    const eventDuplicate = current
      ? await findEvent(client, 'webhook', fact.transactionId)
      : null

    if (storedDuplicate || eventDuplicate) {
      if (eventDuplicate && eventDuplicate.attemptId !== contractRow.initial_attempt_id) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      return Object.freeze({
        ...(current ? { attempt: current } : {}),
        contract: subscriptionFromRow(contractRow),
        ...(eventDuplicate ? { event: eventDuplicate } : {}),
        duplicate: true,
      })
    }

    if (contractRow.initial_webhook_transaction_id) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    if (Boolean(fact.contractId) !== Boolean(details)) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    if (fact.contractId && details) {
      if (
        fact.contractId !== details.contractId
        || fact.dataStatus !== details.dataStatus
        || fact.subscriptionStatus !== details.subscriptionStatus
        || fact.subscriptionState !== details.state
        || fact.productName !== details.productName
        || fact.productAmountMinor !== details.amountMinor
        || fact.productCurrency !== details.currency
        || (fact.tokenId && fact.tokenId !== details.tokenId)
      ) {
        throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
      }

      assertSubscriptionDetails(contractRow, details)
    }

    let attempt: PaymentAttempt | undefined
    let event: PaymentEvent | undefined

    if (current) {
      const correlated = current.paymentId
        ? current
        : Object.freeze({ ...current, paymentId: fact.paymentId })
      const incoming = createEvent({
        id: randomUUID(),
        attemptId: current.id,
        source: 'webhook',
        sourceKey: fact.transactionId,
        status: fact.status,
        rawStatus: fact.paymentStatus ?? fact.transactionStatus,
        transactionId: fact.transactionId,
        transactionStatus: fact.transactionStatus,
        ...(fact.paymentStatus ? { paymentStatus: fact.paymentStatus } : {}),
        occurredAt: fact.occurredAt,
      })
      const merged = mergeAttempt(correlated, incoming)
      event = createEvent({ ...incoming, ...(merged.conflict ? { conflict: true } : {}) })

      await insertEvent(client, event)

      if (merged.attempt !== current) {
        await updateAttempt(client, merged.attempt)
      }

      attempt = merged.attempt
    }

    const correlated = await client.query<SubscriptionRow>(`
      UPDATE subscription_contracts
      SET payment_id = COALESCE(payment_id, $2),
          initial_webhook_transaction_id = $3,
          updated_at = GREATEST(updated_at, $4::timestamptz)
      WHERE id = $1
      RETURNING *
    `, [contractRow.id, fact.paymentId, fact.transactionId, observedAt])
    contractRow = correlated.rows[0]!

    let contract = subscriptionFromRow(contractRow)

    if (details) {
      contract = await applySubscriptionDetails(client, contractRow, details, 'webhook', observedAt)
    }
    else if (isTerminalSubscriptionPlaceholderFact(fact)) {
      await terminalizeSubscriptionPlaceholder(client, contractRow.initial_attempt_id, observedAt, 'webhook')
      const terminal = await client.query<SubscriptionRow>(`
        SELECT * FROM subscription_contracts WHERE id = $1
      `, [contract.id])
      contract = subscriptionFromRow(terminal.rows[0]!)
    }

    return Object.freeze({
      ...(attempt ? { attempt } : {}),
      contract,
      ...(event ? { event } : {}),
      duplicate: false,
    })
  })
}

export async function getPaymentTimeline(identifier: string): Promise<PaymentTimeline | null> {
  return transaction(async (client) => {
    const found = await client.query<AttemptRow>(`
      SELECT DISTINCT a.*
      FROM payment_attempts a
      LEFT JOIN payment_events e ON e.attempt_id = a.id
      WHERE a.merchant_txn_id = $1
         OR a.transaction_id = $1
         OR e.transaction_id = $1
      ORDER BY a.created_at DESC
      LIMIT 2
    `, [identifier])

    if (found.rows.length > 1) {
      throw new PaymentStoreError('PAYMENT_TIMELINE_AMBIGUOUS')
    }

    const row = found.rows[0]

    if (!row) {
      return null
    }

    const events = await client.query<EventRow>(`
      SELECT id, attempt_id, source, source_key, status, raw_status,
             transaction_id, transaction_status, payment_status, conflict, occurred_at
      FROM payment_events
      WHERE attempt_id = $1
      ORDER BY occurred_at ASC, id ASC
      LIMIT 100
    `, [row.id])

    return Object.freeze({
      attempt: attemptFromRow(row),
      events: Object.freeze(events.rows.map(eventFromRow)),
    })
  })
}

export async function getPaymentRecovery(
  orderId: string,
  attemptId: string,
): Promise<PaymentRecovery | null> {
  return transaction(async (client) => {
    const orders = await client.query<OrderRow>(`
      SELECT id, scene, item_sku, item_name, item_variant, item_quantity,
             item_unit_minor, amount_minor, currency, fulfillment,
             customer_environment, customer_merchant_no, customer_app_id, merchant_cust_id,
             created_at
      FROM payment_orders
      WHERE id = $1
    `, [orderId])
    const active = await client.query<AttemptRow>(`
      SELECT *
      FROM payment_attempts
      WHERE id = $1 AND order_id = $2
    `, [attemptId, orderId])
    const order = orders.rows[0]
    const attempt = active.rows[0]

    if (!order || !attempt) {
      return null
    }

    const roots = await client.query<{ id: string }>(`
      SELECT id
      FROM payment_attempts
      WHERE order_id = $1 AND retry_of IS NULL
      LIMIT 2
    `, [orderId])

    if (roots.rows.length !== 1) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const attempts = await client.query<RecoveryAttemptRow>(`
      WITH RECURSIVE chain AS (
        SELECT root.*, ARRAY[root.id]::text[] AS retry_path,
               root.created_at AS root_created_at
        FROM payment_attempts root
        WHERE root.order_id = $1 AND root.retry_of IS NULL

        UNION ALL

        SELECT child.*, parent.retry_path || child.id, parent.root_created_at
        FROM payment_attempts child
        JOIN chain parent ON child.retry_of = parent.id
        WHERE child.order_id = $1
          AND NOT child.id = ANY(parent.retry_path)
      ), topology AS (
        SELECT
          (SELECT count(*) FROM chain) AS chain_count,
          (SELECT count(*) FROM payment_attempts WHERE order_id = $1) AS order_count
      ), recent AS (
        SELECT *
        FROM chain
        WHERE id <> $2
        ORDER BY created_at DESC, id DESC
        LIMIT 99
      ), selected AS (
        SELECT * FROM recent
        UNION ALL
        SELECT * FROM chain WHERE id = $2
      )
      SELECT id, order_id, integration, method, status, status_source, retry_of,
             merchant_txn_id, payment_id, transaction_id, submission_started_at,
             created_at, updated_at, topology.chain_count, topology.order_count
      FROM selected
      CROSS JOIN topology
      ORDER BY root_created_at ASC, retry_path ASC
    `, [orderId, attemptId])

    const topology = attempts.rows[0]

    if (
      !topology
      || Number(topology.chain_count) !== Number(topology.order_count)
      || attempts.rows.filter(row => row.id === attemptId).length !== 1
    ) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    const events = await client.query<EventRow>(`
      SELECT id, attempt_id, source, source_key, status, raw_status,
             transaction_id, transaction_status, payment_status, conflict, occurred_at
      FROM payment_events
      WHERE attempt_id = $1
      ORDER BY occurred_at ASC, id ASC
      LIMIT 100
    `, [attemptId])
    const subscriptions = await client.query<SubscriptionRow>(`
      SELECT *
      FROM subscription_contracts
      WHERE initial_attempt_id = $1
      LIMIT 2
    `, [attemptId])

    if (subscriptions.rows.length > 1) {
      throw new PaymentStoreError('PAYMENT_ATTEMPT_MISMATCH')
    }

    return Object.freeze({
      order: orderFromRow(order),
      customer: customerFromRow(order),
      attempt: attemptFromRow(attempt),
      attempts: Object.freeze(attempts.rows.map(attemptFromRow)),
      events: Object.freeze(events.rows.map(eventFromRow)),
      subscription: subscriptions.rows[0]
        ? subscriptionFromRow(subscriptions.rows[0])
        : null,
    })
  })
}

export function paymentRetentionCutoff(now = Date.now()): string {
  return new Date(now - PAYMENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString()
}

export async function purgeExpiredPayments(now = Date.now()): Promise<number> {
  const cutoff = paymentRetentionCutoff(now)

  return transaction(async (client) => {
    const result = await client.query<{ id: string }>(`
      DELETE FROM payment_orders
      WHERE created_at < $1
      RETURNING id
    `, [cutoff])

    return result.rowCount ?? 0
  })
}

export async function purgeExpiredSubscriptions(now = Date.now()): Promise<number> {
  return transaction(async (client) => {
    const result = await client.query<{ id: string }>(`
      DELETE FROM subscription_contracts
      WHERE cleanup_at IS NOT NULL
        AND cleanup_at < $1
      RETURNING id
    `, [new Date(now).toISOString()])

    return result.rowCount ?? 0
  })
}
