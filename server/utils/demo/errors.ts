export type DemoErrorAction = 'NONE' | 'RETRY_SAME_REQUEST' | 'REFRESH' | 'RECOVER_OPERATION' | 'RENEW_SESSION' | 'START_NEW_SESSION' | 'UPGRADE_CLIENT'
export type DemoExecution = 'not_started' | 'accepted' | 'unknown' | 'completed' | 'not_applicable'
export interface DemoErrorOptions {
  retryable?: boolean
  action?: DemoErrorAction
  retryAfter?: number | null
  execution?: DemoExecution
  fieldErrors?: { field: string, code: string }[]
  currentView?: unknown
  operationId?: string | null
  checkoutSessionId?: string | null
  leaseExpiresAt?: string | null
}
export class DemoError extends Error {
  readonly statusCode: number
  readonly body: { error: Required<DemoErrorOptions> & { code: string } }
  constructor(statusCode: number, code: string, options: DemoErrorOptions = {}) {
    super(code)
    this.name = 'DemoError'
    this.statusCode = statusCode
    this.body = { error: { code, retryable: false, action: 'NONE', retryAfter: null, execution: 'not_started', fieldErrors: [], currentView: null, operationId: null, checkoutSessionId: null, leaseExpiresAt: null, ...options } }
  }
}
export function invalidDemoField(field: string, code = 'INVALID_VALUE'): never {
  throw new DemoError(400, 'INVALID_REQUEST', { fieldErrors: [{ field, code }] })
}
