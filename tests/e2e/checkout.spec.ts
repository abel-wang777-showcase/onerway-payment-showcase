import { expect, test, type Page } from '@playwright/test'
import { createAttempt, setAttemptStatus } from '../../shared/payment/attempt'
import { createEvent } from '../../shared/payment/event'
import { createOrder } from '../../shared/payment/order'
import { toPaymentAttemptSummary } from '../../shared/payment/sdk'
import { expectNoHorizontalOverflow } from './support'

const BASE_URL = 'http://127.0.0.1:4173'
const ORDER_ID = 'HLD-CHECKOUT-E2E'
const ATTEMPT_ID = `${ORDER_ID}-attempt-1`
const HOSTED_URL = 'https://sandbox-checkout.onerway.com/checkout?session=mock-navigation-only'
const RETURN_PATH = `/halden/return/${ORDER_ID}`
const TIMESTAMP = '2026-09-14T08:00:00.000Z'

async function installCheckoutMock(page: Page) {
  const order = createOrder({
    id: ORDER_ID,
    scene: 'ecommerce',
    item: {
      sku: 'HL-CHECKOUT-005', name: 'Halden sample', variant: 'Hosted checkout', quantity: 1,
      unitAmount: { minor: 500, currency: 'USD' },
    },
    amount: { minor: 500, currency: 'USD' },
    createdAt: TIMESTAMP,
  })
  let attempt = setAttemptStatus(createAttempt({
    id: ATTEMPT_ID, orderId: ORDER_ID, integration: 'checkout', method: 'all',
    merchantTxnId: 'showcase-mock-checkout-transaction', paymentId: '9000000000000000011',
    transactionId: '9000000000000000022', createdAt: TIMESTAMP,
  }), 'processing', TIMESTAMP, 'server')
  const createdEvent = createEvent({
    id: 'create-event', attemptId: ATTEMPT_ID, source: 'server', sourceKey: `create:${ATTEMPT_ID}`,
    status: 'processing', rawStatus: 'U', transactionId: attempt.transactionId, occurredAt: TIMESTAMP,
  })
  const events = [createdEvent]
  const query = { token: 'q'.repeat(43), expiresAt: '2099-09-14T08:05:00.000Z' }
  const calls: { path: string, method: string, body: unknown }[] = []
  const externalRequests: string[] = []
  const violations: string[] = []
  const navigations: string[] = []
  let created = false

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url())
  })

  const session = () => ({
    order, attempt, attempts: [toPaymentAttemptSummary(attempt)], events: [...events],
    paymentId: attempt.paymentId, query, submitted: false,
  })

  await page.context().route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== BASE_URL) {
      externalRequests.push(request.url())
      if (request.url() === HOSTED_URL && request.isNavigationRequest() && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><head><title>Mock Hosted Checkout</title></head><body><main><h1>Mock Onerway Checkout</h1><p>Browser navigation fixture. No payment is submitted.</p><a href="${BASE_URL}${RETURN_PATH}?providerStatus=S&amp;session=discard-return-parameter">Return to Halden</a></main></body></html>`,
        })
      }
      else {
        violations.push(`${request.method()} ${url.origin}${url.pathname}`)
        await route.abort('blockedbyclient')
      }
      return
    }

    if (url.pathname === '/api/profile') {
      await route.fulfill({ json: {
        profile: 'sandbox', environment: 'Sandbox', transactionPolicy: 'sandbox-only',
        canonicalOrigin: BASE_URL,
        sdk: { url: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js', release: 'v4/latest' },
      } })
      return
    }

    if (url.pathname.startsWith('/api/payment/')) {
      const body: unknown = request.postData() ? request.postDataJSON() : null
      calls.push({ path: url.pathname, method: request.method(), body })
      if (url.pathname === '/api/payment/intent' && request.method() === 'POST') {
        expect(body).toEqual({ journeyId: 'hosted-checkout', method: 'all', restart: true })
        await route.fulfill({ json: { orderId: ORDER_ID, create: true } })
      }
      else if (url.pathname === '/api/payment/create' && request.method() === 'POST') {
        expect(body).toEqual({})
        expect(created, 'a mock order must be created only once').toBe(false)
        created = true
        await route.fulfill({ json: {
          order, attempt, attempts: [toPaymentAttemptSummary(attempt)], event: createdEvent,
          paymentId: attempt.paymentId, query, redirectUrl: HOSTED_URL,
        } })
      }
      else if (url.pathname === '/api/payment/recover' && request.method() === 'GET' && !created) {
        expect(url.searchParams.has('orderId')).toBe(false)
        await route.fulfill({ status: 401, json: { statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' } })
      }
      else if (url.pathname === '/api/payment/recover' && request.method() === 'GET' && created) {
        expect(url.searchParams.get('orderId')).toBe(ORDER_ID)
        await route.fulfill({ json: session() })
      }
      else if (url.pathname === '/api/payment/return' && request.method() === 'POST' && created) {
        expect(body).toEqual({ orderId: ORDER_ID })
        events.push(createEvent({
          id: 'return-event', attemptId: ATTEMPT_ID, source: 'return', sourceKey: ATTEMPT_ID,
          status: 'processing', occurredAt: TIMESTAMP,
        }))
        await route.fulfill({ json: { duplicate: false } })
      }
      else if (url.pathname === '/api/payment/query' && request.method() === 'POST' && created) {
        expect(body).toEqual({ attemptId: ATTEMPT_ID, paymentId: attempt.paymentId, ...query })
        attempt = setAttemptStatus(attempt, 'succeeded', TIMESTAMP, 'query')
        const event = createEvent({
          id: 'query-event', attemptId: ATTEMPT_ID, source: 'query', sourceKey: 'checkout-query',
          status: 'succeeded', rawStatus: 'S', transactionStatus: 'S',
          transactionId: attempt.transactionId, occurredAt: TIMESTAMP,
        })
        events.push(event)
        await route.fulfill({ json: { attempt, event } })
      }
      else {
        violations.push(`${request.method()} ${url.pathname}`)
        await route.fulfill({ status: 403, json: { statusMessage: 'MOCK_PAYMENT_ROUTE_FORBIDDEN' } })
      }
      return
    }

    if (url.pathname.startsWith('/api/webhooks/')) {
      violations.push(`${request.method()} ${url.pathname}`)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })

  return {
    calls,
    externalRequests,
    navigations,
    assertClean() {
      expect(violations, 'Checkout network boundary').toEqual([])
      expect(externalRequests.filter(url => url !== HOSTED_URL), 'no SDK CDN or other provider requests').toEqual([])
    },
  }
}

async function enterHub(page: Page) {
  // Enter the Hub through client navigation so useFetch uses the mocked public
  // profile; the real local Nitro profile remains Production / locked.
  await page.goto('/halden/checkout/HLD-MOCK-ENTRY')
  await page.getByRole('link', { name: 'Return to Demo Hub', exact: true }).click()
  await expect(page).toHaveURL(`${BASE_URL}/`)
  await expect(page.getByText('Sandbox profile · Sandbox only', { exact: true })).toBeVisible()
  const checkout = page.locator('[role="radio"][value="checkout"]')
  await checkout.focus()
  await checkout.press('Space')
  await expect(checkout).toBeChecked()
  await expect(page.locator('[role="radio"][value="all"]')).toBeChecked()
}

async function startCheckout(page: Page) {
  await enterHub(page)
  await expectNoHorizontalOverflow(page)
  const start = page.getByRole('button', { name: 'Start a new Sandbox Hosted Checkout', exact: true })
  await expect(start).toBeEnabled()
  await start.focus()
  await expect(start).toBeFocused()
  await start.press('Enter')
  await expect(page).toHaveURL(`${BASE_URL}/halden/hosted/${ORDER_ID}`)
  await expect(page.getByRole('heading', { name: 'Complete your Halden order.', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true })).toBeEnabled()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('input')).toHaveCount(0)
}

async function restoreCheckout(
  page: Page,
  mock: Awaited<ReturnType<typeof installCheckoutMock>>,
  trigger: 'reload' | 'pageshow',
) {
  const recoveryCalls = mock.calls.filter(call => call.path === '/api/payment/recover').length
  const createCalls = mock.calls.filter(call => call.path === '/api/payment/create').length
  // Register before the navigation/event. Module loading and restoration are a
  // separate phase from the UI assertion deadline after recovery has finished.
  const recovered = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.origin === BASE_URL
      && url.pathname === '/api/payment/recover'
      && url.searchParams.get('orderId') === ORDER_ID
  })
  const [response] = await Promise.all([
    recovered,
    trigger === 'reload'
      ? page.reload()
      : page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))),
  ])
  expect(response.status(), 'the original order must be recovered successfully').toBe(200)
  expect(await response.json()).toMatchObject({
    order: { id: ORDER_ID },
    attempt: { id: ATTEMPT_ID, orderId: ORDER_ID, integration: 'checkout', method: 'all' },
  })
  expect(mock.calls.filter(call => call.path === '/api/payment/recover')).toHaveLength(recoveryCalls + 1)
  expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(createCalls)
  await expect(page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Verify existing payment', exact: true })).toBeEnabled()
}

async function expectNoPersistedRedirect(page: Page) {
  const leaks = await page.evaluate(() => {
    const storage = JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })
    const html = document.documentElement.outerHTML
    return {
      navigationInStorage: storage.includes('mock-navigation-only'),
      navigationInDocument: html.includes('mock-navigation-only'),
      returnInStorage: storage.includes('discard-return-parameter'),
      returnInDocument: html.includes('discard-return-parameter'),
    }
  })
  expect(leaks, 'navigation capabilities and discarded return parameters must not persist').toEqual({
    navigationInStorage: false,
    navigationInDocument: false,
    returnInStorage: false,
    returnInDocument: false,
  })
}

test('Hosted Checkout navigates out and verifies its sanitized browser return with server mocks', async ({ page }) => {
  test.setTimeout(120_000)
  const mock = await installCheckoutMock(page)
  await startCheckout(page)
  await expectNoPersistedRedirect(page)
  const continueButton = page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true })
  await continueButton.focus()
  await continueButton.press('Enter')
  await expect(page).toHaveURL(HOSTED_URL)
  await expect(page.getByRole('heading', { name: 'Mock Onerway Checkout' })).toBeVisible()
  await expect(page.locator('input, iframe, form')).toHaveCount(0)
  await page.getByRole('link', { name: 'Return to Halden', exact: true }).press('Enter')
  // Routing disables HTTP cache, so a cross-origin round trip reloads the
  // Nuxt development module graph before the client can restore the order.
  await expect(page).toHaveURL(`${BASE_URL}/halden/result/${ORDER_ID}`, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Sandbox payment verified.', exact: true })).toBeFocused()
  await page.getByRole('button', { name: /show technical details/i }).click()
  const details = page.locator('#payment-technical-details-content')
  await expect(details.locator('dt').filter({ hasText: /^integration$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('checkout')
  await expect(details.locator('dt').filter({ hasText: /^returnObserved$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('yes')
  await expect(details).not.toContainText('sdkRelease')
  await expectNoPersistedRedirect(page)
  expect(mock.calls.map(call => call.path)).toEqual([
    '/api/payment/recover', '/api/payment/intent', '/api/payment/create', '/api/payment/return', '/api/payment/recover', '/api/payment/query',
  ])
  expect(mock.navigations).toContain(`${BASE_URL}${RETURN_PATH}`)
  expect(mock.externalRequests).toEqual([HOSTED_URL])
  mock.assertClean()
})

test('refresh preserves the existing Hosted attempt and clears the one-use navigation URL', async ({ page }) => {
  const mock = await installCheckoutMock(page)
  await startCheckout(page)
  await restoreCheckout(page, mock, 'reload')
  await expect(page.getByRole('heading', { name: 'Complete your Halden order.', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true })).toBeDisabled()
  const verify = page.getByRole('button', { name: 'Verify existing payment', exact: true })
  await expect(verify).toBeEnabled()
  await expectNoPersistedRedirect(page)
  expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(1)
  expect(mock.externalRequests).toEqual([])
  await verify.focus()
  await verify.press('Enter')
  await expect(page).toHaveURL(`${BASE_URL}/halden/result/${ORDER_ID}`)
  expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(1)
  mock.assertClean()
})

test('a persisted pageshow event restores the same attempt without replaying its URL', async ({ page }) => {
  const mock = await installCheckoutMock(page)
  await startCheckout(page)
  // This exercises the BFCache restoration handler; it does not claim Chromium
  // actually placed a dev-server page with its WebSocket into BFCache.
  await restoreCheckout(page, mock, 'pageshow')
  await expect(page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Verify existing payment', exact: true })).toBeEnabled()
  expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(1)
  expect(mock.externalRequests).toEqual([])
  await expectNoPersistedRedirect(page)
  mock.assertClean()
})

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [1440, 834, 390, 320]) {
    test(`Hosted Checkout fits ${width}px in ${colorScheme} mode`, async ({ page }) => {
      const mock = await installCheckoutMock(page)
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      await startCheckout(page)
      await expect(page.locator('html')).toHaveClass(new RegExp(`(?:^|\\s)${colorScheme}(?:\\s|$)`))
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: `/tmp/onerway-hosted-${width}-${colorScheme}.png`, fullPage: true })
      await restoreCheckout(page, mock, 'reload')
      await expect(page.getByRole('button', { name: 'Verify existing payment', exact: true })).toBeEnabled()
      await expectNoHorizontalOverflow(page)
      await page.getByRole('button', { name: 'Verify existing payment', exact: true }).click()
      await expect(page).toHaveURL(`${BASE_URL}/halden/result/${ORDER_ID}`)
      await page.getByRole('button', { name: /show technical details/i }).click()
      await expectNoHorizontalOverflow(page)
      await expectNoPersistedRedirect(page)
      mock.assertClean()
    })
  }
}
