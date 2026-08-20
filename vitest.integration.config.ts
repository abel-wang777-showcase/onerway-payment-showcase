import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.integration.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
  },
})
