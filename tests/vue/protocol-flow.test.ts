import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ProtocolFlow from '../../app/components/payment/ProtocolFlow.vue'
import Step from '../../app/components/payment/Step.vue'
import type { PaymentStep, ProtocolFlow as Flow } from '../../shared/payment/protocol'

const actors = [
  { id: 'customer', label: 'Customer', icon: 'i-lucide-user-round' },
  { id: 'client', label: 'Merchant client', icon: 'i-lucide-monitor', merchant: true },
  { id: 'server', label: 'Merchant server', icon: 'i-lucide-server', merchant: true },
  { id: 'google', label: 'Google Pay', icon: 'i-lucide-wallet' },
  { id: 'onerway', label: 'Onerway', icon: 'i-lucide-shield-check' },
]
const flows: readonly Flow[] = ['prepare', 'authorize', 'submit'].map(id => ({ id, title: id, trigger: 'Synthetic trigger', edges: [{ from: 'google', to: 'client', label: 'Synthetic token response' }], client: 'Client explanation', server: 'Server explanation', note: 'Illustrative only', clientCode: 'syntheticExample()' }))
function step(id: string, state: PaymentStep['state'] = 'waiting'): PaymentStep {
  return { id, state, title: id, actor: 'Google Pay', input: 'Synthetic input', output: 'Synthetic output', failure: 'Synthetic interruption', documentation: 'https://example.com' }
}

describe('shared payment protocol presentation', () => {
  it('uses Google protocol data, follows events and keeps browsing independent', async () => {
    const wrapper = await mountSuspended(ProtocolFlow, { props: { wallet: 'google-pay', title: 'Google Pay protocol map', actors, flows, steps: [step('authorize', 'active')] } })
    expect(wrapper.find('[data-google-pay-flow]').exists()).toBe(true)
    expect(wrapper.find('[data-apple-pay-flow]').exists()).toBe(false)
    expect(wrapper.get('[data-flow-panel="authorize"]').text()).toContain('Client explanation')
    expect(wrapper.get('[data-flow-actor="google"]').text()).toBe('Google Pay')
    expect(wrapper.text()).not.toContain('merchant validation')
    await wrapper.get('[data-flow-step="prepare"]').trigger('click')
    await wrapper.get('[data-flow-code="client"]').trigger('click')
    expect(wrapper.find('[data-flow-code-panel="client"]').exists()).toBe(true)
    await wrapper.setProps({ steps: [step('submit', 'active')] })
    expect(wrapper.find('[data-flow-panel="prepare"]').exists()).toBe(true)
    await wrapper.get('[data-flow-follow]').trigger('click')
    expect(wrapper.find('[data-flow-panel="submit"]').exists()).toBe(true)
    expect(wrapper.find('[data-flow-code-panel="client"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shares step explanations without claiming unobserved Google evidence', async () => {
    const wrapper = await mountSuspended(Step, { props: { wallet: 'google-pay', index: 0, step: step('authorize') } })
    expect(wrapper.get('[data-google-pay-step]').attributes('data-state')).toBe('waiting')
    expect(wrapper.find('[data-apple-pay-step]').exists()).toBe(false)
    await wrapper.get('summary').trigger('click')
    expect(wrapper.text()).toContain('No data was recorded')
    expect(wrapper.text()).toContain('Who acts')
    expect(wrapper.text()).toContain('If this step is interrupted')
    await wrapper.setProps({ step: { ...step('authorize', 'completed'), evidence: { source: 'stored', summary: 'Synthetic restored evidence', fields: [] } } })
    expect(wrapper.text()).toContain('Restored from server')
    wrapper.unmount()
  })
})
