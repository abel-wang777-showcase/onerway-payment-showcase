import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PaymentActions from '../../app/components/payment/Actions.vue'
import PaymentAttempts from '../../app/components/payment/Attempts.vue'
import PaymentStatus from '../../app/components/payment/Status.vue'

describe('payment recovery UI', () => {
  it('renders and emits only the supplied safe actions', async () => {
    const wrapper = await mountSuspended(PaymentActions, {
      props: {
        title: 'Choose the safe next step',
        description: 'Keep the existing PaymentAttempt.',
        items: [{
          action: 'verify_attempt',
          label: 'Verify existing payment',
          icon: 'i-lucide-shield-check',
          primary: true,
        }],
      },
    })
    const buttons = wrapper.findAll('button')

    expect(wrapper.get('h2').text()).toBe('Choose the safe next step')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.text()).toContain('Verify existing payment')
    expect(wrapper.text()).not.toContain('Retry payment')

    await buttons[0]?.trigger('click')
    expect(wrapper.emitted('action')).toEqual([['verify_attempt']])
  })

  it('presents a linked attempt history with an explicit active child', async () => {
    const parent = {
      id: 'attempt-parent',
      orderId: 'order-1',
      integration: 'web-js-sdk' as const,
      method: 'card' as const,
      status: 'cancelled' as const,
      statusSource: 'query' as const,
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:01:00.000Z',
    }
    const { statusSource: _statusSource, ...childBase } = parent
    const child = {
      ...childBase,
      id: 'attempt-child',
      status: 'created' as const,
      retryOf: parent.id,
      createdAt: '2026-08-10T00:02:00.000Z',
      updatedAt: '2026-08-10T00:02:00.000Z',
    }
    const wrapper = await mountSuspended(PaymentAttempts, {
      props: { attempts: [parent, child], activeId: child.id },
    })
    const history = wrapper.get('ol[aria-label="Payment attempt history"]')

    expect(history.findAll('li')).toHaveLength(2)
    expect(history.text()).toContain('Retry of Attempt 1')
    expect(history.text()).toContain('Active')
  })

  it.each([
    ['processing', 'Payment still processing'],
    ['not_completed', 'Secure form did not load'],
    ['failed', 'Deterministic payment failure'],
    ['cancelled', 'Deterministic payment cancellation'],
  ] as const)('announces %s with visible text', async (stage, title) => {
    const wrapper = await mountSuspended(PaymentStatus, { props: { stage } })
    const status = wrapper.get('[role="status"]')

    expect(status.attributes('aria-live')).toBe('polite')
    expect(status.text()).toContain(title)
    expect(status.attributes('data-stage')).toBe(stage)
  })
})
