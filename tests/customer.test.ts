import { describe, expect, it } from 'vitest'
import {
  createMerchantCustomer,
  isMerchantCustomerInScope,
  restoreMerchantCustomer,
} from '../server/utils/customer'

const scope = {
  profile: 'sandbox',
  merchantNo: 'merchant-A',
  appId: 'app_1',
} as const

describe('server-owned merchant customer', () => {
  it('creates a private identifier within the provider contract', () => {
    const customer = createMerchantCustomer(scope)

    expect(customer.merchantCustId).toMatch(/^cust_[A-Za-z0-9_-]+$/)
    expect(customer.merchantCustId.length).toBeLessThan(64)
    expect(isMerchantCustomerInScope(customer, scope)).toBe(true)
  })

  it('preserves case and rejects values outside the local allowlist', () => {
    expect(restoreMerchantCustomer({
      environment: 'sandbox',
      merchantNo: 'merchant-A',
      appId: 'app_1',
      merchantCustId: 'Cust-A_9',
    }).merchantCustId).toBe('Cust-A_9')

    for (const merchantCustId of ['', 'a'.repeat(64), 'with space', 'with.dot', '客户']) {
      expect(() => restoreMerchantCustomer({
        environment: 'sandbox',
        merchantNo: 'merchant-A',
        appId: 'app_1',
        merchantCustId,
      })).toThrow('PAYMENT_CUSTOMER_ID_INVALID')
    }
  })

  it('treats every provider scope dimension as part of identity isolation', () => {
    const customer = restoreMerchantCustomer({
      environment: 'sandbox',
      merchantNo: 'merchant-A',
      appId: 'app_1',
      merchantCustId: 'Cust-A_9',
    })

    expect(isMerchantCustomerInScope(customer, { ...scope, profile: 'production' })).toBe(false)
    expect(isMerchantCustomerInScope(customer, { ...scope, merchantNo: 'merchant-B' })).toBe(false)
    expect(isMerchantCustomerInScope(customer, { ...scope, appId: 'app_2' })).toBe(false)
  })
})
