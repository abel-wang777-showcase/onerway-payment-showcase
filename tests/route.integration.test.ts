import { type IncomingMessage, request as httpRequest } from 'node:http'
import { Pool } from '@neondatabase/serverless'
import { setup, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { requireTestDatabaseUrl } from './db'
import {
  PAYMENT_RECOVERY_COOKIE,
  verifyPaymentRecoveryToken,
} from '../server/utils/recovery'

const databaseUrl = requireTestDatabaseUrl()

await setup({
  server: true,
  setupTimeout: 240_000,
  env: {
    ONERWAY_PROFILE: 'sandbox',
    ONERWAY_SANDBOX_BASE_URL: 'https://sandbox-acq.onerway.com',
    ONERWAY_SANDBOX_SDK_URL: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js',
    ONERWAY_SHOWCASE_ORIGIN: 'https://showcase.example',
    ONERWAY_SANDBOX_NOTIFY_URL: 'https://showcase.example/api/webhooks/onerway/payment',
    ONERWAY_SANDBOX_MERCHANT_NO: 'test-merchant-sentinel',
    ONERWAY_SANDBOX_APP_ID: 'test-app-sentinel',
    ONERWAY_SANDBOX_SECRET: 'test-secret-sentinel',
    DATABASE_URL: databaseUrl,
    VERCEL: '1',
  },
  nuxtConfig: {
    fonts: {
      provider: 'local',
    },
  },
})

interface RequestInit {
  method?: string
  headers: Record<string, string>
  body?: string
}

async function readResponse(res: IncomingMessage): Promise<Response> {
  const chunks: Buffer[] = []

  for await (const chunk of res) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const headers = new Headers()

  for (let i = 0; i < res.rawHeaders.length; i += 2) {
    headers.append(res.rawHeaders[i]!, res.rawHeaders[i + 1]!)
  }

  return new Response(Buffer.concat(chunks), {
    status: res.statusCode ?? 500,
    headers,
  })
}

function request(path: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url(path), {
      method: init.method ?? 'GET',
      headers: init.headers,
    }, (res) => {
      readResponse(res).then(
        response => {
          req.setTimeout(0)
          resolve(response)
        },
        error => {
          req.setTimeout(0)
          reject(error)
        },
      )
    })

    req.setTimeout(15_000, () => req.destroy(new Error('PAYMENT_ROUTE_TEST_TIMEOUT')))
    req.once('error', reject)
    req.end(init.body)
  })
}

describe('payment database routes', () => {
  it('rejects a same-origin Preview intent before writing payment state', async () => {
    const response = await request('/api/payment/intent', {
      method: 'POST',
      headers: {
        host: 'preview.example',
        origin: 'https://preview.example',
        'sec-fetch-site': 'same-origin',
        'x-forwarded-proto': 'https',
        'x-vercel-forwarded-for': '203.0.113.9',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ journeyId: 'standard-success' }),
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toContain('PAYMENT_CANONICAL_ORIGIN_REQUIRED')
  })

  it('delivers the recovery cookie before provider create and reuses the same intent', async () => {
    const orderIds: string[] = []
    const client = {
      host: 'showcase.example',
      'x-forwarded-proto': 'https',
      'x-vercel-forwarded-for': '203.0.113.10',
    }

    try {
      const first = await request('/api/payment/intent', {
        method: 'POST',
        headers: { ...client, 'content-type': 'application/json' },
        body: JSON.stringify({ journeyId: 'three-ds-success' }),
      })
      const intent = await first.json() as { orderId: string, create: boolean }
      const setCookie = first.headers.get('set-cookie')

      orderIds.push(intent.orderId)
      expect(first.status).toBe(200)
      expect(intent.create).toBe(true)
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Lax')
      expect(setCookie).toContain('Path=/api/payment')

      const cookie = setCookie?.split(';', 1)[0]
      const second = await request('/api/payment/intent', {
        method: 'POST',
        headers: {
          ...client,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({ journeyId: 'standard-success' }),
      })

      expect(second.status).toBe(200)
      expect(await second.json()).toEqual(intent)

      const restarted = await request('/api/payment/intent', {
        method: 'POST',
        headers: {
          ...client,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({ journeyId: 'standard-success', restart: true }),
      })
      const restartedIntent = await restarted.json() as { orderId: string, create: boolean }

      orderIds.push(restartedIntent.orderId)
      expect(restarted.status).toBe(200)
      expect(restartedIntent.create).toBe(true)
      expect(restartedIntent.orderId).not.toBe(intent.orderId)
      expect(restarted.headers.get('set-cookie')).toContain('HttpOnly')

      const pool = new Pool({ connectionString: databaseUrl })

      try {
        const result = await pool.query<{
          id: string
          amount_minor: string
          customer_environment: string
          customer_merchant_no: string
          customer_app_id: string
          merchant_cust_id: string
        }>(
          `SELECT id, amount_minor, customer_environment, customer_merchant_no,
                  customer_app_id, merchant_cust_id
           FROM payment_orders
           WHERE id = ANY($1::text[])
           ORDER BY amount_minor`,
          [orderIds],
        )
        expect(result.rows.map(row => Number(row.amount_minor))).toEqual([500, 5_000])
        expect(new Set(result.rows.map(row => row.merchant_cust_id)).size).toBe(1)
        expect(result.rows[0]).toMatchObject({
          customer_environment: 'sandbox',
          customer_merchant_no: 'test-merchant-sentinel',
          customer_app_id: 'test-app-sentinel',
        })
        expect(result.rows[0]?.merchant_cust_id).toMatch(/^cust_[A-Za-z0-9_-]+$/)
      }
      finally {
        await pool.end()
      }
    }
    finally {
      if (orderIds.length) {
        const pool = new Pool({ connectionString: databaseUrl })

        try {
          await pool.query('DELETE FROM payment_orders WHERE id = ANY($1::text[])', [orderIds])
        }
        finally {
          await pool.end()
        }
      }
    }
  }, 120_000)

  it('claims one submission and reuses one retry child with the parent cookie', async () => {
    let orderId: string | null = null
    const client = {
      host: 'showcase.example',
      'x-forwarded-proto': 'https',
      'x-vercel-forwarded-for': '203.0.113.11',
    }

    try {
      const intentResponse = await request('/api/payment/intent', {
        method: 'POST',
        headers: { ...client, 'content-type': 'application/json' },
        body: JSON.stringify({ journeyId: 'standard-success' }),
      })
      const intent = await intentResponse.json() as { orderId: string, create: boolean }
      const parentCookie = intentResponse.headers.get('set-cookie')?.split(';', 1)[0]

      orderId = intent.orderId
      expect(parentCookie).toBeTruthy()

      const pool = new Pool({ connectionString: databaseUrl })
      const paymentId = `9084${Date.now()}`.slice(0, 20)
      let attemptId: string

      try {
        const attempts = await pool.query<{ id: string }>(`
          UPDATE payment_attempts
          SET payment_id = $2,
              transaction_id = $3,
              status = 'processing',
              status_source = 'server'
          WHERE order_id = $1
          RETURNING id
        `, [orderId, paymentId, `9184${Date.now()}`.slice(0, 20)])

        attemptId = attempts.rows[0]!.id
      }
      finally {
        await pool.end()
      }

      const submissionBody = JSON.stringify({ orderId, attemptId, paymentId })
      const firstSubmission = await request('/api/payment/submit', {
        method: 'POST',
        headers: {
          ...client,
          'content-type': 'application/json',
          cookie: parentCookie!,
        },
        body: submissionBody,
      })
      const secondSubmission = await request('/api/payment/submit', {
        method: 'POST',
        headers: {
          ...client,
          'content-type': 'application/json',
          cookie: parentCookie!,
        },
        body: submissionBody,
      })

      expect(firstSubmission.status).toBe(200)
      expect(secondSubmission.status).toBe(200)
      expect((await firstSubmission.json() as { claimed: boolean }).claimed).toBe(true)
      expect((await secondSubmission.json() as { claimed: boolean }).claimed).toBe(false)

      const update = new Pool({ connectionString: databaseUrl })

      try {
        await update.query(`
          UPDATE payment_attempts
          SET status = 'cancelled',
              status_source = 'query'
          WHERE id = $1
        `, [attemptId])
      }
      finally {
        await update.end()
      }

      const retryBody = JSON.stringify({ orderId, attemptId, paymentId })
      const firstRetry = await request('/api/payment/retry', {
        method: 'POST',
        headers: {
          ...client,
          'content-type': 'application/json',
          cookie: parentCookie!,
        },
        body: retryBody,
      })
      const secondRetry = await request('/api/payment/retry', {
        method: 'POST',
        headers: {
          ...client,
          'content-type': 'application/json',
          cookie: parentCookie!,
        },
        body: retryBody,
      })
      const childCookie = firstRetry.headers.get('set-cookie')?.split(';', 1)[0]
      const replayedRetry = await request('/api/payment/retry', {
        method: 'POST',
        headers: {
          ...client,
          'content-type': 'application/json',
          ...(childCookie ? { cookie: childCookie } : {}),
        },
        body: retryBody,
      })
      const first = await firstRetry.json() as {
        attemptId: string
        create: boolean
        reused: boolean
      }
      const second = await secondRetry.json() as typeof first
      const replayed = await replayedRetry.json() as typeof first

      expect(firstRetry.status).toBe(200)
      expect(secondRetry.status).toBe(200)
      expect(replayedRetry.status).toBe(200)
      expect(first.attemptId).toBe(second.attemptId)
      expect(first.attemptId).toBe(replayed.attemptId)
      expect(first).toMatchObject({ create: true, reused: false })
      expect(second).toMatchObject({ create: true, reused: true })
      expect(replayed).toMatchObject({ create: true, reused: true })
      const retryCookie = firstRetry.headers.get('set-cookie')
      const retryToken = retryCookie
        ?.split(';', 1)[0]
        ?.slice(`${PAYMENT_RECOVERY_COOKIE}=`.length)

      expect(verifyPaymentRecoveryToken('test-secret-sentinel', retryToken))
        .toMatchObject({ orderId, attemptId: first.attemptId })

      const verify = new Pool({ connectionString: databaseUrl })

      try {
        await verify.query(`
          UPDATE payment_attempts
          SET status = 'succeeded',
              status_source = 'query',
              updated_at = now()
          WHERE id = $1
        `, [attemptId])

        const rejectedCreate = await request('/api/payment/create', {
          method: 'POST',
          headers: {
            ...client,
            'content-type': 'application/json',
            cookie: childCookie!,
          },
          body: JSON.stringify({
            javaEnabled: false,
            colorDepth: '24',
            screenHeight: '900',
            screenWidth: '1440',
            timeZoneOffset: '0',
            contentLength: '1000',
            language: 'en-US',
          }),
        })

        expect(rejectedCreate.status).toBe(409)
        const rejectedToken = rejectedCreate.headers.get('set-cookie')
          ?.split(';', 1)[0]
          ?.slice(`${PAYMENT_RECOVERY_COOKIE}=`.length)

        expect(verifyPaymentRecoveryToken('test-secret-sentinel', rejectedToken))
          .toMatchObject({ orderId, attemptId })

        const recovered = await request('/api/payment/recover', {
          headers: { ...client, cookie: childCookie! },
        })
        const recoveredPayment = await recovered.json() as {
          attempt: { id: string, status: string }
          attempts: readonly { id: string, retryOf?: string }[]
        }
        const reboundToken = recovered.headers.get('set-cookie')
          ?.split(';', 1)[0]
          ?.slice(`${PAYMENT_RECOVERY_COOKIE}=`.length)

        expect(recovered.status).toBe(200)
        expect(recoveredPayment.attempt).toMatchObject({ id: attemptId, status: 'succeeded' })
        expect(recoveredPayment.attempts.map(item => item.id).sort())
          .toEqual([attemptId, first.attemptId].sort())
        expect(recoveredPayment.attempts.find(item => item.id === first.attemptId))
          .toMatchObject({ retryOf: attemptId })
        expect(verifyPaymentRecoveryToken('test-secret-sentinel', reboundToken))
          .toMatchObject({ orderId, attemptId })

        const children = await verify.query<{ id: string, retry_of: string }>(`
          SELECT id, retry_of
          FROM payment_attempts
          WHERE retry_of = $1
        `, [attemptId])

        expect(children.rows).toEqual([{ id: first.attemptId, retry_of: attemptId }])
      }
      finally {
        await verify.end()
      }
    }
    finally {
      if (orderId) {
        const pool = new Pool({ connectionString: databaseUrl })

        try {
          await pool.query('DELETE FROM payment_orders WHERE id = $1', [orderId])
        }
        finally {
          await pool.end()
        }
      }
    }
  }, 120_000)
})
