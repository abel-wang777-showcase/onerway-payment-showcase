import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  PAYMENT_DATABASE_TIMEOUT_MS,
  PAYMENT_RETENTION_DAYS,
  paymentRetentionCutoff,
  subscriptionScopeLockKey,
} from '../server/utils/store'

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
