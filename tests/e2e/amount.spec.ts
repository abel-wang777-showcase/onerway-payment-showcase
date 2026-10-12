import { expect, test, type Page } from '@playwright/test'
import type { OnerwayCheckout, OnerwayPaymentElement } from '../../app/utils/sdk.client'
import { createAttempt, setAttemptStatus } from '../../shared/payment/attempt'
import { createEvent } from '../../shared/payment/event'
import { getJourney } from '../../shared/payment/journey'
import { createOrder } from '../../shared/payment/order'
import { toPaymentAttemptSummary } from '../../shared/payment/sdk'
import { expectNoHorizontalOverflow, gotoHydrated, selectHubOption } from './support'

const BASE_URL = 'http://127.0.0.1:4173'
const SDK_URL = 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js'
const HOSTED_URL = 'https://sandbox-checkout.onerway.com/checkout?session=mock-amount-only'
const CANONICAL_ORIGIN = 'https://amount-preview.example.invalid'
const TIMESTAMP = '2026-10-12T00:00:00.000Z'

// This synthetic surface has no payment fields or confirmation implementation.
function installBrowserSdk() {
  window.Onerway = {
    async createCheckout() {
      const handlers = new Map<string, (value: unknown) => void>()
      const element: OnerwayPaymentElement = {
        on(event, handler) { handlers.set(event, handler); return element },
        off(event) { handlers.delete(event); return element },
        mount(target) {
          const host = typeof target === 'string' ? document.getElementById(target) : target
          if (!host) throw new Error('MOCK_ELEMENT_HOST_MISSING')
          host.textContent = 'Synthetic amount test surface'
          queueMicrotask(() => handlers.get('ready')?.(undefined))
          return element
        },
      }
      const checkout: OnerwayCheckout = {
        createPaymentElement: () => element,
        on: () => checkout,
        off: () => checkout,
        async confirmPayment() {
          document.documentElement.dataset.amountConfirmed = 'true'
          throw new Error('AMOUNT_TEST_MUST_NOT_CONFIRM_PAYMENT')
        },
      }
      return checkout
    },
  }
}

async function installAmountMock(page: Page, options: {
  integration?: 'web-js-sdk' | 'checkout'
  canonicalOrigin?: string
} = {}) {
  const integration = options.integration ?? 'web-js-sdk'
  const orderId = `HLD-AMOUNT-${integration}`
  const attemptId = `${orderId}-attempt-1`
  const canonicalOrigin = options.canonicalOrigin ?? BASE_URL
  const attempt = setAttemptStatus(createAttempt({
    id: attemptId, orderId, integration, method: integration === 'checkout' ? 'all' : 'card',
    merchantTxnId: 'mock-amount-merchant-transaction', transactionId: 'mock-amount-transaction',
    paymentId: 'mock-amount-payment', createdAt: TIMESTAMP,
  }), integration === 'checkout' ? 'processing' : 'created', TIMESTAMP, 'server')
  const event = createEvent({
    id: 'mock-amount-created', attemptId, source: 'server', sourceKey: `create:${attemptId}`,
    status: attempt.status, rawStatus: 'U', occurredAt: TIMESTAMP,
  })
  const query = { token: 'q'.repeat(43), expiresAt: '2099-10-12T00:05:00.000Z' }
  const calls: { path: string, body: Record<string, unknown> | null }[] = []
  const violations: string[] = []
  let amountMinor: number | undefined
  let order: ReturnType<typeof createOrder> | undefined

  await page.context().route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== BASE_URL) {
      if (request.url() === SDK_URL && request.method() === 'GET' && request.resourceType() === 'script') {
        await route.fulfill({ contentType: 'application/javascript', body: `(${installBrowserSdk.toString()})()` })
      }
      else if (request.url() === HOSTED_URL && request.method() === 'GET' && request.isNavigationRequest()) {
        await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Mock Checkout</title></head><body><h1>Mock Checkout</h1><p>No payment is submitted.</p><a href="${BASE_URL}/halden/hosted/${orderId}">Return to merchant</a></body></html>` })
      }
      else if (url.origin === CANONICAL_ORIGIN && request.method() === 'GET' && request.isNavigationRequest()) {
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Mock Sandbox site</title><h1>Mock Sandbox site</h1>' })
      }
      else {
        violations.push(`${request.method()} ${url.origin}${url.pathname}`)
        await route.abort('blockedbyclient')
      }
      return
    }
    if (url.pathname === '/api/profile') {
      await route.fulfill({ json: {
        profile: 'sandbox', environment: 'Sandbox', transactionPolicy: 'sandbox-only', canonicalOrigin,
        sdk: { url: SDK_URL, release: 'v4/latest' },
      } })
      return
    }
    if (url.pathname.startsWith('/api/payment/')) {
      const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : null
      calls.push({ path: url.pathname, body })
      if (url.pathname === '/api/payment/recover' && request.method() === 'GET') {
        if (!order) {
          await route.fulfill({ status: 401, json: { statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' } })
        }
        else {
          if (url.searchParams.has('orderId')) expect(url.searchParams.get('orderId')).toBe(orderId)
          await route.fulfill({ json: {
            order, attempt, attempts: [toPaymentAttemptSummary(attempt)], events: [event],
            paymentId: attempt.paymentId, query, submitted: false,
          } })
        }
      }
      else if (url.pathname === '/api/payment/intent' && request.method() === 'POST') {
        expect(body).toMatchObject({
          journeyId: integration === 'checkout' ? 'hosted-checkout' : 'standard-success',
          method: integration === 'checkout' ? 'all' : 'card', amountMinor: 1234,
        })
        amountMinor = body!.amountMinor as number
        await route.fulfill({ json: { orderId, integration, create: true } })
      }
      else if (url.pathname === '/api/payment/create' && request.method() === 'POST') {
        expect(order, 'create must not repeat during recovery').toBeUndefined()
        expect(amountMinor).toBe(1234)
        const journey = getJourney(integration === 'checkout' ? 'hosted-checkout' : 'standard-success')
        order = createOrder({
          id: orderId, scene: 'ecommerce', createdAt: TIMESTAMP,
          item: { sku: journey.sku, name: 'Amount test sample', variant: journey.variant, quantity: 1, unitAmount: { minor: amountMinor!, currency: 'USD' } },
          amount: { minor: amountMinor!, currency: 'USD' },
        })
        await route.fulfill({ json: {
          order, attempt, attempts: [toPaymentAttemptSummary(attempt)], event,
          paymentId: attempt.paymentId, query, ...(integration === 'checkout' ? { redirectUrl: HOSTED_URL } : {}),
        } })
      }
      else {
        violations.push(`${request.method()} ${url.pathname}`)
        await route.abort('blockedbyclient')
      }
      return
    }
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/_nuxt_icon/')) {
      violations.push(`${request.method()} ${url.pathname}`)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  return {
    calls, orderId,
    assertClean() { expect(violations, 'amount tests must not contact payment services').toEqual([]) },
  }
}

async function enterHub(page: Page) {
  // Client navigation uses the mocked Sandbox public profile; Nitro stays locked.
  await gotoHydrated(page, '/halden/checkout/HLD-MOCK-AMOUNT-ENTRY')
  await page.getByRole('link', { name: 'Return to Demo Hub', exact: true }).click()
  await expect(page.getByLabel('Payment amount', { exact: true })).toBeVisible()
}

test('validates editable USD amounts and preserves the configured amount in the URL', async ({ page }, testInfo) => {
  const mock = await installAmountMock(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await enterHub(page)
  const amount = page.getByLabel('Payment amount', { exact: true })
  const start = page.getByRole('button', { name: 'Start a new real Sandbox checkout', exact: true })
  const presets = page.getByRole('button', { name: 'Amount presets', exact: true })
  for (const [preset, value] of [['Use $50.00', '50.00'], ['Use $5.00', '5.00']] as const) {
    await presets.click()
    await page.getByRole('menuitem', { name: preset, exact: true }).click()
    await expect(amount).toHaveValue(value)
    await expect(page.locator('#demo-launch')).toContainText(`$${value}`)
  }
  await presets.focus()
  await presets.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Use $50.00', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(presets).toBeFocused()
  await expect(start).toBeInViewport({ ratio: 1 })
  const launchBounds = await start.boundingBox()
  const navigationBounds = await page.getByRole('navigation', { name: 'Quick demo navigation' }).boundingBox()
  expect(launchBounds!.y + launchBounds!.height).toBeLessThanOrEqual(navigationBounds!.y)
  for (const [value, formatted] of [['12.34', '$12.34'], ['0.01', '$0.01'], ['10000.00', '$10,000.00']]) {
    await amount.fill(value!)
    await expect(page.locator('#demo-launch')).toContainText(formatted!)
    await expect(start).toBeEnabled()
    await expect.poll(() => new URL(page.url()).searchParams.get('amount')).toBe(value)
    await expectNoHorizontalOverflow(page)
  }
  await page.setViewportSize({ width: 320, height: 844 })
  await expectNoHorizontalOverflow(page)
  const navigation = page.getByRole('navigation', { name: 'Quick demo navigation' })
  await expect(navigation).toContainText('$10,000.00')
  for (const link of await navigation.getByRole('link').all()) {
    await expect(link).toBeInViewport({ ratio: 1 })
    const bounds = await link.boundingBox()
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
  }
  await page.screenshot({ path: testInfo.outputPath('amount-max-320.png') })
  for (const invalid of ['', '0', '-1', '10000.01', '1.234', 'abc']) {
    await amount.fill(invalid)
    await expect(start).toBeDisabled()
  }
  await navigation.getByRole('link', { name: 'View summary', exact: true }).click()
  await expect(amount).toHaveValue('abc')
  await expect(start).toBeDisabled()
  await navigation.getByRole('link', { name: 'Edit selection', exact: true }).click()
  await expect(amount).toHaveValue('abc')
  await expect(start).toBeDisabled()
  expect(mock.calls.filter(call => call.path === '/api/payment/intent')).toHaveLength(0)
  await amount.fill('12.34')
  await expect(start).toBeEnabled()
  await page.reload()
  await expect(amount).toHaveValue('12.34')
  await expect(page.locator('#demo-launch')).toContainText('$12.34')
  mock.assertClean()
})

test('keeps all one-time integrations editable while subscription pricing stays fixed', async ({ page }) => {
  const mock = await installAmountMock(page)
  await enterHub(page)
  const amount = page.getByLabel('Payment amount', { exact: true })
  for (const integration of ['Checkout', 'Direct API', 'Web JS SDK']) {
    await page.getByRole('group', { name: 'Integration', exact: true }).getByRole('tab', { name: integration, exact: true }).click()
    await expect(amount).toBeVisible()
    await amount.fill('12.34')
    await expect(page.locator('#demo-launch')).toContainText('$12.34')
  }
  await selectHubOption(page, 'Billing experience', 'Subscription')
  await expect(amount).toHaveCount(0)
  await expect(page.locator('#demo-launch')).toContainText('$5.00')
  await expect(page.locator('#demo-launch')).not.toContainText('$12.34')
  expect(mock.calls.filter(call => call.path.includes('/intent'))).toHaveLength(0)
  mock.assertClean()
})

test('carries the custom amount to the canonical Sandbox site without creating a payment', async ({ page }) => {
  const mock = await installAmountMock(page, { canonicalOrigin: CANONICAL_ORIGIN })
  await enterHub(page)
  await page.getByLabel('Payment amount', { exact: true }).fill('12.34')
  await page.getByRole('button', { name: 'Open Sandbox site', exact: true }).click()
  await expect(page).toHaveURL(url => url.origin === CANONICAL_ORIGIN && url.searchParams.get('amount') === '12.34')
  expect(mock.calls.filter(call => call.path.includes('/intent'))).toHaveLength(0)
  mock.assertClean()
})

for (const integration of ['web-js-sdk', 'checkout'] as const) {
  test(`${integration} reload recovers the original amount without creating another order`, async ({ page }) => {
    test.setTimeout(120_000)
    const mock = await installAmountMock(page, { integration })
    await enterHub(page)
    if (integration === 'checkout') {
      await page.getByRole('group', { name: 'Integration', exact: true }).getByRole('tab', { name: 'Checkout', exact: true }).click()
    }
    await page.getByLabel('Payment amount', { exact: true }).fill('12.34')
    await page.getByRole('button', { name: integration === 'checkout' ? 'Start a new Sandbox Hosted Checkout' : 'Start a new real Sandbox checkout', exact: true }).click()
    if (integration === 'checkout') {
      await expect(page).toHaveURL(HOSTED_URL)
      await page.getByRole('link', { name: 'Return to merchant', exact: true }).click()
    }
    const merchantPath = `/halden/${integration === 'checkout' ? 'hosted' : 'sdk'}/${mock.orderId}`
    await expect(page).toHaveURL(`${BASE_URL}${merchantPath}`)
    await expect(page.getByText('$12.34', { exact: true }).first()).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-amount-confirmed', 'true')
    const recovered = page.waitForResponse(response => {
      const url = new URL(response.url())
      return response.request().method() === 'GET' && url.origin === BASE_URL
        && url.pathname === '/api/payment/recover' && url.searchParams.get('orderId') === mock.orderId
    })
    await page.reload()
    const response = await recovered
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ order: { id: mock.orderId, amount: { minor: 1234, currency: 'USD' } } })
    // SDK SSR reads the real locked profile, outside browser route mocks. Its
    // recovery response proves amount preservation; only Checkout can also
    // render the restored amount under that profile.
    if (integration === 'checkout') {
      await expect(page.getByText('$12.34', { exact: true }).first()).toBeVisible()
    }
    await expect(page).toHaveURL(`${BASE_URL}${merchantPath}`)
    expect(mock.calls.filter(call => call.path === '/api/payment/intent')).toHaveLength(1)
    expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(1)
    expect(mock.calls.filter(call => call.path === '/api/payment/submit' || call.path === '/api/payment/query')).toHaveLength(0)
    mock.assertClean()
  })
}
