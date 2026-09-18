import { expect, test, type Page } from '@playwright/test'
import type { AuthorizationOperationType, AuthorizationState } from '../../shared/payment/authorization'
import { authorizationSession } from '../vue/authorization-fixture'
import { expectNoHorizontalOverflow } from './support'

const BASE_URL = 'http://127.0.0.1:4173'
const ORDER_ID = 'order-auth-1'
const HOSTED_URL = 'https://sandbox-checkout.onerway.com/checkout?session=mock-authorization-only'

async function installAuthorizationMock(page: Page, options: { restored?: Partial<AuthorizationState>, loseOperationResponse?: boolean } = {}) {
  let current = authorizationSession(options.restored ?? { fundsStatus: 'pending', authTransactionId: undefined, paymentId: undefined })
  let created = Boolean(options.restored)
  const calls: { path: string, body: unknown }[] = []
  const violations: string[] = []

  await page.context().route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== BASE_URL) {
      if (request.url() === HOSTED_URL && request.isNavigationRequest()) {
        await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><title>Mock authorization</title><main><h1>Mock card authorization</h1><p>No real card or payment is used.</p><a href="${BASE_URL}/halden/return/${ORDER_ID}">Return to Halden</a></main></html>` })
      }
      else {
        violations.push(request.url())
        await route.abort('blockedbyclient')
      }
      return
    }
    if (url.pathname === '/api/profile') {
      await route.fulfill({ json: { profile: 'sandbox', environment: 'Sandbox', transactionPolicy: 'sandbox-only', canonicalOrigin: BASE_URL } })
      return
    }
    if (url.pathname.startsWith('/api/payment/') || url.pathname.startsWith('/api/webhooks/')) {
      const body: unknown = request.postData() ? request.postDataJSON() : null
      calls.push({ path: url.pathname, body })
      if (url.pathname === '/api/payment/intent') {
        expect(body).toEqual({ journeyId: 'hosted-authorization', method: 'card', restart: true })
        await route.fulfill({ json: { orderId: ORDER_ID, integration: 'checkout', create: true } })
      }
      else if (url.pathname === '/api/payment/create') {
        expect(body).toEqual({})
        expect(created).toBe(false)
        created = true
        const attempt = {
          ...current.attempt,
          paymentId: 'payment-auth-1',
          transactionId: 'transaction-create-1',
          statusSource: 'server' as const,
          authorization: { ...current.attempt.authorization!, paymentId: 'payment-auth-1' },
        }
        const event = { id: 'create-auth', attemptId: current.attempt.id, source: 'server', status: 'processing', occurredAt: current.attempt.createdAt }
        current = { ...current, attempt, attempts: [attempt], paymentId: attempt.paymentId, events: [event as typeof current.events[number]] }
        await route.fulfill({ json: { ...current, event, redirectUrl: HOSTED_URL } })
      }
      else if (url.pathname === '/api/payment/recover') {
        if (created) await route.fulfill({ json: current })
        else await route.fulfill({ status: 401, json: { statusMessage: 'PAYMENT_RECOVERY_UNAUTHORIZED' } })
      }
      else if (url.pathname === '/api/payment/return') {
        expect(body).toEqual({ orderId: ORDER_ID })
        current = authorizationSession()
        await route.fulfill({ json: { duplicate: false } })
      }
      else if (url.pathname === `/api/payment/authorization/${ORDER_ID}`) {
        const type = (body as { type: AuthorizationOperationType }).type
        expect(['CAPTURE', 'VOID']).toContain(type)
        expect(body).toEqual({ type })
        expect(current.attempt.authorization?.operation).toBeUndefined()
        current = authorizationSession({ operation: { type, merchantTxnId: 'merchant-operation-1', status: options.loseOperationResponse ? 'unknown' : 'pending' } })
        if (options.loseOperationResponse) await route.abort('connectionclosed')
        else await route.fulfill({ json: current })
      }
      else {
        violations.push(`${request.method()} ${url.pathname}`)
        await route.fulfill({ status: 403, json: { statusMessage: 'MOCK_ROUTE_FORBIDDEN' } })
      }
      return
    }
    await route.continue()
  })
  return {
    calls,
    confirm(type: AuthorizationOperationType) {
      current = authorizationSession({
        fundsStatus: type === 'CAPTURE' ? 'captured' : 'voided',
        operation: { type, status: 'confirmed', merchantTxnId: 'merchant-operation-1', transactionId: 'transaction-operation-1' },
      })
    },
    assertClean() {
      expect(violations).toEqual([])
      expect(calls.some(call => /\/query$|\/retry$/.test(call.path))).toBe(false)
    },
  }
}

test.describe('mock Checkout authorization', () => {
  for (const type of ['CAPTURE', 'VOID'] as const) {
    test(`creates one card authorization and confirms full ${type}`, async ({ page }, testInfo) => {
      if (type === 'CAPTURE') {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.emulateMedia({ colorScheme: 'dark' })
      }
      else {
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.emulateMedia({ colorScheme: 'light' })
      }
      const mock = await installAuthorizationMock(page)
      // Client navigation uses the intercepted Sandbox profile. The real local
      // Nitro server remains Production / locked throughout these mock tests.
      await page.goto('/halden/checkout/HLD-AUTH-MOCK-ENTRY')
      await page.getByRole('link', { name: 'Return to Demo Hub', exact: true }).click()
      await expect(page.getByText('Sandbox profile · Sandbox only', { exact: true })).toBeVisible()
      await page.locator('[role="radio"][value="checkout"]').click()
      await page.getByRole('group', { name: 'Payment method' }).locator('[role="radio"][value="card"]').click()
      await expect(page.getByRole('group', { name: 'Payment journey' }).locator('[role="radio"][value="hosted-authorization"]')).toBeChecked()
      await expect(page.getByRole('button', { name: 'Start simulated checkout' })).toHaveCount(0)
      await expect(page.getByText(/Conditional · Card authorization in Sandbox/)).toBeVisible()
      await page.getByRole('button', { name: 'Start a Sandbox card authorization' }).click()
      await expect(page).toHaveURL(`/halden/hosted/${ORDER_ID}`)
      await expect(page.getByRole('heading', { name: 'Authorize your Halden order.' })).toBeVisible()
      await page.getByRole('button', { name: 'Continue to Onerway Checkout' }).click()
      await expect(page.getByRole('heading', { name: 'Mock card authorization' })).toBeVisible()
      await page.getByRole('link', { name: 'Return to Halden' }).click()
      await expect(page).toHaveURL(`/halden/result/${ORDER_ID}`)
      await expect(page.getByText('Funds authorized · Not charged.', { exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`authorized-${type.toLowerCase()}.png`), fullPage: true })
      const action = page.getByRole('button', { name: type === 'CAPTURE' ? 'Capture $5.00' : 'Void authorization', exact: true })
      await action.focus()
      await expect(action).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByText(`${type === 'CAPTURE' ? 'Capture' : 'Void'} awaiting confirmation.`, { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Void authorization', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Capture $5.00', exact: true })).toHaveCount(0)
      mock.confirm(type)
      await page.getByRole('button', { name: 'Refresh status' }).click()
      await expect(page.getByText(type === 'CAPTURE' ? 'Payment captured.' : 'Authorization released.', { exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByText(type === 'CAPTURE' ? 'Payment captured.' : 'Authorization released.', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Retry payment', exact: true })).toHaveCount(0)
      expect(mock.calls.filter(call => call.path === '/api/payment/create')).toHaveLength(1)
      expect(mock.calls.filter(call => call.path.startsWith('/api/payment/authorization/'))).toHaveLength(1)
      mock.assertClean()
    })
  }

  test('restores a lost operation response and keeps both actions locked across reload', async ({ page }) => {
    const mock = await installAuthorizationMock(page, { restored: { fundsStatus: 'authorized' }, loseOperationResponse: true })
    await page.goto(`/halden/result/${ORDER_ID}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Void authorization', exact: true }).click()
    await expect(page.getByText('Void awaiting confirmation.', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText('Void awaiting confirmation.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Refresh status' }).click()
    await expect(page.getByRole('button', { name: 'Void authorization', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Capture $5.00', exact: true })).toHaveCount(0)
    expect(mock.calls.filter(call => call.path.startsWith('/api/payment/authorization/'))).toHaveLength(1)
    mock.assertClean()
  })
})
