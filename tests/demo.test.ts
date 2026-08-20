import { afterEach, describe, expect, it, vi } from 'vitest'
import { findOrderJourney, JOURNEYS } from '../shared/payment/journey'
import {
  createRuntime,
  DEMO_STORAGE_KEY,
  loadSession,
  saveSession,
} from '../shared/demo/runtime'
import {
  advanceSession,
  canAdvance,
  createSession,
  getActiveAttempt,
  restoreSession,
  retrySession,
  serializeSession,
} from '../shared/demo/session'

function complete<T extends ReturnType<typeof createSession>>(initial: T): T {
  let session = initial

  while (canAdvance(session)) {
    session = advanceSession(session) as T
  }

  return session
}

function createHarness(initial: ReturnType<typeof createSession> | null = null) {
  let session = initial
  const go = vi.fn(async (
    _path: string,
    _options?: { replace?: boolean },
  ) => {})
  const runtime = createRuntime<ReturnType<typeof setTimeout>>({
    read: () => session,
    write: next => {
      session = next
    },
    go,
    defer: (task, delay) => setTimeout(task, delay),
    clear: timer => clearTimeout(timer),
  })

  return {
    runtime,
    go,
    read: () => session,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('deterministic demo journeys', () => {
  it('defines the USD 5.00 standard-success stages', () => {
    expect(JOURNEYS['standard-success'].amount).toBe(500)
    expect(JOURNEYS['standard-success'].stages).toEqual([
      'loading',
      'ready',
      'submitting',
      'succeeded',
    ])
  })

  it('defines the USD 50.00 3DS challenge stages', () => {
    expect(JOURNEYS['three-ds-success'].amount).toBe(5_000)
    expect(JOURNEYS['three-ds-success'].modes).toContain('sandbox')
    expect(JOURNEYS['three-ds-success'].stages).toEqual([
      'loading',
      'ready',
      'submitting',
      'redirecting',
      'verifying',
      'succeeded',
    ])
  })

  it.each([
    'processing-recovery',
    'cancelled-retry',
    'deterministic-failure',
    'form-load-recovery',
  ] as const)('keeps %s simulation-only', (journeyId) => {
    expect(JOURNEYS[journeyId].modes).toEqual(['simulation'])
  })

  it('creates deterministic terminal failure without provider facts', () => {
    const failed = complete(createSession('deterministic-failure'))
    const attempt = getActiveAttempt(failed)
    const event = failed.events.at(-1)

    expect(attempt.status).toBe('failed')
    expect(attempt.statusSource).toBeUndefined()
    expect(event).toMatchObject({ source: 'simulation', status: 'failed' })
    expect(event).not.toHaveProperty('rawStatus')
    expect(attempt).not.toHaveProperty('paymentId')
    expect(attempt).not.toHaveProperty('transactionId')
  })

  it('creates the same session for the same journey', () => {
    expect(createSession('standard-success')).toEqual(createSession('standard-success'))
  })

  it('identifies a persisted controlled journey only from its complete Order fixture', () => {
    const session = createSession('three-ds-success')

    expect(findOrderJourney(session.order)?.id).toBe('three-ds-success')
    expect(findOrderJourney({
      ...session.order,
      item: { ...session.order.item, quantity: 2 },
    })).toBeNull()
  })

  it('advances the standard journey without mutating prior snapshots', () => {
    const loading = createSession('standard-success')
    const ready = advanceSession(loading)
    const submitting = advanceSession(ready)
    const succeeded = advanceSession(submitting)

    expect(loading.stage).toBe('loading')
    expect(getActiveAttempt(loading).status).toBe('created')
    expect(Object.isFrozen(getActiveAttempt(loading))).toBe(true)
    expect(Object.isFrozen(loading.events[0])).toBe(true)
    expect(ready.stage).toBe('ready')
    expect(getActiveAttempt(submitting).status).toBe('processing')
    expect(succeeded.stage).toBe('succeeded')
    expect(getActiveAttempt(succeeded).status).toBe('succeeded')
    expect(succeeded.events.map(event => event.stage)).toEqual([
      'loading',
      'ready',
      'submitting',
      'succeeded',
    ])
    expect(advanceSession(succeeded)).toBe(succeeded)
  })

  it('preserves the old attempt and events when retrying', () => {
    const completed = complete(createSession('three-ds-success'))
    const previous = getActiveAttempt(completed)
    const retried = retrySession(completed)
    const active = getActiveAttempt(retried)

    expect(retried.attempts).toHaveLength(2)
    expect(retried.attempts[0]).toBe(previous)
    expect(retried.attempts[0]?.status).toBe('succeeded')
    expect(active.id).not.toBe(previous.id)
    expect(active.retryOf).toBe(previous.id)
    expect(active.status).toBe('created')
    expect(retried.stage).toBe('loading')
    expect(retried.events.slice(0, completed.events.length)).toEqual(completed.events)
  })

  it('does not retry an attempt that is still in progress', () => {
    expect(() => retrySession(createSession('standard-success'))).toThrow(
      'Cannot retry an unfinished payment attempt',
    )
  })

  it('restores a versioned immutable session', () => {
    const completed = complete(createSession('three-ds-success'))
    const retried = advanceSession(retrySession(completed))
    const restored = restoreSession(serializeSession(retried))

    expect(restored).toEqual(retried)
    expect(restored.attempts).toHaveLength(2)
    expect(restored.stage).toBe('ready')
    expect(Object.isFrozen(restored)).toBe(true)
    expect(Object.isFrozen(restored.attempts)).toBe(true)
    expect(Object.isFrozen(restored.events)).toBe(true)
  })

  it('rejects stale or tampered session data', () => {
    const stale = JSON.stringify({
      ...createSession('standard-success'),
      version: 2,
    })
    const tampered = JSON.stringify({
      ...createSession('standard-success'),
      stage: 'succeeded',
    })

    expect(() => restoreSession(stale)).toThrow('Unsupported demo session version')
    expect(() => restoreSession(tampered)).toThrow('Invalid session progress')
  })
})

describe('demo runtime', () => {
  it('resumes loading and advances only after an explicit payment action', async () => {
    vi.useFakeTimers()
    const harness = createHarness()

    await harness.runtime.start('standard-success')
    const orderId = harness.read()?.order.id

    expect(harness.read()?.stage).toBe('loading')
    expect(harness.runtime.resume(orderId ?? '')).toBe(true)

    await vi.advanceTimersByTimeAsync(900)
    expect(harness.read()?.stage).toBe('ready')

    await vi.advanceTimersByTimeAsync(5_000)
    expect(harness.read()?.stage).toBe('ready')

    harness.runtime.pay()
    expect(harness.read()?.stage).toBe('submitting')

    await vi.advanceTimersByTimeAsync(900)
    expect(harness.read()?.stage).toBe('succeeded')
    expect(harness.go).toHaveBeenLastCalledWith(
      `/halden/result/${orderId}`,
      { replace: true },
    )
  })

  it('replaces history when resuming a completed session', () => {
    const completed = complete(createSession('standard-success'))
    const harness = createHarness(completed)

    expect(harness.runtime.resume(completed.order.id)).toBe(true)
    expect(harness.go).toHaveBeenCalledWith(
      `/halden/result/${completed.order.id}`,
      { replace: true },
    )
  })

  it('holds processing across time until explicit verification', async () => {
    vi.useFakeTimers()
    const harness = createHarness()

    await harness.runtime.start('processing-recovery')
    harness.runtime.resume(harness.read()?.order.id ?? '')
    await vi.advanceTimersByTimeAsync(900)
    harness.runtime.pay()
    await vi.advanceTimersByTimeAsync(900)

    expect(harness.read()?.stage).toBe('processing')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(harness.read()?.stage).toBe('processing')

    harness.runtime.verify()
    expect(harness.read()?.stage).toBe('succeeded')
    expect(harness.go).toHaveBeenLastCalledWith(
      `/halden/result/${harness.read()?.order.id}`,
      { replace: true },
    )
  })

  it('reloads the same simulated attempt after a pre-confirm load failure', async () => {
    vi.useFakeTimers()
    const harness = createHarness()

    await harness.runtime.start('form-load-recovery')
    harness.runtime.resume(harness.read()?.order.id ?? '')
    await vi.advanceTimersByTimeAsync(900)
    const attemptId = getActiveAttempt(harness.read()!).id

    expect(harness.read()?.stage).toBe('not_completed')
    harness.runtime.reload()
    expect(harness.read()?.stage).toBe('ready')
    expect(getActiveAttempt(harness.read()!).id).toBe(attemptId)
  })

  it('routes cancelled simulation to result and creates a linked retry child', async () => {
    const cancelled = complete(createSession('cancelled-retry'))
    const harness = createHarness(cancelled)
    const parent = getActiveAttempt(cancelled)

    harness.runtime.resume(cancelled.order.id)
    expect(harness.go).toHaveBeenCalledWith(
      `/halden/result/${cancelled.order.id}`,
      { replace: true },
    )

    await harness.runtime.retry()
    expect(getActiveAttempt(harness.read()!).retryOf).toBe(parent.id)
  })

  it('cancels a scheduled transition when its owner is disposed', async () => {
    vi.useFakeTimers()
    const harness = createHarness()

    await harness.runtime.start('standard-success')
    const orderId = harness.read()?.order.id
    harness.runtime.resume(orderId ?? '')
    harness.runtime.stop()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(harness.read()?.stage).toBe('loading')
  })

  it('ignores a stale timer after another runtime replaces the session', async () => {
    vi.useFakeTimers()
    const harness = createHarness()

    await harness.runtime.start('standard-success')
    harness.runtime.resume('HLD-DEMO-500')

    await harness.runtime.start('three-ds-success')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(harness.read()?.journeyId).toBe('three-ds-success')
    expect(harness.read()?.stage).toBe('loading')
  })

  it('clears invalid stored data without blocking a new demo', () => {
    const removeItem = vi.fn()
    const storage = {
      getItem: vi.fn(() => '{invalid'),
      setItem: vi.fn(),
      removeItem,
    }

    expect(loadSession(() => storage)).toBeNull()
    expect(removeItem).toHaveBeenCalledWith(DEMO_STORAGE_KEY)

    const session = createSession('standard-success')
    saveSession(() => storage, session)
    expect(storage.setItem).toHaveBeenCalledWith(
      DEMO_STORAGE_KEY,
      serializeSession(session),
    )
  })

  it('keeps the in-memory demo usable when storage access is denied', () => {
    const denied = () => {
      throw new DOMException('Access denied', 'SecurityError')
    }

    expect(loadSession(denied)).toBeNull()
    expect(() => saveSession(denied, createSession('standard-success'))).not.toThrow()
  })

  it('adds only one attempt when retry is triggered twice', async () => {
    const harness = createHarness(complete(createSession('standard-success')))

    await Promise.all([
      harness.runtime.retry(),
      harness.runtime.retry(),
    ])

    expect(harness.read()?.attempts).toHaveLength(2)
    expect(harness.read()?.stage).toBe('loading')
    expect(harness.go).toHaveBeenCalledTimes(1)
  })
})
