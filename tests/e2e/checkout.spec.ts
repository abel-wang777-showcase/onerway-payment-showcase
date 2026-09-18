import { expect, test, type Page } from '@playwright/test'
import { createAttempt, setAttemptStatus, type PaymentStatus } from '../../shared/payment/attempt'
import { createEvent } from '../../shared/payment/event'
import { createOrder } from '../../shared/payment/order'
import { toPaymentAttemptSummary } from '../../shared/payment/sdk'
import { createSubscriptionPlaceholder, getSubscriptionPlan, toSubscriptionSummary, type SubscriptionState } from '../../shared/payment/subscription'
import { expectNoHorizontalOverflow } from './support'

const BASE_URL = 'http://127.0.0.1:4173'
const ORDER_ID = 'HLD-CHECKOUT-E2E'
const ATTEMPT_ID = `${ORDER_ID}-attempt-1`
const HOSTED_URL = 'https://sandbox-checkout.onerway.com/checkout?session=mock-navigation-only'
const RETURN_PATH = `/halden/return/${ORDER_ID}`
const TIMESTAMP = '2026-09-14T08:00:00.000Z'

const CHECKOUT_JOURNEYS = [
  { id: 'hosted-checkout', amount: 500, sku: 'HL-CHECKOUT-005', variant: 'Hosted checkout' },
  { id: 'hosted-checkout-three-ds', amount: 5_000, sku: 'HL-CHECKOUT-050', variant: 'Hosted checkout 3DS' },
] as const
type CheckoutJourney = typeof CHECKOUT_JOURNEYS[number]
const THREE_DS = CHECKOUT_JOURNEYS[1]

interface QueryOutcome {
  status: PaymentStatus
  transactionStatus: string
  paymentStatus?: string
}

async function installCheckoutMock(page: Page, options: {
  journey?: CheckoutJourney
  queryOutcome?: QueryOutcome
  interaction?: 'success' | 'cancelled'
  loseCreateResponse?: boolean
  subscription?: boolean
} = {}) {
  const journey = options.journey ?? CHECKOUT_JOURNEYS[0]
  let queryOutcome: QueryOutcome = options.queryOutcome ?? { status: 'succeeded', transactionStatus: 'S' }
  let subscription = options.subscription ? toSubscriptionSummary(createSubscriptionPlaceholder({
    id: 'subscription-fixture', plan: getSubscriptionPlan('halden-daily-essentials-v1'),
    initialOrderId: ORDER_ID, initialAttemptId: ATTEMPT_ID, createdAt: TIMESTAMP,
  })) : undefined
  const intentPath = options.subscription ? '/api/payment/subscription/intent' : '/api/payment/intent'
  const createPath = options.subscription ? '/api/payment/subscription/create' : '/api/payment/create'
  const returnPath = options.subscription ? '/halden/subscription/return' : RETURN_PATH

  const order = createOrder({
    id: ORDER_ID,
    scene: 'ecommerce',
    item: {
      sku: options.subscription ? 'HL-SUB-DAILY-005' : journey.sku,
      name: subscription?.productName ?? 'Halden sample', variant: options.subscription ? 'Daily subscription' : journey.variant, quantity: 1,
      unitAmount: { minor: journey.amount, currency: 'USD' },
    },
    amount: { minor: journey.amount, currency: 'USD' },
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
    ...(subscription ? { subscription } : {}),
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
          body: `<!doctype html><html lang="en"><head><title>Mock Hosted Checkout</title></head><body><main><h1>Mock Onerway Checkout</h1><p>Mock interaction: ${options.interaction ?? 'success'}. No payment or real 3DS is submitted.</p><a href="${BASE_URL}${returnPath}?providerStatus=${options.interaction === 'cancelled' ? 'N' : 'S'}&amp;session=discard-return-parameter">Return to Halden</a></main></body></html>`,
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
      if (url.pathname === intentPath && request.method() === 'POST') {
        expect(body).toEqual(options.subscription
          ? { planId: 'halden-daily-essentials-v1', integration: 'checkout' }
          : { journeyId: journey.id, method: 'all', restart: true })
        await route.fulfill({ json: { orderId: ORDER_ID, integration: 'checkout', create: true } })
      }
      else if (url.pathname === createPath && request.method() === 'POST') {
        expect(body).toEqual({})
        expect(created, 'a mock order must be created only once').toBe(false)
        created = true
        if (options.loseCreateResponse) {
          await route.abort('connectionclosed')
          return
        }
        await route.fulfill({ json: {
          order, attempt, attempts: [toPaymentAttemptSummary(attempt)], event: createdEvent,
          paymentId: attempt.paymentId, query, redirectUrl: HOSTED_URL,
          ...(subscription ? { subscription } : {}),
        } })
      }
      else if (url.pathname === '/api/payment/recover' && request.method() === 'GET' && !created) {
        expect(url.searchParams.has('orderId')).toBe(false)
        await route.fulfill({ status: 401, json: { statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' } })
      }
      else if (url.pathname === '/api/payment/recover' && request.method() === 'GET' && created) {
        if (url.searchParams.has('orderId')) expect(url.searchParams.get('orderId')).toBe(ORDER_ID)
        await route.fulfill({ json: session() })
      }
      else if (url.pathname === (options.subscription ? '/api/payment/subscription/return' : '/api/payment/return') && request.method() === 'POST' && created) {
        expect(body).toEqual(options.subscription ? null : { orderId: ORDER_ID })
        events.push(createEvent({
          id: 'return-event', attemptId: ATTEMPT_ID, source: 'return', sourceKey: ATTEMPT_ID,
          status: 'processing', occurredAt: TIMESTAMP,
        }))
        await route.fulfill({ json: { duplicate: false } })
      }
      else if (url.pathname === '/api/payment/query' && request.method() === 'POST' && created) {
        expect(body).toEqual({ attemptId: ATTEMPT_ID, paymentId: attempt.paymentId, ...query })
        attempt = setAttemptStatus(attempt, queryOutcome.status, TIMESTAMP, 'query')
        const event = createEvent({
          id: `query-event-${events.length}`, attemptId: ATTEMPT_ID, source: 'query', sourceKey: `checkout-query-${events.length}`,
          status: queryOutcome.status, rawStatus: queryOutcome.transactionStatus,
          transactionStatus: queryOutcome.transactionStatus, paymentStatus: queryOutcome.paymentStatus,
          transactionId: attempt.transactionId, occurredAt: TIMESTAMP,
        })
        events.push(event)
        await route.fulfill({ json: { attempt, event, ...(subscription ? { subscription } : {}) } })
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
    setQueryOutcome(outcome: QueryOutcome) { queryOutcome = outcome },
    setSubscriptionState(state: SubscriptionState) {
      if (!subscription) throw new Error('SUBSCRIPTION_FIXTURE_REQUIRED')
      subscription = { ...subscription, state, statusSource: 'query' }
    },
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

async function startCheckout(page: Page, journey: CheckoutJourney = CHECKOUT_JOURNEYS[0], createUnknown = false) {
  await enterHub(page)
  const selectedJourney = page.locator(`[role="radio"][value="${journey.id}"]`)
  await selectedJourney.focus()
  await selectedJourney.press('Space')
  await expect(selectedJourney).toBeChecked()
  await expectNoHorizontalOverflow(page)
  const start = page.getByRole('button', { name: 'Start a new Sandbox Hosted Checkout', exact: true })
  await expect(start).toBeEnabled()
  await start.focus()
  await expect(start).toBeFocused()
  await start.press('Enter')
  await expect(page).toHaveURL(`${BASE_URL}/halden/hosted/${ORDER_ID}`)
  await expect(page.getByRole('heading', { name: 'Complete your Halden order.', exact: true })).toBeFocused()
  const continueButton = page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true })
  if (createUnknown) await expect(continueButton).toBeDisabled()
  else await expect(continueButton).toBeEnabled()
  await expect(page.getByText(`$${(journey.amount / 100).toFixed(2)}`, { exact: true }).first()).toBeVisible()
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

for (const journey of CHECKOUT_JOURNEYS) {
  test(`${journey.id} navigates out and verifies its sanitized browser return with server mocks`, async ({ page }) => {
    test.setTimeout(120_000)
    const mock = await installCheckoutMock(page, { journey })
    await startCheckout(page, journey)
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
    await expect(details.locator('dt').filter({ hasText: /^journey$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(journey.id)
    await expect(details.locator('dt').filter({ hasText: /^amountMinor \/ currency$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(`${journey.amount} / USD`)
    await expect(details.locator('dt').filter({ hasText: /^threeDSJourney$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(journey.id === THREE_DS.id ? 'challenge' : 'not-selected')
    await expect(details).not.toContainText('sdkRelease')
    await expectNoPersistedRedirect(page)
    expect(mock.calls.map(call => call.path)).toEqual([
      '/api/payment/recover', '/api/payment/intent', '/api/payment/create', '/api/payment/return', '/api/payment/recover', '/api/payment/query',
    ])
    expect(mock.navigations).toContain(`${BASE_URL}${RETURN_PATH}`)
    expect(mock.externalRequests).toEqual([HOSTED_URL])
    mock.assertClean()
  })
}

test('refresh preserves the existing USD 50 Hosted attempt and clears the one-use navigation URL', async ({ page }) => {
  const mock = await installCheckoutMock(page, { journey: THREE_DS })
  await startCheckout(page, THREE_DS)
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

// These are merchant-browser and server-response mocks. They do not exercise
// issuer Challenge UI, provider status mapping, or real Sandbox transactions.
for (const queryOutcome of [
  { status: 'requires_action', transactionStatus: 'R' },
  { status: 'processing', transactionStatus: 'F' },
  { status: 'processing', transactionStatus: 'F', paymentStatus: 'O' },
] satisfies QueryOutcome[]) {
  test(`USD 50 interaction success stays non-final for query ${queryOutcome.transactionStatus}/${queryOutcome.paymentStatus ?? 'absent'}`, async ({ page }) => {
    test.setTimeout(120_000)
    const mock = await installCheckoutMock(page, { journey: THREE_DS, queryOutcome })
    await startCheckout(page, THREE_DS)
    await page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true }).click()
    await expect(page.getByText('Mock interaction: success.', { exact: false })).toBeVisible()
    await page.getByRole('link', { name: 'Return to Halden', exact: true }).click()
    await expect(page).toHaveURL(`${BASE_URL}${RETURN_PATH}`)
    await expect(page.getByRole('button', { name: 'Verify existing payment', exact: true })).toBeEnabled({ timeout: 60_000 })
    await expect(page.getByRole('heading', { name: 'Sandbox payment verified.', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Retry payment', exact: true })).toHaveCount(0)
    await expectNoPersistedRedirect(page)
    // Recover the persisted projection on its regular route, including the
    // normalized non-final status returned by the mocked server.
    await page.goto(`/halden/hosted/${ORDER_ID}`)
    const references = page.getByRole('region', { name: 'Payment references' })
    await expect(references.locator('dt').filter({ hasText: /^normalizedStatus$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(queryOutcome.status)
    await expect(page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Retry payment', exact: true })).toHaveCount(0)
    expect(mock.calls.filter(call => call.path === '/api/payment/query').length).toBeGreaterThan(0)
    expect(mock.calls.filter(call => call.path === '/api/payment/intent')).toHaveLength(1)
    expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(1)
    mock.assertClean()
  })
}

test('USD 50 cancelled interaction requires query cancellation before enabling Retry', async ({ page }) => {
  test.setTimeout(120_000)
  const mock = await installCheckoutMock(page, {
    journey: THREE_DS,
    interaction: 'cancelled',
    queryOutcome: { status: 'requires_action', transactionStatus: 'R' },
  })
  await startCheckout(page, THREE_DS)
  await page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true }).click()
  await expect(page.getByText('Mock interaction: cancelled.', { exact: false })).toBeVisible()
  await page.getByRole('link', { name: 'Return to Halden', exact: true }).click()
  const verify = page.getByRole('button', { name: 'Verify existing payment', exact: true })
  await expect(verify).toBeEnabled({ timeout: 60_000 })
  await expect(page).toHaveURL(`${BASE_URL}${RETURN_PATH}`)
  await expect(page.getByRole('button', { name: 'Retry payment', exact: true })).toHaveCount(0)
  mock.setQueryOutcome({ status: 'cancelled', transactionStatus: 'N', paymentStatus: 'N' })
  await verify.click()
  await expect(page).toHaveURL(`${BASE_URL}/halden/result/${ORDER_ID}`)
  await expect(page.getByRole('button', { name: 'Retry payment', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: /show technical details/i }).click()
  const details = page.locator('#payment-technical-details-content')
  await expect(details.locator('dt').filter({ hasText: /^normalizedStatus$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('cancelled')
  await expect(details.locator('dt').filter({ hasText: /^verificationSource$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('query')
  expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(1)
  await expectNoPersistedRedirect(page)
  mock.assertClean()
})

test('closing the USD 50 hosted tab resumes the same attempt without another create', async ({ page, context }) => {
  const mock = await installCheckoutMock(page, { journey: THREE_DS })
  await startCheckout(page, THREE_DS)
  await page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true }).click()
  await expect(page).toHaveURL(HOSTED_URL)
  await page.close()
  // Preserve the browser context; the recover endpoint models its signed
  // cookie authorization. This does not claim an actual browser restart.
  const restoredPage = await context.newPage()
  await restoredPage.goto(`/halden/hosted/${ORDER_ID}`)
  await expect(restoredPage.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true })).toBeDisabled()
  await expect(restoredPage.getByRole('button', { name: 'Verify existing payment', exact: true })).toBeEnabled()
  await expectNoPersistedRedirect(restoredPage)
  await restoredPage.getByRole('button', { name: 'Verify existing payment', exact: true }).click()
  await expect(restoredPage).toHaveURL(`${BASE_URL}/halden/result/${ORDER_ID}`)
  expect(mock.calls.filter(call => call.path === '/api/payment/intent')).toHaveLength(1)
  expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(1)
  expect(mock.externalRequests).toEqual([HOSTED_URL])
  mock.assertClean()
})

test('unknown USD 50 create response restores the original attempt query-only', async ({ page }) => {
  const mock = await installCheckoutMock(page, { journey: THREE_DS, loseCreateResponse: true })
  await startCheckout(page, THREE_DS, true)
  await expect(page.getByRole('button', { name: 'Verify existing payment', exact: true })).toBeEnabled()
  await restoreCheckout(page, mock, 'reload')
  await expectNoPersistedRedirect(page)
  await page.getByRole('button', { name: 'Verify existing payment', exact: true }).click()
  await expect(page).toHaveURL(`${BASE_URL}/halden/result/${ORDER_ID}`)
  expect(mock.calls.filter(call => call.path === '/api/payment/intent')).toHaveLength(1)
  expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(1)
  expect(mock.externalRequests).toEqual([])
  mock.assertClean()
})

test('a restored USD 50 Hosted order keeps its journey when requesting a separate order', async ({ page }) => {
  const mock = await installCheckoutMock(page, { journey: THREE_DS })
  await startCheckout(page, THREE_DS)
  await restoreCheckout(page, mock, 'reload')
  // Inspect the new intent boundary and reject it before creating another
  // fixture order. This test checks the journey retained by the browser.
  let restartBody: unknown
  await page.route('**/api/payment/intent', async (route) => {
    restartBody = route.request().postDataJSON()
    await route.fulfill({ status: 409, json: { statusMessage: 'MOCK_RESTART_NOT_CREATED' } })
  })
  await page.getByRole('button', { name: 'Start a separate Sandbox order', exact: true }).click()
  await expect.poll(() => restartBody).toEqual({ journeyId: THREE_DS.id, method: 'all', restart: true })
  expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(1)
  mock.assertClean()
})

test('a Checkout subscription deep link keeps the fixed plan independent of the payment journey', async ({ page }) => {
  const mock = await installCheckoutMock(page, { journey: THREE_DS })
  await page.goto(`/?mode=subscription&journey=${THREE_DS.id}`)
  await expect(page.locator('[role="radio"][value="subscription"]')).toBeChecked()
  await expect(page.locator('[role="radio"][value="checkout"]')).toBeChecked()
  await expect(page.locator('[role="radio"][value="all"]')).toBeChecked()
  await expect(page.getByRole('heading', { name: 'Halden Daily Essentials', exact: true })).toBeVisible()
  await expect(page.getByText('$5.00', { exact: true })).toBeVisible()
  await expect(page.locator(`[role="radio"][value="${THREE_DS.id}"]`)).toHaveCount(0)
  expect(mock.calls.filter(call => call.path === '/api/payment/intent')).toHaveLength(0)
  expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(0)
  mock.assertClean()
})

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [1440, 834, 390, 320]) {
    test(`Hosted Checkout fits ${width}px in ${colorScheme} mode`, async ({ page }) => {
      const journey = (width === 320 || width === 834) ? THREE_DS : CHECKOUT_JOURNEYS[0]
      const mock = await installCheckoutMock(page, { journey })
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      await startCheckout(page, journey)
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

async function startCheckoutSubscription(page: Page, createUnknown = false) {
  await enterHub(page)
  const billing = page.locator('[role="radio"][value="subscription"]')
  await billing.focus()
  await billing.press('Space')
  await expect(billing).toBeChecked()
  await expect(page.getByText(/Conditional · Select Card on Checkout/)).toBeVisible()
  await page.getByRole('button', { name: 'Start Sandbox subscription', exact: true }).press('Enter')
  await expect(page).toHaveURL(`${BASE_URL}/halden/hosted/${ORDER_ID}`)
  await expect(page.getByRole('heading', { name: 'Start your Halden subscription.', exact: true })).toBeFocused()
  const next = page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true })
  if (createUnknown) await expect(next).toBeDisabled()
  else await expect(next).toBeEnabled()
  await expect(page.getByText(/Select Card to pay/)).toContainText('Halden Daily Essentials')
  await expect(page.locator('iframe, input')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
}

test('Checkout initial subscription keeps payment success separate from contract activation after return', async ({ page }) => {
  test.setTimeout(120_000)
  const mock = await installCheckoutMock(page, { subscription: true })
  await startCheckoutSubscription(page)
  await expectNoPersistedRedirect(page)
  await page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true }).press('Enter')
  await expect(page).toHaveURL(HOSTED_URL)
  await page.getByRole('link', { name: 'Return to Halden', exact: true }).press('Enter')
  await expect(page).toHaveURL(`${BASE_URL}/halden/result/${ORDER_ID}`, { timeout: 60_000 })
  await expect(page.getByRole('heading', { name: 'Payment verified · Subscription pending.', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry payment', exact: true })).toHaveCount(0)
  mock.setSubscriptionState('active')
  await page.getByRole('button', { name: 'Verify existing subscription', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Subscription active.', exact: true })).toBeVisible()
  await expectNoPersistedRedirect(page)
  expect(mock.calls.filter(call => call.path === '/api/payment/subscription/create')).toHaveLength(1)
  expect(mock.calls.some(call => call.path === '/api/payment/subscription/return')).toBe(true)
  mock.assertClean()
})

test('terminal Checkout subscription recovery offers a normal same-customer start from the Hub', async ({ page }) => {
  test.setTimeout(120_000)
  const mock = await installCheckoutMock(page, {
    subscription: true,
    queryOutcome: { status: 'cancelled', transactionStatus: 'N', paymentStatus: 'N' },
  })
  await startCheckoutSubscription(page)
  mock.setSubscriptionState('terminal')
  await page.reload()
  const verify = page.getByRole('button', { name: 'Verify existing payment', exact: true })
  await expect(verify).toBeEnabled()
  await verify.click()
  await expect(page).toHaveURL(`${BASE_URL}/halden/result/${ORDER_ID}`)
  await page.getByRole('link', { name: 'Return to Demo Hub', exact: true }).click()

  const checkout = page.locator('[role="radio"][value="checkout"]')
  await checkout.press('Space')
  await expect(checkout).toBeChecked()
  const billing = page.locator('[role="radio"][value="subscription"]')
  await billing.press('Space')
  await expect(billing).toBeChecked()
  const start = page.getByRole('button', { name: 'Start Sandbox subscription', exact: true })
  await expect(start).toBeEnabled()
  await expect(page.getByRole('link', { name: 'View existing subscription', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start again as a new Sandbox customer', exact: true })).toHaveCount(0)

  // Inspect the normal intent without creating a second order using the fixed fixture IDs.
  let restartBody: unknown
  await page.route('**/api/payment/subscription/intent', async (route) => {
    restartBody = route.request().postDataJSON()
    await route.fulfill({ status: 409, json: { statusMessage: 'MOCK_RESTART_NOT_CREATED' } })
  })
  await start.focus()
  await expect(start).toBeFocused()
  await start.press('Enter')
  await expect.poll(() => restartBody).toEqual({
    planId: 'halden-daily-essentials-v1', integration: 'checkout',
  })
  expect(mock.calls.filter(call => call.path === '/api/payment/subscription/create')).toHaveLength(1)
  expect(mock.externalRequests).toEqual([])
  mock.assertClean()
})

for (const loseCreateResponse of [false, true]) {
  test(`Checkout subscription restores the same attempt with create response ${loseCreateResponse ? 'lost' : 'received'}`, async ({ page }) => {
    const mock = await installCheckoutMock(page, { subscription: true, loseCreateResponse })
    await startCheckoutSubscription(page, loseCreateResponse)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Start your Halden subscription.', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue to Onerway Checkout', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Start a separate Sandbox order', exact: true })).toHaveCount(0)
    const verify = page.getByRole('button', { name: 'Verify existing payment', exact: true })
    await expect(verify).toBeEnabled()
    await verify.click()
    await expect(page.getByRole('heading', { name: 'Payment verified · Subscription pending.', exact: true })).toBeVisible()
    expect(mock.calls.filter(call => call.path === '/api/payment/subscription/create')).toHaveLength(1)
    expect(mock.externalRequests).toEqual([])
    mock.assertClean()
  })
}

for (const [width, colorScheme] of [[1440, 'light'], [390, 'dark']] as const) {
  test(`Checkout subscription fits ${width}px in ${colorScheme} mode`, async ({ page }) => {
    const mock = await installCheckoutMock(page, { subscription: true })
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme })
    await startCheckoutSubscription(page)
    await expect(page.locator('html')).toHaveClass(new RegExp(`(?:^|\\s)${colorScheme}(?:\\s|$)`))
    await page.screenshot({ path: `/tmp/onerway-issue10-hosted-${width}-${colorScheme}.png`, fullPage: true })
    await page.reload()
    await page.getByRole('button', { name: 'Verify existing payment', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Payment verified · Subscription pending.', exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `/tmp/onerway-issue10-pending-${width}-${colorScheme}.png`, fullPage: true })
    mock.assertClean()
  })
}
