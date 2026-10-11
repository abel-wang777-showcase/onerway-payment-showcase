import { expect, test } from '@playwright/test'
import { waitForHydration } from '@nuxt/test-utils/e2e'
import { expectCenteredButtonIcon, expectNoHorizontalOverflow, gotoHydrated, installSimulationGate, methodRadio, startJourney, submitSimulation } from './support'

for (const width of [320, 390, 834, 1440]) {
  test(`keeps the demo and next steps reachable at ${width}px`, async ({ page }, testInfo) => {
    const gate = await installSimulationGate(page)
    await page.setViewportSize({ width, height: 900 })
    await gotoHydrated(page)
    const launch = page.getByRole('button', { name: 'Start a new real Sandbox checkout' })
    await expect(launch).toBeInViewport()
    await expect(launch).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Start simulated checkout' })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`hub-${width}.png`) })

    if (width < 961) {
      await page.getByRole('link', { name: 'Customize your demo' }).click()
      await expect(page.getByRole('heading', { name: 'Make it your demo.' })).toBeInViewport()
      await page.getByRole('navigation', { name: 'Quick demo navigation' }).getByRole('link').click()
      await expect(launch).toBeInViewport()
    }
    await expectNoHorizontalOverflow(page)
    await startJourney(page, 'standard-success')
    await expect(page).toHaveURL(/\/halden\/checkout\//)
    await expect(page.getByRole('heading', { name: '$5.00', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: /simulate payment/i })).toBeEnabled()
    await submitSimulation(page)
    await expect(page).toHaveURL(/\/halden\/result\//)
    await expect(page.getByRole('button', { name: 'Run this journey again' })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`result-${width}.png`) })
    await page.getByRole('button', { name: 'Show Technical details' }).click()
    await expectNoHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Run this journey again' }).click()
    await expect(page).toHaveURL(/\/halden\/checkout\//)
    gate.assertClean()
  })
}

test('keeps the selected wallet across integrations and gives Direct-specific guidance', async ({ page }) => {
  const gate = await installSimulationGate(page)
  await gotoHydrated(page)
  await methodRadio(page, 'google-pay').click()
  const integration = page.getByRole('group', { name: 'Integration', exact: true })
  await integration.locator('[role="radio"][value="direct-api"]').click()
  await expect(methodRadio(page, 'google-pay')).toBeChecked()
  await expect(page.locator('#demo-launch')).toContainText('Halden checks the Direct API payment result')
  await expect(page.locator('#demo-launch')).not.toContainText('SDK renders')
  await expect(page).toHaveURL(/journey=google-pay-direct/)
  await page.getByRole('navigation', { name: 'Demo sections' }).getByRole('link', { name: 'Review & start' }).click()
  await expect(methodRadio(page, 'google-pay')).toBeChecked()
  await expect(page).toHaveURL(/journey=google-pay-direct/)
  await page.reload()
  await waitForHydration(page, new URL(page.url()).pathname, 'hydration')
  await expect(methodRadio(page, 'google-pay')).toBeChecked()
  await integration.locator('[role="radio"][value="web-js-sdk"]').click()
  await expect(integration.locator('[role="radio"][value="web-js-sdk"]')).toBeChecked()
  await expect(methodRadio(page, 'google-pay')).toBeChecked()
  await page.getByRole('group', { name: 'Billing experience' }).locator('[role="radio"][value="subscription"]').click()
  await expect(page.getByRole('group', { name: 'Payment method', exact: true })).toHaveCount(0)
  await expect(page.locator('#demo-launch')).toContainText('SDK available methods')
  await page.getByRole('link', { name: 'Customize your demo' }).click()
  await expect(page.getByRole('group', { name: 'Billing experience' }).locator('[role="radio"][value="subscription"]')).toBeChecked()
  gate.assertClean()
})

test('keeps mobile controls readable in dark mode and with reduced motion', async ({ page }) => {
  await installSimulationGate(page)
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await gotoHydrated(page)
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('button', { name: 'Start a new real Sandbox checkout' })).toBeInViewport()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('link', { name: 'Customize your demo' }).click()
  const integration = page.getByRole('group', { name: 'Integration', exact: true })
  await integration.locator('[role="radio"][value="web-js-sdk"]').focus()
  await page.keyboard.down('ArrowDown')
  await expect(integration.locator('[role="radio"][value="checkout"]')).toBeChecked()
  await page.keyboard.up('ArrowDown')
})

test('centers the theme icon inside its touch target in both themes', async ({ page }) => {
  await installSimulationGate(page)
  await gotoHydrated(page)
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const toggle = page.getByRole('button', { name: /Switch to (light|dark) mode/ })
    await expectCenteredButtonIcon(toggle)
    await toggle.click()
    await expectCenteredButtonIcon(toggle)
  }
  await expect(page.getByText('Sandbox payments are disabled in this preview.', { exact: false })).toBeVisible()
})

test('offers only Sandbox journeys and normalizes old simulation links', async ({ page }) => {
  const gate = await installSimulationGate(page)
  for (const fixture of ['processing-recovery', 'cancelled-retry', 'deterministic-failure', 'form-load-recovery']) {
    await gotoHydrated(page, `/?journey=${fixture}`)
    await expect(page.locator('[role="radio"][value="standard-success"]')).toBeChecked()
    await expect(page.locator(`[role="radio"][value="${fixture}"]`)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /simulated checkout/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start a new real Sandbox checkout' })).toBeDisabled()
  }
  gate.assertClean()
})
