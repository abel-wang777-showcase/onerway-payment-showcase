import { randomUUID } from 'node:crypto'
import type { CheckoutSession, CheckoutSessionCreate, LeaseState, Operation } from '../../../shared/payment/demo'
import { demoTransaction, type DemoDatabaseClient } from './database'
import { DemoError } from './errors'
import { claimDemoOperation, consumeDemoLimit, normalizeDemoOperationId, readDemoOperation, type DemoSession, type OperationRow } from './identity'
import { canExecute, demoCapabilities } from './capability'
import { getDemoPayment, iso, ownedPayment, paymentView, type PaymentRow, type SandboxProfile } from './payment'

interface LeaseRow {
  id: string
  payment_id: string
  session_id: string
  operation_id: string
  expires_at: Date | string
  state: LeaseState
}

function leaseState(lease: LeaseRow, now = Date.now()): LeaseState {
  return lease.state === 'active' && new Date(lease.expires_at).getTime() <= now ? 'expired' : lease.state
}

async function requireWindow(client: DemoDatabaseClient, row: PaymentRow): Promise<void> {
  if (row.continue_until && new Date(row.continue_until).getTime() <= Date.now()) {
    throw new DemoError(409, 'PAYMENT_EXPIRED', { action: 'REFRESH', currentView: await paymentView(client, row) })
  }
}

async function ownedLease(client: DemoDatabaseClient, sessionId: string, paymentId: string, leaseId: string): Promise<LeaseRow> {
  const lease = (await client.query<LeaseRow>('SELECT * FROM demo_leases WHERE id=$1 AND payment_id=$2 AND session_id=$3', [leaseId, paymentId, sessionId])).rows[0]
  if (!lease) throw new DemoError(403, 'RESOURCE_UNAVAILABLE')
  return lease
}

function checkoutView(row: PaymentRow, lease: LeaseRow): CheckoutSession {
  return {
    checkoutSessionId: lease.id, leaseExpiresAt: iso(lease.expires_at), revision: Number(row.revision),
    sdk: { merchantNo: row.merchant_no, paymentId: row.payment_id!, environment: 'sandbox', configRevision: row.config_revision },
  }
}

async function ensureReplay(client: DemoDatabaseClient, row: PaymentRow, operation: OperationRow): Promise<LeaseRow> {
  const lease = await ownedLease(client, row.session_id, row.id, operation.resource_id!)
  if (leaseState(lease) !== 'active') {
    throw new DemoError(409, 'CHECKOUT_SESSION_ENDED', { action: 'REFRESH', currentView: await paymentView(client, row) })
  }
  return lease
}

export async function createDemoCheckout(session: DemoSession, paymentId: string, input: CheckoutSessionCreate, profile: SandboxProfile, compatible = true): Promise<{ status: number, body: CheckoutSession }> {
  const operationId = normalizeDemoOperationId(input.operationId)
  const intent = { paymentId, supersedes: input.supersedes ?? null }
  // No claim is committed before the upstream read. Failed validation leaves no
  // half-operation, and slow Provider queries do not hold a database row lock.
  await demoTransaction(async (client) => {
    const row = await ownedPayment(client, session.id, paymentId)
    await requireWindow(client, row)
    if (input.supersedes) await ownedLease(client, session.id, paymentId, input.supersedes)
    let existing: OperationRow | null = null
    try { existing = await readDemoOperation(client, session.id, operationId) }
    catch (error) {
      if (!(error instanceof DemoError) || error.statusCode !== 404) throw error
    }
    if (existing) {
      const claim = await claimDemoOperation(client, { sessionId: session.id, id: operationId, type: 'checkout_session', intent })
      await ensureReplay(client, row, claim.operation!)
    }
    else if (!compatible) throw new DemoError(426, 'CLIENT_VERSION_UNSUPPORTED', { action: 'UPGRADE_CLIENT' })
  })

  const refreshStartedAt = Date.now()
  const refreshed = await getDemoPayment(session.id, paymentId, profile, { refresh: true })
  return demoTransaction(async (client) => {
    // All lease mutations use the payment lock, including release and takeover.
    const row = await ownedPayment(client, session.id, paymentId, true)
    await requireWindow(client, row)
    if (input.supersedes) await ownedLease(client, session.id, paymentId, input.supersedes)
    const claim = await claimDemoOperation(client, { sessionId: session.id, id: operationId, type: 'checkout_session', intent })
    const replay = claim.existing ? await ensureReplay(client, row, claim.operation!) : null
    if (!claim.existing && !compatible) throw new DemoError(426, 'CLIENT_VERSION_UNSUPPORTED', { action: 'UPGRADE_CLIENT' })
    const view = await paymentView(client, row)
    const job = (await client.query<{ revision: string | number, claimed_revision: string | number | null }>(
      'SELECT revision,claimed_revision FROM demo_jobs WHERE payment_id=$1', [paymentId],
    )).rows[0]
    const coveredLatestEvent = job?.claimed_revision !== null && job?.claimed_revision !== undefined
      && String(job.revision) === String(job.claimed_revision)
    const freshObservation = refreshed.status.observedAt !== null
      && Date.parse(refreshed.status.observedAt) >= refreshStartedAt
    if (!freshObservation || !coveredLatestEvent || refreshed.refresh.state === 'running' || refreshed.refresh.lastErrorCode || view.refresh.state === 'running' || view.refresh.lastErrorCode) {
      throw new DemoError(409, 'PROVIDER_UNAVAILABLE', { action: 'REFRESH', currentView: view })
    }
    const capability = demoCapabilities().combinations.find(value => value.sceneId === 'one_time' && value.integration === 'native-sdk' && value.platform === session.platform)
    if (row.platform !== session.platform || !capability || !canExecute(capability.availability)) {
      throw new DemoError(409, 'CAPABILITY_UNAVAILABLE', { currentView: view })
    }
    const action = view.allowedActions.find(value => value.type === 'CONTINUE_SDK')
    if (!action?.enabled && action?.reasonCode !== 'CHECKOUT_IN_USE') {
      throw new DemoError(409, action?.reasonCode ?? 'CAPABILITY_UNVERIFIED', { action: 'REFRESH', currentView: view })
    }
    if (replay) return { status: 200, body: checkoutView(row, replay) }
    await consumeDemoLimit(client, `${session.id}:checkout_session`, 20, 60)
    await client.query("UPDATE demo_leases SET state='expired' WHERE payment_id=$1 AND state='active' AND expires_at<=clock_timestamp()", [paymentId])
    const current = (await client.query<LeaseRow>("SELECT * FROM demo_leases WHERE payment_id=$1 AND state='active'", [paymentId])).rows[0]
    if (current && input.supersedes !== current.id) {
      throw new DemoError(409, 'CHECKOUT_IN_USE', { action: 'REFRESH', currentView: view, checkoutSessionId: current.id, leaseExpiresAt: iso(current.expires_at) })
    }
    if (current) await client.query("UPDATE demo_leases SET state='superseded' WHERE id=$1", [current.id])
    const id = randomUUID()
    await client.query(`INSERT INTO demo_operations(key_hash,session_id,id,type,execution,outcome,resource_kind,resource_id,error,created_at,expires_at)
      VALUES($1,$2,$3,'checkout_session','completed','effective','checkout_session',$4,NULL,clock_timestamp(),clock_timestamp()+interval '30 days')`,
    [claim.keyHash, session.id, operationId, id])
    const lease = (await client.query<LeaseRow>(`INSERT INTO demo_leases(id,payment_id,session_id,operation_id,expires_at,state)
      SELECT $1,$2,$3,$4,LEAST(clock_timestamp()+interval '2 minutes',$5::timestamptz),'active'
      WHERE $5::timestamptz > clock_timestamp() RETURNING *`,
    [id, paymentId, session.id, operationId, row.continue_until])).rows[0]
    if (!lease) throw new DemoError(409, 'PAYMENT_EXPIRED', { action: 'REFRESH', currentView: await paymentView(client, row) })
    const updated = (await client.query<PaymentRow>('UPDATE demo_payments SET revision=revision+1 WHERE id=$1 RETURNING *', [paymentId])).rows[0]!
    return { status: 201, body: checkoutView(updated, lease) }
  })
}

export async function releaseDemoCheckout(sessionId: string, paymentId: string, leaseId: string): Promise<void> {
  await demoTransaction(async (client) => {
    await ownedPayment(client, sessionId, paymentId, true)
    const lease = await ownedLease(client, sessionId, paymentId, leaseId)
    if (lease.state !== 'active') return
    await client.query('UPDATE demo_leases SET state=$2 WHERE id=$1', [leaseId, leaseState(lease) === 'expired' ? 'expired' : 'released'])
    await client.query('UPDATE demo_payments SET revision=revision+1 WHERE id=$1', [paymentId])
  })
}

export async function getDemoOperation(sessionId: string, operationId: string): Promise<Operation> {
  return demoTransaction(async (client) => {
    const operation = await readDemoOperation(client, sessionId, operationId)
    let state: LeaseState | null = null
    if (operation.type === 'checkout_session' && operation.resource_id) {
      const lease = (await client.query<LeaseRow>('SELECT * FROM demo_leases WHERE id=$1 AND session_id=$2', [operation.resource_id, sessionId])).rows[0]
      // The operation outlives launch material; detail cleanup does not undo its
      // completed outcome or make an ended checkout operation appear active.
      state = lease ? leaseState(lease) : operation.lease_state ?? 'expired'
    }
    // These enum combinations are enforced by the migration and service writes.
    return {
      operationId: operation.id, type: operation.type, execution: operation.execution, outcome: operation.outcome,
      resource: operation.resource_kind && operation.resource_id ? { kind: operation.resource_kind, id: operation.resource_id } : null,
      error: operation.error,
      ...(operation.type === 'checkout_session' ? { leaseState: state } : {}),
    } as Operation
  })
}
