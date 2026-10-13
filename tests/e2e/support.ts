import { expect, type Locator, type Page } from '@playwright/test'
import { waitForHydration } from '@nuxt/test-utils/e2e'
import type { JourneyId } from '../../shared/payment/journey'
import { createSession, serializeSession } from '../../shared/demo/session'
import { DEMO_STORAGE_KEY } from '../../shared/demo/runtime'

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

export async function selectHubOption(
  page: Page,
  field: 'Billing experience' | 'Payment method' | 'Journey preset',
  option: string,
): Promise<void> {
  const select = page.getByRole('combobox', { name: field, exact: true })
  await select.click()
  await page.getByRole('option', { name: option, exact: true }).click()
  const selectedLabel = field === 'Journey preset'
    ? option.replace(/^USD [\d,.]+ · /, '')
    : field === 'Payment method' ? option.split(' · ')[0]! : option
  await expect(select).toContainText(selectedLabel)
}

export async function gotoHydrated(page: Page, path = '/'): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  // Test the hydrated Nuxt page, independently of unrelated network activity.
  await waitForHydration(page, path, 'hydration')
}

export async function startJourney(page: Page, journey: JourneyId): Promise<void> {
  const session = createSession(journey)
  if (new URL(page.url()).origin !== BASE_URL) {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  }
  // Simulation is a test fixture, not a public Hub action. Seed the same serialized
  // session that the runtime restores, without adding a hidden production switch.
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), {
    key: DEMO_STORAGE_KEY,
    value: serializeSession(session),
  })
  await gotoHydrated(page, `/halden/checkout/${session.order.id}`)
  await expect(page).toHaveURL(/\/halden\/checkout\//)
  const readyStage = journey === 'form-load-recovery' ? 'not_completed' : 'ready'
  await expect(page.locator(`[role="status"][aria-live="polite"][data-stage="${readyStage}"]`)).toBeVisible()
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
