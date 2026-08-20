import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

const url = 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js'

class Script extends EventTarget {
  readonly dataset: Record<string, string> = {}
  src = ''
  async = false
  removed = false
  onRemove: (() => void) | null = null

  remove(): void {
    this.removed = true
    this.onRemove?.()
  }
}

function installDom() {
  const created: Script[] = []
  let current: Script | null = null
  const sdk = {
    createCheckout: vi.fn(),
  }
  const browser = {
    Onerway: undefined as typeof sdk | undefined,
    setTimeout,
    clearTimeout,
  }

  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => current),
    createElement: vi.fn(() => {
      const script = new Script()
      script.onRemove = () => {
        if (current === script) {
          current = null
        }
      }
      created.push(script)
      return script
    }),
    head: {
      append: vi.fn((script: Script) => {
        current = script
      }),
    },
  })

  return { browser, created, sdk }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('SDK loader', () => {
  it('recreates the hosted Checkout for a new payment or a controlled reload', async () => {
    const page = await readFile(new URL('../app/pages/halden/sdk/[order].vue', import.meta.url), 'utf8')

    expect(page).toContain(':key="`${current.paymentId}:${elementRevision}`"')
  })

  it('removes a failed script so the next attempt can load', async () => {
    const { browser, created, sdk } = installDom()
    const { loadSdk } = await import('../app/utils/sdk.client')
    const first = loadSdk(url)
    const rejected = expect(first).rejects.toThrow('SDK_LOAD_FAILED')

    created[0]?.dispatchEvent(new Event('error'))
    await rejected
    expect(created[0]?.removed).toBe(true)

    const second = loadSdk(url)
    browser.Onerway = sdk
    created[1]?.dispatchEvent(new Event('load'))

    await expect(second).resolves.toBe(sdk)
    expect(created).toHaveLength(2)
  })
})
