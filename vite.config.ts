/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    /*
     * Only `src`, and only `.test.`.
     *
     * Vitest's default include also matches `*.spec.ts`, which since Phase 7
     * means it collects the Playwright specs under `e2e/` — they import
     * `@playwright/test`, fail to collect, and turn a green run into ten
     * broken files with every assertion still passing. Two runners, two
     * suffixes, no overlap.
     */
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.test.{ts,tsx}'],
    },
  },
})
