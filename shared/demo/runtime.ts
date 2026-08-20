import type { JourneyId } from '../payment/journey'
import {
  advanceSession,
  canAdvance,
  createSession,
  getCurrentStage,
  restoreSession,
  retrySession,
  serializeSession,
  type DemoSession,
} from './session'

export const DEMO_STORAGE_KEY = 'onerway-showcase:demo:v1'

export interface DemoStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface GoOptions {
  replace?: boolean
}

export interface RuntimeOptions<Timer> {
  read(): DemoSession | null
  write(session: DemoSession): void
  go(path: string, options?: GoOptions): unknown
  defer(task: () => void, delay: number): Timer
  clear(timer: Timer): void
}

export function loadSession(getStorage: () => DemoStorage): DemoSession | null {
  let storage: DemoStorage | null = null

  try {
    storage = getStorage()
    const serialized = storage.getItem(DEMO_STORAGE_KEY)
    return serialized ? restoreSession(serialized) : null
  }
  catch {
    if (storage) {
      try {
        storage.removeItem(DEMO_STORAGE_KEY)
      }
      catch {
        // Storage can remain unavailable without blocking an in-memory demo.
      }
    }

    return null
  }
}

export function saveSession(
  getStorage: () => DemoStorage,
  session: DemoSession | null,
): void {
  try {
    const storage = getStorage()

    if (session) {
      storage.setItem(DEMO_STORAGE_KEY, serializeSession(session))
    }
    else {
      storage.removeItem(DEMO_STORAGE_KEY)
    }
  }
  catch {
    // The in-memory simulation remains usable when storage is unavailable.
  }
}

export function createRuntime<Timer>(options: RuntimeOptions<Timer>) {
  let timer: Timer | null = null

  function stop(): void {
    if (timer !== null) {
      options.clear(timer)
      timer = null
    }
  }

  function delay(stage: DemoSession['stage']): number {
    return stage === 'redirecting' ? 1_200 : 900
  }

  function run(): void {
    stop()

    const current = options.read()

    if (!current || !canAdvance(current)) {
      return
    }

    const stage = getCurrentStage(current)

    if (['ready', 'processing', 'not_completed'].includes(stage)) {
      return
    }

    timer = options.defer(() => {
      timer = null

      const active = options.read()

      if (active !== current || !canAdvance(active)) {
        return
      }

      const next = advanceSession(active)
      options.write(next)

      if (['succeeded', 'failed', 'cancelled'].includes(next.stage)) {
        void options.go(`/halden/result/${next.order.id}`, { replace: true })
        return
      }

      run()
    }, delay(stage))
  }

  async function start(journeyId: JourneyId): Promise<void> {
    stop()
    const next = createSession(journeyId)
    options.write(next)
    await options.go(`/halden/checkout/${next.order.id}`)
  }

  function resume(orderId: string): boolean {
    const current = options.read()

    if (!current || current.order.id !== orderId) {
      return false
    }

    if (['succeeded', 'failed', 'cancelled'].includes(current.stage)) {
      void options.go(`/halden/result/${current.order.id}`, { replace: true })
      return true
    }

    run()
    return true
  }

  function pay(): void {
    const current = options.read()

    if (!current || current.stage !== 'ready') {
      return
    }

    options.write(advanceSession(current))
    run()
  }

  function verify(): void {
    const current = options.read()

    if (!current || current.stage !== 'processing') {
      return
    }

    const next = advanceSession(current)
    options.write(next)

    if (['succeeded', 'failed', 'cancelled'].includes(next.stage)) {
      void options.go(`/halden/result/${next.order.id}`, { replace: true })
    }
    else {
      run()
    }
  }

  function reload(): void {
    const current = options.read()

    if (!current || current.stage !== 'not_completed') {
      return
    }

    const next = advanceSession(current)
    options.write(next)
    run()
  }

  async function retry(): Promise<void> {
    const current = options.read()

    if (!current || !['succeeded', 'failed', 'cancelled'].includes(current.stage)) {
      return
    }

    const next = retrySession(current)
    options.write(next)
    await options.go(`/halden/checkout/${next.order.id}`)
  }

  return {
    stop,
    start,
    resume,
    pay,
    verify,
    reload,
    retry,
  }
}
