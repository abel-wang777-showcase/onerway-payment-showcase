import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkApplePay, createApplePayCompletion, type AppleSession } from '../app/utils/apple-pay.client'

function sheet(): AppleSession {
  return { onvalidatemerchant: null, onpaymentauthorized: null, oncancel: null, begin: vi.fn(), abort: vi.fn(), completeMerchantValidation: vi.fn(), completePayment: vi.fn() }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Apple Pay sheet completion', () => {
  it('starts one 25-second budget at authorization and ignores a late success', () => {
    vi.useFakeTimers()
    const session = sheet()
    const timeout = vi.fn()
    const controller = createApplePayCompletion(session, timeout)
    vi.advanceTimersByTime(60_000)
    expect(session.completePayment).not.toHaveBeenCalled()
    expect(controller.authorize(1)).toBe(true)
    vi.advanceTimersByTime(20_000)
    expect(controller.authorize(1)).toBe(false)
    vi.advanceTimersByTime(5_000)
    expect(session.completePayment).toHaveBeenCalledExactlyOnceWith({ status: 1 })
    expect(timeout).toHaveBeenCalledOnce()
    expect(controller.finish(0)).toBe(false)
    expect(session.completePayment).toHaveBeenCalledOnce()
  })

  it('completes once with success before the deadline', () => {
    vi.useFakeTimers()
    const session = sheet()
    const timeout = vi.fn()
    const controller = createApplePayCompletion(session, timeout)
    controller.authorize(1)
    expect(controller.finish(0)).toBe(true)
    vi.advanceTimersByTime(30_000)
    expect(session.completePayment).toHaveBeenCalledExactlyOnceWith({ status: 0 })
    expect(timeout).not.toHaveBeenCalled()
  })

  it('never completes a cancelled or system-closed sheet twice', () => {
    vi.useFakeTimers()
    const session = sheet()
    const controller = createApplePayCompletion(session, vi.fn())
    controller.authorize(1)
    controller.cancel()
    vi.advanceTimersByTime(30_000)
    controller.finish(0)
    expect(session.completePayment).not.toHaveBeenCalled()
    const expired = sheet()
    vi.mocked(expired.completePayment).mockImplementation(() => { throw new Error('closed') })
    const other = createApplePayCompletion(expired, vi.fn())
    expect(other.finish(1)).toBe(true)
    expect(other.finish(0)).toBe(false)
    expect(expired.completePayment).toHaveBeenCalledOnce()
  })
})

describe('Apple Pay capabilities', () => {
  it('keeps credential-unknown eligible for cross-browser flows without browser sniffing', async () => {
    vi.stubGlobal('window', { ApplePaySession: { supportsVersion: () => true, canMakePayments: () => true, applePayCapabilities: async () => ({ paymentCredentialStatus: 'paymentCredentialStatusUnknown' }) } })
    await expect(checkApplePay('merchant.example')).resolves.toBe(true)
  })

  it('rejects explicit unsupported capability and missing session support', async () => {
    vi.stubGlobal('window', { ApplePaySession: { supportsVersion: () => true, canMakePayments: () => true, applePayCapabilities: async () => ({ paymentCredentialStatus: 'applePayUnsupported' }) } })
    await expect(checkApplePay('merchant.example')).resolves.toBe(false)
    vi.stubGlobal('window', {})
    await expect(checkApplePay('merchant.example')).resolves.toBe(false)
  })
})
