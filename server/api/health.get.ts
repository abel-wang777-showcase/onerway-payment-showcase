import { requireServerProfile } from '../utils/profile'
import { checkPaymentDatabase } from '../utils/store'

function commitSha(): string | undefined {
  const value = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
  return value && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : undefined
}

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  try {
    const profile = requireServerProfile()
    await checkPaymentDatabase()
    const commit = commitSha()

    return Object.freeze({
      status: 'ok' as const,
      checks: Object.freeze({
        profile: 'ready' as const,
        database: 'ready' as const,
      }),
      transactionPolicy: profile.transactionPolicy,
      ...(commit ? { commitSha: commit } : {}),
    })
  }
  catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'SERVICE_UNAVAILABLE',
    })
  }
})
