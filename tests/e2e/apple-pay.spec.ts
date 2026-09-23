import { expect, test, type Page } from '@playwright/test'
import type { PrepareApplePayResponse } from '../../shared/payment/apple-pay'
import { APPLE_PAY_SCRIPT } from '../../app/utils/apple-pay.client'
import { expectNoHorizontalOverflow, gotoHydrated } from './support'

const BASE_URL = 'http://127.0.0.1:4173'

function payment(status: PrepareApplePayResponse['attempt']['status'] = 'created', orderId = 'order-direct'): PrepareApplePayResponse {
  const createdAt = '2026-09-23T00:00:00.000Z'
  const attempt = { id: `attempt-${orderId}`, orderId, integration: 'direct-api' as const, method: 'apple-pay' as const, status, statusSource: 'server' as const, merchantTxnId: `merchant-${orderId}`, ...(status !== 'created' ? { transactionId: `transaction-${orderId}` } : {}), createdAt, updatedAt: createdAt }
  return {
    order: { id: orderId, scene: 'ecommerce', item: { sku: 'direct', name: 'Halden Field Jacket', variant: 'Slate / M', quantity: 1, unitAmount: { minor: 500, currency: 'USD' } }, amount: { minor: 500, currency: 'USD' }, fulfillment: 'pending', createdAt },
    attempt, attempts: [attempt], events: status === 'created' ? [] : [{ id: `event-${orderId}`, attemptId: attempt.id, source: 'server', status, rawStatus: status === 'succeeded' ? 'S' : status === 'failed' ? 'F' : 'P', occurredAt: createdAt }], paymentId: null, query: null, submitted: status !== 'created',
    canAuthorize: status === 'created', merchantIdentifier: 'merchant.example', paymentRequest: { countryCode: 'US', currencyCode: 'USD', supportedNetworks: ['visa'], merchantCapabilities: ['supports3DS'], total: { label: 'Halden', amount: '5.00' } },
  }
}

// The provider boundary is mocked. No actual Apple session or payment is opened.
const appleMock = `
customElements.define('apple-pay-button', class extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<button style="width:100%;height:48px;background:#000;color:#fff;border-radius:4px">Pay with Apple Pay</button>';
  }
});
window.ApplePaySession = class {
  static STATUS_SUCCESS = 0;
  static STATUS_FAILURE = 1;
  static supportsVersion() { return true; }
  static canMakePayments() { return true; }
  static async applePayCapabilities() { return { paymentCredentialStatus: 'paymentCredentialStatusUnknown' }; }
  begin() { this.onvalidatemerchant({ validationURL: 'https://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession' }); }
  completeMerchantValidation() { this.onpaymentauthorized({ payment: { token: { paymentData: { data: 'synthetic-only' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-only' } } }); }
  completePayment(result) { window.__appleCompletions = (window.__appleCompletions || []).concat(result.status); }
  abort() {}
};`

async function installAppleMock(page: Page, result: 'succeeded' | 'failed' = 'succeeded', initial: PrepareApplePayResponse['attempt']['status'] = 'created') {
  let current = payment(initial)
  const calls: string[] = []
  const violations: string[] = []
  await page.context().route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.url() === APPLE_PAY_SCRIPT) {
      await route.fulfill({ contentType: 'application/javascript', body: appleMock })
      return
    }
    if (url.origin !== BASE_URL) {
      violations.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
      return
    }
    if (url.pathname === '/api/profile') {
      await route.fulfill({ json: { profile: 'sandbox', environment: 'Sandbox', transactionPolicy: 'sandbox-only', canonicalOrigin: BASE_URL } })
      return
    }
    if (url.pathname.startsWith('/api/payment/') || url.pathname.startsWith('/api/webhooks/')) {
      calls.push(url.pathname)
      const body = request.postData() ? request.postDataJSON() : null
      if (url.pathname === '/api/payment/apple-pay/prepare') {
        expect(body).toEqual({ orderId: current.order.id })
        await route.fulfill({ json: current })
      }
      else if (url.pathname === '/api/payment/apple-pay/validate') {
        expect(body).toEqual({ orderId: current.order.id, attemptId: current.attempt.id, validationURL: 'https://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession' })
        await route.fulfill({ json: { merchantSession: { synthetic: 'merchant-session-only' } } })
      }
      else if (url.pathname === '/api/payment/apple-pay/pay') {
        expect(current.submitted).toBe(false)
        expect(body).toMatchObject({ orderId: current.order.id, attemptId: current.attempt.id, token: { paymentData: { data: 'synthetic-only' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-only' }, browser: { language: 'en-US' } })
        current = payment(result, current.order.id)
        await route.fulfill({ json: current })
      }
      else if (url.pathname === '/api/payment/recover') {
        await route.fulfill({ json: current })
      }
      else if (url.pathname === '/api/payment/intent') {
        expect(body).toEqual({ journeyId: 'apple-pay-direct', method: 'apple-pay', restart: true })
        current = payment('created', 'order-direct-2')
        await route.fulfill({ json: { orderId: current.order.id, create: true } })
      }
      else {
        violations.push(`${request.method()} ${url.pathname}`)
        await route.fulfill({ status: 403, json: { statusMessage: 'MOCK_ROUTE_FORBIDDEN' } })
      }
      return
    }
    await route.continue()
  })
  return { calls, assertClean: () => expect(violations).toEqual([]) }
}

test.describe('mock Apple Pay Direct browser journey', () => {
  for (const width of [320, 390, 834, 1440]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`shows official element and six readable steps at ${width}px ${colorScheme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.emulateMedia({ colorScheme })
        const mock = await installAppleMock(page)
        await gotoHydrated(page, '/halden/direct/order-direct')
        await expect(page.locator('apple-pay-button')).toBeVisible()
        await expect(page.locator('header').first()).toContainText('Sandbox')
        await expect(page.locator('footer')).toContainText('forwards the encrypted token')
        await expect(page.locator('footer')).not.toContainText('simulated')
        await expect(page.getByRole('heading', { name: 'How this payment works' })).toBeVisible()
        const summaries = page.locator('summary')
        await expect(summaries).toHaveCount(6)
        await summaries.first().focus()
        await page.keyboard.press('Enter')
        await expect(page.locator('details').first()).toHaveAttribute('open', '')
        await expect(page.locator('details').first().getByText('Who acts', { exact: true })).toBeVisible()
        for (let index = 1; index < 6; index++) await summaries.nth(index).click()
        await expect(page.getByRole('link', { name: 'Official documentation', exact: true })).toHaveCount(6)
        await expectNoHorizontalOverflow(page)
        await expect(page.locator('body')).not.toContainText('synthetic-only')
        await page.evaluate(() => window.scrollTo(0, 0))
        if (width === 390 || width === 1440) await testInfo.attach(`apple-pay-${width}-${colorScheme}`, { body: await page.screenshot({ path: testInfo.outputPath(`apple-pay-${width}-${colorScheme}.png`), fullPage: true }), contentType: 'image/png' })
        expect(mock.calls.filter(path => path.endsWith('/pay'))).toHaveLength(0)
        mock.assertClean()
      })
    }
  }

  test('pays once and restores the existing order after refresh without replaying browser events', async ({ page }) => {
    const mock = await installAppleMock(page)
    await gotoHydrated(page, '/halden/direct/order-direct')
    await page.locator('apple-pay-button').getByRole('button').click()
    await expect(page.getByRole('heading', { name: 'Your order is paid.' })).toBeVisible()
    expect(mock.calls.filter(path => path.endsWith('/pay'))).toHaveLength(1)
    await expect(page.locator('body')).not.toContainText('synthetic-only')
    await expect(page.locator('body')).not.toContainText('merchant-session-only')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Your order is paid.' })).toBeVisible()
    await expect(page.locator('apple-pay-button')).toHaveCount(0)
    await expect(page.locator('summary').nth(3)).toContainText('Not observed')
    expect(mock.calls.filter(path => path.endsWith('/pay'))).toHaveLength(1)
    mock.assertClean()
  })

  test('creates a separate order after a confirmed failure', async ({ page }) => {
    await page.addInitScript(() => {
      const state = window as unknown as { intentLockNames: string[] }
      state.intentLockNames = []
      navigator.locks.request = new Proxy(navigator.locks.request, {
        apply(target, owner, args) {
          state.intentLockNames.push(String(args[0]))
          return Reflect.apply(target, owner, args)
        },
      })
    })
    const mock = await installAppleMock(page, 'failed')
    await gotoHydrated(page, '/halden/direct/order-direct')
    await page.locator('apple-pay-button').getByRole('button').click()
    await expect(page.getByRole('heading', { name: 'This payment failed.' })).toBeVisible()
    await page.getByRole('button', { name: 'Place a new order and pay' }).click()
    await expect(page).toHaveURL('/halden/direct/order-direct-2')
    await expect(page.locator('apple-pay-button')).toBeVisible()
    expect(mock.calls.filter(path => path.endsWith('/intent'))).toHaveLength(1)
    expect(mock.calls.filter(path => path.endsWith('/pay'))).toHaveLength(1)
    expect(await page.evaluate(() => (window as unknown as { intentLockNames: string[] }).intentLockNames)).toEqual(['onerway-payment-intent', 'onerway-payment-intent'])
    mock.assertClean()
  })

  test('does not create another order when browser intent locks are unavailable', async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(navigator, 'locks', { value: undefined }) })
    const mock = await installAppleMock(page, 'failed', 'failed')
    await gotoHydrated(page, '/halden/direct/order-direct')
    await page.getByRole('button', { name: 'Place a new order and pay' }).click()
    await expect(page.getByText('A new order could not be opened. Your previous order is preserved.')).toBeVisible()
    expect(mock.calls.filter(path => path.endsWith('/intent'))).toHaveLength(0)
    mock.assertClean()
  })

  test('restores an unknown submitted order without offering another payment', async ({ page }) => {
    const mock = await installAppleMock(page, 'succeeded', 'processing')
    await gotoHydrated(page, '/halden/direct/order-direct')
    await expect(page.getByRole('heading', { name: 'Payment result is being confirmed.' })).toBeVisible()
    await expect(page.locator('apple-pay-button')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Place a new order and pay' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Check this order' }).click()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Check this order' })).toBeVisible()
    expect(mock.calls.filter(path => path.endsWith('/pay') || path.endsWith('/intent'))).toHaveLength(0)
    mock.assertClean()
  })
})
