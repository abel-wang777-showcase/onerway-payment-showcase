import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ApplePayToken from '../../app/components/payment/ApplePayToken.vue'

const token = JSON.stringify({ paymentData: { data: 'synthetic-private-token' }, paymentMethod: { network: 'visa' }, transactionIdentifier: 'synthetic-id' })

describe('Apple Pay token panel', () => {
  it('keeps full token out of the DOM until explicitly revealed, and hides it again', async () => {
    const wrapper = await mountSuspended(ApplePayToken, { props: { token, unavailable: false } })
    expect(wrapper.text()).not.toContain('synthetic-private-token')
    const toggle = wrapper.get('button[aria-controls="apple-pay-token-content"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(JSON.parse(wrapper.get('code[data-language=json]').element.textContent!)).toEqual(JSON.parse(token))
    expect(wrapper.findAll('[role=tab]').map(tab => tab.text())).toEqual(['JSON object', 'Stringify', 'Apifox', 'Direct API'])
    await toggle.trigger('click')
    expect(wrapper.find('code[data-language=json]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('synthetic-private-token')
    wrapper.unmount()
  })

  it('requests explicit clearing and resets disclosure when the snapshot is cleared or replaced', async () => {
    const wrapper = await mountSuspended(ApplePayToken, { props: { token, unavailable: false } })
    await wrapper.get('button[aria-controls]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Clear token')!.trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
    await wrapper.setProps({ token: null })
    expect(wrapper.find('code[data-language=json]').exists()).toBe(false)
    await wrapper.setProps({ token })
    expect(wrapper.get('button[aria-controls]').attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('explains absent or blocked tokens without showing any raw fields', async () => {
    const wrapper = await mountSuspended(ApplePayToken, { props: { token: null, unavailable: true } })
    expect(wrapper.text()).toContain('cannot be shown safely')
    expect(wrapper.get('[role="status"]').text()).toContain('Payment submission is unaffected')
    expect(wrapper.find('pre').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
    await wrapper.setProps({ unavailable: false })
    expect(wrapper.text()).toContain('Restored orders do not retain tokens')
    wrapper.unmount()
  })

  it('keeps manual capture unsubmitted after clearing its token', async () => {
    const wrapper = await mountSuspended(ApplePayToken, { props: { token, unavailable: false, manual: true, captured: true } })
    expect(wrapper.text()).toContain('This page did not submit a payment')
    expect(wrapper.text()).not.toContain('synthetic-private-token')
    await wrapper.get('button[aria-controls]').trigger('click')
    expect(wrapper.text()).toContain('USD 5.00')
    expect(wrapper.text()).toContain('this page’s order remains unsubmitted')
    await wrapper.findAll('button').find(button => button.text() === 'Clear token')!.trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
    await wrapper.setProps({ token: null })
    expect(wrapper.get('[role="status"]').text()).toContain('order is still unsubmitted')
    expect(wrapper.find('pre').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('synthetic-private-token')
    wrapper.unmount()
  })

  it('keeps a blocked manual token unsubmitted without claiming capture or clearing', async () => {
    const wrapper = await mountSuspended(ApplePayToken, { props: { token: null, unavailable: true, manual: true, captured: false } })
    expect(wrapper.get('[role="status"]').text()).toContain('No payment was submitted by this page')
    expect(wrapper.text()).not.toContain('Payment submission is unaffected')
    expect(wrapper.text()).not.toContain('was captured')
    expect(wrapper.find('pre').exists()).toBe(false)
    await wrapper.setProps({ unavailable: false })
    expect(wrapper.get('[role="status"]').text()).toContain('Authorize in Wallet to capture')
    expect(wrapper.text()).not.toContain('token has been cleared')
    wrapper.unmount()
  })

  it('explains Apifox object editing and warns against submitting an automatic token twice', async () => {
    const wrapper = await mountSuspended(ApplePayToken, { props: { token, unavailable: false } })
    expect(wrapper.text()).toContain('Do not submit it again in Apifox')
    await wrapper.get('button[aria-controls]').trigger('click')
    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === 'Stringify')!.trigger('keydown', { key: 'Enter' })
    expect(wrapper.text()).toContain('tokenInfo.tokenId')
    const stringify = wrapper.get('code[data-language=json]').element.textContent!
    expect(JSON.parse(stringify)).toBe(token)
    expect(JSON.parse(`{"tokenInfo":{"tokenId":${stringify}}}`).tokenInfo.tokenId).toBe(token)
    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === 'Apifox')!.trigger('keydown', { key: 'Enter' })
    expect(wrapper.text()).toContain('shared signing script serializes the outer object once')
    const apifox = JSON.parse(wrapper.get('code[data-language=json]').element.textContent!)
    expect(apifox.tokenInfo).toEqual({ provider: 'ApplePay', tokenId: token })
    await wrapper.findAll('[role="tab"]').find(tab => tab.text() === 'Direct API')!.trigger('keydown', { key: 'Enter' })
    const wire = JSON.parse(wrapper.get('code[data-language=json]').element.textContent!)
    expect(typeof wire.tokenInfo).toBe('string')
    expect(JSON.parse(wire.tokenInfo)).toEqual({ provider: 'ApplePay', tokenId: token })
    expect(JSON.stringify(apifox.tokenInfo)).toBe(wire.tokenInfo)
    wrapper.unmount()
  })
})
