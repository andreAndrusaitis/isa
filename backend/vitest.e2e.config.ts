import { defineConfig } from 'vitest/config'

// Suíte E2E: HTTP contra um backend real (ver e2e/README.md). Sequencial porque
// os cenários compartilham o mesmo banco e as mesmas contas do seed.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
