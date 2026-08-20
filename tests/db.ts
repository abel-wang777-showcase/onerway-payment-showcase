export function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  const runtimeDatabaseUrl = process.env.DATABASE_URL?.trim()
  const testDatabasePurpose = 'onerway-payment-showcase:ci'

  if (
    !databaseUrl
    || process.env.PAYMENT_TEST_DATABASE_CONFIRM !== 'isolated'
    || process.env.PAYMENT_TEST_DATABASE_VERIFIED !== testDatabasePurpose
  ) {
    throw new Error('PAYMENT_TEST_DATABASE_NOT_CONFIRMED')
  }

  if (databaseUrl !== runtimeDatabaseUrl) {
    throw new Error('PAYMENT_TEST_DATABASE_NOT_BOUND')
  }

  return databaseUrl
}
