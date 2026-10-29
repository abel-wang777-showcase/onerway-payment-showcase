import { Pool } from '@neondatabase/serverless'
import type { QueryResult, QueryResultRow } from '@neondatabase/serverless'

export interface DemoDatabaseClient {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<Row>>
}

export interface DemoDatabaseConnection extends DemoDatabaseClient {
  release(discard?: boolean): void
}

export interface DemoDatabasePool {
  connect(): Promise<DemoDatabaseConnection>
}

export class DemoDatabaseError extends Error {
  readonly code = 'DEMO_DATABASE_UNAVAILABLE'

  constructor() {
    // Do not attach driver errors: PostgreSQL errors may include SQL and values.
    super('DEMO_DATABASE_UNAVAILABLE')
    this.name = 'DemoDatabaseError'
  }
}

export const DEMO_DATABASE_TIMEOUT_MS = 8_000

/** A pg-compatible pool also permits isolated local PostgreSQL integration tests. */
export function createDemoTransaction(getPool: () => DemoDatabasePool) {
  return async function transaction<T>(task: (client: DemoDatabaseClient) => Promise<T>): Promise<T> {
    let connection: DemoDatabaseConnection
    try {
      connection = await getPool().connect()
    }
    catch {
      throw new DemoDatabaseError()
    }

    let begun = false
    let discard = false
    const client: DemoDatabaseClient = {
      async query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
        try {
          return await connection.query<Row>(text, values)
        }
        catch {
          discard = true
          throw new DemoDatabaseError()
        }
      },
    }

    try {
      await client.query('BEGIN')
      begun = true
      await client.query(`SET LOCAL statement_timeout = '${DEMO_DATABASE_TIMEOUT_MS}ms'`)
      const result = await task(client)
      await client.query('COMMIT')
      return result
    }
    catch (error) {
      if (begun) {
        await client.query('ROLLBACK').catch(() => { discard = true })
      }
      // Preserve application errors, while every driver operation is sanitized.
      throw error
    }
    finally {
      connection.release(discard)
    }
  }
}

let pool: Pool | undefined

function demoPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL?.trim()
    if (!connectionString) throw new DemoDatabaseError()
    pool = new Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: DEMO_DATABASE_TIMEOUT_MS,
      query_timeout: DEMO_DATABASE_TIMEOUT_MS,
      idle_in_transaction_session_timeout: DEMO_DATABASE_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: true,
    })
    pool.on('error', () => {})
  }
  return pool
}

export const demoTransaction = createDemoTransaction(demoPool)
