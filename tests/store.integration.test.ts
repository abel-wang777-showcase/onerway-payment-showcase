import { randomUUID } from 'node:crypto'
import { Pool } from '@neondatabase/serverless'
import { describe, expect, it } from 'vitest'
import { createAttempt } from '../shared/payment/attempt'
import { createEvent } from '../shared/payment/event'
import { createOrder } from '../shared/payment/order'
import {
  createSubscriptionPlaceholder,
  getSubscriptionPlan,
} from '../shared/payment/subscription'
import { requireTestDatabaseUrl } from './db'
import { createMerchantCustomer } from '../server/utils/customer'
import {
  claimPaymentCreation,
  claimPaymentSubmission,
  completePaymentRecord,
  createPaymentRecord,
  createPaymentRetry,
  createSubscriptionPaymentRecord,
  ensurePaymentCustomer,
  getPaymentRecovery,
  getRetainedSubscriptionRecovery,
  getSubscriptionForAttempt,
  getPaymentTimeline,
  isSubscriptionWebhookProcessed,
  purgeExpiredPayments,
  purgeExpiredSubscriptions,
  recordQueryEvent,
  recordPaymentMethodDetails,
  recordReturnEvent,
  recordSubscriptionQueryDetails,
  recordSubscriptionWebhookEvent,
  recordWebhookEvent,
} from '../server/utils/store'

const databaseUrl = requireTestDatabaseUrl()
process.env.DATABASE_URL = databaseUrl

function customer() {
  return createMerchantCustomer({
    profile: 'sandbox',
    merchantNo: 'test-merchant',
    appId: 'test-app',
  })
}

async function deleteTestOrder(id: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl })

  try {
    await pool.query(`
      DELETE FROM subscription_contracts
      WHERE initial_order_id = $1
    `, [id])
    await pool.query(`
      DELETE FROM payment_orders
      WHERE id = $1 AND id LIKE 'HLD-TEST-%'
    `, [id])
  }
  finally {
    await pool.end()
  }
}

function recoveryFixture(label: string) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  const orderId = `HLD-TEST-${suffix}`
  const attemptId = `${orderId}-attempt-000`
  const now = new Date().toISOString()
  const order = createOrder({
    id: orderId,
    scene: 'ecommerce',
    item: {
      sku: 'HL-TEST-005',
      name: `${label} recovery test`,
      variant: 'Test only',
      quantity: 1,
      unitAmount: { minor: 500, currency: 'USD' },
    },
    amount: { minor: 500, currency: 'USD' },
    createdAt: now,
  })
  const attempt = createAttempt({
    id: attemptId,
    orderId,
    integration: 'web-js-sdk',
    method: 'card',
    merchantTxnId: `showcase-test-${suffix}`,
    createdAt: now,
  })

  return { orderId, attemptId, now, order, attempt }
}

async function insertRecoveryAttempt(
  pool: Pool,
  input: {
    id: string
    orderId: string
    retryOf: string | null
    createdAt: string
  },
): Promise<void> {
  await pool.query(`
    INSERT INTO payment_attempts (
      id, order_id, integration, method, status, status_source, retry_of,
      merchant_txn_id, payment_id, transaction_id, submission_started_at,
      created_at, updated_at
    ) VALUES (
      $1, $2, 'web-js-sdk', 'card', 'created', NULL, $3,
      $4, NULL, NULL, NULL, $5, $5
    )
  `, [
    input.id,
    input.orderId,
    input.retryOf,
    `showcase-test-${randomUUID()}`,
    input.createdAt,
  ])
}

describe('Neon payment persistence integration', () => {
  it('serializes duplicate subscriptions and preserves contract ownership past Payment cleanup', async () => {
    const plan = getSubscriptionPlan('halden-daily-essentials-v1')
    const sharedCustomer = customer()
    const first = recoveryFixture('Subscription first')
    const second = recoveryFixture('Subscription concurrent')
    const third = recoveryFixture('Subscription after payment cleanup')
    const firstContract = createSubscriptionPlaceholder({
      id: `subscription-${randomUUID()}`,
      plan,
      initialOrderId: first.orderId,
      initialAttemptId: first.attemptId,
      createdAt: first.now,
    })
    const secondContract = createSubscriptionPlaceholder({
      id: `subscription-${randomUUID()}`,
      plan,
      initialOrderId: second.orderId,
      initialAttemptId: second.attemptId,
      createdAt: second.now,
    })
    const thirdContract = createSubscriptionPlaceholder({
      id: `subscription-${randomUUID()}`,
      plan,
      initialOrderId: third.orderId,
      initialAttemptId: third.attemptId,
      createdAt: third.now,
    })

    try {
      const [firstResult, secondResult] = await Promise.all([
        createSubscriptionPaymentRecord(first.order, first.attempt, sharedCustomer, firstContract),
        createSubscriptionPaymentRecord(second.order, second.attempt, sharedCustomer, secondContract),
      ])
      const created = firstResult.created ? first : second
      const createdResult = firstResult.created ? firstResult : secondResult
      const reusedResult = firstResult.created ? secondResult : firstResult

      expect([firstResult.created, secondResult.created].sort()).toEqual([false, true])
      expect(reusedResult).toMatchObject({
        created: false,
        orderId: created.orderId,
        attemptId: created.attemptId,
      })

      const paymentId = `9084${Date.now()}`.slice(0, 20)
      const createTransactionId = `9184${Date.now()}`.slice(0, 20)
      const webhookTransactionId = `9284${Date.now()}`.slice(0, 20)
      await completePaymentRecord(created.attemptId, paymentId, createTransactionId, createEvent({
        id: randomUUID(),
        attemptId: created.attemptId,
        source: 'server',
        sourceKey: `create:${created.attemptId}`,
        status: 'processing',
        rawStatus: 'U',
        transactionId: createTransactionId,
        occurredAt: created.now,
      }))

      const tokenId = 'opaque.subscription-token/value'
      const details = {
        contractId: `contract-${randomUUID()}`,
        merchantCustomerId: sharedCustomer.merchantCustId,
        productName: plan.productName,
        amountMinor: plan.amount.minor,
        currency: plan.amount.currency,
        frequencyType: plan.frequencyType,
        frequencyPoint: plan.frequencyPoint,
        expireDate: plan.expireDate,
        dataStatus: '1' as const,
        subscriptionStatus: 'active' as const,
        state: 'active' as const,
        tokenId,
      }
      const webhook = {
        kind: 'subscription' as const,
        scenario: 'SUBSCRIPTION_INITIAL' as const,
        transactionId: webhookTransactionId,
        paymentId,
        merchantTxnId: created.attempt.merchantTxnId!,
        amountMinor: plan.amount.minor,
        currency: plan.amount.currency,
        transactionStatus: 'S' as const,
        paymentStatus: 'S' as const,
        status: 'succeeded' as const,
        occurredAt: created.now,
        contractId: details.contractId,
        tokenId,
        productName: plan.productName,
        productAmountMinor: plan.amount.minor,
        productCurrency: plan.amount.currency,
        dataStatus: details.dataStatus,
        subscriptionStatus: details.subscriptionStatus,
        subscriptionState: details.state,
      }
      const recorded = await recordSubscriptionWebhookEvent(webhook, details, created.now)
      const duplicate = await recordSubscriptionWebhookEvent(webhook, details, created.now)

      expect(recorded).toMatchObject({
        duplicate: false,
        attempt: { status: 'succeeded' },
        contract: { state: 'active', statusSource: 'webhook', tokenId },
      })
      expect(duplicate.duplicate).toBe(true)

      const pool = new Pool({ connectionString: databaseUrl })
      try {
        await pool.query(
          'UPDATE payment_orders SET created_at = $2 WHERE id = $1',
          [created.orderId, '2000-01-01T00:00:00.000Z'],
        )
      }
      finally {
        await pool.end()
      }

      expect(await purgeExpiredPayments(Date.parse('2026-08-17T00:00:00.000Z'))).toBeGreaterThanOrEqual(1)
      expect(await getPaymentRecovery(created.orderId, created.attemptId)).toBeNull()
      expect(await getRetainedSubscriptionRecovery(created.orderId, created.attemptId))
        .toMatchObject({
          orderId: created.orderId,
          attemptId: created.attemptId,
          paymentId,
          customer: sharedCustomer,
          contract: { state: 'active', tokenId },
        })
      expect(await getSubscriptionForAttempt(created.attemptId)).toMatchObject({
        id: createdResult.contract.id,
        state: 'active',
        tokenId,
      })
      expect(await isSubscriptionWebhookProcessed(webhook)).toBe(true)
      expect(await recordSubscriptionWebhookEvent(webhook, null, created.now))
        .toMatchObject({ duplicate: true, contract: { state: 'active' } })

      const afterCleanup = await createSubscriptionPaymentRecord(
        third.order,
        third.attempt,
        sharedCustomer,
        thirdContract,
      )
      expect(afterCleanup).toMatchObject({
        created: false,
        orderId: created.orderId,
        attemptId: created.attemptId,
      })

      const terminalAt = '2026-08-17T12:00:00.000Z'
      const terminal = await recordSubscriptionQueryDetails(created.attemptId, {
        ...details,
        dataStatus: '3',
        subscriptionStatus: 'canceled',
        state: 'terminal',
        tokenId: undefined,
      }, terminalAt)
      const repeated = await recordSubscriptionQueryDetails(created.attemptId, {
        ...details,
        dataStatus: '3',
        subscriptionStatus: 'canceled',
        state: 'terminal',
        tokenId: undefined,
      }, '2026-08-18T12:00:00.000Z')

      expect(terminal).toMatchObject({ state: 'terminal', statusSource: 'query', terminalAt })
      expect(terminal).not.toHaveProperty('tokenId')
      expect(repeated.terminalAt).toBe(terminalAt)
      expect(await purgeExpiredSubscriptions(
        Date.parse('2026-09-16T12:00:00.001Z'),
      )).toBeGreaterThanOrEqual(1)
      expect(await getSubscriptionForAttempt(created.attemptId)).toBeNull()

      const lateRecord = await createSubscriptionPaymentRecord(
        third.order,
        third.attempt,
        sharedCustomer,
        thirdContract,
      )
      expect(lateRecord.created).toBe(true)
      const latePaymentId = `9384${Date.now()}`.slice(0, 20)
      const lateCreateTransactionId = `9484${Date.now()}`.slice(0, 20)
      await completePaymentRecord(third.attemptId, latePaymentId, lateCreateTransactionId, createEvent({
        id: randomUUID(),
        attemptId: third.attemptId,
        source: 'server',
        sourceKey: `create:${third.attemptId}`,
        status: 'processing',
        rawStatus: 'U',
        transactionId: lateCreateTransactionId,
        occurredAt: third.now,
      }))

      const latePool = new Pool({ connectionString: databaseUrl })
      try {
        await latePool.query(
          'UPDATE payment_orders SET created_at = $2 WHERE id = $1',
          [third.orderId, '2000-01-01T00:00:00.000Z'],
        )
      }
      finally {
        await latePool.end()
      }
      await purgeExpiredPayments(Date.parse('2026-08-17T00:00:00.000Z'))

      const lateDetails = {
        ...details,
        contractId: `contract-${randomUUID()}`,
        tokenId: 'late.opaque.subscription-token/value',
      }
      const lateWebhook = {
        ...webhook,
        transactionId: `9584${Date.now()}`.slice(0, 20),
        paymentId: latePaymentId,
        merchantTxnId: third.attempt.merchantTxnId!,
        contractId: lateDetails.contractId,
        tokenId: lateDetails.tokenId,
      }
      const late = await recordSubscriptionWebhookEvent(lateWebhook, lateDetails, third.now)

      expect(late).toMatchObject({
        duplicate: false,
        contract: { state: 'active', tokenId: lateDetails.tokenId },
      })
      expect(late).not.toHaveProperty('attempt')
      expect(late).not.toHaveProperty('event')

      await recordSubscriptionQueryDetails(third.attemptId, {
        ...lateDetails,
        dataStatus: '3',
        subscriptionStatus: 'canceled',
        state: 'terminal',
        tokenId: undefined,
      }, '2026-09-17T12:00:00.000Z')
      await purgeExpiredSubscriptions(Date.parse('2026-10-17T12:00:00.001Z'))
    }
    finally {
      await deleteTestOrder(first.orderId)
      await deleteTestOrder(second.orderId)
      await deleteTestOrder(third.orderId)
    }
  }, 120_000)

  it('terminalizes a failed no-contract subscription Webhook without changing Payment finality', async () => {
    const plan = getSubscriptionPlan('halden-daily-essentials-v1')
    const fixture = recoveryFixture('Subscription failed Webhook')
    const contract = createSubscriptionPlaceholder({
      id: `subscription-${randomUUID()}`,
      plan,
      initialOrderId: fixture.orderId,
      initialAttemptId: fixture.attemptId,
      createdAt: fixture.now,
    })
    const paymentId = `9684${Date.now()}`.slice(0, 20)
    const createTransactionId = `9784${Date.now()}`.slice(0, 20)
    const webhookTransactionId = `9884${Date.now()}`.slice(0, 20)

    try {
      await createSubscriptionPaymentRecord(
        fixture.order,
        fixture.attempt,
        customer(),
        contract,
      )
      await completePaymentRecord(fixture.attemptId, paymentId, createTransactionId, createEvent({
        id: randomUUID(),
        attemptId: fixture.attemptId,
        source: 'server',
        sourceKey: `create:${fixture.attemptId}`,
        status: 'processing',
        rawStatus: 'U',
        transactionId: createTransactionId,
        occurredAt: fixture.now,
      }))

      const recorded = await recordSubscriptionWebhookEvent({
        kind: 'subscription',
        scenario: 'SUBSCRIPTION_INITIAL',
        transactionId: webhookTransactionId,
        paymentId,
        merchantTxnId: fixture.attempt.merchantTxnId!,
        amountMinor: plan.amount.minor,
        currency: plan.amount.currency,
        transactionStatus: 'F',
        status: 'processing',
        occurredAt: fixture.now,
        productName: plan.productName,
        productAmountMinor: plan.amount.minor,
        productCurrency: plan.amount.currency,
        dataStatus: '0',
        subscriptionStatus: 'paymentdue',
        subscriptionState: 'pending',
      }, null, fixture.now)

      expect(recorded).toMatchObject({
        attempt: { status: 'processing' },
        contract: {
          state: 'terminal',
          statusSource: 'webhook',
          terminalAt: fixture.now,
        },
      })
      expect(recorded.contract).not.toHaveProperty('contractId')
      expect(recorded.contract).not.toHaveProperty('tokenId')
    }
    finally {
      await deleteTestOrder(fixture.orderId)
    }
  }, 120_000)

  it('backfills one stable customer for concurrent legacy recovery', async () => {
    const { orderId, attemptId, order, attempt } = recoveryFixture('Legacy customer')
    const pool = new Pool({ connectionString: databaseUrl })

    try {
      await createPaymentRecord(order, attempt, customer())
      await pool.query(`
        UPDATE payment_orders
        SET customer_environment = NULL,
            customer_merchant_no = NULL,
            customer_app_id = NULL,
            merchant_cust_id = NULL
        WHERE id = $1
      `, [orderId])

      const [first, second] = await Promise.all([
        ensurePaymentCustomer(orderId, customer()),
        ensurePaymentCustomer(orderId, customer()),
      ])
      const recovery = await getPaymentRecovery(orderId, attemptId)

      expect(first).toEqual(second)
      expect(recovery?.customer).toEqual(first)
    }
    finally {
      await pool.end()
      await deleteTestOrder(orderId)
    }
  }, 120_000)

  it('persists, deduplicates and converges across independent store calls', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const orderId = `HLD-TEST-${suffix}`
    const attemptId = `${orderId}-attempt-1`
    const merchantTxnId = `showcase-test-${suffix}`
    const paymentId = `2084${Date.now()}`.slice(0, 20)
    const createTransactionId = `3084${Date.now()}`.slice(0, 20)
    const webhookTransactionId = `4084${Date.now()}`.slice(0, 20)
    const nextTransactionId = `4094${Date.now()}`.slice(0, 20)
    const now = new Date().toISOString()
    const order = createOrder({
      id: orderId,
      scene: 'ecommerce',
      item: {
        sku: 'HL-TEST-005',
        name: 'Persistence test',
        variant: 'Test only',
        quantity: 1,
        unitAmount: { minor: 500, currency: 'USD' },
      },
      amount: { minor: 500, currency: 'USD' },
      createdAt: now,
    })
    const attempt = createAttempt({
      id: attemptId,
      orderId,
      integration: 'web-js-sdk',
      method: 'apple-pay',
      merchantTxnId,
      createdAt: now,
    })

    try {
      await createPaymentRecord(order, attempt, customer())
      expect(await claimPaymentCreation(attemptId, createEvent({
        id: randomUUID(),
        attemptId,
        source: 'server',
        sourceKey: `create-claim:${attemptId}`,
        status: 'created',
        occurredAt: now,
      }))).toEqual({ outcome: 'claimed' })
      await completePaymentRecord(attemptId, paymentId, createTransactionId, createEvent({
        id: randomUUID(),
        attemptId,
        source: 'server',
        sourceKey: `create:${attemptId}`,
        status: 'processing',
        rawStatus: 'U',
        transactionId: createTransactionId,
        occurredAt: now,
      }))

      const returned = await recordReturnEvent(attemptId, now)
      const duplicateReturn = await recordReturnEvent(attemptId, now)

      expect(returned.duplicate).toBe(false)
      expect(duplicateReturn.duplicate).toBe(true)

      const query = {
        paymentId,
        transactionId: webhookTransactionId,
        rawStatus: 'S',
        status: 'succeeded' as const,
      }
      const first = await recordQueryEvent(attemptId, paymentId, query, now)
      const duplicate = await recordQueryEvent(attemptId, paymentId, query, now)
      const partialAttribution = await recordPaymentMethodDetails(attemptId, paymentId, {
        paymentId,
        transactionId: webhookTransactionId,
        actualWallet: 'apple-pay',
      }, now)
      const attributed = await recordPaymentMethodDetails(attemptId, paymentId, {
        paymentId,
        transactionId: webhookTransactionId,
        fundingNetwork: 'VISA',
      }, now)
      const duplicateAttribution = await recordPaymentMethodDetails(attemptId, paymentId, {
        paymentId,
        transactionId: webhookTransactionId,
        actualWallet: 'apple-pay',
        fundingNetwork: 'VISA',
      }, now)

      expect(first.duplicate).toBe(false)
      expect(duplicate.duplicate).toBe(true)
      expect(partialAttribution).toMatchObject({
        method: 'apple-pay',
        actualWallet: 'apple-pay',
        attributionTransactionId: webhookTransactionId,
      })
      expect(partialAttribution.fundingNetwork).toBeUndefined()
      expect(attributed).toMatchObject({
        method: 'apple-pay',
        actualWallet: 'apple-pay',
        fundingNetwork: 'VISA',
        attributionTransactionId: webhookTransactionId,
      })
      expect(duplicateAttribution).toEqual(attributed)
      await expect(recordPaymentMethodDetails(attemptId, paymentId, {
        paymentId,
        transactionId: webhookTransactionId,
        actualWallet: 'google-pay',
        fundingNetwork: 'MASTERCARD',
      }, now)).rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })

      const advanced = await recordQueryEvent(attemptId, paymentId, {
        paymentId,
        transactionId: nextTransactionId,
        rawStatus: 'S',
        status: 'succeeded',
      }, now)
      expect(advanced.attempt.actualWallet).toBeUndefined()
      expect(advanced.attempt.fundingNetwork).toBeUndefined()
      expect(advanced.attempt.attributionTransactionId).toBeUndefined()
      await recordPaymentMethodDetails(attemptId, paymentId, {
        paymentId,
        transactionId: nextTransactionId,
        fundingNetwork: 'MASTERCARD',
      }, now)

      await recordWebhookEvent({
        transactionId: webhookTransactionId,
        paymentId,
        merchantTxnId,
        amountMinor: 500,
        currency: 'USD',
        transactionStatus: 'F',
        paymentStatus: 'O',
        status: 'processing',
        occurredAt: now,
      })

      const timeline = await getPaymentTimeline(merchantTxnId)
      const recovery = await getPaymentRecovery(orderId, attemptId)

      expect(timeline?.attempt.status).toBe('succeeded')
      expect(timeline?.attempt.statusSource).toBe('query')
      expect(timeline?.attempt).toMatchObject({
        method: 'apple-pay',
        fundingNetwork: 'MASTERCARD',
        attributionTransactionId: nextTransactionId,
      })
      expect(timeline?.attempt.actualWallet).toBeUndefined()
      expect(timeline?.events).toHaveLength(6)
      expect(timeline?.events.filter(event => event.source === 'return')).toHaveLength(1)
      expect(JSON.stringify(timeline)).not.toMatch(/payload|cardNumber|secret|sign/i)
      expect(recovery?.order.id).toBe(orderId)
      expect(recovery?.attempt.paymentId).toBe(paymentId)
    }
    finally {
      await deleteTestOrder(orderId)
    }
  }, 120_000)

  it('preserves an early Webhook terminal state when create completion arrives later', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const orderId = `HLD-TEST-${suffix}`
    const attemptId = `${orderId}-attempt-1`
    const merchantTxnId = `showcase-test-${suffix}`
    const paymentId = `5084${Date.now()}`.slice(0, 20)
    const transactionId = `6084${Date.now()}`.slice(0, 20)
    const now = new Date().toISOString()
    const order = createOrder({
      id: orderId,
      scene: 'ecommerce',
      item: {
        sku: 'HL-TEST-005',
        name: 'Persistence test',
        variant: 'Test only',
        quantity: 1,
        unitAmount: { minor: 500, currency: 'USD' },
      },
      amount: { minor: 500, currency: 'USD' },
      createdAt: now,
    })
    const attempt = createAttempt({
      id: attemptId,
      orderId,
      integration: 'web-js-sdk',
      method: 'card',
      merchantTxnId,
      createdAt: now,
    })
    const webhook = {
      transactionId,
      paymentId,
      merchantTxnId,
      amountMinor: 500,
      currency: 'USD' as const,
      transactionStatus: 'S',
      paymentStatus: 'S',
      status: 'succeeded' as const,
      occurredAt: now,
    }

    try {
      await createPaymentRecord(order, attempt, customer())
      const claim = createEvent({
        id: randomUUID(),
        attemptId,
        source: 'server',
        sourceKey: `create-claim:${attemptId}`,
        status: 'created',
        occurredAt: now,
      })

      expect(await claimPaymentCreation(attemptId, claim)).toEqual({ outcome: 'claimed' })
      expect(await claimPaymentCreation(attemptId, claim)).toEqual({ outcome: 'existing' })
      const first = await recordWebhookEvent(webhook)
      const duplicate = await recordWebhookEvent(webhook)
      const completed = await completePaymentRecord(attemptId, paymentId, transactionId, createEvent({
        id: randomUUID(),
        attemptId,
        source: 'server',
        sourceKey: `create:${attemptId}`,
        status: 'processing',
        rawStatus: 'U',
        transactionId,
        occurredAt: now,
      }))

      expect(first.duplicate).toBe(false)
      expect(duplicate.duplicate).toBe(true)
      expect(completed.status).toBe('succeeded')
      expect(completed.statusSource).toBe('webhook')
      await recordReturnEvent(attemptId, now)
      const reconciled = await recordQueryEvent(attemptId, paymentId, {
        paymentId,
        transactionId,
        rawStatus: 'N',
        status: 'cancelled',
      }, now)
      const returned = await getPaymentTimeline(merchantTxnId)

      expect(reconciled.event.conflict).toBe(true)
      expect(returned?.attempt.status).toBe('cancelled')
      expect(returned?.attempt.statusSource).toBe('query')
      const { paymentId: _paymentId, ...withoutPaymentId } = webhook

      await expect(recordWebhookEvent(withoutPaymentId))
        .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
    }
    finally {
      await deleteTestOrder(orderId)
    }
  }, 120_000)

  it('claims submission once and creates one retry child under concurrent requests', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const orderId = `HLD-TEST-${suffix}`
    const attemptId = `${orderId}-attempt-1`
    const merchantTxnId = `showcase-test-${suffix}`
    const paymentId = `7084${Date.now()}`.slice(0, 20)
    const transactionId = `8084${Date.now()}`.slice(0, 20)
    const now = new Date().toISOString()
    const order = createOrder({
      id: orderId,
      scene: 'ecommerce',
      item: {
        sku: 'HL-TEST-005',
        name: 'Retry persistence test',
        variant: 'Test only',
        quantity: 1,
        unitAmount: { minor: 500, currency: 'USD' },
      },
      amount: { minor: 500, currency: 'USD' },
      createdAt: now,
    })
    const attempt = createAttempt({
      id: attemptId,
      orderId,
      integration: 'web-js-sdk',
      method: 'google-pay',
      merchantTxnId,
      createdAt: now,
    })

    try {
      await createPaymentRecord(order, attempt, customer())
      await claimPaymentCreation(attemptId, createEvent({
        id: randomUUID(),
        attemptId,
        source: 'server',
        sourceKey: `create-claim:${attemptId}`,
        status: 'created',
        occurredAt: now,
      }))
      await completePaymentRecord(attemptId, paymentId, transactionId, createEvent({
        id: randomUUID(),
        attemptId,
        source: 'server',
        sourceKey: `create:${attemptId}`,
        status: 'processing',
        rawStatus: 'U',
        transactionId,
        occurredAt: now,
      }))

      const claims = await Promise.all([
        claimPaymentSubmission(attemptId, paymentId),
        claimPaymentSubmission(attemptId, paymentId),
      ])

      expect(claims.map(item => item.claimed).sort()).toEqual([false, true])
      expect(claims.every(item => item.attempt.submissionStartedAt)).toBe(true)

      await recordQueryEvent(attemptId, paymentId, {
        paymentId,
        transactionId,
        rawStatus: 'N',
        status: 'cancelled',
      }, now)
      await recordPaymentMethodDetails(attemptId, paymentId, {
        paymentId,
        transactionId,
        actualWallet: 'google-pay',
        fundingNetwork: 'VISA',
      }, now)

      const retries = await Promise.all([
        createPaymentRetry(orderId, attemptId, paymentId, now),
        createPaymentRetry(orderId, attemptId, paymentId, now),
      ])
      const childId = retries[0]!.attempt.id

      expect(retries[1]!.attempt.id).toBe(childId)
      expect(retries.map(item => item.created).sort()).toEqual([false, true])
      expect(retries.every(item => item.create)).toBe(true)
      expect(retries.every(item => item.attempt.retryOf === attemptId)).toBe(true)
      expect(retries.every(item => item.attempt.method === 'google-pay')).toBe(true)
      expect(retries.every(item => !item.attempt.actualWallet && !item.attempt.fundingNetwork)).toBe(true)

      const recovery = await getPaymentRecovery(orderId, childId)

      expect(recovery?.attempt.id).toBe(childId)
      expect(recovery?.attempts.map(item => item.id)).toEqual([attemptId, childId])
      expect(recovery?.attempts[1]?.retryOf).toBe(attemptId)

      await recordQueryEvent(attemptId, paymentId, {
        paymentId,
        transactionId,
        rawStatus: 'S',
        status: 'succeeded',
      }, new Date(Date.parse(now) + 1_000).toISOString())

      const rejected = await Promise.all([0, 1].map(() => claimPaymentCreation(childId, createEvent({
        id: randomUUID(),
        attemptId: childId,
        source: 'server',
        sourceKey: `create-claim:${childId}`,
        status: 'created',
        occurredAt: now,
      }))))

      expect(rejected).toEqual([
        { outcome: 'retry_rejected', parentId: attemptId },
        { outcome: 'retry_rejected', parentId: attemptId },
      ])
      await expect(createPaymentRetry(orderId, attemptId, paymentId, now))
        .rejects.toMatchObject({ code: 'PAYMENT_RETRY_NOT_ALLOWED' })

      const pool = new Pool({ connectionString: databaseUrl })

      try {
        const children = await pool.query<{ id: string }>(`
          SELECT id
          FROM payment_attempts
          WHERE retry_of = $1
        `, [attemptId])

        expect(children.rows).toEqual([{ id: childId }])

        const events = await pool.query<{ source_key: string }>(`
          SELECT source_key
          FROM payment_events
          WHERE attempt_id = $1 AND source = 'server'
          ORDER BY source_key
        `, [childId])

        expect(events.rows).toEqual([{ source_key: `retry-create-rejected:${childId}` }])
      }
      finally {
        await pool.end()
      }
    }
    finally {
      await deleteTestOrder(orderId)
    }
  }, 120_000)

  it('keeps a deeply nested active retry in the bounded recovery history', async () => {
    const fixture = recoveryFixture('deep retry')
    const activeId = `${fixture.orderId}-attempt-100`

    try {
      await createPaymentRecord(fixture.order, fixture.attempt, customer())
      const pool = new Pool({ connectionString: databaseUrl })

      try {
        await pool.query(`
          INSERT INTO payment_attempts (
            id, order_id, integration, method, status, status_source, retry_of,
            merchant_txn_id, payment_id, transaction_id, submission_started_at,
            created_at, updated_at
          )
          SELECT
            $1 || '-attempt-' || lpad(step::text, 3, '0'),
            $1,
            'web-js-sdk',
            'card',
            'created',
            NULL,
            CASE
              WHEN step = 1 THEN $2
              ELSE $1 || '-attempt-' || lpad((step - 1)::text, 3, '0')
            END,
            'showcase-test-' || $3 || '-' || step,
            NULL,
            NULL,
            NULL,
            CASE
              WHEN step = 50 THEN $4::timestamptz - interval '1 day'
              ELSE $4::timestamptz + step * interval '1 millisecond'
            END,
            CASE
              WHEN step = 50 THEN $4::timestamptz - interval '1 day'
              ELSE $4::timestamptz + step * interval '1 millisecond'
            END
          FROM generate_series(1, 100) AS step
        `, [fixture.orderId, fixture.attemptId, randomUUID().slice(0, 8), fixture.now])
      }
      finally {
        await pool.end()
      }

      const recovery = await getPaymentRecovery(fixture.orderId, activeId)

      expect(recovery?.attempt.id).toBe(activeId)
      expect(recovery?.attempts.map(item => item.id)).toEqual([
        fixture.attemptId,
        ...Array.from({ length: 49 }, (_, index) => (
          `${fixture.orderId}-attempt-${String(index + 1).padStart(3, '0')}`
        )),
        ...Array.from({ length: 50 }, (_, index) => (
          `${fixture.orderId}-attempt-${String(index + 51).padStart(3, '0')}`
        )),
      ])
      expect(recovery?.attempts.filter(item => item.id === activeId)).toHaveLength(1)
      expect(recovery?.attempts.at(-1)?.id).toBe(activeId)
    }
    finally {
      await deleteTestOrder(fixture.orderId)
    }
  }, 120_000)

  it('fails recovery closed for invalid retry topologies', async () => {
    const multipleRoots = recoveryFixture('multiple roots')
    const detachedCycle = recoveryFixture('detached cycle')
    const crossOrder = recoveryFixture('cross order')
    const detachedActive = recoveryFixture('detached active')
    const foreign = recoveryFixture('foreign parent')
    const detachedForeign = recoveryFixture('detached foreign parent')

    try {
      await createPaymentRecord(multipleRoots.order, multipleRoots.attempt, customer())
      await createPaymentRecord(detachedCycle.order, detachedCycle.attempt, customer())
      await createPaymentRecord(crossOrder.order, crossOrder.attempt, customer())
      await createPaymentRecord(detachedActive.order, detachedActive.attempt, customer())
      await createPaymentRecord(foreign.order, foreign.attempt, customer())
      await createPaymentRecord(detachedForeign.order, detachedForeign.attempt, customer())

      const pool = new Pool({ connectionString: databaseUrl })
      const secondRootId = `${multipleRoots.orderId}-attempt-root-2`
      const cycleAId = `${detachedCycle.orderId}-attempt-cycle-a`
      const cycleBId = `${detachedCycle.orderId}-attempt-cycle-b`
      const crossOrderChildId = `${crossOrder.orderId}-attempt-foreign`
      const detachedActiveId = `${detachedActive.orderId}-attempt-foreign`

      try {
        await insertRecoveryAttempt(pool, {
          id: secondRootId,
          orderId: multipleRoots.orderId,
          retryOf: null,
          createdAt: multipleRoots.now,
        })
        await insertRecoveryAttempt(pool, {
          id: cycleAId,
          orderId: detachedCycle.orderId,
          retryOf: null,
          createdAt: detachedCycle.now,
        })
        await insertRecoveryAttempt(pool, {
          id: cycleBId,
          orderId: detachedCycle.orderId,
          retryOf: cycleAId,
          createdAt: detachedCycle.now,
        })
        await pool.query('UPDATE payment_attempts SET retry_of = $2 WHERE id = $1', [
          cycleAId,
          cycleBId,
        ])
        await insertRecoveryAttempt(pool, {
          id: crossOrderChildId,
          orderId: crossOrder.orderId,
          retryOf: foreign.attemptId,
          createdAt: crossOrder.now,
        })
        await insertRecoveryAttempt(pool, {
          id: detachedActiveId,
          orderId: detachedActive.orderId,
          retryOf: detachedForeign.attemptId,
          createdAt: detachedActive.now,
        })
      }
      finally {
        await pool.end()
      }

      await expect(getPaymentRecovery(multipleRoots.orderId, multipleRoots.attemptId))
        .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
      await expect(getPaymentRecovery(detachedCycle.orderId, detachedCycle.attemptId))
        .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
      await expect(getPaymentRecovery(crossOrder.orderId, crossOrder.attemptId))
        .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
      await expect(getPaymentRecovery(detachedActive.orderId, detachedActiveId))
        .rejects.toMatchObject({ code: 'PAYMENT_ATTEMPT_MISMATCH' })
    }
    finally {
      await deleteTestOrder(multipleRoots.orderId)
      await deleteTestOrder(detachedCycle.orderId)
      await deleteTestOrder(crossOrder.orderId)
      await deleteTestOrder(detachedActive.orderId)
      await deleteTestOrder(foreign.orderId)
      await deleteTestOrder(detachedForeign.orderId)
    }
  }, 120_000)
})
