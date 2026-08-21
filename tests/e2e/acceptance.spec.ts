import { expect, test } from '@playwright/test'
import {
  expectNoHorizontalOverflow,
  installSimulationGate,
  journeyRadio,
  methodRadio,
  startJourney,
  submitSimulation,
} from './support'

test('exposes landmarks, keyboard selection and a visible focus indicator', async ({ page }) => {
  const gate = await installSimulationGate(page)

  await page.goto('/', { waitUntil: 'networkidle' })
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Demo Hub' })).toHaveAttribute('aria-current', 'page')

  await page.keyboard.press('Tab')
  const skipLink = page.locator('a[href="#main"]')
  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeVisible()
  await expect.poll(async () => skipLink.evaluate((element) => {
    const style = getComputedStyle(element)
    return Number.parseFloat(style.outlineWidth)
  })).toBeGreaterThan(0)
  await skipLink.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()

  const standard = journeyRadio(page, 'standard-success')
  const challenge = journeyRadio(page, 'three-ds-success')
  await expect(standard).toBeChecked()
  await standard.focus()
  await page.keyboard.down('ArrowDown')
  await expect(challenge).toBeChecked()
  await expect(challenge).toBeFocused()
  await page.keyboard.up('ArrowDown')
  gate.assertClean()
})

test('Halden skip link moves focus into main', async ({ page }) => {
  const gate = await installSimulationGate(page)
  await startJourney(page, 'standard-success')

  const skipLink = page.locator('a[href="#main"]')
  await skipLink.focus()
  await expect(skipLink).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  gate.assertClean()
})

for (const wallet of [
  { method: 'google-pay' as const, label: 'Google Pay' },
  { method: 'apple-pay' as const, label: 'Apple Pay' },
]) {
  test(`restores an allowlisted ${wallet.label} target from the canonical query`, async ({ page }) => {
    const gate = await installSimulationGate(page)

    await page.goto(`/?journey=three-ds-success&method=${wallet.method}`, { waitUntil: 'networkidle' })
    await expect(methodRadio(page, wallet.method)).toBeChecked()
    await expect(page.getByText('USD 5.00 · Standard success', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /start simulated checkout/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: `Open ${wallet.label} Sandbox` })).toBeDisabled()
    gate.assertClean()
  })

  for (const width of [1440, 834, 390, 320]) {
    test(`exposes the ${wallet.label} Conditional acceptance target at ${width}px without a fake simulation`, async ({ page }) => {
      const gate = await installSimulationGate(page)
      await page.setViewportSize({ width, height: 900 })

      await page.goto('/', { waitUntil: 'networkidle' })
      const method = methodRadio(page, wallet.method)

      await expect(method).toBeEnabled()
      await method.focus()
      await method.press('Space')
      await expect(method).toBeChecked()
      await expect(page.getByRole('button', { name: /start simulated checkout/i })).toHaveCount(0)
      await expect(page.getByRole('button', { name: `Open ${wallet.label} Sandbox` })).toBeDisabled()
      await expect(page.getByText('the Onerway SDK renders its own eligible wallet button', { exact: false })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      gate.assertClean()
    })
  }
}

for (const width of [1440, 834, 390, 320]) {
  test(`has no horizontal overflow at ${width}px through the key simulation flow`, async ({ page }) => {
    const gate = await installSimulationGate(page)
    await page.setViewportSize({ width, height: 900 })

    await page.goto('/')
    await expectNoHorizontalOverflow(page)

    await startJourney(page, 'standard-success')
    await expectNoHorizontalOverflow(page)

    await submitSimulation(page)
    await expect(page).toHaveURL(/\/halden\/result\//)
    await expectNoHorizontalOverflow(page)
    gate.assertClean()
  })
}
