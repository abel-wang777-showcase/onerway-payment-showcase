import { expect, test, type Page } from '@playwright/test'
import type { PrepareGooglePayResponse } from '../../shared/payment/google-pay'
import { expectNoHorizontalOverflow, gotoHydrated } from './support'

const origin = 'http://127.0.0.1:4173'
const token = JSON.stringify({ protocolVersion: 'ECv2', signature: 'synthetic-signature', signedMessage: JSON.stringify({ encryptedMessage: 'synthetic-encrypted-message', ephemeralPublicKey: 'synthetic-key', tag: 'synthetic-tag' }) })
function payment(status: PrepareGooglePayResponse['attempt']['status'] = 'created'): PrepareGooglePayResponse {
  const at = '2026-10-09T00:00:00.000Z'
  const attempt = { id: 'attempt-google', orderId: 'order-google', integration: 'direct-api' as const, method: 'google-pay' as const, status,
    merchantTxnId: 'merchant-google', ...(status !== 'created' ? { transactionId: 'transaction-google', statusSource: 'server' as const } : {}), createdAt: at, updatedAt: at }
  return {
    order: { id: 'order-google', scene: 'ecommerce', item: { sku: 'HL-GOOGLE-005', name: 'Halden sample', variant: 'Google Pay Direct', quantity: 1, unitAmount: { minor: 500, currency: 'USD' } }, amount: { minor: 500, currency: 'USD' }, fulfillment: 'pending', createdAt: at },
    attempt, attempts: [attempt], events: [], paymentId: null, query: null, submitted: status !== 'created', canAuthorize: status === 'created',
    config: { environment: 'TEST', gateway: 'synthetic', gatewayMerchantId: 'synthetic-merchant', allowedCardNetworks: ['VISA', 'MASTERCARD'], allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], countryCode: 'US', currencyCode: 'USD', totalPrice: '5.00' },
  }
}

async function installMock(page: Page, hostedVerification = false) {
  let current = payment()
  const calls: string[] = []
  const violations: string[] = []
  await page.context().route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.href === 'https://pay.google.com/gp/p/js/pay.js') {
      await route.fulfill({ contentType: 'application/javascript', body: `window.google = { payments: { api: { PaymentsClient: class {
        constructor(options) { if(options.environment !== 'TEST') throw new Error('TEST_REQUIRED'); }
        async isReadyToPay() { return { result: true }; }
        createButton(options) { const button = document.createElement('button'); button.textContent = 'Pay with Google Pay'; button.addEventListener('click', options.onClick); return button; }
        async loadPaymentData(request) { window.__googleLoads = (window.__googleLoads || 0) + 1; if(request.allowedPaymentMethods[0].tokenizationSpecification.type !== 'PAYMENT_GATEWAY') throw new Error('GATEWAY_REQUIRED'); return { paymentMethodData: { type: 'CARD', tokenizationData: { type: 'PAYMENT_GATEWAY', token: ${JSON.stringify(token)} } } }; }
      } } } };` })
      return
    }
    if (hostedVerification && url.origin === 'https://sandbox-checkout.onerway.com' && url.pathname === '/additional-information') {
      expect(url.searchParams.get('returnUrl')).toBe(`${origin}/halden/direct/order-google`)
      current = payment('succeeded')
      await route.fulfill({ contentType: 'text/html', body: `<h1>Synthetic hosted verification</h1><a href="${origin}/halden/direct/order-google">Return to original order</a>` })
      return
    }
    if (url.origin !== origin) { violations.push(url.origin + url.pathname); await route.abort('blockedbyclient'); return }
    if (url.pathname === '/api/profile') { await route.fulfill({ json: { profile: 'sandbox', environment: 'Sandbox', transactionPolicy: 'sandbox-only', canonicalOrigin: origin } }); return }
    if (url.pathname.startsWith('/api/payment/')) {
      calls.push(url.pathname)
      if (url.pathname === '/api/payment/recover' || url.pathname === '/api/payment/google-pay/prepare') { await route.fulfill({ json: current }); return }
      if (url.pathname === '/api/payment/google-pay/pay') {
        expect(request.postDataJSON()).toMatchObject({ orderId: 'order-google', attemptId: 'attempt-google', token })
        expect(current.submitted).toBe(false)
        current = payment(hostedVerification ? 'requires_action' : 'failed')
        const redirectUrl = `https://sandbox-checkout.onerway.com/additional-information?key=synthetic-hosted-key&returnUrl=${encodeURIComponent(`${origin}/halden/direct/order-google`)}`
        await route.fulfill({ json: { ...current, ...(hostedVerification ? { redirectUrl } : {}) } }); return
      }
      violations.push(url.pathname); await route.fulfill({ status: 403, json: {} }); return
    }
    await route.continue()
  })
  return { calls, violations }
}

test.describe('Google Pay Direct with synthetic provider boundary', () => {
  test('completes a synthetic hosted R round trip on the original order without resubmission', async ({ page }) => {
    const mock = await installMock(page, true)
    await gotoHydrated(page, '/halden/direct/order-google')
    await expect(page.getByRole('button', { name: 'Pay with Google Pay', exact: true })).toBeVisible()
    const initialRecoveries = mock.calls.filter(path => path.endsWith('/recover')).length
    await page.getByRole('button', { name: 'Pay with Google Pay', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Synthetic hosted verification' })).toBeVisible()
    expect(mock.calls.filter(path => path.endsWith('/recover'))).toHaveLength(initialRecoveries)
    await page.getByRole('link', { name: 'Return to original order' }).click()
    await expect(page).toHaveURL(`${origin}/halden/direct/order-google`)
    await expect(page.getByText('Your order is paid.', { exact: true })).toBeVisible()
    expect(mock.calls.filter(path => path.endsWith('/pay'))).toHaveLength(1)
    expect(mock.calls.filter(path => path.endsWith('/recover'))).toHaveLength(initialRecoveries + 1)
    await expect(page.getByRole('button', { name: 'Pay with Google Pay', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Show token', exact: true })).toHaveCount(0)
    expect(mock.violations).toEqual([])
  })

  for (const width of [320, 1440]) {
    test(`explains protocol stages without creating payments at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ colorScheme: width === 1440 ? 'dark' : 'light', reducedMotion: 'reduce' })
      const mock = await installMock(page)
      await gotoHydrated(page, '/halden/direct/order-google')
      const flow = page.locator('[data-google-pay-flow]')
      await expect(flow.getByRole('heading', { name: 'Google Pay protocol map' })).toBeVisible()
      for (const stage of ['prepare', 'ready', 'authorize', 'submit', 'action', 'result', 'cancel']) {
        const button = flow.locator(`[data-flow-step="${stage}"]`)
        await button.focus()
        await button.press('Enter')
        await expect(button).toHaveAttribute('aria-pressed', 'true')
        await expect(flow.locator(`[data-flow-panel="${stage}"]`)).toBeVisible()
        await expectNoHorizontalOverflow(page)
      }
      await flow.locator('[data-flow-step="submit"]').click()
      await flow.getByRole('button', { name: 'Server example', exact: true }).click()
      await expect(flow.locator('[data-flow-code-panel="server"]')).toContainText('GooglePay')
      await expect(flow.locator('[data-flow-code-panel="server"]')).toContainText('tokenId')
      await flow.getByRole('button', { name: 'Follow live events', exact: true }).click()
      await expect(flow.locator('[data-flow-step="ready"]')).toHaveAttribute('aria-pressed', 'true')
      await expect(flow.locator('[data-flow-step="ready"]')).toBeFocused()
      const preparation = page.locator('[data-google-pay-step="prepare"]')
      await preparation.locator('summary').click()
      await expect(preparation.getByRole('heading', { name: 'How to integrate' })).toBeVisible()
      await expect(preparation.getByRole('link', { name: 'Official documentation' })).toBeVisible()
      await expect(preparation).toContainText('PAN_ONLY')
      await page.getByRole('radio', { name: 'Manual debugging', exact: true }).click()
      await page.getByRole('button', { name: 'Pay with Google Pay', exact: true }).click()
      const authorization = page.locator('[data-google-pay-step="authorize"]')
      await expect(authorization).toHaveAttribute('data-state', 'completed')
      await expect(page.locator('[data-google-pay-step="submit"]')).toHaveAttribute('data-state', 'waiting')
      await expect(page.locator('[data-google-pay-step="result"]')).toHaveAttribute('data-state', 'waiting')
      await authorization.locator('summary').click()
      await expect(authorization.getByRole('heading', { name: 'How to integrate' })).toBeVisible()
      expect(await authorization.textContent()).not.toContain('synthetic-signature')
      expect(mock.calls.filter(path => path.endsWith('/pay'))).toHaveLength(0)
      expect(mock.violations).toEqual([])
      await expectNoHorizontalOverflow(page)
      await flow.scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`google-protocol-${width}.png`), fullPage: true })
    })
  }

  for (const width of [320, 390, 834, 1440]) {
    test(`manual capture and four copy formats at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ colorScheme: width === 390 || width === 1440 ? 'dark' : 'light', reducedMotion: 'reduce' })
      const mock = await installMock(page)
      await gotoHydrated(page, '/halden/direct/order-google')
      const manual = page.getByRole('radio', { name: 'Manual debugging', exact: true })
      await expect(manual).toBeVisible()
      await expect(page.getByRole('button', { name: 'Pay with Google Pay', exact: true })).toBeVisible()
      const initialRecoveries = mock.calls.filter(path => path.endsWith('/recover')).length
      await manual.focus(); await page.keyboard.press('Space')
      await expect(manual).toBeChecked()
      await page.getByRole('button', { name: 'Pay with Google Pay', exact: true }).click()
      const panel = page.locator('[data-google-pay-token]')
      await expect(panel.getByRole('button', { name: 'Show token', exact: true })).toBeVisible()
      await expect(panel.locator('code[data-language]')).toHaveCount(0)
      await panel.getByRole('button', { name: 'Show token', exact: true }).click()
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await expect.poll(async () => JSON.parse((await panel.locator('code[data-language]').textContent())!)).toEqual(JSON.parse(token))
      for (const [tab, label, expected] of [
        ['Stringify', 'Google Pay token: stringify', JSON.stringify(token)],
        ['Apifox', 'Apifox tokenInfo object', JSON.stringify({ tokenInfo: { provider: 'GooglePay', tokenId: token } }, null, 2)],
        ['Direct API', 'Direct API tokenInfo', JSON.stringify({ tokenInfo: JSON.stringify({ provider: 'GooglePay', tokenId: token }) }, null, 2)],
      ] as const) {
        await panel.getByRole('tab', { name: tab, exact: true }).click()
        await panel.getByRole('button', { name: `Copy ${label}`, exact: true }).click()
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected)
      }
      expect(mock.calls.filter(path => path.endsWith('/pay'))).toHaveLength(0)
      expect(mock.calls.filter(path => path.endsWith('/recover'))).toHaveLength(initialRecoveries)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath(`google-manual-${width}.png`), fullPage: true })
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
      await expect(panel.locator('code[data-language]')).toHaveCount(0)
      expect(mock.violations).toEqual([])
    })
  }

  test('switching to automatic requires a new token and restores a failed order without another submission', async ({ page }) => {
    const mock = await installMock(page)
    await gotoHydrated(page, '/halden/direct/order-google')
    const button = page.getByRole('button', { name: 'Pay with Google Pay', exact: true })
    await expect(button).toBeVisible()
    await page.getByRole('radio', { name: 'Manual debugging', exact: true }).click()
    await button.click()
    const panel = page.locator('[data-google-pay-token]')
    await expect(panel.getByRole('button', { name: 'Show token', exact: true })).toBeVisible()
    await page.getByRole('radio', { name: 'Automatic payment', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Show token', exact: true })).toHaveCount(0)
    expect(mock.calls.filter(path => path.endsWith('/pay'))).toHaveLength(0)
    await button.click()
    await expect.poll(() => mock.calls.filter(path => path.endsWith('/pay')).length).toBe(1)
    await expect(page.getByRole('radio', { name: 'Manual debugging', exact: true })).toBeDisabled()
    expect(await page.evaluate(() => (window as unknown as { __googleLoads: number }).__googleLoads)).toBe(2)
    await page.reload()
    await expect(page.getByRole('radio', { name: 'Manual debugging', exact: true })).toBeDisabled()
    await expect(panel.getByRole('button', { name: 'Show token', exact: true })).toHaveCount(0)
    expect(mock.calls.filter(path => path.endsWith('/pay'))).toHaveLength(1)
    expect(mock.violations).toEqual([])
  })
})
