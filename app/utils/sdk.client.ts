export interface OnerwayPaymentElement {
  mount(target: string | HTMLElement): OnerwayPaymentElement
  on(event: 'ready' | 'loaderror', handler: (value: unknown) => void): OnerwayPaymentElement
  off(event: 'ready' | 'loaderror', handler: (value: unknown) => void): OnerwayPaymentElement
}

export interface OnerwayCheckout {
  createPaymentElement(): OnerwayPaymentElement
  confirmPayment(options?: Readonly<Record<string, never>>): Promise<unknown>
  on(event: 'payment_result', handler: (value: unknown) => void): OnerwayCheckout
  off(event: 'payment_result', handler: (value: unknown) => void): OnerwayCheckout
}

export interface OnerwaySdk {
  createCheckout(
    paymentId: string,
    options: {
      environment: 'sandbox'
      locale: 'en'
    },
  ): Promise<OnerwayCheckout>
}

declare global {
  interface Window {
    Onerway?: OnerwaySdk
  }
}

let pending: Promise<OnerwaySdk> | null = null
let pendingUrl: string | null = null

function readSdk(): OnerwaySdk | null {
  return window.Onerway?.createCheckout ? window.Onerway : null
}

export function loadSdk(url: string): Promise<OnerwaySdk> {
  const loaded = readSdk()

  if (loaded) {
    return Promise.resolve(loaded)
  }

  if (pending) {
    return pendingUrl === url
      ? pending
      : Promise.reject(new Error('SDK_URL_CONFLICT'))
  }

  pendingUrl = url
  pending = new Promise<OnerwaySdk>((resolve, reject) => {
    const prior = document.querySelector<HTMLScriptElement>('script[data-onerway-sdk]')
    const script = prior ?? document.createElement('script')
    const timeout = window.setTimeout(() => finish(new Error('SDK_LOAD_TIMEOUT')), 12_000)

    function cleanup(): void {
      window.clearTimeout(timeout)
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }

    function finish(error?: Error): void {
      cleanup()
      const sdk = readSdk()

      if (!error && sdk) {
        resolve(sdk)
        return
      }

      pending = null
      pendingUrl = null

      if (script.dataset.onerwaySdk === url) {
        script.remove()
      }

      reject(error ?? new Error('SDK_GLOBAL_MISSING'))
    }

    function onLoad(): void {
      finish()
    }

    function onError(): void {
      finish(new Error('SDK_LOAD_FAILED'))
    }

    if (prior && prior.dataset.onerwaySdk !== url) {
      finish(new Error('SDK_URL_CONFLICT'))
      return
    }

    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })

    if (!prior) {
      script.src = url
      script.async = true
      script.dataset.onerwaySdk = url
      document.head.append(script)
    }
  })

  return pending
}
