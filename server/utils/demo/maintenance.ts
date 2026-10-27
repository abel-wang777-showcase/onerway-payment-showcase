import { randomUUID } from 'node:crypto'
import type { PaymentWebhook } from '../webhook'
import { demoTransaction } from './database'
import { hashDemo, demoOwnerHash } from './identity'
import { DemoError } from './errors'
import { enqueuePayment, runPaymentJob, type PaymentRow, type SandboxProfile } from './payment'

/** A verified notification is durable before ACK; only a subsequent correlated query projects payment truth. */
export async function recordDemoWebhook(fact: PaymentWebhook): Promise<string | null> {
  return demoTransaction(async (client) => {
    const row = (await client.query<PaymentRow>('SELECT * FROM demo_payments WHERE merchant_txn_id=$1 FOR UPDATE', [fact.merchantTxnId])).rows[0]
    if (!row) return null
    if (Number(row.amount_minor) !== fact.amountMinor || row.currency !== fact.currency
      || (row.payment_id && fact.paymentId && row.payment_id !== fact.paymentId)) throw new DemoError(409, 'PAYMENT_ASSOCIATION_CONFLICT')
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new DemoError(410, 'RECORD_EXPIRED')
    await client.query(`INSERT INTO demo_events(id,payment_id,source,kind,raw_status,occurred_at) VALUES($1,$2,'webhook','notification_received',$3,$4)`,
      [randomUUID(), row.id, fact.paymentStatus ?? fact.transactionStatus, fact.occurredAt])
    await enqueuePayment(client, row.id)
    return row.id
  })
}

export async function runDemoMaintenance(profile: SandboxProfile, budgetMs = 25_000, batch = 20): Promise<{ processed: number, deleted: number }> {
  const deadline = Date.now() + budgetMs
  let processed = 0
  // A query has bounded upstream timeouts. Stop starting work before the request budget is exhausted.
  while (processed < batch && Date.now() + 24_000 < deadline && await runPaymentJob(profile)) processed++
  const deleted = await demoTransaction(async (client) => {
    // Lock parents first, in a stable order shared with lease/worker mutations.
    const expired = (await client.query<{ id: string, session_id: string }>('SELECT id,session_id FROM demo_payments WHERE expires_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100')).rows
    const ids = expired.map(row => row.id)
    for (const row of expired) {
      await client.query(`INSERT INTO demo_resource_tombstones(resource_hash,owner_hash,type,expires_at) VALUES($1,$2,'payment',now()+interval '30 days') ON CONFLICT(resource_hash) DO NOTHING`, [hashDemo(['demo-v1-resource',row.id]),demoOwnerHash(row.session_id)])
    }
    await client.query('DELETE FROM demo_events WHERE payment_id=ANY($1::text[])', [ids])
    await client.query(`UPDATE demo_operations o SET lease_state=CASE WHEN l.state='active' THEN 'expired' ELSE l.state END FROM demo_leases l WHERE o.id=l.operation_id AND l.payment_id=ANY($1::text[])`, [ids])
    await client.query('DELETE FROM demo_leases WHERE payment_id=ANY($1::text[])', [ids])
    await client.query('DELETE FROM demo_jobs WHERE payment_id=ANY($1::text[])', [ids])
    const removed = await client.query('DELETE FROM demo_payments WHERE id=ANY($1::text[]) RETURNING id', [ids])
    await client.query('DELETE FROM demo_resource_tombstones WHERE expires_at<=now()')
    // An operation can expire while its payment or lease remains: retain the inaccessible row until references end.
    await client.query(`UPDATE demo_claims SET expired=true WHERE key_hash IN (SELECT key_hash FROM demo_operations WHERE expires_at<=now())`)
    await client.query(`DELETE FROM demo_operations o WHERE expires_at<=now()
      AND NOT EXISTS(SELECT 1 FROM demo_payments p WHERE p.request_id=o.id)
      AND NOT EXISTS(SELECT 1 FROM demo_leases l WHERE l.operation_id=o.id)`)
    await client.query('DELETE FROM demo_limits WHERE reset_at < now()-interval \'1 day\'')
    return removed.rowCount ?? 0
  })
  return { processed, deleted }
}
