import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import LaunchActions from '../../app/components/subscription/LaunchActions.vue'

describe('subscription launch actions', () => {
  it('separates viewing an existing subscription from starting a new test customer', async () => {
    const wrapper = await mountSuspended(LaunchActions, {
      props: {
        existing: { orderId: 'order-1', state: 'active', replayAvailable: true },
        canonicalHref: null,
        startDisabled: false,
        loading: false,
        startingNewCustomer: false,
      },
    })

    expect(wrapper.text()).toContain('Subscription already exists')
    expect(wrapper.text()).toContain('Viewing it creates no payment')

    const viewLink = wrapper.findAll('a')
      .find(link => link.text().includes('View existing subscription'))
    const newCustomerButton = wrapper.findAll('button')
      .find(button => button.text().includes('Start again as a new Sandbox customer'))

    expect(viewLink?.attributes('href')).toBe('/halden/result/order-1')
    expect(newCustomerButton).toBeDefined()
    await newCustomerButton!.trigger('click')
    expect(wrapper.emitted('startNewCustomer')).toHaveLength(1)
    expect(wrapper.emitted('start')).toBeUndefined()
  })

  it('starts the first subscription without creating a client-owned customer identity', async () => {
    const wrapper = await mountSuspended(LaunchActions, {
      props: {
        existing: null,
        canonicalHref: null,
        startDisabled: false,
        loading: false,
        startingNewCustomer: false,
      },
    })
    const startButton = wrapper.findAll('button')
      .find(button => button.text().includes('Start Sandbox subscription'))

    expect(startButton).toBeDefined()
    await startButton!.trigger('click')
    expect(wrapper.emitted('start')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('merchantCustId')
  })

  it('keeps an existing result link available when new starts are disabled', async () => {
    const wrapper = await mountSuspended(LaunchActions, {
      props: {
        existing: { orderId: 'order-1', state: 'active', replayAvailable: true },
        canonicalHref: null,
        startDisabled: true,
        loading: false,
        startingNewCustomer: false,
      },
    })
    const viewLink = wrapper.findAll('a')
      .find(link => link.text().includes('View existing subscription'))
    const newCustomerButton = wrapper.findAll('button')
      .find(button => button.text().includes('Start again as a new Sandbox customer'))

    expect(viewLink?.attributes('aria-disabled')).toBeUndefined()
    expect(viewLink?.attributes('href')).toBe('/halden/result/order-1')
    expect(newCustomerButton?.attributes('disabled')).toBeDefined()
  })
})
