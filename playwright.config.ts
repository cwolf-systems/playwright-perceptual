import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/browser',
  outputDir: 'test-results/browser',
  snapshotPathTemplate: 'test-results/snapshots/{projectName}/{arg}{ext}',
  use: { viewport: { width: 320, height: 200 } },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        // Without it Firefox on Windows runners offers no WebGL 2, and the WebGL fixtures skip.
        launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } },
      },
    },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
