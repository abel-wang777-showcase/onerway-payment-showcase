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
    fields: [{ label: 'Amount', value: 'USD 5.00' }, { label: 'Country', value: 'US' }, { label: 'Networks', value: 'visa, masterCard' }, { label: 'Merchant', value: 'merchant.…demo' }],
    request: '{"amount":"5.00","merchant":"merchant.…demo"}',
    response: '{"countryCode":"US"}',
    occurredAt: '2026-09-23T08:00:00.000Z', durationMs: 125,
  }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Apple Pay protocol timeline', () => {
  it('shows a compact evidence preview and separates recorded messages from synthetic examples', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [step({ state: 'completed', evidence: evidence(), example: { request: '{"example":true}' } })] } })
    const item = wrapper.get('li')
    expect(item.text()).toContain('Apple Pay is eligible for this USD 5.00 order.')
    expect(item.get('dl').findAll('dt').map(node => node.text())).toEqual(['Amount', 'Country', 'Networks'])
    expect(item.get('details').attributes('open')).toBeUndefined()
    await item.get('summary').trigger('click')
    expect(item.get('details').attributes('open')).toBeDefined()
    expect(item.text()).toContain('This visit')
    expect(item.text()).toContain('Synthetic example')
    expect(item.text()).toContain('not a message from your payment')
    expect(item.findAll('pre').map(node => node.attributes('aria-label'))).toEqual([
      'Check payment availability: safe request code', 'Check payment availability: safe response code', 'Check payment availability: example request code',
    ])
    expect(item.findAll('pre').every(node => node.attributes('tabindex') === '0')).toBe(true)
    expect(item.get('time').attributes('datetime')).toBe('2026-09-23T08:00:00.000Z')
    wrapper.unmount()
  })

  it('does not invent evidence for missing steps and labels restored data explicitly', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [step(), step({ id: 'result', title: 'Confirm the order result', state: 'completed', evidence: evidence('stored') })] } })
    const items = wrapper.findAll('li')
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

  it('auto-opens the active step without changing a user-selected collapsed state', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [step()] } })
    await wrapper.setProps({ steps: [step({ state: 'active' })] })
    expect(wrapper.get('details').attributes('open')).toBeDefined()
    await wrapper.get('summary').trigger('click')
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    await wrapper.setProps({ steps: [step({ state: 'completed' })] })
    await wrapper.setProps({ steps: [step({ state: 'active', evidence: evidence() })] })
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    await wrapper.get('summary').trigger('click')
    await wrapper.setProps({ steps: [step({ state: 'completed', evidence: evidence() })] })
    expect(wrapper.get('details').attributes('open')).toBeDefined()
    wrapper.unmount()
  })

  it('keeps focused step content open when a payment event changes the active step', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [step({ state: 'active', evidence: evidence() })] } })
    await wrapper.get('pre').trigger('focusin')
    await wrapper.setProps({ steps: [step({ state: 'completed', evidence: evidence() })] })
    expect(wrapper.get('details').attributes('open')).toBeDefined()
    wrapper.unmount()
  })

  it('leaves focus on the disclosure after the user closes it and another event arrives', async () => {
    const wrapper = await mountSuspended(ApplePaySteps, { attachTo: document.body, props: { steps: [step({ state: 'active', evidence: evidence() })] } })
    const summary = wrapper.get('summary').element as HTMLElement
    summary.focus()
    await wrapper.get('summary').trigger('click')
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(document.activeElement).toBe(summary)
    await wrapper.setProps({ steps: [step({ state: 'completed', evidence: evidence() })] })
    await wrapper.setProps({ steps: [step({ state: 'active', evidence: evidence() })] })
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(document.activeElement).toBe(summary)
    wrapper.unmount()
  })

  it('copies only the displayed safe projection and announces a short confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const wrapper = await mountSuspended(ApplePaySteps, { props: { steps: [step({ state: 'active', evidence: evidence() })] } })
    await wrapper.get('button[aria-label="Copy Check payment availability: safe request"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(evidence().request)
    expect(wrapper.findAll('[role="status"]').some(node => node.text() === 'Check payment availability: safe request copied.')).toBe(true)
    expect(wrapper.findAll('[role="status"]').some(node => node.text().includes('"amount"'))).toBe(false)
    wrapper.unmount()
  })
})
