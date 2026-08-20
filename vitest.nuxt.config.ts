import { fileURLToPath } from 'node:url'
import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    include: ['tests/vue/**/*.test.ts'],
    environment: 'nuxt',
    hookTimeout: 60_000,
    testTimeout: 30_000,
    environmentOptions: {
      nuxt: {
        rootDir: fileURLToPath(new URL('.', import.meta.url)),
        domEnvironment: 'happy-dom',
      },
    },
  },
})
