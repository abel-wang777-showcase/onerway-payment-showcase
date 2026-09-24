import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import ApplePayFlow from '../../app/components/payment/ApplePayFlow.vue'
import type { ApplePayStep } from '../../shared/payment/apple-pay'

function step(id: string, state: ApplePayStep['state'] = 'waiting', observed = false): ApplePayStep {
  return {
    id,
    title: id,
    state,
    actor: 'Actor',
    input: 'Input',
    output: 'Output',
    failure: 'Failure',
    documentation: 'https://example.com',
    ...(observed ? { evidence: { source: 'live' as const, summary: 'Observed', fields: [] } } : {}),
  }
}

const steps = [
  step('prepare', 'completed', true),
  step('begin', 'completed', true),
  step('validate', 'completed', true),
  step('authorize', 'active', true),
  step('submit'),
  step('result'),
]

describe('Apple Pay five-party protocol map', () => {
  it('shows six protocol stages, a separate cancellation branch and five named actors', async () => {
    const wrapper = await mountSuspended(ApplePayFlow, { props: { steps } })
    expect(wrapper.findAll('[data-flow-step]:not([data-flow-step="cancel"])')).toHaveLength(6)
    expect(wrapper.get('[data-flow-step="cancel"]').text()).toBeTruthy()
    expect(wrapper.findAll('[data-flow-actor]')).toHaveLength(5)
    expect(wrapper.findAll('[data-flow-actor] [class*="text-primary"]').filter(node => node.text() === 'Merchant')).toHaveLength(2)
    expect(wrapper.get('[data-flow-panel="authorize"]')).toBeTruthy()
    expect(wrapper.findAll('[data-flow-edge]').length).toBeGreaterThan(0)
    expect(wrapper.findAll('[data-flow-edge]').every((edge, index) => edge.attributes('data-flow-edge-index') === String(index + 1))).toBe(true)
    expect(wrapper.findAll('[data-flow-lane-edge]').length).toBe(wrapper.findAll('[data-flow-edge]').length)
    wrapper.unmount()
  })

  it('follows live progress until the user chooses a stage, then resumes on request', async () => {
    const wrapper = await mountSuspended(ApplePayFlow, { attachTo: document.body, props: { steps } })
    expect(wrapper.get('[data-flow-step="authorize"]').attributes('aria-pressed')).toBe('true')

    await wrapper.get('[data-flow-step="validate"]').trigger('click')
    expect(wrapper.get('[data-flow-panel="validate"]')).toBeTruthy()
    expect(wrapper.get('[data-flow-follow]')).toBeTruthy()
    expect(wrapper.get('[data-flow-lane-edge=""]').attributes('style')).toContain('--flow-from: 70%; --flow-to: 30%')

    await wrapper.setProps({ steps: steps.map(item => ({ ...item, state: ['submit', 'result'].includes(item.id) ? 'active' as const : 'completed' as const })) })
    expect(wrapper.get('[data-flow-panel="validate"]')).toBeTruthy()

    await wrapper.get('[data-flow-follow]').trigger('click')
    await nextTick()
    expect(wrapper.get('[data-flow-panel="result"]')).toBeTruthy()
    expect(wrapper.find('[data-flow-follow]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('[data-flow-step="result"]').element)
    wrapper.unmount()
  })

  it('keeps explanatory code collapsed and does not describe browsed stages as recorded', async () => {
    const wrapper = await mountSuspended(ApplePayFlow, { props: { steps } })
    await wrapper.get('[data-flow-step="validate"]').trigger('click')
    expect(wrapper.text()).toContain('Browsing protocol')
    expect(wrapper.get('[data-flow-panel="validate"]').text()).not.toMatch(/Completed|Recorded/)
    expect(wrapper.findAll('[data-flow-code]').every(node => node.attributes('aria-expanded') === 'false')).toBe(true)
    expect(wrapper.findAll('[data-flow-code-panel]')).toHaveLength(0)
    await wrapper.get('[data-flow-code="client"]').trigger('click')
    expect(wrapper.get('[data-flow-code-panel="client"] code').attributes('data-language')).toBe('js')

    await wrapper.get('[data-flow-step="result"]').trigger('click')
    expect(wrapper.find('[aria-label="Independent result paths across five participants"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-flow-edge]').every(node => node.attributes('data-flow-edge-index') === undefined)).toBe(true)
    expect(wrapper.findAll('[data-flow-lane-edge]').every(node => node.attributes('data-flow-edge-index') === undefined)).toBe(true)
    expect(wrapper.get('[data-flow-panel="result"]').text()).toContain('Independent delivery path')
    wrapper.unmount()
  })
})
