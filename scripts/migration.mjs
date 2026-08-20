export function resolveVercelMigrationAction(environment, mode) {
  if (environment === 'production' && mode === 'apply') {
    return 'apply'
  }

  if (environment === 'preview' && mode === 'skip') {
    return 'skip'
  }

  throw new Error('PAYMENT_DATABASE_MIGRATION_MODE_INVALID')
}
