import type { SceneId } from './capability'

export type Currency = 'USD'
export type FulfillmentStatus = 'pending' | 'fulfilled' | 'cancelled'

export interface Money {
  readonly minor: number
  readonly currency: Currency
}

export interface OrderItem {
  readonly sku: string
  readonly name: string
  readonly variant: string
  readonly quantity: number
  readonly unitAmount: Money
}

export interface Order {
  readonly id: string
  readonly scene: SceneId
  readonly item: OrderItem
  readonly amount: Money
  readonly fulfillment: FulfillmentStatus
  readonly createdAt: string
}

export interface CreateOrderInput {
  readonly id: string
  readonly scene: SceneId
  readonly item: OrderItem
  readonly amount: Money
  readonly createdAt: string
}

function assertMinorUnit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer in minor units`)
  }
}

function assertText(value: string, name: string): void {
  if (!value.trim()) {
    throw new TypeError(`${name} must not be empty`)
  }
}

export function createOrder(input: CreateOrderInput): Order {
  assertText(input.id, 'Order id')
  assertText(input.item.sku, 'Item sku')
  assertText(input.item.name, 'Item name')
  assertText(input.item.variant, 'Item variant')
  assertMinorUnit(input.item.quantity, 'Item quantity')
  assertMinorUnit(input.item.unitAmount.minor, 'Item unit amount')
  assertMinorUnit(input.amount.minor, 'Order amount')

  if (input.item.quantity < 1) {
    throw new TypeError('Item quantity must be at least one')
  }

  if (input.item.unitAmount.currency !== input.amount.currency) {
    throw new TypeError('Item and order currencies must match')
  }

  return Object.freeze({
    id: input.id,
    scene: input.scene,
    item: Object.freeze({
      ...input.item,
      unitAmount: Object.freeze({ ...input.item.unitAmount }),
    }),
    amount: Object.freeze({ ...input.amount }),
    fulfillment: 'pending',
    createdAt: input.createdAt,
  })
}
