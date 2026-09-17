import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PAYMENT_DATABASE_TIMEOUT_MS,
  PAYMENT_RETENTION_DAYS,
  paymentRetentionCutoff,
  subscriptionScopeLockKey,
  claimPaymentSubmission,
  claimPaymentCreation,
  completePaymentRecord,
  getPaymentQueryContext,
  recordQueryEvent,
  recordWebhookEvent,
} from '../server/utils/store'
import { createEvent } from '../shared/payment/event'

const database = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))

vi.mock('@neondatabase/serverless', () => ({
  Pool: class {
    on() {}
    connect() { return database }
  },
}))

const now = '2026-09-14T00:00:00.000Z'

function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1', order_id: 'order-1', integration: 'checkout', method: 'all',
    status: 'processing', status_source: 'server', retry_of: null,
    merchant_txn_id: 'merchant-attempt-1', payment_id: '1000', transaction_id: '1001',
    submission_started_at: null, created_at: now, updated_at: now,
    amount_minor: 500, currency: 'USD', ...overrides,
  }
}

function mockAttempt(overrides: Record<string, unknown> = {}) {
  database.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('SELECT') && sql.includes('payment_attempts') ? [attemptRow(overrides)] : [],
  }))
}

const cancellation = {
  transactionId: '1001', merchantTxnId: 'merchant-attempt-1', amountMinor: 500,
  currency: 'USD' as const, transactionStatus: 'N' as const, status: 'cancelled' as const,
  occurredAt: now,
}

describe('Checkout persistence boundaries', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://mock-only.invalid/test')
    database.query.mockReset()
    mockAttempt()
  })

  afterEach(() => vi.unstubAllEnvs())

  it('accepts a correlated Checkout cancellation without Payment ID and preserves the bound ID', async () => {
    const result = await recordWebhookEvent(cancellation)

    expect(result.attempt).toMatchObject({ paymentId: '1000', transactionId: '1001', status: 'cancelled' })
    expect(result.event).toMatchObject({ source: 'webhook', transactionStatus: 'N', status: 'cancelled' })
    expect(result.event).not.toHaveProperty('paymentStatus')
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO payment_events'))).toBe(true)
  })

  it('persists an early no-ID cancellation and preserves its truth when create completes', async () => {
    mockAttempt({ payment_id: null, transaction_id: null })
    const early = await recordWebhookEvent(cancellation)

    expect(early.attempt).toMatchObject({ transactionId: '1001', status: 'cancelled' })
    expect(early.attempt).not.toHaveProperty('paymentId')

    mockAttempt({ payment_id: null, status: 'cancelled', status_source: 'webhook' })
    const completed = await completePaymentRecord('attempt-1', '1000', '1001', createEvent({
      id: 'create-event', attemptId: 'attempt-1', source: 'server', sourceKey: 'create:attempt-1',
      status: 'processing', rawStatus: 'U', transactionId: '1001', occurredAt: now,
    }))

    expect(completed).toMatchObject({ paymentId: '1000', status: 'cancelled', statusSource: 'webhook' })
  })

  it.each([
    [{ integration: 'web-js-sdk', method: 'card' }, {}],
    [{}, { transactionId: 'different' }],
    [{}, { amountMinor: 501 }],
    [{ currency: 'EUR' }, {}],
    [{}, { transactionStatus: 'S', status: 'processing' }],
    [{}, { paymentStatus: 'N' }],
    [{}, { paymentId: 'wrong-payment' }],
  ])('rejects incomplete or mismatched cancellation correlation', async (row, fact) => {
    mockAttempt(row)

    await expect(recordWebhookEvent({ ...cancellation, ...fact } as typeof cancellation))
      .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false)
  })

  it('checks an early Checkout transaction against a later create completion', async () => {
    await expect(completePaymentRecord('attempt-1', '1000', 'other', createEvent({
      id: 'create-event', attemptId: 'attempt-1', source: 'server', sourceKey: 'create:attempt-1',
      status: 'processing', occurredAt: now,
    }))).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
  })

  it('rejects Checkout submission claims and query access for a different Payment ID', async () => {
    await expect(claimPaymentSubmission('attempt-1', '1000'))
      .rejects.toMatchObject({ code: 'PAYMENT_SUBMISSION_NOT_ALLOWED' })
    await expect(getPaymentQueryContext('attempt-1', 'other'))
      .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
  })

  it('does not claim a new create for Checkout with only an existing transaction', async () => {
    mockAttempt({ payment_id: null })
    const claim = await claimPaymentCreation('attempt-1', createEvent({
      id: 'claim-event', attemptId: 'attempt-1', source: 'server', sourceKey: 'create-claim:attempt-1',
      status: 'created', occurredAt: now,
    }))

    expect(claim.outcome).toBe('existing')
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false)
  })

  it('records transaction-axis Checkout query truth without inventing a Payment status', async () => {
    const result = await recordQueryEvent('attempt-1', '1000', {
      paymentId: '1000', transactionId: '1001', merchantTxnId: 'merchant-attempt-1',
      transactionStatus: 'N', rawStatus: 'N', status: 'cancelled',
    }, now)

    expect(result.event).toMatchObject({ source: 'query', transactionStatus: 'N', status: 'cancelled' })
    expect(result.event).not.toHaveProperty('paymentStatus')
  })

  it('retains fresh query reconciliation of conflicting terminal Webhook truth', async () => {
    mockAttempt({ status: 'cancelled', status_source: 'webhook' })
    const result = await recordQueryEvent('attempt-1', '1000', {
      paymentId: '1000', transactionId: '1001', merchantTxnId: 'merchant-attempt-1',
      transactionStatus: 'S', paymentStatus: 'S', rawStatus: 'S', status: 'succeeded',
    }, now)

    expect(result.attempt).toMatchObject({ status: 'succeeded', statusSource: 'query' })
    expect(result.event.conflict).toBe(true)
  })

  it('deduplicates a correlated cancellation without inserting a second event', async () => {
    database.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('SELECT') && sql.includes('payment_attempts')
        ? [attemptRow({ status: 'cancelled', status_source: 'webhook' })]
        : sql.includes('SELECT') && sql.includes('payment_events')
          ? [{ id: 'existing-event', attempt_id: 'attempt-1', source: 'webhook', source_key: '1001',
              status: 'cancelled', raw_status: 'N', transaction_id: '1001', transaction_status: 'N',
              payment_status: null, conflict: false, occurred_at: now }]
          : [],
    }))
    const result = await recordWebhookEvent(cancellation)

    expect(result.duplicate).toBe(true)
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false)
  })

  it('rejects a Checkout query for another merchant transaction', async () => {
    await expect(recordQueryEvent('attempt-1', '1000', {
      paymentId: '1000', transactionId: '1001', merchantTxnId: 'other',
      transactionStatus: 'N', rawStatus: 'N', status: 'cancelled',
    }, now)).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
  })

  it('allows cookie-recovered no-ID Checkout queries with exact stored transaction association', async () => {
    mockAttempt({ payment_id: null })
    const result = await recordQueryEvent('attempt-1', undefined, {
      transactionId: '1001', merchantTxnId: 'merchant-attempt-1',
      transactionStatus: 'N', rawStatus: 'N', status: 'cancelled',
    }, now)

    expect(result.attempt.status).toBe('cancelled')
    expect(result.attempt).not.toHaveProperty('paymentId')
  })
})

describe('payment persistence contract', () => {
  it('keeps payment records for exactly 30 days', () => {
    const now = Date.parse('2026-08-31T00:00:00.000Z')

    expect(PAYMENT_RETENTION_DAYS).toBe(30)
    expect(paymentRetentionCutoff(now)).toBe('2026-08-01T00:00:00.000Z')
  })

  it('bounds database connection and query waits', () => {
    expect(PAYMENT_DATABASE_TIMEOUT_MS).toBe(8_000)
  })

  it('encodes the subscription advisory-lock scope without PostgreSQL NUL bytes', () => {
    const customer = {
      environment: 'sandbox' as const,
      merchantNo: 'merchant',
      appId: 'app',
      merchantCustId: 'customer',
    }
    const key = subscriptionScopeLockKey(customer, 'halden-daily-essentials-v1')

    expect(key).toBe('["sandbox","merchant","app","customer","halden-daily-essentials-v1"]')
    expect(key).not.toContain('\0')
    expect(subscriptionScopeLockKey(
      { ...customer, merchantNo: 'merchant,app', appId: 'customer' },
      'halden-daily-essentials-v1',
    )).not.toBe(key)
  })

  it('defines durable event idempotency and cascade cleanup without sensitive columns', async () => {
    const initial = await readFile(new URL(
      '../server/db/migrations/0001_payment.sql',
      import.meta.url,
    ), 'utf8')
    const retry = await readFile(new URL(
      '../server/db/migrations/0002_retry.sql',
      import.meta.url,
    ), 'utf8')
    const customer = await readFile(new URL(
      '../server/db/migrations/0003_customer.sql',
      import.meta.url,
    ), 'utf8')
    const subscription = await readFile(new URL(
      '../server/db/migrations/0004_subscription.sql',
      import.meta.url,
    ), 'utf8')
    const subscriptionStatusSource = await readFile(new URL(
      '../server/db/migrations/0005_subscription_status_source.sql',
      import.meta.url,
    ), 'utf8')
    const paymentMethodAttribution = await readFile(new URL(
      '../server/db/migrations/0006_payment_method_attribution.sql',
      import.meta.url,
    ), 'utf8')
    const runner = await readFile(new URL(
      '../scripts/migrate.mjs',
      import.meta.url,
    ), 'utf8')
    const sql = `${initial}\n${retry}\n${customer}\n${subscription}\n${subscriptionStatusSource}\n${paymentMethodAttribution}`

    expect(sql).toContain('UNIQUE (source, source_key)')
    expect(sql).toContain('ON DELETE CASCADE')
    expect(sql).toContain('merchant_txn_id text NOT NULL UNIQUE')
    expect(sql).toContain('payment_id text UNIQUE')
    expect(retry).toContain('submission_started_at timestamptz')
    expect(retry).toContain('payment_attempts_retry_of_unique_idx')
    expect(retry).toContain("WHERE version = '0002_retry'")
    expect(customer).toContain("VALUES ('0003_customer')")
    expect(customer).toContain("merchant_cust_id ~ '^[A-Za-z0-9_-]{1,63}$'")
    expect(customer).toContain('payment_orders_customer_complete_check')
    expect(subscription).toContain('subscription_contracts_active_scope_plan_idx')
    expect(subscription).toContain('initial_attempt_id text NOT NULL UNIQUE')
    expect(subscription).toContain('merchant_txn_id text NOT NULL UNIQUE')
    expect(subscription).toContain('payment_id text UNIQUE')
    expect(subscription).toContain('initial_webhook_transaction_id text UNIQUE')
    expect(subscription).toContain('token_id text CHECK')
    expect(subscription).not.toMatch(/initial_attempt_id[^\n]+REFERENCES|initial_order_id[^\n]+REFERENCES/i)
    expect(subscription).toContain("VALUES ('0004_subscription')")
    expect(subscriptionStatusSource).toContain("WHERE version = '0005_subscription_status_source'")
    expect(subscriptionStatusSource).toContain("VALUES ('0005_subscription_status_source')")
    expect(subscriptionStatusSource).toContain("'placeholder', 'query', 'webhook'")
    expect(paymentMethodAttribution).toContain('actual_wallet text')
    expect(paymentMethodAttribution).toContain('funding_network text')
    expect(paymentMethodAttribution).toContain('attribution_transaction_id text')
    expect(paymentMethodAttribution).toContain("actual_wallet IN ('google-pay', 'apple-pay')")
    expect(paymentMethodAttribution).toContain('payment_attempts_attribution_complete_check')
    expect(paymentMethodAttribution).toContain('attribution_transaction_id = transaction_id')
    expect(paymentMethodAttribution).toContain("VALUES ('0006_payment_method_attribution')")
    expect(runner).toContain('readdir(directory)')
    expect(runner).toContain('.sort()')
    expect(sql).not.toMatch(/raw_payload|\bsign\b|\bsecret\b|\bpan\b|\bcvv\b|payment_method_details|\breason\b/i)
  })
})
