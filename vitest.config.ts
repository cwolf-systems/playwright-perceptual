import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['test/**/*.test.ts'], exclude: ['test/runner/**'] } },
      // Drives the Playwright runner, so it needs Chromium installed.
      { test: { name: 'runner', include: ['test/runner/**/*.test.ts'], testTimeout: 60_000 } },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // The matchers run in a real browser: test/browser and test/runner.
      exclude: ['src/index.ts', 'src/types.ts', 'src/matchers/**'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 98 },
    },
  },
});
