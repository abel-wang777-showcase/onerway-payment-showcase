import { expect, test, type Page } from '@playwright/test'
import type { OnerwayCheckout, OnerwayPaymentElement } from '../../app/utils/sdk.client'
import { createAttempt, setAttemptStatus } from '../../shared/payment/attempt'
import { createEvent } from '../../shared/payment/event'
import { createOrder } from '../../shared/payment/order'
import { toPaymentAttemptSummary } from '../../shared/payment/sdk'

const BASE_URL = 'http://127.0.0.1:4173'
const SDK_URL = 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js'
const ORDER_ID = 'HLD-SDK-VALIDATION-E2E'
const ATTEMPT_ID = `${ORDER_ID}-attempt-1`
const PAYMENT_ID = 'mock-sdk-payment'
const TIMESTAMP = '2026-10-12T00:00:00.000Z'

// Served as a script in place of the external SDK. The only input is an ordinary
// text marker; this fixture never asks for, creates, or records payment details.
function installBrowserSdk() {
  const counters = document.documentElement.dataset
  counters.sdkCreates = '0'
  counters.sdkMounts = '0'
  counters.sdkConfirms = '0'
  counters.sdkDetaches = '0'
  window.Onerway = {
    async createCheckout(paymentId) {
      counters.sdkCreates = String(Number(counters.sdkCreates) + 1)
      counters.sdkPaymentId = paymentId
      const handlers = new Map<string, (value: unknown) => void>()
      let input: HTMLInputElement
      const element: OnerwayPaymentElement = {
        on(event, handler) { handlers.set(event, handler); return element },
        off(event) {
          counters.sdkDetaches = String(Number(counters.sdkDetaches) + 1)
          handlers.delete(event)
          return element
        },
        mount(target) {
          counters.sdkMounts = String(Number(counters.sdkMounts) + 1)
          const host = typeof target === 'string' ? document.getElementById(target) : target
          if (!host) throw new Error('MOCK_ELEMENT_HOST_MISSING')
          const label = document.createElement('label')
          label.textContent = 'Synthetic test marker'
          input = document.createElement('input')
          input.type = 'text'
          input.autocomplete = 'off'
          input.dataset.syntheticSdkInput = 'true'
          label.append(input)
          host.append(label)
          queueMicrotask(() => handlers.get('ready')?.(undefined))
          return element
        },
      }
      const checkout: OnerwayCheckout = {
        createPaymentElement: () => element,
        on: () => checkout,
        off: () => checkout,
        async confirmPayment() {
          counters.sdkConfirms = String(Number(counters.sdkConfirms) + 1)
          return input.value === 'synthetic test marker'
            ? { paymentId, paymentStatus: 'S', paymentMethod: 'CARD' }
            : { paymentId, reason: { type: 'validation_error', code: 'FORM_INCOMPLETE' } }
        },
      }
      return checkout
    },
  }
}

async function installSdkMock(page: Page) {
  const order = createOrder({
    id: ORDER_ID, scene: 'ecommerce', createdAt: TIMESTAMP,
    item: {
      sku: 'HL-SAMPLE-005', name: 'Halden sample', variant: 'Standard success', quantity: 1,
      unitAmount: { minor: 500, currency: 'USD' },
    },
    amount: { minor: 500, currency: 'USD' },
  })
  let attempt = createAttempt({
    id: ATTEMPT_ID, orderId: ORDER_ID, integration: 'web-js-sdk', method: 'card',
    merchantTxnId: 'mock-sdk-merchant-transaction', transactionId: 'mock-sdk-transaction',
    paymentId: PAYMENT_ID, createdAt: TIMESTAMP,
  })
  const createdEvent = createEvent({
    id: 'mock-sdk-created', attemptId: ATTEMPT_ID, source: 'server',
    sourceKey: `create:${ATTEMPT_ID}`, status: 'created', rawStatus: 'U', occurredAt: TIMESTAMP,
  })
  const query = { token: 'q'.repeat(43), expiresAt: '2099-10-12T00:05:00.000Z' }
  const calls: string[] = []
  const violations: string[] = []
  const externalRequests: string[] = []
  let created = false
  let releaseQuery!: () => void
  const queryGate = new Promise<void>((resolve) => { releaseQuery = resolve })

  await page.context().route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== BASE_URL) {
      externalRequests.push(request.url())
      if (request.url() === SDK_URL && request.method() === 'GET' && request.resourceType() === 'script') {
        await route.fulfill({ contentType: 'application/javascript', body: `(${installBrowserSdk.toString()})()` })
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
        canonicalOrigin: BASE_URL, sdk: { url: SDK_URL, release: 'v4/latest' },
      } })
      return
    }
    if (url.pathname === '/api/_nuxt_icon/lucide.json' && request.method() === 'GET') {
      await route.continue()
      return
    }
    // Only the local icon asset may pass through; payment APIs never reach Nitro.
    if (url.pathname.startsWith('/api/')) {
      calls.push(url.pathname)
      if (url.pathname === '/api/payment/recover' && request.method() === 'GET' && !created) {
        await route.fulfill({ status: 401, json: { statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' } })
      }
      else if (url.pathname === '/api/payment/intent' && request.method() === 'POST') {
        expect(request.postDataJSON()).toEqual({ journeyId: 'standard-success', method: 'card', restart: true, amountMinor: order.amount.minor })
        await route.fulfill({ json: { orderId: ORDER_ID, create: true } })
      }
      else if (url.pathname === '/api/payment/create' && request.method() === 'POST') {
        expect(created, 'create must not repeat after validation').toBe(false)
        created = true
        await route.fulfill({ json: {
          order, attempt, attempts: [toPaymentAttemptSummary(attempt)], event: createdEvent,
          paymentId: PAYMENT_ID, query,
        } })
      }
      else if (url.pathname === '/api/payment/submit' && request.method() === 'POST' && created) {
        expect(request.postDataJSON()).toEqual({ orderId: ORDER_ID, attemptId: ATTEMPT_ID, paymentId: PAYMENT_ID })
        expect(attempt.submissionStartedAt, 'the persisted submission claim is granted only once').toBeUndefined()
        attempt = { ...attempt, submissionStartedAt: TIMESTAMP }
        await route.fulfill({ json: { attempt, claimed: true } })
      }
      else if (url.pathname === '/api/payment/query' && request.method() === 'POST' && created) {
        expect(request.postDataJSON()).toEqual({ attemptId: ATTEMPT_ID, paymentId: PAYMENT_ID, ...query })
        await queryGate
        attempt = {
          ...setAttemptStatus(attempt, 'succeeded', TIMESTAMP, 'query'),
          attributionTransactionId: attempt.transactionId, fundingNetwork: 'VISA',
        }
        const event = createEvent({
          id: 'mock-sdk-query', attemptId: ATTEMPT_ID, source: 'query', sourceKey: 'mock-sdk-query',
          status: 'succeeded', rawStatus: 'S', transactionId: attempt.transactionId, occurredAt: TIMESTAMP,
        })
        await route.fulfill({ json: { attempt, event } })
      }
      else {
        violations.push(`${request.method()} ${url.pathname}`)
        await route.abort('blockedbyclient')
      }
      return
    }
    await route.continue()
  })

  return {
    calls, releaseQuery,
    assertClean() {
      expect(violations, 'mock SDK network boundary').toEqual([])
      expect(externalRequests, 'the only external request is intercepted mock SDK loading').toEqual([SDK_URL])
    },
  }
}

test('keeps the same secure form after validation and verifies one corrected payment', async ({ page }) => {
  const mock = await installSdkMock(page)
  // Client navigation allows the browser-mocked public profile to be used while
  // the actual local server remains locked to Production with no credentials.
  await page.goto('/halden/checkout/HLD-MOCK-ENTRY')
  await page.getByRole('link', { name: 'Return to Demo Hub', exact: true }).click()
  await page.getByRole('button', { name: 'Start a new real Sandbox checkout', exact: true }).click()
  await expect(page).toHaveURL(`${BASE_URL}/halden/sdk/${ORDER_ID}`)
  const marker = page.getByLabel('Synthetic test marker', { exact: true })
  const pay = page.getByRole('button', { name: 'Pay by card · $5.00', exact: true })
  await expect(marker).toBeVisible()
  await expect(marker).toBeEmpty()
  await expect(pay).toBeEnabled()
  const originalInput = await marker.elementHandle()

  await pay.click()
  await expect(page.getByRole('alert')).toContainText('Check the payment details in the secure form')
  await expect(pay).toBeEnabled()
  await expect(marker).toBeVisible()
  expect(await originalInput!.evaluate(input => input.isConnected)).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('data-sdk-creates', '1')
  await expect(page.locator('html')).toHaveAttribute('data-sdk-mounts', '1')
  await expect(page.locator('html')).toHaveAttribute('data-sdk-detaches', '0')
  await expect(page.locator('html')).toHaveAttribute('data-sdk-confirms', '1')
  expect(mock.calls.filter(path => path === '/api/payment/query')).toHaveLength(0)

  await marker.fill('synthetic test marker')
  try {
    await pay.click()
    await expect.poll(() => mock.calls.filter(path => path === '/api/payment/query').length).toBe(1)
    await expect(page.locator('[data-stage="verifying"]')).toBeVisible()
    await expect(page).toHaveURL(`${BASE_URL}/halden/sdk/${ORDER_ID}`)
    await expect(page.locator('html')).toHaveAttribute('data-sdk-confirms', '2')
    await expect(page.locator('html')).toHaveAttribute('data-sdk-payment-id', PAYMENT_ID)
  }
  finally {
    mock.releaseQuery()
  }
  await expect(page).toHaveURL(`${BASE_URL}/halden/result/${ORDER_ID}`)
  await expect(page.getByRole('heading', { name: 'Sandbox payment verified.', exact: true })).toBeVisible()
  expect(mock.calls.filter(path => path === '/api/payment/intent')).toHaveLength(1)
  expect(mock.calls.filter(path => path === '/api/payment/create')).toHaveLength(1)
  expect(mock.calls.filter(path => path === '/api/payment/submit')).toHaveLength(1)
  expect(mock.calls.filter(path => path === '/api/payment/query')).toHaveLength(1)
  mock.assertClean()
})
