import type { PaymentStatus } from './attempt'

export type AuthorizationFundsStatus = 'pending' | 'authorized' | 'captured' | 'voided'
export type AuthorizationOperationType = 'CAPTURE' | 'VOID'
export type AuthorizationOperationStatus = 'pending' | 'unknown' | 'confirmed'
export type AuthorizationTransactionType = 'AUTH' | AuthorizationOperationType

export interface AuthorizationOperation {
  readonly type: AuthorizationOperationType
  readonly merchantTxnId: string
  readonly transactionId?: string
  readonly status: AuthorizationOperationStatus
}

export interface AuthorizationState {
  readonly paymentId?: string
  readonly authTransactionId?: string
  readonly authMerchantTxnId: string
  readonly amountMinor: number
  readonly currency: 'USD'
  readonly fundsStatus: AuthorizationFundsStatus
  readonly operation?: AuthorizationOperation
  readonly conflict?: boolean
  readonly updatedAt: string
}

// Only the verified notification adapter may produce authoritative facts until
// the Provider's AUTH query contract has been confirmed.
export interface AuthorizationFact {
  readonly source: 'webhook'
  readonly txnType: AuthorizationTransactionType
  readonly transactionId: string
  readonly paymentId: string
  readonly merchantTxnId: string
  readonly amountMinor: number
  readonly currency: 'USD'
  readonly transactionStatus: 'S' | 'F' | 'N'
  readonly paymentStatus: 'A' | 'S' | 'O' | 'N'
  readonly occurredAt: string
}

export interface AuthorizationProjection {
  readonly fundsStatus: AuthorizationFundsStatus
  readonly status: PaymentStatus
}

export interface AuthorizationMerge {
  readonly authorization: AuthorizationState
  readonly accepted: boolean
  readonly conflict: boolean
}

export function mapAuthorizationStatus(
  txnType: string,
  transactionStatus: string,
  paymentStatus: string,
): AuthorizationProjection {
  if (txnType === 'AUTH' && transactionStatus === 'S' && paymentStatus === 'A') {
    return Object.freeze({ fundsStatus: 'authorized', status: 'processing' })
  }

  if (txnType === 'AUTH' && transactionStatus === 'F' && paymentStatus === 'O') {
    return Object.freeze({ fundsStatus: 'pending', status: 'processing' })
  }

  if (txnType === 'CAPTURE' && transactionStatus === 'S' && paymentStatus === 'S') {
    return Object.freeze({ fundsStatus: 'captured', status: 'succeeded' })
  }

  if (txnType === 'VOID' && transactionStatus === 'S' && paymentStatus === 'N') {
    return Object.freeze({ fundsStatus: 'voided', status: 'cancelled' })
  }

  throw new TypeError('AUTHORIZATION_STATUS_UNKNOWN')
}

export function canClaimAuthorizationOperation(authorization: AuthorizationState): boolean {
  return authorization.fundsStatus === 'authorized'
    && Boolean(authorization.paymentId && authorization.authTransactionId)
    && !authorization.conflict
    && !authorization.operation
}

export function createAuthorizationState(input: {
  readonly merchantTxnId: string
  readonly amountMinor: number
  readonly currency: 'USD'
  readonly occurredAt: string
}): AuthorizationState {
  return Object.freeze({
    authMerchantTxnId: input.merchantTxnId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    fundsStatus: 'pending',
    updatedAt: input.occurredAt,
  })
}

export function claimAuthorizationOperation(
  authorization: AuthorizationState,
  input: {
    readonly type: AuthorizationOperationType
    readonly merchantTxnId: string
    readonly occurredAt: string
  },
): AuthorizationState {
  if (!canClaimAuthorizationOperation(authorization)) {
    throw new TypeError('AUTHORIZATION_OPERATION_UNAVAILABLE')
  }

  if (
    !['CAPTURE', 'VOID'].includes(input.type)
    || !/^[A-Za-z0-9_-]{1,64}$/.test(input.merchantTxnId)
    || input.merchantTxnId === authorization.authMerchantTxnId
  ) {
    throw new TypeError('AUTHORIZATION_OPERATION_INVALID')
  }

  return Object.freeze({
    ...authorization,
    operation: Object.freeze({
      type: input.type,
      merchantTxnId: input.merchantTxnId,
      status: 'pending',
    }),
    updatedAt: latest(authorization.updatedAt, input.occurredAt),
  })
}

function latest(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right
}

function isFinalFundsStatus(status: AuthorizationFundsStatus): boolean {
  return status === 'captured' || status === 'voided'
}

export function mergeAuthorization(
  authorization: AuthorizationState,
  fact: AuthorizationFact,
): AuthorizationMerge {
  const reject = (conflict = false): AuthorizationMerge => Object.freeze({
    authorization: conflict ? Object.freeze({ ...authorization, conflict: true }) : authorization,
    accepted: false,
    conflict,
  })

  if (fact.source !== 'webhook') {
    return reject()
  }

  const projection = mapAuthorizationStatus(fact.txnType, fact.transactionStatus, fact.paymentStatus)

  if (
    (authorization.paymentId && fact.paymentId !== authorization.paymentId)
    || fact.amountMinor !== authorization.amountMinor
    || fact.currency !== authorization.currency
  ) {
    return reject()
  }

  if (fact.txnType === 'AUTH') {
    if (
      fact.merchantTxnId !== authorization.authMerchantTxnId
    ) {
      return reject()
    }

    if (projection.fundsStatus === 'authorized' && authorization.authTransactionId
      && fact.transactionId !== authorization.authTransactionId) {
      return reject(true)
    }

    // An attempt can fail while its Payment remains open. Neither an old AUTH
    // success nor an AUTH F/O notification can undo later verified funds state.
    if (authorization.fundsStatus !== 'pending') {
      return Object.freeze({ authorization, accepted: true, conflict: false })
    }

    return Object.freeze({
      authorization: Object.freeze({
        ...authorization,
        paymentId: fact.paymentId,
        ...(projection.fundsStatus === 'authorized' ? { authTransactionId: fact.transactionId } : {}),
        fundsStatus: projection.fundsStatus,
        updatedAt: latest(authorization.updatedAt, fact.occurredAt),
      }),
      accepted: true,
      conflict: false,
    })
  }

  const operation = authorization.operation
  const merchantMatches = fact.merchantTxnId === authorization.authMerchantTxnId
    || fact.merchantTxnId === operation?.merchantTxnId

  if (!merchantMatches) {
    return reject()
  }

  // Keep contradictory verified funds evidence visible, but never use it to
  // switch the final state or bind a different operation.
  if (isFinalFundsStatus(authorization.fundsStatus) && authorization.fundsStatus !== projection.fundsStatus) {
    return reject(true)
  }

  if (
    !operation
    || !authorization.paymentId
    || !authorization.authTransactionId
    || operation.type !== fact.txnType
    || fact.transactionId === authorization.authTransactionId
    || (operation.transactionId && operation.transactionId !== fact.transactionId)
    || (!operation.transactionId && operation.status === 'confirmed')
  ) {
    return reject()
  }

  // A missing Provider operation id is bound only after a local claim and the
  // signed merchant id check above; unsigned origin fields are never consulted.
  return Object.freeze({
    authorization: Object.freeze({
      ...authorization,
      fundsStatus: projection.fundsStatus,
      operation: Object.freeze({
        ...operation,
        transactionId: fact.transactionId,
        status: 'confirmed',
      }),
      updatedAt: latest(authorization.updatedAt, fact.occurredAt),
    }),
    accepted: true,
    conflict: false,
  })
}
