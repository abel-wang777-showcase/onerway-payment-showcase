import { isIP } from 'node:net'
import type { ProfileName, PublicProfile } from '../../shared/profile'

type Env = Readonly<Record<string, string | undefined>>

export type ProfileErrorCode
  = | 'PROFILE_API_BASE_MISMATCH'
    | 'PROFILE_ENABLED_INVALID'
    | 'PROFILE_IP_INVALID'
    | 'PROFILE_INVALID'
    | 'PROFILE_MISSING'
    | 'PROFILE_NOTIFY_URL_MISMATCH'
    | 'PROFILE_NOT_READY'
    | 'PROFILE_PRODUCTION_LOCKED'
    | 'PROFILE_PUBLIC_CONFIG'
    | 'PROFILE_SDK_URL_MISMATCH'
    | 'PROFILE_URL_INVALID'

interface SandboxProfile {
  profile: 'sandbox'
  apiBaseUrl: 'https://sandbox-acq.onerway.com'
  sdkUrl: string
  showcaseOrigin: string
  notifyUrl: string
  transactionIp: string | null
  merchantNo: string
  appId: string
  secret: string
  transactionPolicy: 'sandbox-only'
}

interface ProductionProfile {
  profile: 'production'
  apiBaseUrl: 'https://acq.onerway.com'
  sdkUrl: string | null
  notifyUrl: string | null
  merchantNo: string | null
  appId: string | null
  secret: string | null
  transactionPolicy: 'locked'
}

export type ServerProfile = SandboxProfile | ProductionProfile

export class ProfileError extends Error {
  readonly code: ProfileErrorCode
  readonly fields: readonly string[]

  constructor(code: ProfileErrorCode, fields: readonly string[]) {
    super(`${code}:${fields.join(',')}`)
    this.name = 'ProfileError'
    this.code = code
    this.fields = fields
  }
}

const apiBaseUrls = {
  sandbox: 'https://sandbox-acq.onerway.com',
  production: 'https://acq.onerway.com',
} as const satisfies Record<ProfileName, string>

const sandboxSdkUrl = 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js' as const
const sandboxSdkHash = '80ee223bc5d3561a729c09901379324186f1c65bcb778be10240fe06f338ed64' as const
const sandboxPublicSdkUrl = `${sandboxSdkUrl}?revision=${sandboxSdkHash}` as const
const paymentWebhookPath = '/api/webhooks/onerway/payment'
const paymentWebhookRelayPath = '/onerway/payment'

const keys = {
  sandbox: {
    baseUrl: 'ONERWAY_SANDBOX_BASE_URL',
    sdkUrl: 'ONERWAY_SANDBOX_SDK_URL',
    showcaseOrigin: 'ONERWAY_SHOWCASE_ORIGIN',
    notifyUrl: 'ONERWAY_SANDBOX_NOTIFY_URL',
    notifyRelay: 'ONERWAY_SANDBOX_NOTIFY_RELAY',
    transactionIp: 'ONERWAY_SANDBOX_TRANSACTION_IP',
    merchantNo: 'ONERWAY_SANDBOX_MERCHANT_NO',
    appId: 'ONERWAY_SANDBOX_APP_ID',
    secret: 'ONERWAY_SANDBOX_SECRET',
  },
  production: {
    baseUrl: 'ONERWAY_PRODUCTION_BASE_URL',
    sdkUrl: 'ONERWAY_PRODUCTION_SDK_URL',
    notifyUrl: 'ONERWAY_PRODUCTION_NOTIFY_URL',
    merchantNo: 'ONERWAY_PRODUCTION_MERCHANT_NO',
    appId: 'ONERWAY_PRODUCTION_APP_ID',
    secret: 'ONERWAY_PRODUCTION_SECRET',
  },
} as const

function fail(code: ProfileErrorCode, ...fields: string[]): never {
  throw new ProfileError(code, fields)
}

function required(env: Env, field: string): string {
  const value = env[field]

  if (value === undefined || value.trim() === '') {
    fail('PROFILE_MISSING', field)
  }

  return value
}

function optional(env: Env, field: string): string | null {
  const value = env[field]
  return value === undefined || value.trim() === '' ? null : value
}

function assertHttps(value: string, field: string): void {
  try {
    const url = new URL(value)

    if (url.protocol !== 'https:' || url.username || url.password) {
      fail('PROFILE_URL_INVALID', field)
    }
  }
  catch (error) {
    if (error instanceof ProfileError) {
      throw error
    }

    fail('PROFILE_URL_INVALID', field)
  }
}

function readEnabled(env: Env, field: string): boolean {
  const value = env[field]

  if (value === undefined || value === '' || value === 'false') {
    return false
  }

  if (value === 'true') {
    return true
  }

  fail('PROFILE_ENABLED_INVALID', field)
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname

  return isIP(host) === 0
    && !host.endsWith('.')
    && host !== 'localhost'
    && !host.endsWith('.localhost')
    && !host.endsWith('.local')
}

function readPublicRelayUrl(value: string, field: string): URL {
  assertHttps(value, field)

  const url = new URL(value)

  if (
    url.toString() !== value
    || url.pathname !== paymentWebhookRelayPath
    || url.search
    || url.hash
    || !isPublicHostname(url.hostname)
  ) {
    fail('PROFILE_URL_INVALID', field)
  }

  return url
}

function readIp(env: Env, field: string): string | null {
  const value = optional(env, field)

  if (value !== null && isIP(value) === 0) {
    fail('PROFILE_IP_INVALID', field)
  }

  return value
}

function assertPublicConfigIsPrivate(env: Env): void {
  const exposed = Object.keys(env)
    .filter(field => field.startsWith('NUXT_PUBLIC_ONERWAY_') && env[field] !== undefined)
    .sort()

  if (exposed.length > 0) {
    fail('PROFILE_PUBLIC_CONFIG', ...exposed)
  }
}

function readBaseUrl<P extends ProfileName>(
  env: Env,
  profile: P,
): typeof apiBaseUrls[P] {
  const field = keys[profile].baseUrl
  const value = required(env, field)

  if (value !== apiBaseUrls[profile]) {
    fail('PROFILE_API_BASE_MISMATCH', field)
  }

  return apiBaseUrls[profile]
}

function readSandbox(env: Env): ServerProfile {
  const profile = 'sandbox'
  const profileKeys = keys[profile]
  const sdkUrl = required(env, profileKeys.sdkUrl)
  const showcaseOrigin = required(env, profileKeys.showcaseOrigin)
  const notifyUrl = required(env, profileKeys.notifyUrl)
  const notifyRelay = readEnabled(env, profileKeys.notifyRelay)

  assertHttps(sdkUrl, profileKeys.sdkUrl)
  assertHttps(showcaseOrigin, profileKeys.showcaseOrigin)
  assertHttps(notifyUrl, profileKeys.notifyUrl)

  if (sdkUrl !== sandboxSdkUrl) {
    fail('PROFILE_SDK_URL_MISMATCH', profileKeys.sdkUrl)
  }

  const parsedOrigin = new URL(showcaseOrigin)

  if (
    parsedOrigin.origin !== showcaseOrigin
    || parsedOrigin.pathname !== '/'
    || parsedOrigin.search
    || parsedOrigin.hash
    || !isPublicHostname(parsedOrigin.hostname)
  ) {
    fail('PROFILE_URL_INVALID', profileKeys.showcaseOrigin)
  }

  const canonicalNotifyUrl = `${showcaseOrigin}${paymentWebhookPath}`

  if (!notifyRelay && notifyUrl !== canonicalNotifyUrl) {
    fail('PROFILE_NOTIFY_URL_MISMATCH', profileKeys.notifyUrl)
  }

  if (notifyRelay) {
    if (notifyUrl === canonicalNotifyUrl) {
      fail('PROFILE_NOTIFY_URL_MISMATCH', profileKeys.notifyUrl)
    }

    const relayUrl = readPublicRelayUrl(notifyUrl, profileKeys.notifyUrl)

    if (relayUrl.origin === showcaseOrigin) {
      fail('PROFILE_NOTIFY_URL_MISMATCH', profileKeys.notifyUrl)
    }
  }

  return {
    profile,
    apiBaseUrl: readBaseUrl(env, profile),
    sdkUrl,
    showcaseOrigin,
    notifyUrl,
    transactionIp: readIp(env, profileKeys.transactionIp),
    merchantNo: required(env, profileKeys.merchantNo),
    appId: required(env, profileKeys.appId),
    secret: required(env, profileKeys.secret),
    transactionPolicy: 'sandbox-only',
  }
}

function readProductionEnabled(env: Env): boolean {
  return readEnabled(env, 'ONERWAY_PRODUCTION_ENABLED')
}

function readProduction(env: Env): ServerProfile {
  const profile = 'production'
  const profileKeys = keys[profile]
  const enabled = readProductionEnabled(env)

  if (enabled) {
    fail('PROFILE_PRODUCTION_LOCKED', 'ONERWAY_PRODUCTION_ENABLED')
  }

  const values = {
    sdkUrl: optional(env, profileKeys.sdkUrl),
    notifyUrl: optional(env, profileKeys.notifyUrl),
    merchantNo: optional(env, profileKeys.merchantNo),
    appId: optional(env, profileKeys.appId),
    secret: optional(env, profileKeys.secret),
  }
  const missing = Object.entries(values)
    .filter(([, value]) => value === null)
    .map(([field]) => profileKeys[field as keyof typeof profileKeys])
  const configured = Object.keys(values).length - missing.length

  if (configured > 0 && missing.length > 0) {
    fail('PROFILE_NOT_READY', ...missing)
  }

  if (values.sdkUrl !== null) {
    assertHttps(values.sdkUrl, profileKeys.sdkUrl)
  }

  if (values.notifyUrl !== null) {
    assertHttps(values.notifyUrl, profileKeys.notifyUrl)
  }

  return {
    profile,
    apiBaseUrl: readBaseUrl(env, profile),
    ...values,
    transactionPolicy: 'locked',
  }
}

export function readProfile(env: Env): ServerProfile {
  assertPublicConfigIsPrivate(env)

  const profile = env.ONERWAY_PROFILE

  if (profile === undefined || profile.trim() === '') {
    fail('PROFILE_MISSING', 'ONERWAY_PROFILE')
  }

  if (profile !== 'sandbox' && profile !== 'production') {
    fail('PROFILE_INVALID', 'ONERWAY_PROFILE')
  }

  return profile === 'sandbox' ? readSandbox(env) : readProduction(env)
}

export function toPublicProfile(profile: ServerProfile): PublicProfile {
  return {
    profile: profile.profile,
    environment: profile.profile === 'sandbox' ? 'Sandbox' : 'Production',
    transactionPolicy: profile.transactionPolicy,
    canonicalOrigin: profile.profile === 'sandbox' ? profile.showcaseOrigin : null,
    sdk: profile.profile === 'sandbox'
      ? {
          url: sandboxPublicSdkUrl,
          release: 'v4/latest',
        }
      : null,
  }
}

export function requireServerProfile(): ServerProfile {
  const app = useNitroApp() as ReturnType<typeof useNitroApp> & {
    profile?: ServerProfile
  }

  if (!app.profile) {
    throw createError({
      statusCode: 503,
      statusMessage: 'PROFILE_NOT_READY',
    })
  }

  return app.profile
}
