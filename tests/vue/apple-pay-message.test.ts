import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ApplePayMessage from '../../app/components/payment/ApplePayMessage.vue'

const highlight = vi.hoisted(() => ({
  blockedValue: undefined as string | undefined,
  gate: undefined as Promise<void> | undefined,
  failedValue: undefined as string | undefined,
  tokenize: vi.fn(),
}))

vi.mock('@speed-highlight/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@speed-highlight/core')>()
  highlight.tokenize.mockImplementation(async (source, language, token) => {
    if (source === highlight.failedValue) throw new Error('tokenization unavailable')
    if (source === highlight.blockedValue) await highlight.gate
    return actual.tokenize(source, language, token)
  })
  return { ...actual, tokenize: highlight.tokenize }
})

beforeEach(() => {
  highlight.blockedValue = undefined
  highlight.gate = undefined
  highlight.failedValue = undefined
  highlight.tokenize.mockClear()
})
afterEach(() => { vi.unstubAllGlobals() })

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

describe('Apple Pay safe message', () => {
  it('tokenizes real JSON while rendering message text as escaped spans', async () => {
    const value = '{"payload":"<img src=x onerror=alert(1)>","ok":true,"count":2}'
    const wrapper = await mountSuspended(ApplePayMessage, { props: { label: 'Safe request', value } })
    await flushPromises()

    const code = wrapper.get('code')
    await vi.waitFor(() => expect(code.findAll('[data-syntax]').length).toBeGreaterThan(0))
    expect(wrapper.findAll('[role="region"]')).toHaveLength(1)
    expect(code.attributes()).toMatchObject({ tabindex: '0', role: 'region', 'aria-label': 'Safe request code' })
    expect(wrapper.get('pre').attributes('tabindex')).toBeUndefined()
    expect(wrapper.text()).toContain('Safe request')
    expect(wrapper.find('[data-slot="icon"]').exists()).toBe(false)
    expect(code.attributes('data-language')).toBe('json')
    expect(code.element.textContent).toBe(value)
    expect(code.find('img').exists()).toBe(false)
    expect(code.html()).toContain('&lt;img src=x onerror=alert(1)&gt;')
    wrapper.unmount()
  })

  it('copies the unchanged source value after highlighting', async () => {
    const value = '{"safe":true}'
    const clipboard = installClipboard()
    const wrapper = await mountSuspended(ApplePayMessage, { props: { label: 'Safe response', value } })
    await flushPromises()

    await wrapper.get('button[aria-label="Copy Safe response"]').trigger('click')
    await flushPromises()
    expect(clipboard.write).toHaveBeenCalledOnce()
    expect(clipboard.items[0]?.['text/plain']).toBe(value)
    wrapper.unmount()
    clipboard.restore()
  })

  it('keeps the newest value and language when an older tokenization finishes late', async () => {
    const oldValue = '{"old":true}'
    const newValue = 'const current = true'
    let release!: () => void
    highlight.blockedValue = oldValue
    highlight.gate = new Promise<void>((resolve) => { release = resolve })
    const wrapper = await mountSuspended(ApplePayMessage, { props: { label: 'Example', value: oldValue } })
    await vi.waitFor(() => expect(highlight.tokenize).toHaveBeenCalledWith(oldValue, 'json', expect.any(Function)))

    await wrapper.setProps({ value: newValue, language: 'js' })
    await vi.waitFor(() => {
      const code = wrapper.get('code')
      expect(code.attributes('data-language')).toBe('js')
      expect(code.element.textContent).toBe(newValue)
      expect(code.findAll('[data-syntax]').length).toBeGreaterThan(0)
    })

    release()
    await flushPromises()
    expect(wrapper.get('code').element.textContent).toBe(newValue)
    expect(wrapper.get('code').attributes('data-language')).toBe('js')
    wrapper.unmount()
  })

  it('keeps plain text when tokenization is unavailable', async () => {
    const value = '{"fallback":true}'
    highlight.failedValue = value
    const wrapper = await mountSuspended(ApplePayMessage, { props: { label: 'Fallback', value } })
    await flushPromises()

    const code = wrapper.get('code')
    expect(code.element.textContent).toBe(value)
    expect(code.findAll('[data-syntax]')).toHaveLength(0)
    wrapper.unmount()
  })
})
