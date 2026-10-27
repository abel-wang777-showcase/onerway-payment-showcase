import { readdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { QueryResultRow } from '@neondatabase/serverless'
import { createDemoTransaction, type DemoDatabaseConnection } from '../server/utils/demo/database'

/** Real PostgreSQL SQL in-process; serialized connections do not model Neon concurrency. */
export async function createDemoTestDatabase() {
  const db = new PGlite()
  const directory = new URL('../server/db/migrations/', import.meta.url)
  for (const name of (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    await db.exec(await readFile(new URL(name, directory), 'utf8'))
  }

  let available = Promise.resolve()
  const transaction = createDemoTransaction(() => ({
    async connect(): Promise<DemoDatabaseConnection> {
      const preceding = available
      let release!: () => void
      available = new Promise<void>((resolve) => { release = resolve })
      await preceding
      return {
        async query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
          const result = await db.query<Row>(text, values)
          return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length, command: '', oid: 0, fields: [] }
        },
        release,
      }
    },
  }))
  return { db, transaction, close: () => db.close() }
}
