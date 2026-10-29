import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { demoTransaction, type DemoDatabaseClient } from './database'
import { DemoError, invalidDemoField } from './errors'

export const DEMO_CUSTOMER_LIMIT = 20
export const DEMO_RETENTION_DAYS = 30
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export interface DemoSession {
  id: string
  platform: 'ANDROID' | 'IOS' | 'WEB'
  currentCustomerId: string | null
  expiresAt: string
  createdAt: string
}
interface SessionRow {
  id: string
  platform: DemoSession['platform']
  current_customer_id: string | null
  expires_at: Date | string
  created_at: Date | string
}
export interface CustomerRecord {
  id: string
  label: string
  merchantCustId: string
  createdAt: string
}
interface CustomerRow { id: string, label: string, merchant_cust_id: string, created_at: Date | string }
export interface OperationRow {
  key_hash: string
  session_id: string
  id: string
  type: string
  execution: 'accepted' | 'unknown' | 'completed'
  outcome: 'scheduled' | 'effective' | 'rejected' | null
  resource_kind: string | null
  resource_id: string | null
  lease_state?: 'active' | 'released' | 'expired' | 'superseded' | null
  error: unknown
  created_at: Date | string
  expires_at: Date | string
}
export type CustomerChoice = { kind: 'current' } | { kind: 'existing', id: string } | { kind: 'new', label: string }
function iso(value: Date | string): string { return new Date(value).toISOString() }
function sessionView(row: SessionRow): DemoSession {
  return { id: row.id, platform: row.platform, currentCustomerId: row.current_customer_id, expiresAt: iso(row.expires_at), createdAt: iso(row.created_at) }
}
function customerRecord(row: CustomerRow): CustomerRecord {
  return { id: row.id, label: row.label, merchantCustId: row.merchant_cust_id, createdAt: iso(row.created_at) }
}
function publicCustomer(customer: CustomerRecord) { return { id: customer.id, label: customer.label, createdAt: customer.createdAt } }
/** Stable JSON compares the submitted intent, independently of later defaults. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new TypeError('DEMO_INTENT_INVALID')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
}
export function hashDemo(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex') }
export function normalizeDemoOperationId(id: string): string {
  if (typeof id !== 'string' || !uuidV4.test(id)) invalidDemoField('operationId')
  return id.toLowerCase()
}
export function demoKeyHash(id: string): string { return hashDemo(['demo-v1-key', normalizeDemoOperationId(id)]) }
export function demoOwnerHash(sessionId: string): string { return hashDemo(['demo-v1-owner', sessionId]) }
export function normalizeCustomerLabel(value: string): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) invalidDemoField('label')
  const label = value.trim()
  if ([...label].length < 1 || [...label].length > 40) invalidDemoField('label')
  return label
}
export async function createDemoSession(platform: DemoSession['platform']): Promise<{ session: DemoSession, sessionToken: string }> {
  if (!['ANDROID', 'IOS'].includes(platform)) invalidDemoField('platform', 'PLATFORM_NOT_SUPPORTED')
  const sessionToken = randomBytes(32).toString('base64url')
  return demoTransaction(async (client) => {
    const result = await client.query<SessionRow>(`
      INSERT INTO demo_sessions (id, token_hash, platform, created_at, expires_at)
      VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp() + interval '30 days') RETURNING *
    `, [randomUUID(), hashDemo(['demo-v1-token', sessionToken]), platform])
    return { session: sessionView(result.rows[0]!), sessionToken }
  })
}
/** A valid credential renews before business validation; expired sessions cannot revive. */
export async function authenticateDemoSession(token: string | null | undefined): Promise<DemoSession> {
  if (!token) throw new DemoError(401, 'SESSION_MISSING', { action: 'START_NEW_SESSION' })
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DemoError(401, 'SESSION_INVALID', { action: 'START_NEW_SESSION' })
  return demoTransaction(async (client) => {
    const tokenHash = hashDemo(['demo-v1-token', token])
    const locked = await client.query<SessionRow & { expired: boolean }>(`
      SELECT *, expires_at <= clock_timestamp() AS expired FROM demo_sessions WHERE token_hash = $1 FOR UPDATE
    `, [tokenHash])
    const row = locked.rows[0]
    if (!row) throw new DemoError(401, 'SESSION_INVALID', { action: 'START_NEW_SESSION' })
    if (row.expired) throw new DemoError(401, 'SESSION_EXPIRED', { action: 'START_NEW_SESSION' })
    const updated = await client.query<SessionRow>(`
      UPDATE demo_sessions SET expires_at = GREATEST(expires_at, clock_timestamp() + interval '30 days') WHERE id = $1 AND expires_at > clock_timestamp() RETURNING *
    `, [row.id])
    if (!updated.rows[0]) throw new DemoError(401, 'SESSION_EXPIRED', { action: 'START_NEW_SESSION' })
    return sessionView(updated.rows[0])
  })
}
export async function getDemoSession(sessionId: string): Promise<DemoSession> {
  return demoTransaction(async (client) => {
    const result = await client.query<SessionRow>('SELECT * FROM demo_sessions WHERE id = $1', [sessionId])
    if (!result.rows[0]) throw new DemoError(401, 'SESSION_INVALID', { action: 'START_NEW_SESSION' })
    return sessionView(result.rows[0])
  })
}
/** The session lock serializes current/default customer resolution and the quota. */
export async function resolveCustomer(client: DemoDatabaseClient, sessionId: string, choice: CustomerChoice, limit = DEMO_CUSTOMER_LIMIT): Promise<CustomerRecord> {
  const session = await client.query<SessionRow>('SELECT * FROM demo_sessions WHERE id = $1 FOR UPDATE', [sessionId])
  if (!session.rows[0]) throw new DemoError(401, 'SESSION_INVALID')
  const existingId = choice.kind === 'existing' ? choice.id : choice.kind === 'current' ? session.rows[0].current_customer_id : null
  if (choice.kind === 'existing' || existingId) {
    const result = await client.query<CustomerRow>('SELECT * FROM demo_customers WHERE id = $1 AND session_id = $2', [existingId, sessionId])
    if (!result.rows[0]) throw new DemoError(403, 'RESOURCE_UNAVAILABLE')
    return customerRecord(result.rows[0])
  }
  const count = await client.query<{ count: number }>('SELECT count(*)::integer AS count FROM demo_customers WHERE session_id = $1', [sessionId])
  if (count.rows[0]!.count >= limit) throw new DemoError(409, 'CUSTOMER_LIMIT_REACHED')
  const label = choice.kind === 'new' ? normalizeCustomerLabel(choice.label) : 'Test customer'
  const result = await client.query<CustomerRow>(`
    INSERT INTO demo_customers (id, session_id, label, merchant_cust_id, created_at)
    VALUES ($1, $2, $3, $4, date_trunc('milliseconds', clock_timestamp())) RETURNING *
  `, [randomUUID(), sessionId, label, `demo_${randomBytes(16).toString('hex')}`])
  const customer = customerRecord(result.rows[0]!)
  await client.query('UPDATE demo_sessions SET current_customer_id = $1 WHERE id = $2', [customer.id, sessionId])
  return customer
}
export async function setCurrentCustomer(sessionId: string, customerId: string): Promise<DemoSession> {
  return demoTransaction(async (client) => {
    await client.query('SELECT id FROM demo_sessions WHERE id = $1 FOR UPDATE', [sessionId])
    const customer = await client.query('SELECT id FROM demo_customers WHERE id = $1 AND session_id = $2', [customerId, sessionId])
    if (!customer.rows.length) throw new DemoError(403, 'RESOURCE_UNAVAILABLE')
    const result = await client.query<SessionRow>('UPDATE demo_sessions SET current_customer_id = $1 WHERE id = $2 RETURNING *', [customerId, sessionId])
    return sessionView(result.rows[0]!)
  })
}
interface ClaimRow { owner_hash: string, intent_hash: string, type: string, expired: boolean }
async function existingOperation(client: DemoDatabaseClient, sessionId: string, keyHash: string, claim: ClaimRow): Promise<OperationRow> {
  if (claim.owner_hash !== demoOwnerHash(sessionId)) throw new DemoError(409, 'IDEMPOTENCY_KEY_UNAVAILABLE')
  if (claim.expired) throw new DemoError(410, 'RECORD_EXPIRED')
  const operation = await client.query<OperationRow & { expired: boolean }>(`
    SELECT *, expires_at <= clock_timestamp() AS expired FROM demo_operations WHERE key_hash = $1
  `, [keyHash])
  if (!operation.rows[0] || operation.rows[0].expired) throw new DemoError(410, 'RECORD_EXPIRED')
  return operation.rows[0]
}
/** Caller must create its operation/resource before committing a new claim. */
export async function claimDemoOperation(client: DemoDatabaseClient, input: { sessionId: string, id: string, type: string, intent: unknown }): Promise<{ keyHash: string, existing: boolean, operation: OperationRow | null }> {
  const keyHash = demoKeyHash(input.id)
  const intentHash = hashDemo(input.intent)
  const inserted = await client.query(`
    INSERT INTO demo_claims (key_hash, owner_hash, intent_hash, type, created_at, expired)
    VALUES ($1, $2, $3, $4, clock_timestamp(), false) ON CONFLICT (key_hash) DO NOTHING RETURNING key_hash
  `, [keyHash, demoOwnerHash(input.sessionId), intentHash, input.type])
  if (inserted.rows.length) return { keyHash, existing: false, operation: null }
  const result = await client.query<ClaimRow>('SELECT * FROM demo_claims WHERE key_hash = $1 FOR UPDATE', [keyHash])
  const claim = result.rows[0]!
  const operation = await existingOperation(client, input.sessionId, keyHash, claim)
  if (claim.type !== input.type || claim.intent_hash !== intentHash) throw new DemoError(409, 'IDEMPOTENCY_CONFLICT')
  return { keyHash, existing: true, operation }
}
export async function readDemoOperation(client: DemoDatabaseClient, sessionId: string, id: string): Promise<OperationRow> {
  const keyHash = demoKeyHash(id)
  const result = await client.query<ClaimRow>('SELECT * FROM demo_claims WHERE key_hash = $1', [keyHash])
  if (!result.rows[0]) throw new DemoError(404, 'REQUEST_NOT_FOUND', { action: 'RETRY_SAME_REQUEST' })
  return existingOperation(client, sessionId, keyHash, result.rows[0])
}
/** Fixed database windows are shared across instances; use only after replay lookup. */
export async function consumeDemoLimit(client: DemoDatabaseClient, key: string, maximum: number, windowSeconds: number): Promise<void> {
  const result = await client.query<{ count: number, retry_after: number }>(`
    INSERT INTO demo_limits (key, count, reset_at) VALUES ($1, 1, clock_timestamp() + make_interval(secs => $2))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN demo_limits.reset_at <= clock_timestamp() THEN 1 ELSE demo_limits.count + 1 END,
      reset_at = CASE WHEN demo_limits.reset_at <= clock_timestamp() THEN clock_timestamp() + make_interval(secs => $2) ELSE demo_limits.reset_at END
    RETURNING count, GREATEST(1, ceil(extract(epoch FROM reset_at - clock_timestamp())))::integer AS retry_after
  `, [hashDemo(['demo-v1-limit', key]), windowSeconds])
  if (result.rows[0]!.count > maximum) throw new DemoError(429, 'RATE_LIMITED', { retryable: true, retryAfter: result.rows[0]!.retry_after, action: 'RETRY_SAME_REQUEST' })
}
export async function createDemoCustomer(sessionId: string, input: { operationId: string, label: string }, options: { compatible?: boolean, limit?: number } = {}) {
  const id = normalizeDemoOperationId(input.operationId)
  const label = normalizeCustomerLabel(input.label)
  const result = await demoTransaction(async (client) => {
    const claim = await claimDemoOperation(client, { sessionId, id, type: 'customer_create', intent: { label } })
    if (claim.existing) {
      const customer = await client.query<CustomerRow>('SELECT * FROM demo_customers WHERE id = $1 AND session_id = $2', [claim.operation!.resource_id, sessionId])
      if (!customer.rows[0]) throw new DemoError(410, 'RECORD_EXPIRED')
      return { status: 200 as const, customer: customerRecord(customer.rows[0]) }
    }
    if (options.compatible === false) throw new DemoError(426, 'CLIENT_VERSION_UNSUPPORTED', { action: 'UPGRADE_CLIENT' })
    await consumeDemoLimit(client, `${sessionId}:customer_create`, 20, 60)
    const customer = await resolveCustomer(client, sessionId, { kind: 'new', label }, options.limit)
    await client.query(`
      INSERT INTO demo_operations (key_hash, session_id, id, type, execution, outcome, resource_kind, resource_id, error, created_at, expires_at)
      VALUES ($1, $2, $3, 'customer_create', 'completed', 'effective', 'customer', $4, NULL, clock_timestamp(), clock_timestamp() + interval '30 days')
    `, [claim.keyHash, sessionId, id, customer.id])
    return { status: 201 as const, customer }
  })
  const session = await getDemoSession(sessionId)
  return { status: result.status, body: { ...publicCustomer(result.customer), currentCustomerId: session.currentCustomerId } }
}
export function readDemoPage(input: { cursor?: string, limit?: number }): { cursor: { createdAt: string, id: string } | null, limit: number } {
  const limit = input.limit ?? 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalidDemoField('limit')
  let cursor: { createdAt: string, id: string } | null = null
  if (input.cursor !== undefined) {
    if (!input.cursor || input.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) invalidDemoField('cursor')
    try {
      const value: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'string'
        || iso(value[0]) !== value[0] || !uuidV4.test(value[1])) invalidDemoField('cursor')
      cursor = { createdAt: value[0], id: value[1] }
    }
    catch { invalidDemoField('cursor') }
  }
  return { cursor, limit }
}
export function demoPageCursor(createdAt: string, id: string): string { return Buffer.from(JSON.stringify([createdAt, id])).toString('base64url') }
export async function listDemoCustomers(sessionId: string, input: { cursor?: string, limit?: number } = {}) {
  const { cursor, limit } = readDemoPage(input)
  return demoTransaction(async (client) => {
    const result = await client.query<CustomerRow>(`
      SELECT * FROM demo_customers WHERE session_id = $1
      AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::text))
      ORDER BY created_at DESC, id DESC LIMIT $4
    `, [sessionId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1])
    const items = result.rows.slice(0, limit).map(row => publicCustomer(customerRecord(row)))
    const last = items.at(-1)
    return { items, nextCursor: result.rows.length > limit && last ? demoPageCursor(last.createdAt, last.id) : null }
  })
}
