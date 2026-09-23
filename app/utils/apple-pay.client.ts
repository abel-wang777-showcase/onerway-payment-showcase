import type { ApplePayRequest } from '#shared/payment/apple-pay'

export const APPLE_PAY_SCRIPT = 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js'
// Version 6 supports the result-object completion API used by this integration.
// The CDN release version is separate from the ApplePaySession protocol version.
export const APPLE_PAY_SESSION_VERSION = 6
export const APPLE_PAY_AUTHORIZATION_BUDGET = 25_000

export interface AppleSession {
  onvalidatemerchant: ((event: { validationURL: string }) => void) | null
  onpaymentauthorized: ((event: { payment: { token: Record<string, unknown> } }) => void) | null
  oncancel: (() => void) | null
  begin: () => void
  abort: () => void
  completeMerchantValidation: (session: Record<string, unknown>) => void
  completePayment: (result: { status: number }) => void
}

export interface AppleSessionConstructor {
  new(version: number, request: ApplePayRequest): AppleSession
  supportsVersion: (version: number) => boolean
  canMakePayments: () => boolean
  applePayCapabilities?: (merchantIdentifier: string) => Promise<{ paymentCredentialStatus: string }>
  STATUS_SUCCESS: number
  STATUS_FAILURE: number
}

export function appleSessionConstructor(): AppleSessionConstructor | undefined {
  return (window as unknown as { ApplePaySession?: AppleSessionConstructor }).ApplePaySession
}

let scriptFlight: Promise<void> | undefined
export function loadApplePay(): Promise<void> {
  if (scriptFlight) return scriptFlight
  scriptFlight = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = APPLE_PAY_SCRIPT
    script.async = true
    const timer = setTimeout(() => fail(), 15_000)
    function fail() {
      clearTimeout(timer)
      script.remove()
      scriptFlight = undefined
      reject(new Error('APPLE_PAY_UNAVAILABLE'))
    }
    script.onload = () => {
      clearTimeout(timer)
      resolve()
    }
    script.onerror = fail
    document.head.append(script)
  })
  return scriptFlight
}

export async function checkApplePay(merchantIdentifier: string): Promise<boolean> {
  const ApplePay = appleSessionConstructor()
  if (!ApplePay?.supportsVersion(APPLE_PAY_SESSION_VERSION) || !ApplePay.canMakePayments()) return false
  if (!ApplePay.applePayCapabilities) return true
  const result = await ApplePay.applePayCapabilities(merchantIdentifier)
  // Unknown permits cross-browser payment code flows. No active-card gate.
  return result.paymentCredentialStatus !== 'applePayUnsupported'
}

/** Each sheet is completed at most once, including cancellation and late results. */
export function createApplePayCompletion(session: AppleSession, onTimeout: () => void) {
  let closed = false
  let authorized = false
  let timer: ReturnType<typeof setTimeout> | undefined
  function finish(status: number): boolean {
    if (closed) return false
    closed = true
    clearTimeout(timer)
    try { session.completePayment({ status }) }
    catch { /* The system may already have dismissed the sheet. */ }
    return true
  }
  return {
    authorize(failureStatus: number): boolean {
      if (closed || authorized) return false
      authorized = true
      timer = setTimeout(() => {
        if (finish(failureStatus)) onTimeout()
      }, APPLE_PAY_AUTHORIZATION_BUDGET)
      return true
    },
    finish,
    cancel() { closed = true; clearTimeout(timer) },
    get active() { return !closed },
  }
}
