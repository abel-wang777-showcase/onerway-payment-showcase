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
  recordPaymentMethodDetails,
  recordWebhookEvent,
  recordSubscriptionWebhookEvent,
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
    const subscriptionIntegration = await readFile(new URL('../server/db/migrations/0008_subscription_integration.sql', import.meta.url), 'utf8')
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
    expect(subscriptionIntegration).toContain("initial_integration text NOT NULL DEFAULT 'web-js-sdk'")
    expect(subscriptionIntegration).toContain("initial_integration IN ('web-js-sdk', 'checkout')")
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

describe('subscription query payment association', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://mock-only.invalid/test')
    database.query.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('persists a first queried Payment ID on both Attempt and long-lived contract', async () => {
    database.query.mockImplementation(async (sql: string) => ({ rows:
      sql.includes('SELECT') && sql.includes('payment_attempts') ? [attemptRow({ payment_id: null, transaction_id: null })]
        : sql.includes('SELECT') && sql.includes('subscription_contracts') ? [{ id: 'local-contract', payment_id: null }]
          : [],
    }))
    const result = await recordQueryEvent('attempt-1', undefined, {
      merchantTxnId: 'merchant-attempt-1', paymentId: '1000', transactionId: '1001', transactionStatus: 'S', rawStatus: 'S', status: 'succeeded',
    }, now)
    expect(result.attempt.paymentId).toBe('1000')
    expect(database.query.mock.calls.some(([sql, values]) => sql.includes('UPDATE subscription_contracts') && values[0] === 'local-contract' && values[1] === '1000')).toBe(true)
  })

  it('binds the first Payment ID on a duplicate N query without inserting another event', async () => {
    const existingEvent = {
      id: 'query-existing', attempt_id: 'attempt-1', source: 'query', source_key: 'merchant-attempt-1:1001:N:-',
      status: 'cancelled', raw_status: 'N', transaction_id: '1001', transaction_status: 'N', payment_status: null,
      conflict: false, occurred_at: now,
    }
    database.query.mockImplementation(async (sql: string) => ({ rows:
      sql.includes('SELECT') && sql.includes('payment_attempts') ? [attemptRow({ payment_id: null, status: 'cancelled', status_source: 'query' })]
        : sql.includes('SELECT') && sql.includes('subscription_contracts') ? [{ id: 'local-contract', payment_id: null }]
          : sql.includes('SELECT') && sql.includes('payment_events') ? [existingEvent]
            : [],
    }))
    const result = await recordQueryEvent('attempt-1', undefined, {
      merchantTxnId: 'merchant-attempt-1', paymentId: '1000', transactionId: '1001', transactionStatus: 'N', rawStatus: 'N', status: 'cancelled',
    }, now)
    expect(result).toMatchObject({ duplicate: true, attempt: { paymentId: '1000', status: 'cancelled' }, event: { id: 'query-existing' } })
    expect(database.query.mock.calls.some(([sql, values]) => sql.includes('UPDATE subscription_contracts') && values[1] === '1000')).toBe(true)
    expect(database.query.mock.calls.some(([sql, values]) => sql.includes('UPDATE payment_attempts') && values[3] === '1000')).toBe(true)
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO payment_events'))).toBe(false)
  })

  it('rejects an existing contract Payment ID mismatch atomically', async () => {
    database.query.mockImplementation(async (sql: string) => ({ rows:
      sql.includes('SELECT') && sql.includes('payment_attempts') ? [attemptRow()]
        : sql.includes('SELECT') && sql.includes('subscription_contracts') ? [{ id: 'local-contract', payment_id: 'other-payment' }]
          : [],
    }))
    await expect(recordQueryEvent('attempt-1', '1000', {
      merchantTxnId: 'merchant-attempt-1', paymentId: '1000', transactionId: '1001', transactionStatus: 'S', rawStatus: 'S', status: 'succeeded',
    }, now)).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
    expect(database.query.mock.calls.some(([sql]) => /^\s*UPDATE/.test(sql))).toBe(false)
  })
})

describe('subscription cancellation without Payment ID', () => {
  const fact = {
    ...cancellation, kind: 'subscription' as const, scenario: 'SUBSCRIPTION_INITIAL' as const,
    productName: 'Halden Daily Essentials', productAmountMinor: 500, productCurrency: 'USD' as const,
    dataStatus: '0' as const, subscriptionStatus: 'paymentdue' as const, subscriptionState: 'pending' as const,
  }
  function mockContract(integration = 'checkout', transactionId: string | null = '1001') {
    const row: Record<string, unknown> = {
      id: 'contract-local', environment: 'sandbox', merchant_no: 'merchant', app_id: 'app', merchant_cust_id: 'customer',
      plan_id: 'halden-daily-essentials-v1', plan_version: 1, product_name: 'Halden Daily Essentials', initial_amount_minor: 500, currency: 'USD',
      frequency_type: 'D', frequency_point: 1, expire_date: '2099-12-31', initial_order_id: 'order-1', initial_attempt_id: 'attempt-1', initial_integration: integration,
      merchant_txn_id: 'merchant-attempt-1', payment_id: null, initial_webhook_transaction_id: null,
      establishment_state: 'pending', status_source: 'placeholder', data_status: '0', subscription_status: 'paymentdue',
      contract_id: null, token_id: null, terminal_at: null, cleanup_at: null, created_at: now, updated_at: now,
    }
    database.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SET establishment_state = 'terminal'")) Object.assign(row, { establishment_state: 'terminal', status_source: 'webhook', terminal_at: now })
      if (sql.includes('SELECT') && sql.includes('payment_attempts')) return { rows: [attemptRow({ integration, payment_id: null, transaction_id: transactionId })] }
      if (sql.includes('subscription_contracts')) return { rows: [row] }
      return { rows: [] }
    })
  }
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://mock-only.invalid/test')
    database.query.mockReset()
    mockContract()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('correlates an early signed Checkout cancellation by its immutable merchant transaction and plan', async () => {
    mockContract('checkout', null)
    const result = await recordSubscriptionWebhookEvent(fact, null, now)
    expect(result.attempt).toMatchObject({ status: 'cancelled', transactionId: '1001' })
    expect(result.attempt).not.toHaveProperty('paymentId')
    expect(result.contract).toMatchObject({ state: 'terminal', initialIntegration: 'checkout' })
    expect(result.contract).not.toHaveProperty('tokenId')
  })

  it.each([
    ['web-js-sdk', {}], ['checkout', { transactionStatus: 'S' }], ['checkout', { paymentStatus: 'N' }],
    ['checkout', { transactionId: 'different-transaction' }], ['checkout', { amountMinor: 600 }],
  ])('rejects unsafe no-ID subscription correlation %s %j', async (integration, override) => {
    mockContract(integration)
    await expect(recordSubscriptionWebhookEvent({ ...fact, ...override } as typeof fact, null, now))
      .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO'))).toBe(false)
  })
})


describe('Direct Apple Pay persistence', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://mock-only.invalid/test')
    database.query.mockReset()
    mockAttempt({ integration: 'direct-api', method: 'apple-pay', payment_id: null, transaction_id: null })
  })
  afterEach(() => vi.unstubAllEnvs())
  const directFact = { ...cancellation, kind: 'direct' as const, transactionStatus: 'F' as const, status: 'failed' as const }
  const completion = () => createEvent({ id: 'direct-event', attemptId: 'attempt-1', source: 'server', sourceKey: 'direct-create:attempt-1', status: 'succeeded', transactionId: '1001', transactionStatus: 'S', rawStatus: 'S', occurredAt: now })

  it('persists a terminal server response without paymentId', async () => {
    expect(await completePaymentRecord('attempt-1', undefined, '1001', completion())).toMatchObject({ status: 'succeeded', statusSource: 'server', transactionId: '1001' })
  })
  it('accepts an early failure webhook without paymentId and prevents late response from changing it', async () => {
    expect((await recordWebhookEvent(directFact)).attempt).toMatchObject({ status: 'failed', transactionId: '1001' })
    mockAttempt({ integration: 'direct-api', method: 'apple-pay', payment_id: null, transaction_id: '1001', status: 'failed', status_source: 'webhook' })
    expect(await completePaymentRecord('attempt-1', undefined, '1001', completion())).toMatchObject({ status: 'failed', statusSource: 'webhook' })
    const insert = database.query.mock.calls.findLast(([sql]) => sql.includes('INSERT INTO payment_events'))
    expect(insert?.[1]).toContain(true)
  })
  it('rejects cross-transaction webhook even when paymentId matches', async () => {
    mockAttempt({ integration: 'direct-api', method: 'apple-pay', transaction_id: '2000' })
    await expect(recordWebhookEvent({ ...directFact, paymentId: '1000' })).rejects.toThrow('PAYMENT_ATTEMPT_MISMATCH')
    await expect(completePaymentRecord('attempt-1', '1000', '1001', completion())).rejects.toThrow('PAYMENT_ATTEMPT_MISMATCH')
  })
  it.each([{ amountMinor: 501 }, { currency: 'EUR' }, { kind: undefined }])('rejects wrong webhook correlation %j', async (fields) => {
    await expect(recordWebhookEvent({ ...directFact, ...fields } as typeof directFact)).rejects.toThrow('PAYMENT_ATTEMPT_MISMATCH')
  })
  it('records query-verified Direct attribution without paymentId on the same transaction', async () => {
    mockAttempt({ integration: 'direct-api', method: 'apple-pay', payment_id: null, transaction_id: '1001' })
    const result = await recordPaymentMethodDetails('attempt-1', undefined, { transactionId: '1001', actualWallet: 'apple-pay', fundingNetwork: 'VISA' }, now)
    expect(result).toMatchObject({ actualWallet: 'apple-pay', fundingNetwork: 'VISA', attributionTransactionId: '1001' })
    await expect(recordPaymentMethodDetails('attempt-1', undefined, { transactionId: '1002', actualWallet: 'apple-pay', fundingNetwork: 'VISA' }, now)).rejects.toThrow('PAYMENT_ATTEMPT_MISMATCH')
    await expect(recordPaymentMethodDetails('attempt-1', undefined, { transactionId: '1001', actualWallet: 'google-pay', fundingNetwork: 'VISA' }, now)).rejects.toThrow('PAYMENT_ATTEMPT_MISMATCH')
  })
  it('preserves the SDK paymentId requirement for attribution', async () => {
    mockAttempt({ integration: 'web-js-sdk', method: 'apple-pay', payment_id: null, transaction_id: '1001' })
    await expect(recordPaymentMethodDetails('attempt-1', undefined, { transactionId: '1001', actualWallet: 'apple-pay', fundingNetwork: 'VISA' }, now)).rejects.toThrow('PAYMENT_ATTEMPT_MISMATCH')
  })
  it('allows fresh transaction query to reconcile without paymentId', async () => {
    const result = await recordQueryEvent('attempt-1', undefined, { merchantTxnId: 'merchant-attempt-1', transactionId: '1001', transactionStatus: 'S', rawStatus: 'S', status: 'succeeded' }, now)
    expect(result.attempt).toMatchObject({ status: 'succeeded', statusSource: 'query', transactionId: '1001' })
    expect(result.event).not.toHaveProperty('paymentStatus')
  })
})
