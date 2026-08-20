import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PaymentElement from '../../app/components/payment/Element.vue'
import { isCurrentSdkElementEvent } from '../../shared/payment/sdk'

const sdk = vi.hoisted(() => ({
  load: vi.fn(),
}))

vi.mock('~/utils/sdk.client', () => ({
  loadSdk: sdk.load,
}))

describe('payment Element generation', () => {
  beforeEach(() => {
    sdk.load.mockReset()
  })

  it.each([
    [{ paymentId: 'payment-1', generation: 1 }, { paymentId: 'payment-1', generation: 1 }, true],
    [{ paymentId: 'payment-1', generation: 0 }, { paymentId: 'payment-1', generation: 1 }, false],
    [{ paymentId: 'payment-1', generation: 1 }, { paymentId: 'payment-2', generation: 1 }, false],
    [{ paymentId: 'payment-1', generation: 1 }, null, false],
  ] as const)('matches only the current production Element identity %#', (event, current, expected) => {
    expect(isCurrentSdkElementEvent(event, current)).toBe(expected)
  })

  it('ignores a queued ready event from the previous Element generation', async () => {
    const ready: Array<() => void> = []
    const createCheckout = vi.fn(async () => {
      const element = {
        mount: vi.fn(),
        on: vi.fn((event: string, handler: () => void) => {
          if (event === 'ready') {
            ready.push(handler)
          }
        }),
        off: vi.fn(),
      }
      return {
        createPaymentElement: vi.fn(() => element),
        confirmPayment: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      }
    })
    sdk.load.mockResolvedValue({ createCheckout })

    const Host = defineComponent({
      components: { PaymentElement },
      setup() {
        const generation = shallowRef(0)
        const accepted = shallowRef(0)

        function reload(): void {
          generation.value += 1
        }

        function accept(paymentId: string, value: number): void {
          if (isCurrentSdkElementEvent(
            { paymentId, generation: value },
            { paymentId: 'payment-1', generation: generation.value },
          )) {
            accepted.value += 1
          }
        }

        return { accepted, accept, generation, reload }
      },
      template: `
        <PaymentElement
          :key="generation"
          payment-id="payment-1"
          url="https://sdk.test/v4.js"
          :generation="generation"
          @ready="accept"
        />
        <output>{{ accepted }}</output>
        <button type="button" @click="reload">Reload</button>
      `,
    })
    const wrapper = await mountSuspended(Host)
    await flushPromises()

    expect(ready).toHaveLength(1)
    wrapper.get('button').element.click()
    ready[0]?.()
    await nextTick()

    expect(wrapper.get('output').text()).toBe('0')

    await flushPromises()
    expect(ready).toHaveLength(2)
    ready[1]?.()
    await nextTick()

    expect(wrapper.get('output').text()).toBe('1')
  })

  it('ignores queued events from a previous paymentId with the same generation', async () => {
    const ready: Array<() => void> = []
    const error: Array<() => void> = []
    const result: Array<(value: unknown) => void> = []
    const createCheckout = vi.fn(async () => {
      const element = {
        mount: vi.fn(),
        on: vi.fn((event: string, handler: () => void) => {
          if (event === 'ready') {
            ready.push(handler)
          }
          else if (event === 'loaderror') {
            error.push(handler)
          }
        }),
        off: vi.fn(),
      }
      return {
        createPaymentElement: vi.fn(() => element),
        confirmPayment: vi.fn(),
        on: vi.fn((event: string, handler: (value: unknown) => void) => {
          if (event === 'payment_result') {
            result.push(handler)
          }
        }),
        off: vi.fn(),
      }
    })
    sdk.load.mockResolvedValue({ createCheckout })

    const Host = defineComponent({
      components: { PaymentElement },
      setup() {
        const paymentId = shallowRef('payment-1')
        const accepted = shallowRef(0)

        function replacePayment(): void {
          paymentId.value = 'payment-2'
        }

        function accept(id: string, generation: number): void {
          if (isCurrentSdkElementEvent(
            { paymentId: id, generation },
            { paymentId: paymentId.value, generation: 0 },
          )) {
            accepted.value += 1
          }
        }

        function acceptResult(id: string, generation: number): void {
          accept(id, generation)
        }

        return { accepted, accept, acceptResult, paymentId, replacePayment }
      },
      template: `
        <PaymentElement
          :key="paymentId"
          :payment-id="paymentId"
          url="https://sdk.test/v4.js"
          :generation="0"
          @ready="accept"
          @error="accept"
          @result="acceptResult"
        />
        <output>{{ accepted }}</output>
        <button type="button" @click="replacePayment">Replace payment</button>
      `,
    })
    const wrapper = await mountSuspended(Host)
    await flushPromises()

    wrapper.get('button').element.click()
    ready[0]?.()
    error[0]?.()
    result[0]?.({ paymentId: 'payment-1' })
    await nextTick()

    expect(wrapper.get('output').text()).toBe('0')

    await flushPromises()
    ready[1]?.()
    error[1]?.()
    result[1]?.({ paymentId: 'payment-2' })
    await nextTick()

    expect(wrapper.get('output').text()).toBe('3')
  })
})
