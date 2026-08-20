import { describe, expect, it } from 'vitest'
import { resolveVercelMigrationAction } from '../scripts/migration.mjs'

describe('Vercel migration gate', () => {
  it('allows only the expected environment and mode pairs', () => {
    expect(resolveVercelMigrationAction('production', 'apply')).toBe('apply')
    expect(resolveVercelMigrationAction('preview', 'skip')).toBe('skip')
  })

  it.each([
    [undefined, undefined],
    ['production', 'skip'],
    ['preview', 'apply'],
    ['development', 'skip'],
  ])('fails closed for environment %s and mode %s', (environment, mode) => {
    expect(() => resolveVercelMigrationAction(environment, mode))
      .toThrow('PAYMENT_DATABASE_MIGRATION_MODE_INVALID')
  })
})
