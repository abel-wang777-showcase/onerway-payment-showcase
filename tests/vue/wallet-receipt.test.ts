import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import WalletReceipt from '../../app/components/payment/WalletReceipt.vue'
import { createOrder } from '../../shared/payment/order'

const order = createOrder({
  id: 'HLD-RECEIPT', scene: 'standard-success', createdAt: '2026-10-10T00:00:00Z',
  amount: { minor: 500, currency: 'USD' },
  item: { sku: 'SAMPLE', name: 'Halden sample', variant: 'Slate', quantity: 1, unitAmount: { minor: 500, currency: 'USD' } },
})
const base = { orderId: order.id, order, headingId: 'receipt-title' }

describe('wallet receipt', () => {
  it.each(['submitting', 'checking', 'loading'] as const)('shows an active request for %s', async (flag) => {
    const wrapper = await mountSuspended(WalletReceipt, { props: { ...base, [flag]: true } })
    expect(wrapper.get('[data-wallet-feedback]').attributes('data-busy')).toBe('true')
    expect(wrapper.get('[data-wallet-order-summary]').text()).toContain(order.id)
    expect(wrapper.get('[data-wallet-amount]').text()).toContain('5.00')
    expect(wrapper.get('[role="status"]').attributes('aria-live')).toBe('polite')
    wrapper.unmount()
  })

  it.each(['succeeded', 'failed', 'cancelled'] as const)('preserves a confirmed %s result during a late request', async (status) => {
    const wrapper = await mountSuspended(WalletReceipt, { props: { ...base, status, submitting: true, checking: true } })
    expect(wrapper.get('[data-wallet-feedback]').attributes('data-busy')).toBe('false')
    expect(wrapper.get('h2').text()).not.toMatch(/Processing|Checking/)
    wrapper.unmount()
  })

  it.each([
    { submitted: true, status: 'requires_action' as const },
    { submitted: true, transactionNotFound: true, verificationPending: true },
    { submitted: true, verificationPending: true },
    { manualCaptured: true },
  ])('does not spin for an idle unresolved or captured payment: %j', async (state) => {
    const wrapper = await mountSuspended(WalletReceipt, { props: { ...base, ...state } })
    expect(wrapper.get('[data-wallet-feedback]').attributes('data-busy')).not.toBe('true')
    expect(wrapper.get('h2').text()).not.toContain('paid')
    wrapper.unmount()
  })
})
