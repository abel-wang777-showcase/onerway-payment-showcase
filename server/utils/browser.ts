import type { BrowserData } from '../../shared/payment/sdk'

const browserFields = [
  'javaEnabled',
  'colorDepth',
  'screenHeight',
  'screenWidth',
  'timeZoneOffset',
  'contentLength',
  'language',
] as const satisfies readonly (keyof BrowserData)[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readDigits(record: Record<string, unknown>, key: keyof BrowserData, pattern: RegExp): string {
  const value = record[key]

  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError('PAYMENT_INPUT_INVALID')
  }

  return value
}

export function readBrowserData(value: unknown): BrowserData {
  if (
    !isRecord(value)
    || Object.keys(value).some(key => !browserFields.includes(key as keyof BrowserData))
    || browserFields.some(key => !(key in value))
    || typeof value.javaEnabled !== 'boolean'
    || typeof value.language !== 'string'
    || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value.language)
  ) {
    throw new TypeError('PAYMENT_INPUT_INVALID')
  }

  return Object.freeze({
    javaEnabled: value.javaEnabled,
    colorDepth: readDigits(value, 'colorDepth', /^\d{1,3}$/),
    screenHeight: readDigits(value, 'screenHeight', /^\d{1,5}$/),
    screenWidth: readDigits(value, 'screenWidth', /^\d{1,5}$/),
    timeZoneOffset: readDigits(value, 'timeZoneOffset', /^-?\d{1,4}$/),
    contentLength: readDigits(value, 'contentLength', /^\d{1,9}$/),
    language: value.language,
  })
}
