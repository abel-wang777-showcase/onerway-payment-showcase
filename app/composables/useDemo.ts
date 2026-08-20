import type { JourneyId } from '#shared/payment/journey'
import {
  createRuntime,
  loadSession,
  saveSession,
} from '#shared/demo/runtime'
import type { DemoSession } from '#shared/demo/session'

export function useDemo() {
  const session = useState<DemoSession | null>('demo-session', () => null)
  const restored = useState('demo-session-restored', () => false)

  function save(next: DemoSession | null): void {
    session.value = next

    if (import.meta.client) {
      saveSession(() => sessionStorage, next)
    }
  }

  const runtime = createRuntime<ReturnType<typeof setTimeout>>({
    read: () => session.value,
    write: save,
    go: (path, options) => navigateTo(path, options),
    defer: (task, delay) => setTimeout(task, delay),
    clear: timer => clearTimeout(timer),
  })

  function restore(): void {
    if (!import.meta.client || restored.value) {
      return
    }

    session.value = loadSession(() => sessionStorage)
    restored.value = true
  }

  async function start(journeyId: JourneyId): Promise<void> {
    restored.value = true
    await runtime.start(journeyId)
  }

  function resume(orderId: string): boolean {
    restore()
    return runtime.resume(orderId)
  }

  onScopeDispose(runtime.stop)

  return {
    session: readonly(session),
    restored: readonly(restored),
    restore,
    start,
    resume,
    pay: runtime.pay,
    verify: runtime.verify,
    reload: runtime.reload,
    retry: runtime.retry,
  }
}
