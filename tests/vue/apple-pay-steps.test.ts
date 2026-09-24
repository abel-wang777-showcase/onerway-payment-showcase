import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ApplePaySteps from '../../app/components/payment/ApplePaySteps.vue'
import type { ApplePayStep } from '../../shared/payment/apple-pay'

function step(overrides: Partial<ApplePayStep> = {}): ApplePayStep {
  return {
    id: 'prepare', title: 'Check payment availability', state: 'waiting',
    actor: 'Merchant server → Onerway', input: 'A server-owned order.', output: 'Eligible country and networks.',
    failure: 'Keep the order and check configuration.', documentation: 'https://developer.apple.com/documentation/applepayontheweb',
    ...overrides,
  }
}
function evidence(source: 'live' | 'stored' = 'live') {
  return {
    source, summary: 'Apple Pay is eligible for this USD 5.00 order.',
    fields: [{ label: 'Amount', value: 'USD 5.00' }, { label: 'Country', value: 'US' }, { label: 'Networks', value: 'visa, masterCard', networks: [{ value: 'visa', icon: 'i-simple-icons-visa' as const }, { value: 'masterCard', icon: 'i-simple-icons-mastercard' as const }] }, { label: 'Merchant', value: 'merchant.…demo' }],
    request: '{"amount":"5.00","merchant":"merchant.…demo"}',
    response: '{"countryCode":"US"}',
    occurredAt: '2026-09-23T08:00:00.000Z', durationMs: 125,
  }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function installClipboard() {
  const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard')
  const originalPermissions = Object.getOwnPropertyDescriptor(window.navigator, 'permissions')
  const write = vi.fn().mockResolvedValue(undefined)
  const items: Array<Record<string, unknown>> = []
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { write } })
  Object.defineProperty(window.navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue(Object.assign(new EventTarget(), { state: 'granted' })) },
  })
  vi.stubGlobal('ClipboardItem', function (value: Record<string, unknown>) { items.push(value) })
  return {
    items,
    write,
    restore() {
      if (originalClipboard) Object.defineProperty(window.navigator, 'clipboard', originalClipboard)
      else Reflect.deleteProperty(window.navigator, 'clipboard')
      if (originalPermissions) Object.defineProperty(window.navigator, 'permissions', originalPermissions)
      else Reflect.deleteProperty(window.navigator, 'permissions')
    },
  }
}

describe('Apple Pay protocol timeline', () => {
  it('shows a compact evidence preview and separates recorded messages from synthetic examples', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [step({ state: 'completed', evidence: evidence(), example: { request: '{"example":true}' } })] } })
    const item = wrapper.get('[data-apple-pay-step]')
    expect(item.text()).toContain('Apple Pay is eligible for this USD 5.00 order.')
    expect(item.get('dl').findAll('dt').map(node => node.text())).toEqual(['Amount', 'Country', 'Networks'])
    expect(item.get('[data-apple-pay-network="visa"]').getComponent({ name: 'UIcon' }).props('name')).toBe('i-simple-icons-visa')
    expect(item.get('[data-apple-pay-network="masterCard"]').getComponent({ name: 'UIcon' }).props('name')).toBe('i-simple-icons-mastercard')
    expect(item.text()).toContain('visa, masterCard')
    expect(item.get('details').attributes('open')).toBeUndefined()
    await item.get('summary').trigger('click')
    expect(item.get('details').attributes('open')).toBeDefined()
    expect(item.text()).toContain('This visit')
    expect(item.text()).toContain('Synthetic example')
    expect(item.text()).toContain('not a message from your payment')
    expect(item.findAll('[role="region"]').map(node => node.attributes('aria-label'))).toEqual([
      'Check payment availability: safe request code', 'Check payment availability: safe response code', 'Check payment availability: example request code',
    ])
    expect(item.findAll('[role="region"]').every(node => node.attributes('tabindex') === '0')).toBe(true)
    expect(item.get('time').attributes('datetime')).toBe('2026-09-23T08:00:00.000Z')
    wrapper.unmount()
  })

  it('does not invent evidence for missing steps and labels restored data explicitly', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [step(), step({ id: 'result', title: 'Confirm the order result', state: 'completed', evidence: evidence('stored') })] } })
    const items = wrapper.findAll('[data-apple-pay-step]')
    expect(items[0]!.text()).toContain('Not recorded')
    expect(items[0]!.findAll('pre')).toHaveLength(0)
    await items[0]!.get('summary').trigger('click')
    expect(items[0]!.text()).toContain('does not prove that this step ran')
    expect(items[1]!.text()).toContain('Restored from server')
    const status = wrapper.findAll('[role="status"]').map(node => node.text()).join(' ')
    expect(status).not.toContain('countryCode')
    expect(status).not.toContain('merchant.…demo')
    wrapper.unmount()
  })

  it('marks browser examples as JavaScript and message examples as JSON', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [
      step({ id: 'authorize', example: { request: 'session.onpaymentauthorized = handler', response: '{"paymentData":{}}' } }),
      step({ id: 'submit', example: { request: '{"tokenInfo":"[synthetic]"}' } }),
    ] } })
    expect(wrapper.findAll('[data-apple-pay-step] code').map(node => node.attributes('data-language'))).toEqual(['js', 'json', 'json'])
    wrapper.unmount()
  })

  it('auto-opens the active step without changing a user-selected collapsed state', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [step()] } })
    await wrapper.setProps({ steps: [step({ state: 'active' })] })
    expect(wrapper.get('[data-step-details]').attributes('open')).toBeDefined()
    await wrapper.get('[data-step-details] > summary').trigger('click')
    expect(wrapper.get('[data-step-details]').attributes('open')).toBeUndefined()
    await wrapper.setProps({ steps: [step({ state: 'completed' })] })
    await wrapper.setProps({ steps: [step({ state: 'active', evidence: evidence() })] })
    expect(wrapper.get('[data-step-details]').attributes('open')).toBeUndefined()
    await wrapper.get('[data-step-details] > summary').trigger('click')
    await wrapper.setProps({ steps: [step({ state: 'completed', evidence: evidence() })] })
    expect(wrapper.get('[data-step-details]').attributes('open')).toBeDefined()
    wrapper.unmount()
  })

  it('keeps focused step content open when a payment event changes the active step', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [step({ state: 'active', evidence: evidence() })] } })
    await wrapper.get('[data-apple-pay-step] [role="region"]').trigger('focusin')
    await wrapper.setProps({ steps: [step({ state: 'completed', evidence: evidence() })] })
    expect(wrapper.get('[data-step-details]').attributes('open')).toBeDefined()
    wrapper.unmount()
  })

  it('leaves focus on the disclosure after the user closes it and another event arrives', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { attachTo: document.body, props: { steps: [step({ state: 'active', evidence: evidence() })] } })
    const summary = wrapper.get('[data-step-details] > summary').element as HTMLElement
    summary.focus()
    await wrapper.get('[data-step-details] > summary').trigger('click')
    expect(wrapper.get('[data-step-details]').attributes('open')).toBeUndefined()
    expect(document.activeElement).toBe(summary)
    await wrapper.setProps({ steps: [step({ state: 'completed', evidence: evidence() })] })
    await wrapper.setProps({ steps: [step({ state: 'active', evidence: evidence() })] })
    expect(wrapper.get('[data-step-details]').attributes('open')).toBeUndefined()
    expect(document.activeElement).toBe(summary)
    wrapper.unmount()
  })

  it('copies only the displayed safe projection without announcing message contents', async () => {
    const clipboard = installClipboard()
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [step({ state: 'active', evidence: evidence() })] } })
    await wrapper.get('button[aria-label="Copy Check payment availability: safe request"]').trigger('click')
    await flushPromises()
    expect(clipboard.write).toHaveBeenCalledOnce()
    expect(clipboard.items[0]?.['text/plain']).toBe(evidence().request)
    expect(wrapper.findAll('[role="status"]').some(node => node.text().includes('"amount"'))).toBe(false)
    wrapper.unmount()
    clipboard.restore()
  })
})
