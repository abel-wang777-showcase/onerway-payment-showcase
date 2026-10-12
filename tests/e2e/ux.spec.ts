import { expect, test } from '@playwright/test'
import { waitForHydration } from '@nuxt/test-utils/e2e'
import { getJourney } from '../../shared/payment/journey'
import { expectCenteredButtonIcon, expectNoHorizontalOverflow, gotoHydrated, installSimulationGate, selectHubOption, startJourney, submitSimulation } from './support'

for (const width of [320, 390, 834, 1440]) {
  test(`keeps the demo and next steps reachable at ${width}px`, async ({ page }, testInfo) => {
    const gate = await installSimulationGate(page)
    await page.setViewportSize({ width, height: 900 })
    await gotoHydrated(page)
    const launch = page.getByRole('button', { name: 'Start a new real Sandbox checkout' })
    await expect(launch).toBeDisabled()
    await expect(page.getByRole('radio', { includeHidden: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start simulated checkout' })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`hub-${width}.png`) })

    if (width < 961) {
      await expect(page.locator('#matrix-title')).toBeInViewport()
      const choices = await page.locator('#demo-selection').boundingBox()
      const summary = await page.locator('#demo-launch').boundingBox()
      expect(choices).not.toBeNull()
      expect(summary).not.toBeNull()
      expect(choices!.y + choices!.height).toBeLessThanOrEqual(summary!.y)
      await page.getByRole('navigation', { name: 'Quick demo navigation' }).getByRole('link', { name: 'Review & start' }).click()
    }
    await expect(launch).toBeInViewport()
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
  await selectHubOption(page, 'Payment method', 'Google Pay · Conditional')
  const integration = page.getByRole('group', { name: 'Integration', exact: true })
  const method = page.getByRole('combobox', { name: 'Payment method', exact: true })
  await integration.getByRole('tab', { name: 'Direct API', exact: true }).click()
  await expect(method).toContainText('Google Pay')
  await expect(page.locator('#demo-launch')).toContainText('Onerway Store checks the Direct API payment result')
  await expect(page.locator('#demo-launch')).not.toContainText('SDK renders')
  await expect(page).toHaveURL(/journey=google-pay-direct/)
  await page.setViewportSize({ width: 834, height: 900 })
  await page.getByRole('navigation', { name: 'Quick demo navigation' }).getByRole('link', { name: 'Review & start' }).click()
  await expect(method).toContainText('Google Pay')
  await expect(page).toHaveURL(/journey=google-pay-direct/)
  await page.reload()
  await waitForHydration(page, new URL(page.url()).pathname, 'hydration')
  await expect(method).toContainText('Google Pay')
  await integration.getByRole('tab', { name: 'Web JS SDK', exact: true }).click()
  await expect(integration.getByRole('tab', { name: 'Web JS SDK', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(method).toContainText('Google Pay')
  await selectHubOption(page, 'Billing experience', 'Subscription')
  await expect(method).toHaveCount(0)
  await expect(page.locator('#demo-launch')).toContainText('SDK available methods')
  await page.getByRole('navigation', { name: 'Quick demo navigation' }).getByRole('link', { name: 'Review & start' }).click()
  await expect(page.getByRole('combobox', { name: 'Billing experience', exact: true })).toContainText('Subscription')
  gate.assertClean()
})

for (const width of [1024, 1366, 1440]) {
  for (const [name, query] of [
    ['sdk', ''],
    ['checkout', '?journey=hosted-checkout'],
    ['wallet', '?journey=standard-success&method=apple-pay'],
    ['subscription', '?mode=subscription'],
  ]) {
    test(`fits desktop ${name} choices and launch in one screen at ${width}px`, async ({ page }, testInfo) => {
      const gate = await installSimulationGate(page)
      await page.setViewportSize({ width, height: 768 })
      await gotoHydrated(page, `/${query}`)
      await page.screenshot({ path: testInfo.outputPath(`compact-${width}-${name}.png`) })
      await expect(page.getByRole('radio', { includeHidden: true })).toHaveCount(0)
      const choices = page.locator('#demo-selection').getByRole('combobox')
        .or(page.getByRole('group', { name: 'Integration', exact: true }).getByRole('tab'))
      expect(await choices.count()).toBeGreaterThan(0)
      for (const choice of await choices.all()) {
        await expect(choice).toBeInViewport({ ratio: 1 })
      }
      await expect(page.locator('#demo-launch button').first()).toBeInViewport({ ratio: 1 })
      await expect(page.locator('#demo-launch dl')).toBeVisible()
      await expectNoHorizontalOverflow(page)
      gate.assertClean()
    })
  }
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`keeps mobile tabs and selects operable in ${colorScheme} mode with reduced motion`, async ({ page }, testInfo) => {
    const gate = await installSimulationGate(page)
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoHydrated(page)
    await expect(page.locator('html')).toHaveClass(new RegExp(`(?:^|\\s)${colorScheme}(?:\\s|$)`))
    await expect(page.getByRole('radio', { includeHidden: true })).toHaveCount(0)
    const launch = await page.locator('#demo-launch button').first().boundingBox()
    const navigation = await page.getByRole('navigation', { name: 'Quick demo navigation' }).boundingBox()
    expect(launch).not.toBeNull()
    expect(navigation).not.toBeNull()
    expect(launch!.y + launch!.height).toBeLessThanOrEqual(navigation!.y)
    await expect(page.locator('#demo-launch dl')).not.toBeVisible()
    await page.locator('#demo-launch summary').click()
    await expect(page.locator('#demo-launch dl')).toBeVisible()
    await page.locator('#demo-launch summary').click()
    const integration = page.getByRole('group', { name: 'Integration', exact: true })
    await integration.getByRole('tab', { name: 'Web JS SDK', exact: true }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(integration.getByRole('tab', { name: 'Checkout', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(integration.getByRole('tab', { name: 'Checkout', exact: true })).toBeFocused()
    await selectHubOption(page, 'Payment journey', getJourney('hosted-checkout-three-ds').label)
    await expect(page.locator('#demo-launch')).toContainText('$50.00')
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath(`compact-mobile-${colorScheme}.png`) })
    gate.assertClean()
  })
}

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

for (const width of [985, 1920]) {
  test(`resizes desktop columns without losing choices at ${width}px`, async ({ page }) => {
    const gate = await installSimulationGate(page)
    await page.setViewportSize({ width, height: 1080 })
    await gotoHydrated(page)
    await expect(page.getByRole('group', { name: 'Integration', exact: true }).getByRole('tab'))
      .toHaveText(['Checkout', 'Web JS SDK', 'Direct API'])
    const configuration = page.locator('#demo-configuration-panel')
    const handle = page.getByRole('separator', { name: 'Resize configuration and summary' })
    await expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    const initial = (await configuration.boundingBox())!.width
    await handle.focus()
    await handle.press('ArrowLeft')
    await expect.poll(async () => (await configuration.boundingBox())!.width).toBeLessThan(initial)
    const bounds = (await handle.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + width / 4, bounds.y + bounds.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect.poll(async () => (await configuration.boundingBox())!.width).toBeGreaterThan(initial)
    await expectNoHorizontalOverflow(page)
    await expect(page.getByRole('combobox', { name: 'Payment journey' })).toBeInViewport({ ratio: 1 })
    await expect(page.locator('#demo-launch button').first()).toBeInViewport({ ratio: 1 })
    await handle.dblclick()
    await expect.poll(async () => Math.abs((await configuration.boundingBox())!.width - initial)).toBeLessThan(2)
    if (width === 1920) {
      const footer = (await page.getByRole('contentinfo').boundingBox())!
      expect(Math.abs(footer.y + footer.height - 1080)).toBeLessThan(2)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(handle).not.toBeVisible()
    await expectNoHorizontalOverflow(page)
    gate.assertClean()
  })
}

test('offers only Sandbox journeys and normalizes old simulation links', async ({ page }) => {
  const gate = await installSimulationGate(page)
  for (const fixture of ['processing-recovery', 'cancelled-retry', 'deterministic-failure', 'form-load-recovery'] as const) {
    await gotoHydrated(page, `/?journey=${fixture}`)
    const journey = page.getByRole('combobox', { name: 'Payment journey', exact: true })
    await expect(journey).toContainText('Standard success')
    await journey.click()
    await expect(page.getByRole('option', { name: getJourney('standard-success').label, exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: getJourney('three-ds-success').label, exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: getJourney(fixture).label, exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/journey=standard-success/)
    await expect(page.getByRole('button', { name: /simulated checkout/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Start a new real Sandbox checkout' })).toBeDisabled()
  }
  gate.assertClean()
})
