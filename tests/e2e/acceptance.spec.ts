import { expect, test } from '@playwright/test'
import {
  expectNoHorizontalOverflow,
  gotoHydrated,
  installSimulationGate,
  selectHubOption,
  startJourney,
  submitSimulation,
} from './support'

test('exposes landmarks, keyboard selection and a visible focus indicator', async ({ page }) => {
  const gate = await installSimulationGate(page)

  await gotoHydrated(page)
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

  await expect(page.getByRole('radio', { includeHidden: true })).toHaveCount(0)
  const journey = page.getByRole('combobox', { name: 'Payment journey', exact: true })
  await expect(journey).toContainText('Standard success')
  await journey.focus()
  await journey.press('Enter')
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('option', { selected: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('option').last()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(journey).toContainText('3DS Challenge')
  await expect(journey).toBeFocused()
  await expect(page).toHaveURL(/journey=three-ds-success/)
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

    await gotoHydrated(page, `/?journey=three-ds-success&method=${wallet.method}`)
    await expect(page.getByRole('combobox', { name: 'Payment method', exact: true })).toContainText(wallet.label)
    await expect(page.locator('#demo-launch')).toContainText('Standard success')
    await expect(page.getByRole('button', { name: /start simulated checkout/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: `Open ${wallet.label} Sandbox` })).toBeDisabled()
    gate.assertClean()
  })

  for (const width of [1440, 834, 390, 320]) {
    test(`exposes the ${wallet.label} Conditional acceptance target at ${width}px without a fake simulation`, async ({ page }) => {
      const gate = await installSimulationGate(page)
      await page.setViewportSize({ width, height: 900 })

      await gotoHydrated(page)
      const method = page.getByRole('combobox', { name: 'Payment method', exact: true })
      await expect(method).toBeEnabled()
      await selectHubOption(page, 'Payment method', `${wallet.label} · Conditional`)
      await expect(method).toContainText(wallet.label)
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
