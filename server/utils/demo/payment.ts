import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from '@neondatabase/serverless'
import type { PaymentCreate, PaymentView, PaymentPage, ActionReason } from '../../../shared/payment/demo'
import type { ServerProfile } from '../profile'
import { createMobilePayment, queryPayment, queryPaymentCreation } from '../gateway'
import { demoTransaction, type DemoDatabaseClient } from './database'
import { DemoError } from './errors'
import { claimDemoOperation, resolveCustomer, readDemoOperation, consumeDemoLimit, hashDemo, demoOwnerHash, normalizeCustomerLabel, normalizeDemoOperationId, readDemoPage, demoPageCursor, type DemoSession } from './identity'
import { DEMO_REVISION, canExecute, demoCapabilities } from './capability'

export type SandboxProfile = Extract<ServerProfile, { profile: 'sandbox' }>
export interface PaymentRow extends QueryResultRow {
  id: string
  session_id: string
  request_id: string
  order_id: string
  attempt_id: string
  merchant_txn_id: string
  customer_id: string
  platform: 'ANDROID' | 'IOS'
  amount_minor: number | string
  currency: 'USD'
  return_url: string
  merchant_no: string
  config_revision: string
  creation_state: PaymentView['creationState']
  payment_id: string | null
  transaction_id: string | null
  raw_payment_status: PaymentView['status']['rawPaymentStatus']
  raw_transaction_status: string | null
  normalized: PaymentView['status']['normalized']
  status_source: PaymentView['status']['source']
  verified: boolean
  observed_at: Date | string | null
  revision: number | string
  created_at: Date | string
  expires_at: Date | string
  sent_at: Date | string | null
  continue_until: Date | string | null
}
export const iso = (value: Date | string): string => new Date(value).toISOString()
export const nowIso = (): string => new Date().toISOString()
export const DAY = 86_400_000

export async function ownedPayment(client: DemoDatabaseClient, sessionId: string, id: string, lock = false): Promise<PaymentRow> {
  const row = (await client.query<PaymentRow>(`SELECT * FROM demo_payments WHERE id=$1 AND session_id=$2${lock ? ' FOR UPDATE' : ''}`, [id, sessionId])).rows[0]
  if (!row) {
    const tombstone = (await client.query('SELECT resource_hash FROM demo_resource_tombstones WHERE resource_hash=$1 AND owner_hash=$2 AND expires_at>now()', [hashDemo(['demo-v1-resource', id]),demoOwnerHash(sessionId)])).rows[0]
    if (tombstone) throw new DemoError(410, 'RECORD_EXPIRED')
    throw new DemoError(403, 'RESOURCE_UNAVAILABLE')
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new DemoError(410, 'RECORD_EXPIRED')
  return row
}

export async function paymentView(client: DemoDatabaseClient, row: PaymentRow): Promise<PaymentView> {
  const session = (await client.query('SELECT current_customer_id FROM demo_sessions WHERE id=$1', [row.session_id])).rows[0]!
  const job = (await client.query('SELECT * FROM demo_jobs WHERE payment_id=$1', [row.id])).rows[0]
  const lease = (await client.query("SELECT * FROM demo_leases WHERE payment_id=$1 AND state='active' AND expires_at > now()", [row.id])).rows[0]
  let reason: ActionReason | null = null
  if (row.creation_state !== 'ready') reason = 'CREATION_NOT_READY'
  else if (row.raw_payment_status === 'S' || row.raw_payment_status === 'N') reason = 'PAYMENT_TERMINAL'
  else if (row.raw_payment_status === 'P') reason = 'PAYMENT_PROCESSING'
  else if (row.raw_payment_status === 'R') reason = 'EXTERNAL_ACTION_IN_PROGRESS'
  else if (row.raw_payment_status === 'A') reason = 'PAYMENT_AUTHORIZED'
  else if (!row.verified || !['U', 'O'].includes(row.raw_payment_status ?? '')) reason = 'CAPABILITY_UNVERIFIED'
  else if (!row.continue_until || new Date(row.continue_until).getTime() <= Date.now()) reason = 'PAYMENT_EXPIRED'
  else if (job?.last_error_code) reason = 'PROVIDER_UNAVAILABLE'
  else if (lease) reason = 'CHECKOUT_IN_USE'
  const due = job?.state === 'pending' && new Date(job.due_at).getTime() <= Date.now()
  const refreshState = job?.state === 'running' ? 'running' : job?.last_error_code ? 'failed' : due ? 'queued' : 'idle'
  return {
    id: row.id, requestId: row.request_id, merchantTxnId: row.merchant_txn_id,
    sceneId: 'one_time', integration: 'native-sdk', txnType: 'SALE', platform: row.platform,
    amount: { minor: Number(row.amount_minor), currency: 'USD' }, customerId: row.customer_id,
    createdAt: iso(row.created_at), recordExpiresAt: iso(row.expires_at), creationState: row.creation_state,
    provider: row.payment_id ? { merchantNo: row.merchant_no, paymentId: row.payment_id } : null,
    providerExpiresAt: null, currentCustomerId: session.current_customer_id, fundsState: 'not_applicable',
    revision: Number(row.revision),
    status: { normalized: row.normalized, source: row.status_source, verified: row.verified,
      observedAt: row.observed_at ? iso(row.observed_at) : null,
      isTerminal: row.raw_payment_status === 'S' || row.raw_payment_status === 'N',
      rawPaymentStatus: row.raw_payment_status, rawTransactionStatus: row.raw_transaction_status },
    allowedActions: [reason ? { type: 'CONTINUE_SDK', enabled: false, reasonCode: reason } : { type: 'CONTINUE_SDK', enabled: true, reasonCode: null },
      { type: 'QUERY', enabled: true, reasonCode: null }],
    attention: row.creation_state === 'unknown' || row.creation_state === 'pending' ? { kind: 'creation_unknown' }
      : !reason || (row.creation_state === 'ready' && !row.verified) ? { kind: 'continue_sdk' } : null,
    refresh: { state: refreshState, lastAttemptAt: job?.last_attempt_at ? iso(job.last_attempt_at) : null,
      lastErrorCode: job?.last_error_code ?? null, pollAfterSeconds: refreshState === 'idle' ? null : 5 },
  }
}

function returnUrl(input: PaymentCreate, session: DemoSession, profile: SandboxProfile, merchantTxnId: string): string {
  const target = input.returnTarget
  const expected = session.platform === 'ANDROID' ? 'app_android' : 'app_ios'
  if (target.kind === 'preset' && target.id !== expected) throw new DemoError(400, 'INPUT_INVALID', { fieldErrors: [{ field: 'returnTarget', code: 'PLATFORM_MISMATCH' }] })
  let url: URL
  try { url = new URL(target.kind === 'preset' ? `${profile.showcaseOrigin}/mobile/return/${session.platform.toLowerCase()}` : target.url) }
  catch { throw new DemoError(400, 'INPUT_INVALID') }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.searchParams.has('merchantTxnId')
    || (target.kind === 'custom' && target.url.length > 2048)
    || [...url.searchParams.keys()].some(key => /token|authorization|secret|session/i.test(key))) throw new DemoError(400, 'RETURN_URL_INVALID')
  url.searchParams.append('merchantTxnId', merchantTxnId)
  return url.toString()
}

export async function enqueuePayment(client: DemoDatabaseClient, id: string, dueAt = nowIso()): Promise<void> {
  await client.query(`INSERT INTO demo_jobs(payment_id,due_at,deadline_at) SELECT id,$2,expires_at FROM demo_payments WHERE id=$1
    ON CONFLICT(payment_id) DO UPDATE SET due_at=LEAST(demo_jobs.due_at,excluded.due_at),revision=demo_jobs.revision+1,
    state=CASE WHEN demo_jobs.state='running' THEN 'running' ELSE 'pending' END`, [id, dueAt])
}

export async function createDemoPayment(session: DemoSession, input: PaymentCreate, profile: SandboxProfile, compatible = true): Promise<{ status: number, body: PaymentView }> {
  input = { ...input, requestId: normalizeDemoOperationId(input.requestId), customer: input.customer.kind === 'new' ? { kind: 'new', label: normalizeCustomerLabel(input.customer.label) } : input.customer }
  const accepted = await demoTransaction(async (client) => {
    const claim = await claimDemoOperation(client, { sessionId: session.id, id: input.requestId, type: 'payment_create', intent: input })
    if (claim.existing) {
      const old = claim.operation!
      return { row: await ownedPayment(client, session.id, old.resource_id!), fresh: false }
    }
    if (!compatible) throw new DemoError(426, 'CLIENT_VERSION_UNSUPPORTED', { action: 'UPGRADE_CLIENT' })
    const combination = demoCapabilities().combinations.find(value => value.sceneId === input.sceneId && value.integration === input.integration && value.platform === session.platform)
    if (!combination || !canExecute(combination.availability)) throw new DemoError(409, 'CAPABILITY_UNAVAILABLE')
    await consumeDemoLimit(client, `payment:${session.id}`, 10, 60)
    const customer = await resolveCustomer(client, session.id, input.customer)
    const id = randomUUID(), attemptId = randomUUID(), orderId = randomUUID(), merchantTxnId = `demo_${randomUUID().replaceAll('-', '')}`
    const finalReturnUrl = returnUrl(input, session, profile, merchantTxnId)
    const createdAt = nowIso(), expiresAt = new Date(Date.now() + 30 * DAY).toISOString()
    await client.query(`INSERT INTO demo_operations(key_hash,session_id,id,type,execution,resource_kind,resource_id,created_at,expires_at) VALUES($1,$2,$3,'payment_create','accepted','payment',$4,$5,$6)`, [claim.keyHash,session.id,input.requestId,id,createdAt,expiresAt])
    await client.query(`INSERT INTO payment_orders(id,scene,item_sku,item_name,item_variant,item_quantity,item_unit_minor,amount_minor,currency,fulfillment,created_at,updated_at,customer_environment,customer_merchant_no,customer_app_id,merchant_cust_id)
      VALUES($1,'ecommerce','demo-native-sale','Demo purchase','Default',1,$2,$2,'USD','pending',$3,$3,'sandbox',$4,$5,$6)`, [orderId, input.amount.minor, createdAt, profile.merchantNo, profile.appId, customer.merchantCustId])
    await client.query(`INSERT INTO payment_attempts(id,order_id,integration,method,status,status_source,merchant_txn_id,created_at,updated_at)
      VALUES($1,$2,'native-sdk','card','created','server',$3,$4,$4)`, [attemptId, orderId, merchantTxnId, createdAt])
    const row = (await client.query<PaymentRow>(`INSERT INTO demo_payments(id,session_id,request_id,order_id,attempt_id,merchant_txn_id,customer_id,platform,amount_minor,currency,return_url,merchant_no,config_revision,creation_state,normalized,status_source,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'USD',$10,$11,$12,'pending','created','server',$13,$14) RETURNING *`,
    [id, session.id, input.requestId, orderId, attemptId, merchantTxnId, customer.id, session.platform, input.amount.minor, finalReturnUrl, profile.merchantNo, DEMO_REVISION, createdAt, expiresAt])).rows[0]!
    await enqueuePayment(client, id)
    return { row, fresh: true }
  })
  if (accepted.row.sent_at === null) {
    // Claim the send before network I/O. A crash in this gap is unknown, never a licence to resend.
    const sending = await demoTransaction(async (client) => {
      const row = (await client.query<PaymentRow>(`UPDATE demo_payments SET sent_at=now(),continue_until=now()+interval '30 minutes',creation_state='unknown',revision=revision+1 WHERE id=$1 AND sent_at IS NULL RETURNING *`, [accepted.row.id])).rows[0]
      if (row) await client.query("UPDATE demo_operations SET execution='unknown' WHERE id=$1", [input.requestId])
      return row
    })
    if (sending) {
      try {
        const customer = await demoTransaction(async client => (await client.query('SELECT merchant_cust_id FROM demo_customers WHERE id=$1', [sending.customer_id])).rows[0]!)
        const result = await createMobilePayment(profile, {
          merchantTxnId: sending.merchant_txn_id, merchantCustId: customer.merchant_cust_id, platform: sending.platform, returnUrl: sending.return_url,
          order: { id: sending.order_id, scene: 'ecommerce', amount: input.amount, fulfillment: 'pending', createdAt: iso(sending.created_at),
            item: { sku: 'demo-native-sale', name: 'Demo purchase', variant: 'Default', quantity: 1, unitAmount: input.amount } },
        })
        await demoTransaction(async (client) => {
          const row = await ownedPayment(client, session.id, sending.id, true)
          await attachProvider(client, row, result.paymentId, result.transactionId)
          await enqueuePayment(client, row.id)
        })
      }
      catch {
        // No upstream payload/error text is persisted. Every uncertain outcome is recovered by query only.
        await demoTransaction(async client => enqueuePayment(client, sending.id))
      }
    }
  }
  // A linked creation is not yet a verified payment state. Query once before
  // returning a ready view; uncertain creation still recovers through its job.
  const linked = await demoTransaction(client => ownedPayment(client, session.id, accepted.row.id))
  const body = await getDemoPayment(session.id, linked.id, profile, { process: linked.creation_state === 'ready' })
  return { status: body.creationState !== 'ready' ? 202 : accepted.fresh ? 201 : 200, body }
}

async function attachProvider(client: DemoDatabaseClient, row: PaymentRow, paymentId: string, transactionId: string): Promise<void> {
  if (row.payment_id && row.payment_id !== paymentId) throw new DemoError(409, 'PROVIDER_ID_MISMATCH')
  await client.query(`UPDATE demo_payments SET payment_id=$2,transaction_id=$3,creation_state='ready',normalized=CASE WHEN raw_payment_status IS NULL THEN 'unknown' ELSE normalized END,revision=revision+1 WHERE id=$1`, [row.id, paymentId, transactionId])
  await client.query(`UPDATE payment_attempts SET payment_id=$2,transaction_id=$3 WHERE id=$1`, [row.attempt_id, paymentId, transactionId])
  await client.query(`UPDATE demo_operations SET execution='completed',outcome='effective',error=NULL WHERE id=$1`, [row.request_id])
}

export async function getDemoPayment(sessionId: string, id: string, profile: SandboxProfile, options: { refresh?: boolean, process?: boolean } = {}): Promise<PaymentView> {
  await demoTransaction(async client => ownedPayment(client, sessionId, id))
  if (options.refresh) await demoTransaction(async client => enqueuePayment(client, id))
  if (options.process !== false) await runPaymentJob(profile, id)
  return demoTransaction(async client => paymentView(client, await ownedPayment(client, sessionId, id)))
}

export async function recoverDemoPayment(sessionId: string, requestId: string, profile: SandboxProfile): Promise<PaymentView> {
  const op = await demoTransaction(async client => readDemoOperation(client, sessionId, requestId))
  if (op.type !== 'payment_create' || !op.resource_id) throw new DemoError(409, 'IDEMPOTENCY_CONFLICT')
  return getDemoPayment(sessionId, op.resource_id, profile)
}

export async function listDemoPayments(sessionId: string, query: { limit?: number, cursor?: string, merchantTxnId?: string, customerId?: string, filter?: string }, profile: SandboxProfile): Promise<PaymentPage> {
  const { limit, cursor } = readDemoPage(query)
  const rows = await demoTransaction(async client => (await client.query<PaymentRow>(`SELECT p.* FROM demo_payments p WHERE session_id=$1 AND expires_at>now()
    AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::text))
    AND ($4::text IS NULL OR merchant_txn_id=$4) AND ($5::text IS NULL OR customer_id=$5)
    AND ($6::boolean=false OR creation_state IN ('pending','unknown') OR (creation_state='ready' AND NOT verified) OR
      (creation_state='ready' AND raw_payment_status IN ('U','O') AND verified AND continue_until>now()
       AND NOT EXISTS(SELECT 1 FROM demo_leases l WHERE l.payment_id=p.id AND l.state='active' AND l.expires_at>now())
       AND NOT EXISTS(SELECT 1 FROM demo_jobs j WHERE j.payment_id=p.id AND j.last_error_code IS NOT NULL)))
    ORDER BY created_at DESC,id DESC LIMIT $7`, [sessionId,cursor?.createdAt ?? null,cursor?.id ?? null,query.merchantTxnId ?? null,query.customerId ?? null,query.filter === 'needs-attention',limit+1])).rows)
  const selected = rows.slice(0, limit)
  // Bound each list request; the same persistent jobs also run through detail and daily scan.
  await Promise.all(selected.slice(0, 3).map(row => runPaymentJob(profile, row.id)))
  const views = await demoTransaction(async client => Promise.all(selected.map(async row => paymentView(client, await ownedPayment(client, sessionId, row.id)))))
  const items = views.filter(view => query.filter !== 'needs-attention' || view.attention !== null).map(view => ({
    id: view.id, merchantTxnId: view.merchantTxnId, sceneId: view.sceneId, integration: view.integration, txnType: view.txnType,
    amount: view.amount, createdAt: view.createdAt, creationState: view.creationState,
    status: { normalized: view.status.normalized, source: view.status.source, verified: view.status.verified, observedAt: view.status.observedAt, isTerminal: view.status.isTerminal },
    attention: view.attention, allowedActions: view.allowedActions, revision: view.revision, recordExpiresAt: view.recordExpiresAt, refresh: view.refresh,
  }))
  return { items, nextCursor: rows.length > limit ? demoPageCursor(iso(selected.at(-1)!.created_at), selected.at(-1)!.id) : null }
}

export async function runPaymentJob(profile: SandboxProfile, paymentId?: string): Promise<boolean> {
  const work = await demoTransaction(async (client) => {
    await client.query("UPDATE demo_jobs SET state='unresolved',lease_until=NULL,last_error_code='QUERY_DEADLINE_REACHED' WHERE deadline_at<=now() AND ($1::text IS NULL OR payment_id=$1) AND state IN ('pending','running')", [paymentId ?? null])
    const job = (await client.query(`SELECT * FROM demo_jobs WHERE ($1::text IS NULL OR payment_id=$1) AND due_at<=now() AND deadline_at>now()
      AND (state='pending' OR (state='running' AND lease_until<=now())) ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1`, [paymentId ?? null])).rows[0]
    if (!job) return null
    try {
      await consumeDemoLimit(client, `query:${job.payment_id}`, 10, 60)
      await consumeDemoLimit(client, 'worker:global', 120, 60)
    }
    catch (error) {
      if (error instanceof DemoError && error.statusCode === 429) {
        await client.query(`UPDATE demo_jobs SET due_at=now()+($2*interval '1 second'),state='pending',lease_until=NULL WHERE payment_id=$1`, [job.payment_id,error.body.error.retryAfter ?? 60])
        return { deferred: true } as const
      }
      throw error
    }
    await client.query(`UPDATE demo_jobs SET state='running',lease_until=now()+interval '45 seconds',attempts=attempts+1,last_attempt_at=now(),claimed_revision=revision WHERE payment_id=$1`, [job.payment_id])
    const row = (await client.query<PaymentRow>('SELECT * FROM demo_payments WHERE id=$1', [job.payment_id])).rows[0]!
    return { row, revision: Number(job.revision), attempts: Number(job.attempts) + 1 }
  })
  if (!work) return false
  if ('deferred' in work) return true
  let errorCode: string | null = null
  try {
    let providerId = work.row.payment_id
    // Creation recovery checks merchant reference, amount and currency before linking anything.
    const transaction = await queryPaymentCreation(profile, work.row.merchant_txn_id, Number(work.row.amount_minor), work.row.currency)
    if (providerId && providerId !== transaction.paymentId) throw new Error('mismatch')
    providerId = transaction.paymentId
    const fact = await queryPayment(profile, providerId)
    if (fact.rawStatus === 'S' && (transaction.rawStatus !== 'S' || fact.transactionId !== transaction.transactionId)) throw new Error('unverified funds')
    await demoTransaction(async (client) => {
      const row = (await client.query<PaymentRow>('SELECT * FROM demo_payments WHERE id=$1 FOR UPDATE', [work.row.id])).rows[0]!
      if (!row) return
      const job = (await client.query(`SELECT * FROM demo_jobs WHERE payment_id=$1 AND state='running' AND claimed_revision=$2 AND attempts=$3 AND lease_until>clock_timestamp() FOR UPDATE`, [row.id, work.revision, work.attempts])).rows[0]
      if (!job) return
      await attachProvider(client, row, providerId!, transaction.transactionId)
      await mergePaymentFact(client, row, fact.rawStatus, transaction.rawStatus, 'query')
    })
  }
  catch { errorCode = 'PROVIDER_UNAVAILABLE' }
  await demoTransaction(async (client) => {
    const current = (await client.query<PaymentRow>('SELECT * FROM demo_payments WHERE id=$1', [work.row.id])).rows[0]!
    if (!current) return
    const terminal = current.raw_payment_status === 'S'
    const backoff = Math.min(3600, 5 * 2 ** Math.min(work.attempts, 10))
    await client.query(`UPDATE demo_jobs SET lease_until=NULL,last_error_code=$3,
      state=CASE WHEN revision<>$2 THEN 'pending' WHEN $4 THEN 'completed' WHEN attempts>=20 AND $3::text IS NOT NULL THEN 'unresolved' ELSE 'pending' END,
      due_at=CASE WHEN revision<>$2 THEN now() ELSE now()+($5 * interval '1 second') END
      WHERE payment_id=$1 AND claimed_revision=$2 AND attempts=$6 AND state='running'`, [work.row.id, work.revision, errorCode, terminal, backoff, work.attempts])
  })
  return true
}

export async function mergePaymentFact(client: DemoDatabaseClient, row: PaymentRow, raw: string, transaction: string | null, source: 'query' | 'webhook'): Promise<void> {
  if (!['I', 'U', 'O', 'P', 'R', 'A', 'N', 'S'].includes(raw)) throw new DemoError(502, 'PROVIDER_STATE_UNKNOWN')
  // A successful payment is monotonic; a late verified success can correct a prior close.
  if (row.raw_payment_status === 'S' && raw !== 'S') return
  if (row.raw_payment_status === 'N' && raw !== 'S' && raw !== 'N') return
  const normalized = raw === 'S' ? 'succeeded' : raw === 'N' ? 'cancelled' : raw === 'R' ? 'requires_action' : 'processing'
  const now = nowIso()
  await client.query(`UPDATE demo_payments SET raw_payment_status=$2,raw_transaction_status=$3,normalized=$4,status_source=$5,verified=true,observed_at=$6,revision=revision+1 WHERE id=$1`, [row.id, raw, transaction, normalized, source, now])
  await client.query(`UPDATE payment_attempts SET status=$2,status_source=$3,updated_at=$4 WHERE id=$1`, [row.attempt_id, normalized, source, now])
  await client.query(`INSERT INTO demo_events(id,payment_id,source,kind,raw_status,occurred_at) VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), row.id, source, row.raw_payment_status === 'N' && raw === 'S' ? 'late_success' : 'payment_observed', raw, now])
}
