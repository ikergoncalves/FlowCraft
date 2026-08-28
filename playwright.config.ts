import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end configuration.
 *
 * **Against the dev server, not the preview build.** The export specs reach
 * into the app's own module graph to call `exportSvg` and `renderPng` — the
 * very functions the toolbar calls, rather than a re-implementation — and that
 * import only resolves while Vite is serving source. Measuring performance is
 * the one job that needs the production bundle, and `npm run measure:perf`
 * does that separately.
 *
 * **`E2E_BASE_URL` overrides everything**, including the server. That is how
 * the smoke spec is pointed at the deployed site: the same checks, run against
 * production, where the secure-context APIs the editor leans on (IndexedDB,
 * `createImageBitmap`, blob downloads) can behave differently from localhost.
 *
 * Each test gets its own browser context, which means its own origin storage.
 * That matters more here than in most suites: the editor auto-saves to
 * IndexedDB, so tests sharing a context would inherit each other's diagrams.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4321'

export default defineConfig({
  testDir: './e2e',
  // Serial by default would hide flakiness behind luck; the suite is written
  // so that nothing shares state, so it can say so.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL,
    // A trace of the first retry, which is the one worth reading.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /*
   * Chromium only, and that is a decision rather than an omission.
   *
   * The suite was run against Firefox and 29 of the 67 specs passed; the other
   * 38 failed on `browserContext.newPage` timeouts and
   * `RenderCompositorSWGL failed mapping default framebuffer` crashes — the
   * headless Firefox on this machine falling over, not FlowCraft failing.
   * Nothing in the app's behaviour differed in the specs that did run.
   *
   * A suite that fails for reasons that are not the code's is worse than no
   * suite: it teaches everyone to re-run rather than to read. So Firefox is
   * left out until it can be run somewhere it is stable, and this note is here
   * so the next person does not rediscover the same afternoon. Nothing in the
   * specs is Chromium-specific — they use no `chromium`-only API — so adding a
   * project back is a four-line change.
   */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 4321 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
})
