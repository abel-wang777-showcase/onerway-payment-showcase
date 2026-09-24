import type { BrowserData } from '#shared/payment/sdk'

export function browserData(): BrowserData {
  const javaEnabled = (() => {
    try {
      return typeof navigator.javaEnabled === 'function' && navigator.javaEnabled()
    }
    catch {
      return false
    }
  })()

  return Object.freeze({
    javaEnabled,
    colorDepth: String(screen.colorDepth),
    screenHeight: String(screen.height),
    screenWidth: String(screen.width),
    timeZoneOffset: String(new Date().getTimezoneOffset()),
    contentLength: String(document.documentElement.outerHTML.length),
    language: navigator.language || 'en-US',
  })
}

