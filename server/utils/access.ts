import { timingSafeEqual } from 'node:crypto'

export function verifyBearerToken(authorization: string | undefined, expected: string | undefined): boolean {
  const token = expected?.trim()

  if (!token || token.length < 32 || !authorization?.startsWith('Bearer ')) {
    return false
  }

  const provided = authorization.slice('Bearer '.length)
  const left = Buffer.from(provided, 'utf8')
  const right = Buffer.from(token, 'utf8')

  return left.length === right.length && timingSafeEqual(left, right)
}
