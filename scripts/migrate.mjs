import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Client } from '@neondatabase/serverless'
import { resolveVercelMigrationAction } from './migration.mjs'

const vercelGate = process.argv.includes('--vercel-gate')
const action = vercelGate
  ? resolveVercelMigrationAction(
      process.env.VERCEL_ENV,
      process.env.PAYMENT_MIGRATION_MODE,
    )
  : 'apply'

async function migrate() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('PAYMENT_DATABASE_URL_MISSING')
  }

  const directory = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
  const names = (await readdir(directory))
    .filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
  const migrations = await Promise.all(names.map(async name => ({
    name: name.slice(0, -4),
    sql: await readFile(new URL(`../server/db/migrations/${name}`, import.meta.url), 'utf8'),
  })))
  const client = new Client({ connectionString })

  try {
    await client.connect()
    await client.query('BEGIN')
    for (const migration of migrations) {
      await client.query(migration.sql)
    }
    await client.query('COMMIT')
    process.stdout.write(`Applied payment schema migrations ${migrations.map(item => item.name).join(', ')}\n`)
  }
  catch {
    await client.query('ROLLBACK').catch(() => {})
    throw new Error('PAYMENT_DATABASE_MIGRATION_FAILED')
  }
  finally {
    await client.end().catch(() => {})
  }
}

if (action === 'apply') {
  await migrate()
}
else {
  process.stdout.write('Skipped payment schema migration for this Vercel environment\n')
}
