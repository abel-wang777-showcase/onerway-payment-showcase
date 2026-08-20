import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Client } from '@neondatabase/serverless'

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
const runtimeDatabaseUrls = [
  process.env.DATABASE_URL?.trim(),
  process.env.DATABASE_URL_UNPOOLED?.trim(),
].filter(Boolean)
const testDatabasePurpose = 'onerway-payment-showcase:ci'

if (!databaseUrl || process.env.PAYMENT_TEST_DATABASE_CONFIRM !== 'isolated') {
  throw new Error('PAYMENT_TEST_DATABASE_NOT_CONFIRMED')
}

function databaseTarget(value) {
  try {
    const url = new URL(value)
    const hostname = url.hostname.replace(/-pooler(?=\.)/, '')
    const port = url.port || '5432'

    return `${url.protocol}//${hostname}:${port}${url.pathname}`
  }
  catch {
    throw new Error('PAYMENT_TEST_DATABASE_URL_INVALID')
  }
}

const testDatabaseTarget = databaseTarget(databaseUrl)

if (runtimeDatabaseUrls.some(value => databaseTarget(value) === testDatabaseTarget)) {
  throw new Error('PAYMENT_TEST_DATABASE_NOT_ISOLATED')
}

async function verifyTestDatabaseGuard() {
  const client = new Client({ connectionString: databaseUrl })

  try {
    await client.connect()
    const result = await client.query(`
      SELECT purpose
      FROM payment_test_guard
      WHERE singleton = true
    `)

    if (result.rows[0]?.purpose !== testDatabasePurpose) {
      throw new Error('PAYMENT_TEST_DATABASE_GUARD_MISSING')
    }
  }
  catch {
    throw new Error('PAYMENT_TEST_DATABASE_GUARD_MISSING')
  }
  finally {
    await client.end().catch(() => {})
  }
}

await verifyTestDatabaseGuard()

const cwd = fileURLToPath(new URL('..', import.meta.url))
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DATABASE_URL_UNPOOLED: '',
  PAYMENT_TEST_DATABASE_VERIFIED: testDatabasePurpose,
}

for (const key of Object.keys(env)) {
  if (key.startsWith('ONERWAY_') || ['CRON_SECRET', 'PAYMENT_DIAGNOSTIC_TOKEN'].includes(key)) {
    delete env[key]
  }
}

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' })

    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolve()
      : reject(new Error('PAYMENT_DATABASE_TEST_FAILED')))
  })
}

await run(['scripts/migrate.mjs'])

const fixtureIds = []
let paymentSequence = 0

function paymentId() {
  paymentSequence += 1
  return `9${Date.now()}${String(paymentSequence).padStart(6, '0')}`
}

async function insertMigrationFixture(client, label) {
  const orderId = `migration-${label}-${randomUUID()}`
  const attemptId = `migration-${label}-${randomUUID()}`
  const now = new Date().toISOString()

  await client.query(`
    INSERT INTO payment_orders (
      id, scene, item_sku, item_name, item_variant, item_quantity,
      item_unit_minor, amount_minor, currency, fulfillment, created_at, updated_at
    ) VALUES ($1, 'ecommerce', 'migration-fixture', 'Migration fixture', 'Default', 1,
              500, 500, 'USD', 'pending', $2, $2)
  `, [orderId, now])
  await client.query(`
    INSERT INTO payment_attempts (
      id, order_id, integration, method, status, status_source, retry_of,
      merchant_txn_id, payment_id, transaction_id, submission_started_at,
      created_at, updated_at
    ) VALUES ($1, $2, 'web-js-sdk', 'card', 'processing', 'server', NULL,
              $3, $4, NULL, NULL, $5, $5)
  `, [attemptId, orderId, `migration-${randomUUID()}`, paymentId(), now])
  fixtureIds.push(orderId)

  return attemptId
}

async function verifyMigrationReplay() {
  const client = new Client({ connectionString: databaseUrl })

  try {
    await client.connect()
    const historicalAttempt = await insertMigrationFixture(client, 'historical')
    await client.query("DELETE FROM payment_schema_migrations WHERE version = '0002_retry'")
    await run(['scripts/migrate.mjs'])

    const historical = await client.query(`
      SELECT submission_started_at
      FROM payment_attempts
      WHERE id = $1
    `, [historicalAttempt])

    if (!historical.rows[0]?.submission_started_at) {
      throw new Error('PAYMENT_HISTORICAL_SUBMISSION_NOT_BACKFILLED')
    }

    const modernAttempt = await insertMigrationFixture(client, 'modern')
    await run(['scripts/migrate.mjs'])

    const result = await client.query(`
      SELECT
        (SELECT submission_started_at FROM payment_attempts WHERE id = $1) AS modern_submission,
        (SELECT count(*)::integer FROM payment_schema_migrations WHERE version = '0002_retry') AS ledger_count
    `, [modernAttempt])

    if (result.rows[0]?.modern_submission !== null || result.rows[0]?.ledger_count !== 1) {
      throw new Error('PAYMENT_MODERN_SUBMISSION_MIGRATION_DRIFT')
    }
  }
  finally {
    if (fixtureIds.length) {
      await client.query('DELETE FROM payment_orders WHERE id = ANY($1::text[])', [fixtureIds])
        .catch(() => {})
    }
    await client.end().catch(() => {})
  }
}

await verifyMigrationReplay()
await run(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts'])
