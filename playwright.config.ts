import { defineConfig } from '@playwright/test';

export default defineConfig({
  // One browser with the extension at a time.
  workers: 1,
  // A stray test.only can't make CI green while skipping every other test.
  forbidOnly: !!process.env.CI,
  // One retry on CI; a test that only passes on it shows as flaky on the run page.
  retries: process.env.CI ? 1 : 0,
  globalTimeout: process.env.CI ? 10 * 60_000 : 0,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    // Against a mock reddit.com: fast, offline, runs in CI.
    { name: 'e2e', testDir: 'e2e/mock', timeout: 90_000 },
    // Against the real reddit.com, headed, by hand only (`pnpm live`). Slow: it goes at Reddit's
    // pace. Not even defined on CI: it needs a logged-in profile, and CI must never load Reddit.
    ...(process.env.CI ? [] : [{ name: 'live', testDir: 'e2e/live', timeout: 60 * 60_000 }]),
    // `pnpm media`: screenshots of every screen for the README, then the store images made from them.
    { name: 'capture', testDir: 'media', testMatch: 'capture.spec.ts' },
    { name: 'store', testDir: 'media', testMatch: 'store.spec.ts', dependencies: ['capture'] },
  ],
});
