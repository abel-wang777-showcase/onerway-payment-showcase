import { fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

const serverEnv = {
  ONERWAY_PROFILE: 'sandbox',
  ONERWAY_SANDBOX_BASE_URL: 'https://sandbox-acq.onerway.com',
  ONERWAY_SANDBOX_SDK_URL: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js',
  ONERWAY_SHOWCASE_ORIGIN: 'https://showcase.example',
  ONERWAY_SANDBOX_NOTIFY_URL: 'https://showcase.example/api/webhooks/onerway/payment',
  ONERWAY_SANDBOX_MERCHANT_NO: 'test-merchant-sentinel',
  ONERWAY_SANDBOX_APP_ID: 'test-app-sentinel',
  ONERWAY_SANDBOX_SECRET: 'test-secret-sentinel',
  PAYMENT_DIAGNOSTIC_TOKEN: 'diagnostic-token-sentinel-value-32',
  CRON_SECRET: 'cron-secret-sentinel-value-32-chars',
}

const privateValues = [
  serverEnv.ONERWAY_SANDBOX_BASE_URL,
  serverEnv.ONERWAY_SANDBOX_NOTIFY_URL,
  serverEnv.ONERWAY_SANDBOX_MERCHANT_NO,
  serverEnv.ONERWAY_SANDBOX_APP_ID,
  serverEnv.ONERWAY_SANDBOX_SECRET,
  serverEnv.PAYMENT_DIAGNOSTIC_TOKEN,
  serverEnv.CRON_SECRET,
]

await setup({
  server: true,
  setupTimeout: 240_000,
  env: serverEnv,
  nuxtConfig: {
    fonts: {
      provider: 'local',
    },
  },
})

describe('application routes', () => {
  it('exposes only the public Sandbox profile summary', async () => {
    const response = await fetch('/api/profile')
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(JSON.parse(body)).toEqual({
      profile: 'sandbox',
      environment: 'Sandbox',
      transactionPolicy: 'sandbox-only',
      canonicalOrigin: serverEnv.ONERWAY_SHOWCASE_ORIGIN,
      sdk: {
        url: `${serverEnv.ONERWAY_SANDBOX_SDK_URL}?revision=80ee223bc5d3561a729c09901379324186f1c65bcb778be10240fe06f338ed64`,
        release: 'v4/latest',
      },
    })

    for (const value of privateValues) {
      expect(body).not.toContain(value)
    }
  })

  it('renders the home shell', async () => {
    const response = await fetch('/', {
      headers: {
        accept: 'text/html',
      },
    })
    const html = await response.text()
    const mainIds = html.match(/id="main"/g) ?? []

    expect(response.status).toBe(200)
    expect(html).toContain('<title>Demo Hub · Onerway Payment Showcase</title>')
    expect(html).toContain('Choose a payment journey. See exactly what happens.')
    expect(html).toContain('Start simulated checkout')
    expect(html).toContain('Start a new real Sandbox checkout')
    expect(html).toContain('USD 50.00 · 3DS Challenge')
    expect(html).toContain('Sandbox profile · Sandbox only')
    expect(mainIds).toHaveLength(1)

    for (const value of privateValues) {
      expect(html).not.toContain(value)
    }
  })

  it.each([
    ['/halden/checkout/HLD-DEMO-500', 'Simulated checkout · Halden', 'Restoring demo session'],
    ['/halden/sdk/HLD-SANDBOX', 'Sandbox checkout · Halden', 'Restoring Sandbox checkout'],
    ['/halden/return/HLD-SANDBOX?a=discarded', 'Restoring payment · Halden', 'Restoring 3DS return'],
    ['/halden/result/HLD-DEMO-500', 'Payment result · Halden', 'Restoring payment result'],
  ])('renders the client-restored shell for %s', async (path, title, label) => {
    const response = await fetch(path, {
      headers: {
        accept: 'text/html',
      },
    })
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain(`<title>${title}</title>`)
    expect(html).toContain(label)
    expect(html).toContain(path.includes('/sdk/') ? 'Sandbox' : 'Simulation')
    expect(html.match(/id="main"/g) ?? []).toHaveLength(1)

    for (const value of privateValues) {
      expect(html).not.toContain(value)
    }
  })

  it('renders the custom shell with an HTTP 404 status', async () => {
    const response = await fetch('/not-found', {
      headers: {
        accept: 'text/html',
      },
    })
    const html = await response.text()

    expect(response.status).toBe(404)
    expect(html).toContain('<title>404 · Onerway Payment Showcase</title>')
    expect(html).toContain('Page not found')
    expect(html).toContain('Back to showcase')
  })

  it('keeps payment diagnostics and cleanup unavailable without server tokens', async () => {
    const timeline = await fetch('/api/internal/payments/timeline?merchantTxnId=showcase-test')
    const cleanup = await fetch('/api/internal/payments/cleanup')

    expect(timeline.status).toBe(401)
    expect(cleanup.status).toBe(401)
  })

  it('does not expose persisted payment recovery without its HttpOnly capability', async () => {
    const response = await fetch('/api/payment/recover?orderId=HLD-SANDBOX')
    const returned = await fetch('/api/payment/return', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'HLD-SANDBOX' }),
    })

    expect(response.status).toBe(401)
    expect(returned.status).toBe(401)
  })

  it('rejects unauthenticated webhook bodies before storage', async () => {
    const response = await fetch('/api/webhooks/onerway/payment', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ notifyType: 'TXN' }),
    })
    const body = await response.text()

    expect(response.status).toBe(400)
    expect(body).not.toContain(serverEnv.ONERWAY_SANDBOX_SECRET)
  })
})
