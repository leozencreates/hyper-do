import { defineConfig } from 'vitest/config'

// Standalone config on purpose: vite.config.ts loads the Electron plugin, which must not run under Vitest.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
})
