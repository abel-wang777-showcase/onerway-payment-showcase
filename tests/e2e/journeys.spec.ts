import { expect, test } from '@playwright/test'
import {
  installSimulationGate,
  startJourney,
  submitSimulation,
} from './support'

test.describe('deterministic payment journeys', () => {
  test('completes the USD 5 standard simulation without payment traffic', async ({ page }) => {
    const gate = await installSimulationGate(page)

    await startJourney(page, 'standard-success')
    await submitSimulation(page)

    await expect(page).toHaveURL(/\/halden\/result\//)
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
    await page.getByRole('button', { name: /technical details/i }).click()
    await expect(page.locator('#payment-technical-details-content')).toContainText('simulation')
    await expect(page.locator('#payment-technical-details-content')).toContainText('standard-success')
    gate.assertClean()
  })

  test('completes the USD 50 3DS simulation without opening an external page', async ({ page }) => {
    const gate = await installSimulationGate(page)

    await startJourney(page, 'three-ds-success')
    await submitSimulation(page)

    await expect(page.locator('[role="status"][data-stage="redirecting"]')).toBeVisible()
    await expect(page).toHaveURL(/\/halden\/result\//)
    await page.getByRole('button', { name: /technical details/i }).click()
    await expect(page.locator('#payment-technical-details-content')).toContainText('three-ds-success')
    await expect(page.locator('#payment-technical-details-content')).toContainText('challenge')
    expect(page.context().pages()).toHaveLength(1)
    gate.assertClean()
  })

  test('restores a processing attempt after refresh and verifies the same payment', async ({ page }) => {
    const gate = await installSimulationGate(page)

    await startJourney(page, 'processing-recovery')
    await submitSimulation(page)
    await expect(page.locator('[role="status"][data-stage="processing"]')).toBeVisible()

    const checkout = page.url()
    await page.reload()
    await expect(page).toHaveURL(checkout)
    await expect(page.locator('[role="status"][data-stage="processing"]')).toBeVisible()
    await page.getByRole('button', { name: /verify existing simulated payment/i }).click()

    await expect(page).toHaveURL(/\/halden\/result\//)
    await expect(page.getByRole('list', { name: 'Payment attempt history' }).getByRole('listitem')).toHaveCount(1)
    gate.assertClean()
  })

  test('retries a cancelled attempt as a linked child', async ({ page }) => {
    const gate = await installSimulationGate(page)

    await startJourney(page, 'cancelled-retry')
    await submitSimulation(page)
    await expect(page).toHaveURL(/\/halden\/result\//)

    await page.getByRole('button', { name: /retry simulated payment/i }).click()
    await expect(page).toHaveURL(/\/halden\/checkout\//)
    await expect(page.locator('[role="status"][data-stage="ready"]')).toBeVisible()
    await submitSimulation(page)
    await expect(page).toHaveURL(/\/halden\/result\//)

    const history = page.getByRole('list', { name: 'Payment attempt history' })
    await expect(history.getByRole('listitem')).toHaveCount(2)
    await expect(history.getByRole('listitem').nth(1)).toContainText(/retry of attempt 1/i)
    gate.assertClean()
  })

  test('keeps a deterministic failure simulation-only', async ({ page }) => {
    const gate = await installSimulationGate(page)

    await startJourney(page, 'deterministic-failure')
    await submitSimulation(page)

    await expect(page).toHaveURL(/\/halden\/result\//)
    await expect(page.getByText('failed · Simulation', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /technical details/i }).click()
    const details = page.locator('#payment-technical-details-content')
    await expect(details).toContainText('deterministic-failure')
    await expect(details).not.toContainText('paymentId')
    await expect(details).not.toContainText('transactionId')
    gate.assertClean()
  })

  test('reloads the same simulated form before submitting', async ({ page }) => {
    const gate = await installSimulationGate(page)

    await page.goto('/', { waitUntil: 'networkidle' })
    await page.locator('[role="radio"][value="form-load-recovery"]').click()
    await page.getByRole('button', { name: /start simulated checkout/i }).click()
    await expect(page.locator('[role="status"][data-stage="not_completed"]')).toBeVisible()

    const checkout = page.url()
    const attempt = page.locator('main p.font-mono').filter({ hasText: 'Attempt ' })
    await expect(attempt).toBeVisible()
    const attemptLabel = await attempt.textContent()
    await page.getByRole('button', { name: /reload simulated secure form/i }).click()
    await expect(page).toHaveURL(checkout)
    await expect(page.locator('[role="status"][data-stage="ready"]')).toBeVisible()
    await expect(page.locator('[data-focus-target="payment-status"]')).toBeFocused()
    await expect(attempt).toHaveText(attemptLabel ?? '')

    await submitSimulation(page)
    await expect(page).toHaveURL(/\/halden\/result\//)
    await expect(page.getByRole('list', { name: 'Payment attempt history' }).getByRole('listitem')).toHaveCount(1)
    gate.assertClean()
  })
})
