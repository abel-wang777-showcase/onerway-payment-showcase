import { readProfile, type ServerProfile } from '../utils/profile'

export default defineNitroPlugin((nitroApp) => {
  const app = nitroApp as typeof nitroApp & { profile?: ServerProfile }
  app.profile = readProfile(process.env)
})
