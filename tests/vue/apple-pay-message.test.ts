import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaymentMessage from '../../app/components/payment/Message.vue'

const highlight = vi.hoisted(() => ({
  blockedValue: undefined as string | undefined,
  gate: undefined as Promise<void> | undefined,
  failedValue: undefined as string | undefined,
  tokenize: vi.fn(),
}))
const toast = vi.hoisted(() => ({ add: vi.fn() }))
const restoreClipboard: Array<() => void> = []

mockNuxtImport('useToast', () => () => toast)

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
  toast.add.mockClear()
})
afterEach(() => {
  restoreClipboard.splice(0).forEach(restore => restore())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function installClipboard() {
  const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard')
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
  restoreClipboard.push(() => {
    if (originalClipboard) Object.defineProperty(window.navigator, 'clipboard', originalClipboard)
    else Reflect.deleteProperty(window.navigator, 'clipboard')
  })
  return { writeText }
}

describe('Apple Pay safe message', () => {
  it('tokenizes real JSON while rendering message text as escaped spans', async () => {
    const value = '{"payload":"<img src=x onerror=alert(1)>","ok":true,"count":2}'
    const wrapper = await mountSuspended(PaymentMessage, { props: { label: 'Safe request', value } })
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
    const value = '  {\n  "safe": true,\n  "text": "<script>escaped</script>"\n}\n'
    const clipboard = installClipboard()
    const wrapper = await mountSuspended(PaymentMessage, {
      attachTo: document.body,
      props: { label: 'Safe response', value },
    })
    await flushPromises()

    const button = wrapper.get('button[aria-label="Copy Safe response"]')
    button.element.focus()
    await button.trigger('click')
    await flushPromises()
    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(value)
    expect(wrapper.get('code').element.textContent).toBe(value)
    expect(button.attributes('aria-label')).toBe('Safe response copied to clipboard')
    expect(button.get('[data-slot="leadingIcon"]').classes()).toContain('i-lucide:check')
    expect(document.activeElement).toBe(button.element)
    expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }))
    expect(toast.add.mock.calls.flatMap(([payload]) => Object.values(payload))).not.toContain(value)
    expect(wrapper.get('[role="status"]').text()).not.toContain(value)
    wrapper.unmount()
  })

  it('keeps a labelled copy icon and visible focus without a tooltip wrapper', async () => {
    const warn = vi.spyOn(console, 'warn')
    const wrapper = await mountSuspended(PaymentMessage, { props: { label: 'Safe request', value: '{}' } })
    const button = wrapper.get('button[aria-label="Copy Safe request"]')

    expect(button.get('[data-slot="leadingIcon"]').classes()).toContain('i-lucide:copy')
    expect(button.get('[data-slot="leadingIcon"]').attributes('aria-hidden')).toBe('true')
    expect(button.classes().some(name => name.startsWith('focus-visible:'))).toBe(true)
    expect(button.attributes('aria-describedby')).toBeUndefined()
    expect(wrapper.find('[role="tooltip"]').exists()).toBe(false)
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/failed to resolve component|extraneous non-props attributes|icon.*not found/i)
    wrapper.unmount()
  })

  it('reports a failed clipboard write without showing a copied state', async () => {
    const value = '{"safe":true}'
    const clipboard = installClipboard()
    clipboard.writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')
    const execCommand = vi.fn().mockReturnValue(false)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    restoreClipboard.push(() => {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand)
      else Reflect.deleteProperty(document, 'execCommand')
    })
    const wrapper = await mountSuspended(PaymentMessage, { props: { label: 'Safe response', value } })

    const button = wrapper.get('button[aria-label="Copy Safe response"]')
    await button.trigger('click')
    await flushPromises()
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(button.attributes('aria-label')).toBe('Copy Safe response')
    expect(button.get('[data-slot="leadingIcon"]').classes()).toContain('i-lucide:copy')
    expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
    expect(toast.add.mock.calls.flatMap(([payload]) => Object.values(payload))).not.toContain(value)
    expect(document.querySelector('textarea')).toBeNull()
    wrapper.unmount()
  })

  it('keeps the newest value and language when an older tokenization finishes late', async () => {
    const oldValue = '{"old":true}'
    const newValue = 'const current = true'
    let release!: () => void
    highlight.blockedValue = oldValue
    highlight.gate = new Promise<void>((resolve) => { release = resolve })
    const wrapper = await mountSuspended(PaymentMessage, { props: { label: 'Example', value: oldValue } })
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
    const wrapper = await mountSuspended(PaymentMessage, { props: { label: 'Fallback', value } })
    await flushPromises()

    const code = wrapper.get('code')
    expect(code.element.textContent).toBe(value)
    expect(code.findAll('[data-syntax]')).toHaveLength(0)
    wrapper.unmount()
  })
})
