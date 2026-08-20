export type ProfileName = 'sandbox' | 'production'

export type ProfileEnvironment = 'Sandbox' | 'Production'

export type TransactionPolicy = 'sandbox-only' | 'locked'

export interface PublicSdk {
  url: string
  release: 'v4/latest'
}

export interface PublicProfile {
  profile: ProfileName
  environment: ProfileEnvironment
  transactionPolicy: TransactionPolicy
  canonicalOrigin: string | null
  sdk: PublicSdk | null
}
