import { describe, expect, it } from 'vitest'
import {
  ProfileError,
  readProfile,
  toPublicProfile,
} from '../server/utils/profile'

const sandbox = {
  ONERWAY_PROFILE: 'sandbox',
  ONERWAY_SANDBOX_BASE_URL: 'https://sandbox-acq.onerway.com',
  ONERWAY_SANDBOX_SDK_URL: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js',
  ONERWAY_SHOWCASE_ORIGIN: 'https://showcase.example',
  ONERWAY_SANDBOX_NOTIFY_URL: 'https://showcase.example/api/webhooks/onerway/payment',
  ONERWAY_SANDBOX_MERCHANT_NO: 'merchant',
  ONERWAY_SANDBOX_APP_ID: 'app',
  ONERWAY_SANDBOX_SECRET: 'secret',
} as const

const production = {
  ONERWAY_PROFILE: 'production',
  ONERWAY_PRODUCTION_ENABLED: 'false',
  ONERWAY_PRODUCTION_BASE_URL: 'https://acq.onerway.com',
  ONERWAY_PRODUCTION_SDK_URL: '',
  ONERWAY_PRODUCTION_NOTIFY_URL: '',
  ONERWAY_PRODUCTION_MERCHANT_NO: '',
  ONERWAY_PRODUCTION_APP_ID: '',
  ONERWAY_PRODUCTION_SECRET: '',
} as const

function capture(read: () => unknown): ProfileError {
  try {
    read()
  }
  catch (error) {
    expect(error).toBeInstanceOf(ProfileError)
    return error as ProfileError
  }

  throw new Error('Expected ProfileError')
}

describe('readProfile', () => {
  it('reads a complete Sandbox profile', () => {
    expect(readProfile(sandbox)).toEqual({
      profile: 'sandbox',
      apiBaseUrl: 'https://sandbox-acq.onerway.com',
      sdkUrl: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js',
      showcaseOrigin: 'https://showcase.example',
      notifyUrl: 'https://showcase.example/api/webhooks/onerway/payment',
      transactionIp: null,
      merchantNo: 'merchant',
      appId: 'app',
      secret: 'secret',
      transactionPolicy: 'sandbox-only',
    })
  })

  it.each([
    'ONERWAY_SANDBOX_SDK_URL',
    'ONERWAY_SHOWCASE_ORIGIN',
    'ONERWAY_SANDBOX_NOTIFY_URL',
    'ONERWAY_SANDBOX_MERCHANT_NO',
    'ONERWAY_SANDBOX_APP_ID',
    'ONERWAY_SANDBOX_SECRET',
  ])('rejects a missing Sandbox field: %s', (field) => {
    const error = capture(() => readProfile({ ...sandbox, [field]: '' }))

    expect(error.code).toBe('PROFILE_MISSING')
    expect(error.fields).toEqual([field])
  })

  it.each(['Sandbox', 'production ', 'staging'])(
    'accepts only exact profile names: %s',
    (profile) => {
      const error = capture(() => readProfile({
        ...sandbox,
        ONERWAY_PROFILE: profile,
      }))

      expect(error.code).toBe('PROFILE_INVALID')
      expect(error.fields).toEqual(['ONERWAY_PROFILE'])
    },
  )

  it.each([undefined, '', '   '])(
    'requires an explicit profile: %s',
    (profile) => {
      const error = capture(() => readProfile({
        ...sandbox,
        ONERWAY_PROFILE: profile,
      }))

      expect(error.code).toBe('PROFILE_MISSING')
      expect(error.fields).toEqual(['ONERWAY_PROFILE'])
    },
  )

  it('rejects an HTTP SDK URL', () => {
    const error = capture(() => readProfile({
      ...sandbox,
      ONERWAY_SANDBOX_SDK_URL: 'http://unsafe.example/sdk.js',
    }))

    expect(error.code).toBe('PROFILE_URL_INVALID')
    expect(error.fields).toEqual(['ONERWAY_SANDBOX_SDK_URL'])
  })

  it('locks Sandbox to the confirmed v4/latest SDK URL', () => {
    const error = capture(() => readProfile({
      ...sandbox,
      ONERWAY_SANDBOX_SDK_URL: 'https://sandbox-checkout-sdk.onerway.com/v4/1.0.1/onerway.js',
    }))

    expect(error.code).toBe('PROFILE_SDK_URL_MISMATCH')
    expect(error.fields).toEqual(['ONERWAY_SANDBOX_SDK_URL'])
  })

  it.each([
    'https://showcase.example/webhook',
    'https://other.example/api/webhooks/onerway/payment',
    'https://showcase.example/api/webhooks/onerway/payment?forward=true',
    'https://showcase.example/api/webhooks/onerway/payment#fragment',
  ])('locks Sandbox notifications to the Showcase webhook path: %s', (notifyUrl) => {
    const error = capture(() => readProfile({
      ...sandbox,
      ONERWAY_SANDBOX_NOTIFY_URL: notifyUrl,
    }))

    expect(error.code).toBe('PROFILE_NOTIFY_URL_MISMATCH')
    expect(error.fields).toEqual(['ONERWAY_SANDBOX_NOTIFY_URL'])
  })

  it('accepts an explicitly enabled external Sandbox notification relay', () => {
    const notifyUrl = 'https://relay.example/onerway/payment'

    expect(readProfile({
      ...sandbox,
      ONERWAY_SANDBOX_NOTIFY_URL: notifyUrl,
      ONERWAY_SANDBOX_NOTIFY_RELAY: 'true',
    })).toMatchObject({ notifyUrl })
  })

  it('rejects relay mode when the notification stays on the canonical origin', () => {
    const error = capture(() => readProfile({
      ...sandbox,
      ONERWAY_SANDBOX_NOTIFY_RELAY: 'true',
    }))

    expect(error.code).toBe('PROFILE_NOTIFY_URL_MISMATCH')
    expect(error.fields).toEqual(['ONERWAY_SANDBOX_NOTIFY_URL'])
  })

  it.each(['1', 'TRUE', ' false', 'true '])(
    'rejects an ambiguous Sandbox notification relay flag: %s',
    (enabled) => {
      const error = capture(() => readProfile({
        ...sandbox,
        ONERWAY_SANDBOX_NOTIFY_RELAY: enabled,
      }))

      expect(error.code).toBe('PROFILE_ENABLED_INVALID')
      expect(error.fields).toEqual(['ONERWAY_SANDBOX_NOTIFY_RELAY'])
    },
  )

  it.each([
    'http://relay.example/onerway/payment',
    'https://127.0.0.1/onerway/payment',
    'https://[::1]/onerway/payment',
    'https://localhost/onerway/payment',
    'https://localhost./onerway/payment',
    'https://edge.localhost/onerway/payment',
    'https://relay.local/onerway/payment',
    'https://relay.local./onerway/payment',
    'https://relay.example/other',
    'https://relay.example/onerway/payment/',
    'https://relay.example/onerway/payment?forward=true',
    'https://relay.example/onerway/payment#fragment',
  ])('rejects an invalid Sandbox notification relay URL: %s', (notifyUrl) => {
    const error = capture(() => readProfile({
      ...sandbox,
      ONERWAY_SANDBOX_NOTIFY_URL: notifyUrl,
      ONERWAY_SANDBOX_NOTIFY_RELAY: 'true',
    }))

    expect(error.code).toBe('PROFILE_URL_INVALID')
    expect(error.fields).toEqual(['ONERWAY_SANDBOX_NOTIFY_URL'])
  })

  it.each([
    'https://showcase.example/path',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://localhost.',
    'https://edge.localhost',
    'https://showcase.local.',
  ])('requires a public canonical Showcase origin: %s', (origin) => {
    const error = capture(() => readProfile({
      ...sandbox,
      ONERWAY_SHOWCASE_ORIGIN: origin,
    }))

    expect(error.code).toBe('PROFILE_URL_INVALID')
    expect(error.fields).toEqual(['ONERWAY_SHOWCASE_ORIGIN'])
  })

  it('accepts an optional server-only Sandbox transaction IP', () => {
    expect(readProfile({
      ...sandbox,
      ONERWAY_SANDBOX_TRANSACTION_IP: '203.0.113.10',
    })).toMatchObject({
      transactionIp: '203.0.113.10',
    })
  })

  it('rejects an invalid Sandbox transaction IP without echoing it', () => {
    const value = 'not-an-ip'
    const error = capture(() => readProfile({
      ...sandbox,
      ONERWAY_SANDBOX_TRANSACTION_IP: value,
    }))

    expect(error.code).toBe('PROFILE_IP_INVALID')
    expect(error.fields).toEqual(['ONERWAY_SANDBOX_TRANSACTION_IP'])
    expect(error.message).not.toContain(value)
  })

  it.each([
    {
      env: sandbox,
      field: 'ONERWAY_SANDBOX_BASE_URL',
      value: 'https://acq.onerway.com',
    },
    {
      env: production,
      field: 'ONERWAY_PRODUCTION_BASE_URL',
      value: 'https://sandbox-acq.onerway.com',
    },
  ])('rejects a cross-environment API base URL: $field', ({ env, field, value }) => {
    const error = capture(() => readProfile({ ...env, [field]: value }))

    expect(error.code).toBe('PROFILE_API_BASE_MISMATCH')
    expect(error.fields).toEqual([field])
  })

  it('does not inspect the inactive Production profile', () => {
    expect(readProfile({
      ...sandbox,
      ONERWAY_PRODUCTION_ENABLED: 'not-a-boolean',
      ONERWAY_PRODUCTION_BASE_URL: 'https://wrong.example',
      ONERWAY_PRODUCTION_SDK_URL: 'not-a-url',
    }).profile).toBe('sandbox')
  })

  it('does not require the inactive Sandbox profile', () => {
    expect(readProfile(production)).toMatchObject({
      profile: 'production',
      transactionPolicy: 'locked',
    })
  })

  it('starts Production locked without credentials or an SDK URL', () => {
    expect(readProfile(production)).toEqual({
      profile: 'production',
      apiBaseUrl: 'https://acq.onerway.com',
      sdkUrl: null,
      notifyUrl: null,
      merchantNo: null,
      appId: null,
      secret: null,
      transactionPolicy: 'locked',
    })
  })

  it('rejects a partially configured Production transaction bundle', () => {
    const error = capture(() => readProfile({
      ...production,
      ONERWAY_PRODUCTION_MERCHANT_NO: 'merchant',
    }))

    expect(error.code).toBe('PROFILE_NOT_READY')
    expect(error.fields).toEqual([
      'ONERWAY_PRODUCTION_SDK_URL',
      'ONERWAY_PRODUCTION_NOTIFY_URL',
      'ONERWAY_PRODUCTION_APP_ID',
      'ONERWAY_PRODUCTION_SECRET',
    ])
  })

  it('keeps a complete Production transaction bundle locked', () => {
    expect(readProfile({
      ...production,
      ONERWAY_PRODUCTION_SDK_URL: 'https://checkout.example/onerway.js',
      ONERWAY_PRODUCTION_NOTIFY_URL: 'https://merchant.example/webhook',
      ONERWAY_PRODUCTION_MERCHANT_NO: 'merchant',
      ONERWAY_PRODUCTION_APP_ID: 'app',
      ONERWAY_PRODUCTION_SECRET: 'secret',
    })).toMatchObject({
      profile: 'production',
      transactionPolicy: 'locked',
    })
  })

  it('fails closed when Production is enabled', () => {
    const error = capture(() => readProfile({
      ...production,
      ONERWAY_PRODUCTION_ENABLED: 'true',
    }))

    expect(error.code).toBe('PROFILE_PRODUCTION_LOCKED')
    expect(error.fields).toEqual(['ONERWAY_PRODUCTION_ENABLED'])
  })

  it.each(['1', 'TRUE', ' false', 'true '])(
    'rejects an ambiguous Production enable value: %s',
    (enabled) => {
      const error = capture(() => readProfile({
        ...production,
        ONERWAY_PRODUCTION_ENABLED: enabled,
      }))

      expect(error.code).toBe('PROFILE_ENABLED_INVALID')
      expect(error.fields).toEqual(['ONERWAY_PRODUCTION_ENABLED'])
    },
  )

  it('rejects public credential variables', () => {
    const exposed = 'do-not-print-this-credential'
    const error = capture(() => readProfile({
      ...sandbox,
      NUXT_PUBLIC_ONERWAY_SANDBOX_SECRET: exposed,
    }))

    expect(error.code).toBe('PROFILE_PUBLIC_CONFIG')
    expect(error.fields).toEqual(['NUXT_PUBLIC_ONERWAY_SANDBOX_SECRET'])
    expect(error.message).not.toContain(exposed)
  })

  it('rejects any public Onerway configuration', () => {
    const error = capture(() => readProfile({
      ...sandbox,
      NUXT_PUBLIC_ONERWAY_PROFILE: 'sandbox',
    }))

    expect(error.code).toBe('PROFILE_PUBLIC_CONFIG')
    expect(error.fields).toEqual(['NUXT_PUBLIC_ONERWAY_PROFILE'])
  })

  it('never includes invalid values in errors', () => {
    const exposed = 'http://contains-sensitive-details.example/sdk.js'
    const error = capture(() => readProfile({
      ...sandbox,
      ONERWAY_SANDBOX_SDK_URL: exposed,
    }))

    expect(error.message).toBe('PROFILE_URL_INVALID:ONERWAY_SANDBOX_SDK_URL')
    expect(error.message).not.toContain(exposed)
  })
})

describe('toPublicProfile', () => {
  it('returns only the explicitly allowed summary shape', () => {
    const summary = toPublicProfile(readProfile(sandbox))

    expect(summary).toEqual({
      profile: 'sandbox',
      environment: 'Sandbox',
      transactionPolicy: 'sandbox-only',
      canonicalOrigin: 'https://showcase.example',
      sdk: {
        url: 'https://sandbox-checkout-sdk.onerway.com/v4/latest/onerway.js?revision=80ee223bc5d3561a729c09901379324186f1c65bcb778be10240fe06f338ed64',
        release: 'v4/latest',
      },
    })
    expect(Object.keys(summary)).toEqual([
      'profile',
      'environment',
      'transactionPolicy',
      'canonicalOrigin',
      'sdk',
    ])
    expect(JSON.stringify(summary)).not.toContain('merchant')
    expect(JSON.stringify(summary)).not.toContain('secret')
    expect(JSON.stringify(summary)).not.toContain('app')
    expect(JSON.stringify(summary)).not.toContain('sandbox-acq.onerway.com')
  })

  it('projects a locked Production summary', () => {
    expect(toPublicProfile(readProfile(production))).toEqual({
      profile: 'production',
      environment: 'Production',
      transactionPolicy: 'locked',
      canonicalOrigin: null,
      sdk: null,
    })
  })
})
