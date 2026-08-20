import { isIP } from 'node:net'
import {
  createError,
  getHeader,
  getRequestIP,
  getRequestURL,
  setResponseHeader,
  type H3Event,
} from 'h3'

export type PaymentOperation = 'create' | 'query' | 'retry' | 'submit'

interface LimitPolicy {
  readonly max: number
  readonly windowMs: number
  readonly concurrent: number
}

interface LimitOptions {
  readonly policies?: Readonly<Record<PaymentOperation, LimitPolicy>>
  readonly globalConcurrent?: number
  readonly clientConcurrent?: number
  readonly maxEntries?: number
}

interface ClientIpOptions {
  readonly vercel?: boolean
  readonly development?: boolean
}

interface Window {
  count: number
  resetAt: number
}

export type LimitDecision
  = | Readonly<{ allowed: false, retryAfterMs: number }>
    | Readonly<{ allowed: true, release: () => void }>

const policies = Object.freeze({
  create: Object.freeze({ max: 4, windowMs: 60_000, concurrent: 1 }),
  query: Object.freeze({ max: 30, windowMs: 60_000, concurrent: 2 }),
  retry: Object.freeze({ max: 4, windowMs: 60_000, concurrent: 1 }),
  submit: Object.freeze({ max: 4, windowMs: 60_000, concurrent: 1 }),
}) satisfies Readonly<Record<PaymentOperation, LimitPolicy>>

export class PaymentLimiter {
  readonly #policies: Readonly<Record<PaymentOperation, LimitPolicy>>
  readonly #globalConcurrent: number
  readonly #clientConcurrent: number
  readonly #maxEntries: number
  readonly #windows = new Map<string, Window>()
  readonly #clients = new Map<string, number>()
  readonly #operations = new Map<string, number>()
  #active = 0

  constructor(options: LimitOptions = {}) {
    this.#policies = options.policies ?? policies
    this.#globalConcurrent = options.globalConcurrent ?? 12
    this.#clientConcurrent = options.clientConcurrent ?? 3
    this.#maxEntries = options.maxEntries ?? 2_048
  }

  acquire(operation: PaymentOperation, client: string, now = Date.now()): LimitDecision {
    const policy = this.#policies[operation]
    const key = `${operation}\0${client}`
    const clientActive = this.#clients.get(client) ?? 0
    const operationActive = this.#operations.get(key) ?? 0

    if (
      this.#active >= this.#globalConcurrent
      || clientActive >= this.#clientConcurrent
      || operationActive >= policy.concurrent
    ) {
      return Object.freeze({ allowed: false, retryAfterMs: 1_000 })
    }

    let window = this.#windows.get(key)

    if (window && window.resetAt <= now) {
      this.#windows.delete(key)
      window = undefined
    }

    if (!window) {
      if (this.#windows.size >= this.#maxEntries) {
        this.#sweep(now)
      }

      if (this.#windows.size >= this.#maxEntries) {
        return Object.freeze({ allowed: false, retryAfterMs: policy.windowMs })
      }

      window = { count: 0, resetAt: now + policy.windowMs }
      this.#windows.set(key, window)
    }

    if (window.count >= policy.max) {
      return Object.freeze({
        allowed: false,
        retryAfterMs: Math.max(1_000, window.resetAt - now),
      })
    }

    window.count += 1
    this.#active += 1
    this.#clients.set(client, clientActive + 1)
    this.#operations.set(key, operationActive + 1)

    let released = false

    return Object.freeze({
      allowed: true,
      release: () => {
        if (released) {
          return
        }

        released = true
        this.#active -= 1
        this.#decrement(this.#clients, client)
        this.#decrement(this.#operations, key)
      },
    })
  }

  #decrement(map: Map<string, number>, key: string): void {
    const next = (map.get(key) ?? 1) - 1

    if (next <= 0) {
      map.delete(key)
    }
    else {
      map.set(key, next)
    }
  }

  #sweep(now: number): void {
    for (const [key, window] of this.#windows) {
      if (window.resetAt <= now) {
        this.#windows.delete(key)
      }
    }
  }
}

// Deliberately process-local: this is a last-resort application safety valve,
// not a globally exact quota across serverless instances.
const limiter = new PaymentLimiter()

function forbidOrigin(): never {
  throw createError({ statusCode: 403, statusMessage: 'PAYMENT_ORIGIN_FORBIDDEN' })
}

export function requireCanonicalPaymentOrigin(event: H3Event, canonicalOrigin: string): void {
  requireSameOriginBrowser(event)

  if (getRequestURL(event).origin !== canonicalOrigin) {
    throw createError({ statusCode: 403, statusMessage: 'PAYMENT_CANONICAL_ORIGIN_REQUIRED' })
  }
}

export function requireSameOriginBrowser(event: H3Event): void {
  const origin = getHeader(event, 'origin')
  const site = getHeader(event, 'sec-fetch-site')

  if (site && site !== 'same-origin' && site !== 'none') {
    forbidOrigin()
  }

  if (!origin) {
    return
  }

  let parsed: URL

  try {
    parsed = new URL(origin)
  }
  catch {
    forbidOrigin()
  }

  if (parsed.origin !== origin || origin !== getRequestURL(event).origin) {
    forbidOrigin()
  }
}

export function requireIp(value: string | null | undefined): string {
  const ip = value?.trim()

  if (!ip) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_IP_UNAVAILABLE' })
  }

  if (isIP(ip) === 0) {
    throw createError({ statusCode: 400, statusMessage: 'PAYMENT_IP_INVALID' })
  }

  return ip
}

export function resolveClientIp(
  value: string | null | undefined,
  allowLocalFallback = false,
): string {
  if (!value?.trim() && allowLocalFallback) {
    return '127.0.0.1'
  }

  return requireIp(value)
}

export function resolveRequestIp(
  event: H3Event,
  options: ClientIpOptions = {},
): string {
  const vercel = options.vercel ?? process.env.VERCEL === '1'
  const development = options.development ?? import.meta.dev
  const value = vercel
    ? getHeader(event, 'x-vercel-forwarded-for')
    : getRequestIP(event)

  return resolveClientIp(value, development)
}

export async function withPaymentLimit<T>(
  event: H3Event,
  operation: PaymentOperation,
  task: (clientIp: string) => Promise<T>,
): Promise<T> {
  requireSameOriginBrowser(event)

  // Vercel overwrites this platform header; outside that explicit runtime only H3's
  // clientAddress/socket identity is trusted. Dev alone may use a fixed loopback bucket.
  const clientIp = resolveRequestIp(event)
  const decision = limiter.acquire(operation, clientIp)

  if (!decision.allowed) {
    setResponseHeader(event, 'Retry-After', Math.ceil(decision.retryAfterMs / 1_000))
    throw createError({ statusCode: 429, statusMessage: 'PAYMENT_RATE_LIMITED' })
  }

  try {
    return await task(clientIp)
  }
  finally {
    decision.release()
  }
}
