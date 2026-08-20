import { randomUUID } from 'node:crypto'
import type { ProfileName } from '../../shared/profile'

export const MERCHANT_CUST_ID_PATTERN = /^[A-Za-z0-9_-]{1,63}$/

export interface MerchantCustomer {
  readonly environment: ProfileName
  readonly merchantNo: string
  readonly appId: string
  readonly merchantCustId: string
}

export interface MerchantCustomerScope {
  readonly profile: ProfileName
  readonly merchantNo: string
  readonly appId: string
}

function assertScope(scope: MerchantCustomerScope): void {
  if (!scope.merchantNo || !scope.appId) {
    throw new TypeError('PAYMENT_CUSTOMER_SCOPE_INVALID')
  }
}

export function createMerchantCustomer(scope: MerchantCustomerScope): MerchantCustomer {
  assertScope(scope)

  return Object.freeze({
    environment: scope.profile,
    merchantNo: scope.merchantNo,
    appId: scope.appId,
    merchantCustId: `cust_${randomUUID().replaceAll('-', '')}`,
  })
}

export function restoreMerchantCustomer(input: MerchantCustomer): MerchantCustomer {
  assertScope({
    profile: input.environment,
    merchantNo: input.merchantNo,
    appId: input.appId,
  })

  if (!MERCHANT_CUST_ID_PATTERN.test(input.merchantCustId)) {
    throw new TypeError('PAYMENT_CUSTOMER_ID_INVALID')
  }

  return Object.freeze({ ...input })
}

export function isMerchantCustomerInScope(
  customer: MerchantCustomer,
  scope: MerchantCustomerScope,
): boolean {
  return customer.environment === scope.profile
    && customer.merchantNo === scope.merchantNo
    && customer.appId === scope.appId
    && MERCHANT_CUST_ID_PATTERN.test(customer.merchantCustId)
}
