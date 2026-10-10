import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import GooglePayToken from '../../app/components/payment/GooglePayToken.vue'

describe('Google Pay token panel', () => {
  it('distinguishes unsupported and cleared manual authorization', async () => {
    const wrapper = await mountSuspended(GooglePayToken, { props: { token: null, unavailable: true, manual: true, captured: false } })
    expect(wrapper.get('[role=status]').text()).toContain('cannot be shown safely')
    expect(wrapper.text()).not.toContain('was captured')
    await wrapper.setProps({ unavailable: false, captured: true })
    expect(wrapper.get('[role=status]').text()).toContain('token has been cleared')
    expect(wrapper.get('[role=status]').text()).toContain('order is still unsubmitted')
    wrapper.unmount()
  })
  it('keeps opaque tokens hidden and never offers fake object JSON', async () => {
    const wrapper = await mountSuspended(GooglePayToken, { props: { token: 'synthetic-opaque-token', unavailable: false } })
    expect(wrapper.text()).not.toContain('synthetic-opaque-token')
    await wrapper.get('button[aria-controls]').trigger('click')
    expect(wrapper.text()).toContain('not a JSON object')
    expect(wrapper.find('code[data-language=json]').exists()).toBe(false)
    wrapper.unmount()
  })
})
