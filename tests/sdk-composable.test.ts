import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SdkSession } from '../shared/payment/sdk'

function session(): SdkSession {
  const attempt = {
    id: 'attempt-1',
    orderId: 'order-1',
    integration: 'web-js-sdk' as const,
    method: 'card' as const,
    status: 'processing' as const,
    paymentId: 'payment-1',
    submissionStartedAt: '2026-08-03T00:00:30.000Z',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  }

  return {
    order: {
      id: 'order-1',
      scene: 'ecommerce',
      item: {
        sku: 'sku-1',
        name: 'Item',
        variant: 'Default',
        quantity: 1,
        unitAmount: { minor: 500, currency: 'USD' },
      },
      amount: { minor: 500, currency: 'USD' },
      createdAt: '2026-08-03T00:00:00.000Z',
    },
    attempt,
    attempts: [attempt],
    events: [],
    paymentId: 'payment-1',
    query: {
      token: 'a'.repeat(43),
      expiresAt: '2026-08-03T00:05:00.000Z',
    },
  }
}

function queried(status: 'processing' | 'succeeded', rawStatus: 'P' | 'S') {
  const current = session()
  const occurredAt = '2026-08-03T00:01:00.000Z'

  return {
    attempt: {
      ...current.attempt,
      status,
      statusSource: 'query' as const,
      transactionId: 'transaction-1',
      updatedAt: occurredAt,
    },
    event: {
      id: `event-query-${rawStatus}`,
      attemptId: current.attempt.id,
      source: 'query' as const,
      status,
      rawStatus,
      transactionId: 'transaction-1',
      occurredAt,
    },
  }
}

function created() {
  const current = session()
  const { submissionStartedAt: _submissionStartedAt, ...attempt } = current.attempt

  return {
    order: current.order,
    attempt,
    attempts: [attempt],
    event: {
      id: 'event-created',
      attemptId: current.attempt.id,
      source: 'server' as const,
      status: 'processing' as const,
      rawStatus: 'U',
      occurredAt: '2026-08-03T00:00:00.000Z',
    },
    paymentId: current.paymentId,
    query: current.query,
  }
}

function unclaimedSession(): SdkSession {
  const current = session()
  const { submissionStartedAt: _submissionStartedAt, ...attempt } = current.attempt

  return { ...current, attempt }
}

function claimedSubmission() {
  return {
    attempt: session().attempt,
    claimed: true,
  }
}

function claimFetch(...responses: unknown[]) {
  const fetch = vi.fn().mockResolvedValueOnce(claimedSubmission())

  for (const response of responses) {
    fetch.mockResolvedValueOnce(response)
  }

  return fetch
}

function browserNavigator(request = vi.fn(async (
  _name: string,
  _options: LockOptions,
  task: () => Promise<unknown>,
) => task())) {
  return {
    javaEnabled: () => false,
    language: 'en-US',
    locks: { request },
  }
}

function stubState(state: Map<string, { value: unknown }>): void {
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!state.has(key)) {
      state.set(key, { value: init() })
    }

    return state.get(key)
  })
  vi.stubGlobal('readonly', <T>(value: T) => value)
  vi.stubGlobal('computed', (read: () => unknown) => ({
    get value() {
      return read()
    },
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('SDK composable lifecycle', () => {
  it('durably claims the first merchant submission before calling confirm', async () => {
    const current = session()
    const { submissionStartedAt: _submissionStartedAt, ...attempt } = current.attempt
    const unclaimed = { ...current, attempt }
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimed }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = vi.fn().mockResolvedValue({
      attempt: {
        ...attempt,
        submissionStartedAt: '2026-08-03T00:00:30.000Z',
      },
      claimed: true,
    })
    const confirm = vi.fn().mockResolvedValue({
      paymentId: 'payment-1',
      paymentStatus: 'O',
    })

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    await sdk.submit(confirm)

    expect(fetch).toHaveBeenCalledWith('/api/payment/submit', {
      method: 'POST',
      body: {
        orderId: 'order-1',
        attemptId: 'attempt-1',
        paymentId: 'payment-1',
      },
    })
    expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0]!)
    expect((state.get('sdk-session')?.value as SdkSession).attempt.submissionStartedAt)
      .toBe('2026-08-03T00:00:30.000Z')
    expect(state.get('sdk-stage')?.value).toBe('ready')
  })

  it('never calls confirm when the durable submission claim is reused', async () => {
    const current = session()
    const { submissionStartedAt: _submissionStartedAt, ...attempt } = current.attempt
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: { ...current, attempt } }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = vi.fn().mockResolvedValue({
      attempt: current.attempt,
      claimed: false,
    })
    const confirm = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    await sdk.submit(confirm)

    expect(confirm).not.toHaveBeenCalled()
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(sdk.submitted.value).toBe(true)
  })

  it('never treats a persisted submission latch as permission after remount', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: session() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = vi.fn()
    const confirm = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    await sdk.submit(confirm)

    expect(confirm).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('already submitted')
    expect(sdk.submitted.value).toBe(true)
  })

  it('restores one authorized persisted attempt as query-only', async () => {
    const state = new Map<string, { value: unknown }>()
    const current = session()
    const fetch = vi.fn().mockResolvedValue({
      ...current,
      submitted: true,
    })

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    await expect(sdk.recover('order-1')).resolves.toBe(true)
    expect(fetch).toHaveBeenCalledWith('/api/payment/recover', {
      query: { orderId: 'order-1' },
    })
    expect((state.get('sdk-session')?.value as SdkSession).attempt.id).toBe('attempt-1')
    expect(sdk.submitted.value).toBe(true)
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
  })

  it('keeps the restoration operation stable while recovery is in flight', async () => {
    const state = new Map<string, { value: unknown }>()
    const current = session()
    let resolveRecovery!: (value: SdkSession & { submitted: boolean }) => void
    const response = new Promise<SdkSession & { submitted: boolean }>((resolve) => {
      resolveRecovery = resolve
    })
    const fetch = vi.fn().mockReturnValue(response)
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const recovery = sdk.recover('order-1')

    expect(sdk.restoring.value).toBe(true)

    resolveRecovery({ ...current, submitted: true })
    await expect(recovery).resolves.toBe(true)
    expect(sdk.restoring.value).toBe(false)
  })

  it('keeps an older composable recovery from overwriting the current owner', async () => {
    const state = new Map<string, { value: unknown }>()
    const current = session()
    const oldAttempt = {
      ...current.attempt,
      id: 'attempt-old',
      orderId: 'order-old',
      paymentId: 'payment-old',
    }
    const old = {
      ...current,
      order: { ...current.order, id: 'order-old' },
      attempt: oldAttempt,
      attempts: [oldAttempt],
      paymentId: 'payment-old',
    }
    let resolveOld!: (value: SdkSession & { submitted: boolean }) => void
    let resolveCurrent!: (value: SdkSession & { submitted: boolean }) => void
    const oldResponse = new Promise<SdkSession & { submitted: boolean }>((resolve) => {
      resolveOld = resolve
    })
    const currentResponse = new Promise<SdkSession & { submitted: boolean }>((resolve) => {
      resolveCurrent = resolve
    })
    const fetch = vi.fn()
      .mockReturnValueOnce(oldResponse)
      .mockReturnValueOnce(currentResponse)

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const oldSdk = useSdk()
    const oldRecovery = oldSdk.recover('order-old')
    const currentSdk = useSdk()
    const currentRecovery = currentSdk.recover('order-1')

    resolveCurrent({ ...current, submitted: true })
    await expect(currentRecovery).resolves.toBe(true)
    resolveOld({ ...old, submitted: true })
    await expect(oldRecovery).resolves.toBe(false)
    expect(currentSdk.restoring.value).toBe(false)
    expect(currentSdk.failure.value).toBeNull()
    expect(currentSdk.session.value?.order.id).toBe('order-1')
    expect(currentSdk.session.value?.attempt.id).toBe('attempt-1')
  })

  it('keeps an older rejected recovery from overwriting the current owner', async () => {
    const state = new Map<string, { value: unknown }>()
    const current = session()
    let rejectOld!: (reason: unknown) => void
    let resolveCurrent!: (value: SdkSession & { submitted: boolean }) => void
    const oldResponse = new Promise<SdkSession & { submitted: boolean }>((_resolve, reject) => {
      rejectOld = reject
    })
    const currentResponse = new Promise<SdkSession & { submitted: boolean }>((resolve) => {
      resolveCurrent = resolve
    })
    const fetch = vi.fn()
      .mockReturnValueOnce(oldResponse)
      .mockReturnValueOnce(currentResponse)

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const oldSdk = useSdk()
    const oldRecovery = oldSdk.recover('order-old')
    const currentSdk = useSdk()
    const currentRecovery = currentSdk.recover('order-1')

    resolveCurrent({ ...current, submitted: true })
    await expect(currentRecovery).resolves.toBe(true)
    rejectOld(new Error('late recovery failure'))
    await expect(oldRecovery).resolves.toBe(false)
    expect(currentSdk.restoring.value).toBe(false)
    expect(currentSdk.failure.value).toBeNull()
    expect(currentSdk.session.value?.order.id).toBe('order-1')
    expect(currentSdk.session.value?.attempt.id).toBe('attempt-1')
  })

  it('prevents an older composable from starting recovery after a newer owner exists', async () => {
    const state = new Map<string, { value: unknown }>()
    const current = session()
    let resolveCurrent!: (value: SdkSession & { submitted: boolean }) => void
    const response = new Promise<SdkSession & { submitted: boolean }>((resolve) => {
      resolveCurrent = resolve
    })
    const fetch = vi.fn().mockReturnValue(response)
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)

    const { useSdk } = await import('../app/composables/useSdk')
    const oldSdk = useSdk()
    const currentSdk = useSdk()
    const currentRecovery = currentSdk.recover('order-1')

    await oldSdk.restore()
    await expect(oldSdk.recover('order-old')).resolves.toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(currentSdk.restoring.value).toBe(true)
    expect(currentSdk.failure.value).toBeNull()

    resolveCurrent({ ...current, submitted: true })
    await expect(currentRecovery).resolves.toBe(true)
    expect(currentSdk.restoring.value).toBe(false)
  })

  it('settles a creating stage when a newer composable takes ownership', async () => {
    const state = new Map<string, { value: unknown }>()
    let resolveIntent!: (value: { orderId: string, create: boolean }) => void
    const response = new Promise<{ orderId: string, create: boolean }>((resolve) => {
      resolveIntent = resolve
    })
    const fetch = vi.fn().mockReturnValue(response)

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('navigator', browserNavigator())

    const { useSdk } = await import('../app/composables/useSdk')
    const oldSdk = useSdk()
    const creation = oldSdk.start('standard-success')
    const currentSdk = useSdk()

    expect(currentSdk.stage.value).toBe('not_completed')
    expect(currentSdk.failure.value).toMatchObject({
      source: 'create',
      action: 'recover_attempt',
    })

    resolveIntent({ orderId: 'order-new', create: true })
    await creation
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(currentSdk.stage.value).toBe('not_completed')
    expect(currentSdk.failure.value?.source).toBe('create')
  })

  it('drops a queued intent request after a newer composable takes ownership', async () => {
    const state = new Map<string, { value: unknown }>()
    let release!: () => void
    const queued = new Promise<void>((resolve) => {
      release = resolve
    })
    const request = vi.fn(async (
      _name: string,
      _options: LockOptions,
      task: () => Promise<unknown> | null,
    ) => {
      await queued
      return task()
    })
    const fetch = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('navigator', browserNavigator(request))

    const { useSdk } = await import('../app/composables/useSdk')
    const oldSdk = useSdk()
    const creation = oldSdk.start('standard-success')

    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    const currentSdk = useSdk()
    release()

    await creation
    expect(fetch).not.toHaveBeenCalled()
    expect(currentSdk.stage.value).toBe('not_completed')
    expect(currentSdk.failure.value?.source).toBe('create')
  })

  it.each(['resolve', 'reject'] as const)('requires recovery when a newer composable takes over an in-flight retry that will %s', async (outcome) => {
    const base = session()
    const parent = {
      ...base.attempt,
      status: 'cancelled' as const,
      statusSource: 'query' as const,
    }
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: { ...base, attempt: parent, attempts: [parent] } }],
      ['sdk-stage', { value: 'not_completed' }],
    ])
    let resolveRetry!: (value: { orderId: string, attemptId: string, create: boolean, reused: boolean }) => void
    let rejectRetry!: (reason: unknown) => void
    const response = new Promise<{ orderId: string, attemptId: string, create: boolean, reused: boolean }>((resolve, reject) => {
      resolveRetry = resolve
      rejectRetry = reject
    })
    const fetch = vi.fn().mockReturnValue(response)
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)

    const { useSdk } = await import('../app/composables/useSdk')
    const oldSdk = useSdk()
    const retry = oldSdk.retry()
    const currentSdk = useSdk()

    expect(currentSdk.retrying.value).toBe(false)
    expect(currentSdk.failure.value).toMatchObject({
      source: 'retry',
      action: 'recover_attempt',
    })
    const snapshot = {
      error: currentSdk.error.value,
      failure: currentSdk.failure.value,
      stage: currentSdk.stage.value,
      attemptId: currentSdk.session.value?.attempt.id,
      retrying: currentSdk.retrying.value,
      restoring: currentSdk.restoring.value,
    }

    await currentSdk.retry()
    expect(fetch).toHaveBeenCalledTimes(1)

    if (outcome === 'resolve') {
      resolveRetry({ orderId: 'order-1', attemptId: 'attempt-2', create: true, reused: false })
    }
    else {
      rejectRetry(new Error('late retry failure'))
    }
    await retry
    expect(fetch).toHaveBeenCalledTimes(1)
    expect({
      error: currentSdk.error.value,
      failure: currentSdk.failure.value,
      stage: currentSdk.stage.value,
      attemptId: currentSdk.session.value?.attempt.id,
      retrying: currentSdk.retrying.value,
      restoring: currentSdk.restoring.value,
    }).toEqual(snapshot)
    expect(navigate).not.toHaveBeenCalled()
  })

  it.each([
    ['processing', '/halden/sdk/order-1'],
    ['cancelled', '/halden/result/order-1'],
  ] as const)('restores a cookie-bound %s attempt without intent or journey input', async (status, path) => {
    const state = new Map<string, { value: unknown }>()
    const current = session()
    const attempt = {
      ...current.attempt,
      status,
      ...(status === 'cancelled' ? { statusSource: 'query' as const } : {}),
    }
    const restored = {
      ...current,
      attempt,
      attempts: [attempt],
      submitted: true,
    }
    const fetch = vi.fn().mockResolvedValue(restored)
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.restore()

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/api/payment/recover', {})
    expect(fetch).not.toHaveBeenCalledWith('/api/payment/intent', expect.anything())
    expect(navigate).toHaveBeenCalledWith(path)
  })

  it('rejects a mismatched recovery response before writing shared state', async () => {
    const state = new Map<string, { value: unknown }>()
    const current = session()
    const attempt = {
      ...current.attempt,
      id: 'attempt-2',
      orderId: 'order-2',
      paymentId: 'payment-2',
    }
    const fetch = vi.fn().mockResolvedValue({
      ...current,
      order: { ...current.order, id: 'order-2' },
      attempt,
      attempts: [attempt],
      paymentId: 'payment-2',
      submitted: true,
    })

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    await expect(sdk.recover('order-1')).resolves.toBe(false)
    expect(sdk.session.value).toBeNull()
    expect(sdk.failure.value).toMatchObject({
      source: 'recovery',
      action: 'retry_restoration',
    })
  })

  it('retries a temporary restoration failure without creating a new order', async () => {
    const state = new Map<string, { value: unknown }>()
    const current = session()
    const fetch = vi.fn()
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce({ ...current, submitted: true })
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    await sdk.restore()
    expect(sdk.failure.value?.action).toBe('retry_restoration')

    await sdk.restore()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/payment/recover', {})
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/payment/recover', {})
    expect(fetch).not.toHaveBeenCalledWith('/api/payment/intent', expect.anything())
    expect(navigate).toHaveBeenCalledWith('/halden/sdk/order-1')
  })

  it('recovers an existing intent without calling provider create again', async () => {
    const state = new Map<string, { value: unknown }>()
    const current = session()
    const fetch = vi.fn()
      .mockResolvedValueOnce({ orderId: 'order-1', create: false })
      .mockResolvedValueOnce({ ...current, submitted: true })
    const navigate = vi.fn()
    const request = vi.fn(async (
      _name: string,
      _options: LockOptions,
      task: () => Promise<unknown>,
    ) => task())

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('navigator', browserNavigator(request))
    vi.stubGlobal('screen', { colorDepth: 24, height: 900, width: 1440 })
    vi.stubGlobal('document', { documentElement: { outerHTML: '<html></html>' } })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.start('standard-success')

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/payment/intent', {
      method: 'POST',
      body: { journeyId: 'standard-success', method: 'card' },
    })
    expect(request).toHaveBeenCalledWith(
      'onerway-payment-intent',
      { mode: 'exclusive' },
      expect.any(Function),
    )
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/payment/recover', {
      query: { orderId: 'order-1' },
    })
    expect(fetch).not.toHaveBeenCalledWith('/api/payment/create', expect.anything())
    expect(navigate).toHaveBeenCalledWith('/halden/sdk/order-1')
  })

  it('requests a separate Sandbox order only for an explicit new test run', async () => {
    const state = new Map<string, { value: unknown }>()
    const fetch = vi.fn()
      .mockResolvedValueOnce({ orderId: 'order-1', create: true })
      .mockResolvedValueOnce(created())
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('navigator', browserNavigator())
    vi.stubGlobal('screen', { colorDepth: 24, height: 900, width: 1440 })
    vi.stubGlobal('document', { documentElement: { outerHTML: '<html></html>' } })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.start('three-ds-success', true)

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/payment/intent', {
      method: 'POST',
      body: { journeyId: 'three-ds-success', method: 'card', restart: true },
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/payment/create', expect.objectContaining({
      method: 'POST',
      signal: expect.any(AbortSignal),
    }))
    expect(navigate).toHaveBeenCalledWith('/halden/sdk/order-1')
  })

  it.each(['google-pay', 'apple-pay'] as const)(
    'sends the server-validated expected method for the shared %s fixture',
    async (method) => {
      const state = new Map<string, { value: unknown }>()
      const response = created()
      const fetch = vi.fn()
        .mockResolvedValueOnce({ orderId: 'order-1', create: true })
        .mockResolvedValueOnce({
          ...response,
          attempt: { ...response.attempt, method },
        })

      stubState(state)
      vi.stubGlobal('onScopeDispose', vi.fn())
      vi.stubGlobal('$fetch', fetch)
      vi.stubGlobal('navigateTo', vi.fn())
      vi.stubGlobal('navigator', browserNavigator())
      vi.stubGlobal('screen', { colorDepth: 24, height: 900, width: 1440 })
      vi.stubGlobal('document', { documentElement: { outerHTML: '<html></html>' } })

      const { useSdk } = await import('../app/composables/useSdk')
      await useSdk().start('standard-success', true, method)

      expect(fetch).toHaveBeenNthCalledWith(1, '/api/payment/intent', {
        method: 'POST',
        body: { journeyId: 'standard-success', method, restart: true },
      })
      expect((state.get('sdk-session')?.value as SdkSession).attempt.method).toBe(method)
    },
  )

  it('fails closed before creating an intent when cross-tab locking is unavailable', async () => {
    const state = new Map<string, { value: unknown }>()
    const fetch = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('navigator', { javaEnabled: () => false, language: 'en-US' })
    vi.stubGlobal('screen', { colorDepth: 24, height: 900, width: 1440 })
    vi.stubGlobal('document', { documentElement: { outerHTML: '<html></html>' } })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.start('standard-success')

    expect(fetch).not.toHaveBeenCalled()
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
  })


  it('renders the stored Webhook terminal projection when a later query fact is still open', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: session() }],
      ['sdk-stage', { value: 'not_completed' }],
    ])
    const response = queried('processing', 'P')
    const fetch = vi.fn().mockResolvedValue({
      ...response,
      attempt: {
        ...response.attempt,
        status: 'succeeded',
        statusSource: 'webhook',
      },
    })
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.verify(1)

    expect((state.get('sdk-session')?.value as SdkSession).attempt.status).toBe('succeeded')
    expect(state.get('sdk-stage')?.value).toBe('succeeded')
    expect(navigate).toHaveBeenCalledWith('/halden/result/order-1', { replace: true })
  })

  it('retries partial terminal Apple Pay attribution with a fresh payment query', async () => {
    const base = session()
    const terminalAttempt = {
      ...base.attempt,
      status: 'succeeded' as const,
      statusSource: 'query' as const,
      method: 'apple-pay' as const,
      transactionId: '9000000000000000002',
      actualWallet: 'apple-pay' as const,
      attributionTransactionId: '9000000000000000002',
    }
    const current = { ...base, attempt: terminalAttempt, attempts: [terminalAttempt] }
    const attributedAttempt = {
      ...terminalAttempt,
      actualWallet: 'apple-pay' as const,
      fundingNetwork: 'VISA',
      attributionTransactionId: terminalAttempt.transactionId,
    }
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: current }],
      ['sdk-stage', { value: 'succeeded' }],
    ])
    const fetch = vi.fn().mockResolvedValue({
      ...queried('succeeded', 'S'),
      attempt: attributedAttempt,
    })
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.verify(1, false)

    expect(fetch).toHaveBeenCalledWith('/api/payment/query', expect.objectContaining({
      body: expect.objectContaining({ attemptId: 'attempt-1', paymentId: 'payment-1' }),
    }))
    expect((state.get('sdk-session')?.value as SdkSession).attempt).toMatchObject({
      actualWallet: 'apple-pay',
      fundingNetwork: 'VISA',
      attributionTransactionId: '9000000000000000002',
    })
    expect(navigate).not.toHaveBeenCalled()
  })


  it('discards an in-flight query response and restores retry state after disposal', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: session() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    let dispose = () => {}
    let resolveQuery!: (value: unknown) => void
    const query = new Promise(resolve => resolveQuery = resolve)
    const fetch = vi.fn(() => query)
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', (callback: () => void) => dispose = callback)
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const running = sdk.verify(2)

    expect(state.get('sdk-stage')?.value).toBe('verifying')
    dispose()
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('verification was paused')

    resolveQuery(queried('succeeded', 'S'))
    await running

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
    expect((state.get('sdk-session')?.value as SdkSession).events).toHaveLength(0)
  })

  it('discards a create response after the owning page is disposed', async () => {
    const state = new Map<string, { value: unknown }>()
    let dispose = () => {}
    let resolveCreate!: (value: ReturnType<typeof created>) => void
    const request = new Promise<ReturnType<typeof created>>(resolve => resolveCreate = resolve)
    const fetch = vi.fn()
      .mockResolvedValueOnce({ orderId: 'order-1', create: true })
      .mockImplementationOnce(() => request)
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', (callback: () => void) => dispose = callback)
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('navigator', browserNavigator())
    vi.stubGlobal('screen', { colorDepth: 24, height: 900, width: 1440 })
    vi.stubGlobal('document', { documentElement: { outerHTML: '<html></html>' } })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const running = sdk.start('three-ds-success')

    expect(state.get('sdk-stage')?.value).toBe('creating')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    dispose()
    expect(state.get('sdk-stage')?.value).toBe('not_completed')

    resolveCreate(created())
    await running

    expect(fetch.mock.calls[0]).toEqual(['/api/payment/intent', {
      method: 'POST',
      body: { journeyId: 'three-ds-success', method: 'card' },
    }])
    expect((fetch.mock.calls[1]?.[1] as { signal?: AbortSignal }).signal?.aborted).toBe(true)
    expect(state.get('sdk-session')?.value).toBeNull()
    expect(navigate).not.toHaveBeenCalled()

    fetch
      .mockResolvedValueOnce({ orderId: 'order-1', create: false })
      .mockResolvedValueOnce({ ...session(), submitted: true })

    const restored = useSdk()
    await restored.start('three-ds-success')

    expect(fetch.mock.calls.filter(([path]) => path === '/api/payment/create')).toHaveLength(1)
    expect((state.get('sdk-session')?.value as SdkSession).attempt.id).toBe('attempt-1')
    expect(navigate).toHaveBeenCalledWith('/halden/sdk/order-1')
  })

  it('records a browser return before restoring the same attempt as query-only', async () => {
    const state = new Map<string, { value: unknown }>()
    const current = session()
    const fetch = vi.fn()
      .mockResolvedValueOnce({ duplicate: false })
      .mockResolvedValueOnce({ ...current, submitted: true })

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    await expect(sdk.recover('order-1', true)).resolves.toBe(true)
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/payment/return', {
      method: 'POST',
      body: { orderId: 'order-1' },
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/payment/recover', {
      query: { orderId: 'order-1' },
    })
    expect(sdk.submitted.value).toBe(true)
  })

  it('classifies return restoration failures without exposing raw server errors', async () => {
    const state = new Map<string, { value: unknown }>()
    const fetch = vi.fn()
      .mockRejectedValueOnce({ statusCode: 504, data: { raw: 'must-not-pass-through' } })
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockRejectedValueOnce({ statusCode: 504 })
      .mockRejectedValueOnce({ response: { status: 401 } })

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    await expect(sdk.recover('order-1', true)).resolves.toBe(false)
    expect(sdk.recoveryFailure.value).toBe('retryable')
    expect(sdk.recoveryError.value).toContain('Retry restoration')
    expect(sdk.recoveryError.value).not.toContain('must-not-pass-through')
    expect(sdk.failure.value).toMatchObject({ action: 'retry_restoration' })
    expect(state.get('sdk-error')?.value).not.toContain('must-not-pass-through')

    await expect(sdk.recover('order-1', true)).resolves.toBe(false)
    expect(sdk.recoveryFailure.value).toBe('unauthorized')
    expect(sdk.recoveryError.value).toContain('No authorized persisted payment attempt')

    fetch.mockRejectedValueOnce({ statusCode: 403 })
    await expect(sdk.recover('order-1')).resolves.toBe(false)
    expect(sdk.recoveryFailure.value).toBe('unauthorized')
  })

  it('keeps a disposed in-flight submission query-only when confirm resolves late', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    let dispose = () => {}
    let resolveConfirm!: (value: unknown) => void
    const confirm = vi.fn(() => new Promise(resolve => resolveConfirm = resolve))
    const fetch = claimFetch()

    stubState(state)
    vi.stubGlobal('onScopeDispose', (callback: () => void) => dispose = callback)
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const running = sdk.submit(confirm)

    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce())

    expect(state.get('sdk-stage')?.value).toBe('submitting')
    expect(sdk.submitted.value).toBe(true)
    dispose()
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('submission was paused')

    resolveConfirm({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'S',
    })
    await running

    expect(fetch).toHaveBeenCalledOnce()
    expect((state.get('sdk-session')?.value as SdkSession).events).toHaveLength(0)
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(sdk.submitted.value).toBe(true)

    fetch.mockResolvedValueOnce(queried('processing', 'P'))
    const restored = useSdk()
    await restored.verify(1)

    expect(fetch).toHaveBeenCalledWith('/api/payment/query', expect.objectContaining({
      body: expect.objectContaining({ attemptId: 'attempt-1', paymentId: 'payment-1' }),
    }))
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(restored.submitted.value).toBe(true)
  })

  it('keeps an active attempt query-only when confirm rejects without a trusted result', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', claimFetch())
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.submit(() => Promise.reject(new Error('CARD_INVALID')))

    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('result is unknown')
    expect(sdk.submitted.value).toBe(true)
  })

  it.each([
    ['PresentToShopper', 'awaiting_action'],
    ['RedirectShopper', 'redirecting'],
  ] as const)('preserves Checkout for confirm R with %s', async (nextAction, expectedStage) => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = claimFetch()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: () => 'event-client-r' })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.submit(() => Promise.resolve({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'R',
      nextAction: { type: nextAction },
      rawResult: { cardNumber: 'must-not-pass-through' },
    }))

    const current = state.get('sdk-session')?.value as SdkSession

    expect(state.get('sdk-stage')?.value).toBe(expectedStage)
    expect(sdk.submitted.value).toBe(true)
    expect(current.attempt.status).toBe('requires_action')
    expect(current.events).toEqual([expect.objectContaining({
      id: 'event-client-r',
      source: 'client',
      status: 'requires_action',
      rawStatus: 'R',
    })])
    expect(current.events[0]).not.toHaveProperty('rawResult')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('keeps R without a browser action query-only instead of pretending a presenter opened', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = claimFetch()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: () => 'event-client-r' })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.submit(() => Promise.resolve({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'R',
    }))

    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('did not provide a browser action')
    expect(sdk.submitted.value).toBe(true)
    expect((state.get('sdk-session')?.value as SdkSession).attempt.status).toBe('requires_action')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('retries an SDK O result with the same payment and Checkout', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = claimFetch(queried('succeeded', 'S'))
    const confirm = vi.fn()
      .mockResolvedValueOnce({
        paymentId: 'payment-1',
        paymentMethod: 'VISA',
        paymentStatus: 'O',
      })
      .mockResolvedValueOnce({
        paymentId: 'payment-1',
        paymentMethod: 'VISA',
        paymentStatus: 'S',
      })
    let sequence = 0

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: () => `event-client-${sequence += 1}` })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    await sdk.submit(confirm)

    expect(state.get('sdk-stage')?.value).toBe('ready')
    expect(state.get('sdk-error')?.value).toContain('same payment')
    expect(sdk.submitted.value).toBe(false)
    expect((state.get('sdk-session')?.value as SdkSession).paymentId).toBe('payment-1')
    expect(fetch).toHaveBeenCalledOnce()

    await sdk.submit(confirm)

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(state.get('sdk-stage')?.value).toBe('succeeded')
  })

  it('buffers a presenter callback until merchant confirm establishes PresentToShopper', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    let resolveConfirm!: (value: unknown) => void
    const confirm = () => new Promise(resolve => resolveConfirm = resolve)
    const fetch = claimFetch()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    let sequence = 0
    vi.stubGlobal('crypto', { randomUUID: () => `event-client-${sequence += 1}` })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const running = sdk.submit(confirm)

    await vi.waitFor(() => expect(resolveConfirm).toBeTypeOf('function'))

    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      reason: { type: 'canceled', code: 'must-not-pass-through' },
    })
    resolveConfirm({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'R',
      nextAction: { type: 'PresentToShopper' },
    })
    await running

    const current = state.get('sdk-session')?.value as SdkSession

    expect(state.get('sdk-stage')?.value).toBe('ready')
    expect(state.get('sdk-error')?.value).toContain('closed')
    expect(sdk.submitted.value).toBe(false)
    expect(current.events).toHaveLength(1)
    expect(current.events[0]).toEqual(expect.objectContaining({
      source: 'client',
      status: 'requires_action',
      rawStatus: 'R',
    }))
    expect(current.events.every(event => !('reason' in event))).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('accepts payment_result after a current-page R action and then verifies on the server', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = claimFetch(queried('succeeded', 'S'))
    const navigate = vi.fn()
    let sequence = 0

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('crypto', { randomUUID: () => `event-client-${sequence += 1}` })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.submit(() => Promise.resolve({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'R',
      nextAction: { type: 'PresentToShopper' },
    }))
    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'S',
    })

    expect(fetch).toHaveBeenCalledWith('/api/payment/query', expect.anything())
    expect(state.get('sdk-stage')?.value).toBe('succeeded')
    expect(navigate).toHaveBeenCalledWith('/halden/result/order-1', { replace: true })
  })

  it('does not let an early payment_result suppress merchant confirm RedirectShopper', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    let resolveConfirm!: (value: unknown) => void
    const confirm = () => new Promise(resolve => resolveConfirm = resolve)
    const fetch = claimFetch()
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('crypto', { randomUUID: () => 'event-client-result' })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const running = sdk.submit(confirm)

    await vi.waitFor(() => expect(resolveConfirm).toBeTypeOf('function'))

    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'S',
    })
    resolveConfirm({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'R',
      nextAction: { type: 'RedirectShopper' },
    })
    await running

    const current = state.get('sdk-session')?.value as SdkSession

    expect(current.attempt.status).toBe('requires_action')
    expect(current.events).toEqual([expect.objectContaining({
      source: 'client',
      status: 'requires_action',
      rawStatus: 'R',
    })])
    expect(state.get('sdk-stage')?.value).toBe('redirecting')
    expect(fetch).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ignores payment_result after merchant confirm establishes RedirectShopper', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = claimFetch()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: () => 'event-client-r' })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.submit(() => Promise.resolve({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'R',
      nextAction: { type: 'RedirectShopper' },
    }))
    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'S',
    })

    expect((state.get('sdk-session')?.value as SdkSession).events).toEqual([
      expect.objectContaining({ rawStatus: 'R', status: 'requires_action' }),
    ])
    expect(state.get('sdk-stage')?.value).toBe('redirecting')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('keeps the submission latch when confirm rejects after disposal', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    let dispose = () => {}
    let rejectConfirm!: (reason: unknown) => void
    const confirm = () => new Promise((_, reject) => rejectConfirm = reject)

    stubState(state)
    vi.stubGlobal('onScopeDispose', (callback: () => void) => dispose = callback)
    vi.stubGlobal('$fetch', claimFetch())
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const running = sdk.submit(confirm)

    await vi.waitFor(() => expect(rejectConfirm).toBeTypeOf('function'))

    dispose()
    rejectConfirm(new Error('SDK_DISPOSED'))
    await running

    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('submission was paused')
    expect(sdk.submitted.value).toBe(true)
  })

  it('does not let a buffered callback mask an unknown merchant confirm result', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    let rejectConfirm!: (reason: unknown) => void
    const confirm = () => new Promise((_, reject) => rejectConfirm = reject)
    const fetch = claimFetch()
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('crypto', { randomUUID: () => 'event-client' })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const running = sdk.submit(confirm)

    await vi.waitFor(() => expect(rejectConfirm).toBeTypeOf('function'))
    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'S',
    })

    rejectConfirm(new Error('SDK_CONFIRM_REJECTED'))
    await running

    expect((state.get('sdk-session')?.value as SdkSession).events).toHaveLength(0)
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('result is unknown')
    expect(sdk.submitted.value).toBe(true)
    expect(fetch).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ignores payment_result after merchant confirm becomes query-only unknown', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = claimFetch()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.submit(() => Promise.reject(new Error('SDK_CONFIRM_REJECTED')))
    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'S',
    })

    expect((state.get('sdk-session')?.value as SdkSession).events).toHaveLength(0)
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('result is unknown')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('keeps an unrecognized callback query-only when confirm rejects afterwards', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    let rejectConfirm!: (reason: unknown) => void
    const confirm = () => new Promise((_, reject) => rejectConfirm = reject)

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', claimFetch())
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const running = sdk.submit(confirm)

    await vi.waitFor(() => expect(rejectConfirm).toBeTypeOf('function'))
    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentStatus: 'UNKNOWN',
    })

    rejectConfirm(new Error('SDK_CONFIRM_REJECTED'))
    await running

    expect((state.get('sdk-session')?.value as SdkSession).events).toHaveLength(0)
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('result is unknown')
    expect(sdk.submitted.value).toBe(true)
  })

  it('keeps PresentToShopper query-only when its early callback is unrecognized', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    let resolveConfirm!: (value: unknown) => void
    const confirm = () => new Promise(resolve => resolveConfirm = resolve)
    const fetch = claimFetch()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: () => 'event-client-r' })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const running = sdk.submit(confirm)

    await vi.waitFor(() => expect(resolveConfirm).toBeTypeOf('function'))
    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentStatus: 'UNKNOWN',
    })
    resolveConfirm({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'R',
      nextAction: { type: 'PresentToShopper' },
    })
    await running

    expect((state.get('sdk-session')?.value as SdkSession).events).toEqual([
      expect.objectContaining({ rawStatus: 'R', status: 'requires_action' }),
    ])
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('Verify the existing payment')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    ['S', 'P'],
    ['P', 'S'],
  ] as const)('does not choose between conflicting early callbacks in %s then %s order', async (first, second) => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    let resolveConfirm!: (value: unknown) => void
    const confirm = () => new Promise(resolve => resolveConfirm = resolve)
    const fetch = claimFetch()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: () => 'event-client-r' })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const running = sdk.submit(confirm)

    await vi.waitFor(() => expect(resolveConfirm).toBeTypeOf('function'))
    await sdk.acceptResult({ paymentId: 'payment-1', paymentMethod: 'VISA', paymentStatus: first })
    await sdk.acceptResult({ paymentId: 'payment-1', paymentMethod: 'VISA', paymentStatus: second })
    resolveConfirm({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      paymentStatus: 'R',
      nextAction: { type: 'PresentToShopper' },
    })
    await running

    expect((state.get('sdk-session')?.value as SdkSession).events).toEqual([
      expect.objectContaining({ rawStatus: 'R', status: 'requires_action' }),
    ])
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('Verify the existing payment')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('accepts payment_result directly for an SDK-owned Apple Pay button', async () => {
    const current = session()
    const attempt = { ...current.attempt, method: 'apple-pay' as const }
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: { ...current, attempt, attempts: [attempt] } }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = vi.fn().mockResolvedValueOnce(queried('succeeded', 'S'))
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('crypto', { randomUUID: () => 'event-client-wallet' })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentMethod: 'ApplePay',
      paymentStatus: 'S',
    })

    expect(fetch).toHaveBeenCalledWith('/api/payment/query', expect.anything())
    expect((state.get('sdk-session')?.value as SdkSession).events[0]).toEqual(expect.objectContaining({
      source: 'client',
      status: 'processing',
      rawStatus: 'S',
    }))
    expect(state.get('sdk-stage')?.value).toBe('succeeded')
    expect(navigate).toHaveBeenCalledWith('/halden/result/order-1', { replace: true })
  })

  it('accepts a second SDK-owned result after cancellation on the same Checkout', async () => {
    const current = session()
    const attempt = { ...current.attempt, method: 'apple-pay' as const }
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: { ...current, attempt, attempts: [attempt] } }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = vi.fn().mockResolvedValueOnce(queried('succeeded', 'S'))

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('crypto', { randomUUID: () => 'event-client-apple-retry' })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentMethod: 'ApplePay',
      reason: { type: 'canceled', code: 'presenter_closed' },
    })

    expect(state.get('sdk-stage')?.value).toBe('ready')
    expect((state.get('sdk-session')?.value as SdkSession).events).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()

    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentMethod: 'ApplePay',
      paymentStatus: 'S',
    })

    expect(fetch).toHaveBeenCalledOnce()
    expect((state.get('sdk-session')?.value as SdkSession).events).toEqual([
      expect.objectContaining({ source: 'client', status: 'processing', rawStatus: 'S' }),
      expect.objectContaining({ source: 'query', status: 'succeeded', rawStatus: 'S' }),
    ])
    expect(state.get('sdk-stage')?.value).toBe('succeeded')
  })

  it('shows a sanitized SDK diagnostic without inventing processing', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: session() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.acceptResult({
      paymentId: 'payment-1',
      paymentMethod: 'GooglePay',
      reason: {
        type: 'sdk_error',
        code: 'SDK_TIMEOUT',
        message: 'Timed out for customer@test.com with secret=must-not-pass-through',
      },
      rawResult: { secret: 'must-not-pass-through' },
    })

    expect((state.get('sdk-session')?.value as SdkSession).events).toHaveLength(0)
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(state.get('sdk-error')?.value).toContain('SDK')
    expect(state.get('sdk-error')?.value).toContain('SDK_TIMEOUT')
    expect(state.get('sdk-error')?.value).toContain('[redacted-sensitive-details]')
    expect(state.get('sdk-error')?.value).not.toContain('customer@test.com')
    expect(state.get('sdk-error')?.value).not.toContain('must-not-pass-through')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows a sanitized merchant confirm API diagnostic', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = claimFetch()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.submit(() => Promise.resolve({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      reason: {
        type: 'api_error',
        code: '40000',
        message: 'Invalid transaction URL',
      },
      rawResult: {
        respCode: '40000',
        respMsg: 'provider payload must not pass through',
        data: null,
      },
    }))

    const message = String(state.get('sdk-error')?.value)

    expect((state.get('sdk-session')?.value as SdkSession).events).toHaveLength(0)
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(message).toContain('Invalid transaction URL')
    expect(message).toContain('40000')
    expect(message).toContain('API error')
    expect(message).toContain('returnUrl')
    expect(message).toContain('notifyUrl')
    expect(message).toContain('not the final payment status')
    expect(message).not.toContain('provider payload must not pass through')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('shows a generic sanitized diagnostic from allowlisted raw result fallback fields', async () => {
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: unclaimedSession() }],
      ['sdk-stage', { value: 'ready' }],
    ])
    const fetch = claimFetch()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.submit(() => Promise.resolve({
      paymentId: 'payment-1',
      paymentMethod: 'VISA',
      rawResult: {
        respCode: '40000',
        respMsg: 'Invalid transaction URL',
        data: { secret: 'must-not-pass-through' },
      },
    }))

    const message = String(state.get('sdk-error')?.value)

    expect((state.get('sdk-session')?.value as SdkSession).events).toHaveLength(0)
    expect(state.get('sdk-stage')?.value).toBe('not_completed')
    expect(message).toContain('Onerway payment error 40000')
    expect(message).toContain('Invalid transaction URL')
    expect(message).toContain('not the final payment status')
    expect(message).not.toContain('API error')
    expect(message).not.toContain('must-not-pass-through')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('reloads a failed Element with the same payment and no network mutation', async () => {
    const current = unclaimedSession()
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: current }],
      ['sdk-stage', { value: 'loading' }],
    ])
    const fetch = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()

    sdk.loadFailed()
    expect(sdk.failure.value).toMatchObject({ action: 'reload_element' })
    sdk.reloadElement()

    expect(sdk.elementRevision.value).toBe(1)
    expect(state.get('sdk-stage')?.value).toBe('loading')
    expect((state.get('sdk-session')?.value as SdkSession).paymentId).toBe('payment-1')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['submitting', 'submitting'],
    ['awaiting action', 'awaiting_action'],
    ['terminal', 'succeeded'],
  ] as const)('ignores a late Element error while %s', async (_label, stage) => {
    const base = stage === 'succeeded'
      ? {
          ...session(),
          attempt: { ...session().attempt, status: 'succeeded' as const },
        }
      : unclaimedSession()
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: base }],
      ['sdk-stage', { value: stage }],
      ['sdk-submitted-attempt', { value: stage === 'succeeded' ? null : base.attempt.id }],
    ])

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', vi.fn())
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    sdk.loadFailed()

    expect(state.get('sdk-stage')?.value).toBe(stage)
    expect(sdk.failure.value).toBeNull()
    expect(sdk.elementRevision.value).toBe(0)
  })

  it('refreshes an expired query capability once before verifying the same attempt', async () => {
    const current = session()
    const recovered = {
      ...current,
      query: { token: 'b'.repeat(43), expiresAt: '2026-08-03T00:10:00.000Z' },
      submitted: true,
    }
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: current }],
      ['sdk-stage', { value: 'not_completed' }],
    ])
    const fetch = vi.fn()
      .mockRejectedValueOnce({ statusCode: 403 })
      .mockResolvedValueOnce(recovered)
      .mockResolvedValueOnce(queried('succeeded', 'S'))

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.verify(1)

    expect(fetch).toHaveBeenNthCalledWith(2, '/api/payment/recover', {
      query: { orderId: 'order-1' },
    })
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/payment/query', expect.objectContaining({
      body: expect.objectContaining({ token: 'b'.repeat(43) }),
    }))
    expect(state.get('sdk-stage')?.value).toBe('succeeded')
  })

  it('creates one linked retry child and opens its existing Payment', async () => {
    const base = session()
    const parent = {
      ...base.attempt,
      status: 'cancelled' as const,
      statusSource: 'query' as const,
    }
    const current = { ...base, attempt: parent, attempts: [parent] }
    const { submissionStartedAt: _submissionStartedAt, ...childBase } = parent
    const child = {
      ...childBase,
      id: 'attempt-2',
      status: 'processing' as const,
      statusSource: 'server' as const,
      retryOf: parent.id,
      paymentId: 'payment-2',
    }
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: current }],
      ['sdk-stage', { value: 'not_completed' }],
    ])
    const fetch = vi.fn()
      .mockResolvedValueOnce({ orderId: 'order-1', attemptId: 'attempt-2', create: true, reused: false })
      .mockResolvedValueOnce({
        order: current.order,
        attempt: child,
        attempts: [parent, child],
        event: {
          id: 'event-created-2',
          attemptId: child.id,
          source: 'server',
          status: 'processing',
          rawStatus: 'U',
          occurredAt: '2026-08-03T00:02:00.000Z',
        },
        paymentId: 'payment-2',
        query: { token: 'c'.repeat(43), expiresAt: '2026-08-03T00:10:00.000Z' },
      })
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('navigator', { javaEnabled: () => false, language: 'en-US' })
    vi.stubGlobal('screen', { colorDepth: 24, height: 900, width: 1440 })
    vi.stubGlobal('document', { documentElement: { outerHTML: '<html></html>' } })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.retry()

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/payment/retry', {
      method: 'POST',
      body: { orderId: 'order-1', attemptId: 'attempt-1', paymentId: 'payment-1' },
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/payment/create', expect.objectContaining({ method: 'POST' }))
    expect((state.get('sdk-session')?.value as SdkSession).attempt.id).toBe('attempt-2')
    expect((state.get('sdk-session')?.value as SdkSession).attempts).toHaveLength(2)
    expect(navigate).toHaveBeenCalledWith('/halden/sdk/order-1')
  })

  it.each([
    ['missing retry lineage', undefined, true],
    ['wrong retry lineage', 'attempt-other', true],
    ['missing parent history', 'attempt-1', false],
  ] as const)('rejects retry creation with %s', async (_label, retryOf, includesParent) => {
    const base = session()
    const parent = {
      ...base.attempt,
      status: 'cancelled' as const,
      statusSource: 'query' as const,
    }
    const { submissionStartedAt: _submissionStartedAt, ...childBase } = parent
    const child = {
      ...childBase,
      id: 'attempt-2',
      status: 'processing' as const,
      statusSource: 'server' as const,
      ...(retryOf ? { retryOf } : {}),
      paymentId: 'payment-2',
    }
    const response = {
      order: base.order,
      attempt: child,
      attempts: includesParent ? [parent, child] : [child],
      event: {
        id: 'event-created-2',
        attemptId: child.id,
        source: 'server' as const,
        status: 'processing' as const,
        rawStatus: 'U',
        occurredAt: '2026-08-03T00:02:00.000Z',
      },
      paymentId: 'payment-2',
      query: { token: 'c'.repeat(43), expiresAt: '2026-08-03T00:10:00.000Z' },
    }
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: { ...base, attempt: parent, attempts: [parent] } }],
      ['sdk-stage', { value: 'not_completed' }],
    ])
    const fetch = vi.fn()
      .mockResolvedValueOnce({ orderId: 'order-1', attemptId: 'attempt-2', create: true, reused: false })
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce({ statusCode: 503 })

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('navigator', { javaEnabled: () => false, language: 'en-US' })
    vi.stubGlobal('screen', { colorDepth: 24, height: 900, width: 1440 })
    vi.stubGlobal('document', { documentElement: { outerHTML: '<html></html>' } })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.retry()

    expect(sdk.session.value?.attempt.id).toBe(parent.id)
    expect(sdk.failure.value).toMatchObject({ source: 'retry', action: 'recover_attempt' })
  })

  it.each([
    ['direct child', true, 'processing', '/halden/sdk/order-1'],
    ['terminal parent fallback', false, 'succeeded', '/halden/result/order-1'],
  ] as const)('does not downgrade a verified %s while navigation mounts the next owner', async (_label, create, status, path) => {
    const base = session()
    const parent = {
      ...base.attempt,
      status: 'cancelled' as const,
      statusSource: 'query' as const,
    }
    const { submissionStartedAt: _submissionStartedAt, ...childBase } = parent
    const child = {
      ...childBase,
      id: 'attempt-2',
      status: 'processing' as const,
      statusSource: 'server' as const,
      retryOf: parent.id,
      paymentId: 'payment-2',
    }
    const fallback = {
      ...parent,
      status: 'succeeded' as const,
      statusSource: 'query' as const,
    }
    const restored = create
      ? {
          order: base.order,
          attempt: child,
          attempts: [parent, child],
          event: {
            id: 'event-created-2',
            attemptId: child.id,
            source: 'server' as const,
            status: 'processing' as const,
            rawStatus: 'U',
            occurredAt: '2026-08-03T00:02:00.000Z',
          },
          paymentId: 'payment-2',
          query: { token: 'c'.repeat(43), expiresAt: '2026-08-03T00:10:00.000Z' },
        }
      : { ...base, attempt: fallback, attempts: [fallback], submitted: true }
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: { ...base, attempt: parent, attempts: [parent] } }],
      ['sdk-stage', { value: 'not_completed' }],
    ])
    let finishNavigation!: () => void
    const navigation = new Promise<void>(resolve => finishNavigation = resolve)
    const fetch = vi.fn()
      .mockResolvedValueOnce({ orderId: 'order-1', attemptId: 'attempt-2', create, reused: !create })
      .mockResolvedValueOnce(restored)
    const navigate = vi.fn(() => navigation)

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('navigator', { javaEnabled: () => false, language: 'en-US' })
    vi.stubGlobal('screen', { colorDepth: 24, height: 900, width: 1440 })
    vi.stubGlobal('document', { documentElement: { outerHTML: '<html></html>' } })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    const retry = sdk.retry()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(path))
    expect(sdk.retrying.value).toBe(false)
    expect(sdk.restoring.value).toBe(false)
    expect(sdk.failure.value).toBeNull()
    const current = useSdk()

    expect(current.retrying.value).toBe(false)
    expect(current.failure.value).toBeNull()
    expect(current.session.value?.attempt.status).toBe(status)

    finishNavigation()
    await retry
    expect(current.failure.value).toBeNull()
  })

  it('requires restoration when retry creation and automatic recovery are both unknown', async () => {
    const base = session()
    const parent = {
      ...base.attempt,
      status: 'cancelled' as const,
      statusSource: 'query' as const,
    }
    const state = new Map<string, { value: unknown }>([
      ['sdk-session', { value: { ...base, attempt: parent } }],
      ['sdk-stage', { value: 'not_completed' }],
    ])
    const fetch = vi.fn()
      .mockResolvedValueOnce({ orderId: 'order-1', attemptId: 'attempt-2', create: true, reused: false })
      .mockRejectedValueOnce(new Error('response lost'))
      .mockRejectedValueOnce({ statusCode: 503 })

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('navigator', { javaEnabled: () => false, language: 'en-US' })
    vi.stubGlobal('screen', { colorDepth: 24, height: 900, width: 1440 })
    vi.stubGlobal('document', { documentElement: { outerHTML: '<html></html>' } })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.retry()

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sdk.failure.value).toMatchObject({
      source: 'retry',
      action: 'recover_attempt',
    })
    expect((state.get('sdk-session')?.value as SdkSession).attempt.id).toBe(parent.id)
  })

  it('navigates an existing retained subscription without creating another payment', async () => {
    const state = new Map<string, { value: unknown }>()
    const fetch = vi.fn()
      .mockResolvedValueOnce({ orderId: 'order-1', create: false, existing: true })
      .mockResolvedValueOnce({
        retained: true,
        orderId: 'order-1',
        paymentStatus: 'succeeded',
        subscription: {
          planId: 'halden-daily-essentials-v1',
          productName: 'Halden Daily Essentials',
          amount: { minor: 500, currency: 'USD' },
          frequencyType: 'D',
          frequencyPoint: 1,
          expireDate: '2099-12-31',
          state: 'active',
          statusSource: 'query',
        },
      })
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('navigator', browserNavigator())

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.startSubscription('halden-daily-essentials-v1')

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/payment/subscription/intent', {
      method: 'POST',
      body: { planId: 'halden-daily-essentials-v1' },
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/payment/recover', {
      query: { orderId: 'order-1' },
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenCalledWith('/halden/result/order-1')
    expect(sdk.session.value).toBeNull()
    expect(sdk.subscription.value?.state).toBe('active')
    expect(sdk.retainedSubscriptionOrderId.value).toBe('order-1')
    expect(sdk.failure.value).toBeNull()
  })

  it('requests a separate server-owned customer for an explicit Sandbox replay', async () => {
    const state = new Map<string, { value: unknown }>()
    const subscription = {
      planId: 'halden-daily-essentials-v1' as const,
      productName: 'Halden Daily Essentials',
      amount: { minor: 500, currency: 'USD' as const },
      frequencyType: 'D' as const,
      frequencyPoint: 1,
      expireDate: '2099-12-31',
      state: 'pending' as const,
      statusSource: 'placeholder' as const,
    }
    const fetch = vi.fn()
      .mockResolvedValueOnce({ orderId: 'order-1', create: true, existing: false })
      .mockResolvedValueOnce({ ...created(), subscription })
    const navigate = vi.fn()

    stubState(state)
    vi.stubGlobal('onScopeDispose', vi.fn())
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('navigator', browserNavigator())
    vi.stubGlobal('screen', { colorDepth: 24, height: 900, width: 1440 })
    vi.stubGlobal('document', { documentElement: { outerHTML: '<html></html>' } })

    const { useSdk } = await import('../app/composables/useSdk')
    const sdk = useSdk()
    await sdk.startSubscription('halden-daily-essentials-v1', true)

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/payment/subscription/intent', {
      method: 'POST',
      body: {
        planId: 'halden-daily-essentials-v1',
        newTestCustomer: true,
      },
    })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/payment/subscription/create', {
      method: 'POST',
      body: expect.objectContaining({ language: 'en-US' }),
    })
    expect(navigate).toHaveBeenCalledWith('/halden/sdk/order-1')
    expect(sdk.subscription.value).toEqual(subscription)
  })
})
