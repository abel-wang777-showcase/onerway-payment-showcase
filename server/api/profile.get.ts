import { requireServerProfile, toPublicProfile } from '../utils/profile'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')

  return toPublicProfile(requireServerProfile())
})
