import { expect, type Locator, type Page } from '@playwright/test'
import { waitForHydration } from '@nuxt/test-utils/e2e'
import type { JourneyId } from '../../shared/payment/journey'
import type { PaymentMethodId } from '../../shared/payment/capability'

const BASE_URL = 'http://127.0.0.1:4173'
const PAYMENT_PATH = /^\/api\/(?:payment(?:\/|$)|webhooks(?:\/|$))/

export interface SimulationGate {
  assertClean(): void
}

export async function installSimulationGate(page: Page): Promise<SimulationGate> {
  const violations: string[] = []

  await page.context().route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (url.origin !== BASE_URL || PAYMENT_PATH.test(url.pathname)) {
      violations.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
      return
    }

    await route.continue()
  })

  return {
    assertClean: () => expect(violations, 'simulation network gate').toEqual([]),
  }
}

export function journeyRadio(page: Page, journey: JourneyId) {
  return page
    .getByRole('group', { name: 'Payment journey' })
    .locator(`[role="radio"][value="${journey}"]`)
}

export function methodRadio(page: Page, method: PaymentMethodId) {
  return page
    .getByRole('group', { name: 'Payment method' })
    .locator(`[role="radio"][value="${method}"]`)
}

export async function gotoHydrated(page: Page, path = '/'): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  // Test the hydrated Nuxt page, independently of unrelated network activity.
  await waitForHydration(page, path, 'hydration')
}

export async function startJourney(page: Page, journey: JourneyId): Promise<void> {
  await gotoHydrated(page)
  await journeyRadio(page, journey).click()
  await expect(journeyRadio(page, journey)).toBeChecked()
  await page.getByRole('button', { name: /start simulated checkout/i }).click()
  await expect(page).toHaveURL(/\/halden\/checkout\//)
  await expect(page.locator('[role="status"][aria-live="polite"][data-stage="ready"]')).toBeVisible()
}

export async function submitSimulation(page: Page): Promise<void> {
  await page.getByRole('button', { name: /simulate payment/i }).click()
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(1)
}

export async function expectCenteredButtonIcon(button: Locator): Promise<void> {
  const icon = button.locator('.iconify:visible')
  await expect(icon).toHaveCount(1)
  const [control, glyph] = await Promise.all([button.boundingBox(), icon.boundingBox()])
  expect(control).not.toBeNull()
  expect(glyph).not.toBeNull()
  expect(glyph!.width).toBeGreaterThanOrEqual(16)
  expect(glyph!.width).toBeLessThanOrEqual(24)
  expect(Math.abs(control!.x + control!.width / 2 - glyph!.x - glyph!.width / 2)).toBeLessThanOrEqual(1)
  expect(Math.abs(control!.y + control!.height / 2 - glyph!.y - glyph!.height / 2)).toBeLessThanOrEqual(1)
}
