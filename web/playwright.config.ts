import { defineConfig } from '@playwright/test';

// Driven by the Go harness (e2e/s5_ui_test.go), which starts the hub, the
// agents and tmux and passes their addresses in the environment. Specs run
// against the production build the hub embeds; the hub's certificate comes
// from the test CA, hence ignoreHTTPSErrors.
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['json']] : 'list',
  outputDir: process.env.MX_TRACES ?? 'test-results',
  use: {
    baseURL: process.env.MX_BASE_URL ?? 'https://127.0.0.1:7600',
    ignoreHTTPSErrors: true,
    trace: 'on',
    viewport: { width: 1200, height: 800 },
  },
});
