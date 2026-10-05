import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

// Runs a real Playwright test with the matcher in each --update-snapshots mode and checks what it
// did: the exit code, the baseline on disk and the images attached to the report.

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK = join(ROOT, 'test-results', 'runner');
const BASELINE = join(WORK, 'baselines', 'swatch.png');
const REPORT = join(WORK, 'report.json');
const CLI = join(
  createRequire(import.meta.url).resolve('@playwright/test/package.json'),
  '..',
  'cli.js',
);

const SAME = 'rgb(80, 120, 160)';
const INVISIBLE = 'rgb(80, 120, 161)';
const VISIBLE = 'rgb(80, 150, 160)';

const SPEC = `
import { expect as base, test } from '@playwright/test';
import { perceptualMatchers } from '${relative(WORK, join(ROOT, 'src', 'index.js')).replaceAll('\\', '/')}';

const expect = base.extend(perceptualMatchers);

test('swatch', async ({ page }) => {
  await page.setContent(\`<body style="margin: 0; background: \${process.env.SWATCH}">\`);
  if (process.env.SETTLE_MS) {
    // Repaint the page every frame for a while before it settles on the swatch.
    await page.evaluate((ms) => {
      const end = performance.now() + ms;
      const frame = (now) => {
        if (now >= end) return;
        document.body.style.opacity = String(0.5 + 0.5 * Math.random());
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      setTimeout(() => (document.body.style.opacity = '1'), ms);
    }, Number(process.env.SETTLE_MS));
  }
  await expect(page).toMatchPerceptually('swatch');
});
`;

const CONFIG = `
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: './output',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  reporter: [['json', { outputFile: 'report.json' }]],
  use: { browserName: 'chromium', viewport: { width: 64, height: 48 } },
  expect: { timeout: Number(process.env.EXPECT_TIMEOUT ?? 5000) },
});
`;

interface Run {
  readonly passed: boolean;
  readonly stdout: string;
  readonly attachments: readonly string[];
}

interface JsonReport {
  suites: { specs: { tests: { results: { attachments: { name: string }[] }[] }[] }[] }[];
}

function run(swatch: string, mode: string, env: Record<string, string> = {}): Run {
  const result = spawnSync(
    process.execPath,
    [CLI, 'test', '--config', join(WORK, 'playwright.config.ts'), `--update-snapshots=${mode}`],
    { cwd: WORK, env: { ...process.env, ...env, SWATCH: swatch }, encoding: 'utf8' },
  );
  const report = JSON.parse(readFileSync(REPORT, 'utf8')) as JsonReport;
  const attachments = report.suites
    .flatMap((suite) => suite.specs)
    .flatMap((spec) => spec.tests)
    .flatMap((test) => test.results)
    .flatMap((r) => r.attachments.map((a) => a.name))
    .filter((name) => name.startsWith('swatch-'))
    .sort();
  return { passed: result.status === 0, stdout: result.stdout, attachments };
}

const baseline = (): Buffer | null => (existsSync(BASELINE) ? readFileSync(BASELINE) : null);

describe('update modes, through the Playwright runner', () => {
  beforeEach(() => {
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(WORK, { recursive: true });
    writeFileSync(join(WORK, 'swatch.spec.ts'), SPEC);
    writeFileSync(join(WORK, 'playwright.config.ts'), CONFIG);
  });

  it('missing: writes an absent baseline and fails', () => {
    const first = run(SAME, 'missing');
    expect(first.passed).toBe(false);
    expect(baseline()).not.toBeNull();
    expect(first.attachments).toEqual(['swatch-actual.png', 'swatch-expected.png']);
    expect(run(SAME, 'missing').passed).toBe(true);
  });

  it('none: writes nothing, and fails without a baseline', () => {
    expect(run(SAME, 'none').passed).toBe(false);
    expect(baseline()).toBeNull();
  });

  it('a visible change fails with the three images the report shows as a diff', () => {
    run(SAME, 'missing');
    const before = baseline();
    const changed = run(VISIBLE, 'none');
    expect(changed.passed).toBe(false);
    expect(changed.attachments).toEqual([
      'swatch-actual.png',
      'swatch-diff.png',
      'swatch-expected.png',
    ]);
    expect(baseline()).toEqual(before);
  });

  it('a change too small to see passes, and changed leaves the baseline alone', () => {
    run(SAME, 'missing');
    const before = baseline();
    expect(run(INVISIBLE, 'changed').passed).toBe(true);
    expect(baseline()).toEqual(before);
  });

  it('changed: rewrites a baseline that differs, and passes', () => {
    run(SAME, 'missing');
    const before = baseline();
    const updated = run(VISIBLE, 'changed');
    expect(updated.passed).toBe(true);
    expect(baseline()).not.toEqual(before);
    expect(updated.stdout).toContain('updated');
    expect(run(VISIBLE, 'none').passed).toBe(true);
  });

  it('an expect timeout of 0 waits for a page that is still repainting to settle', () => {
    run(SAME, 'missing');
    const settling = run(SAME, 'none', { EXPECT_TIMEOUT: '0', SETTLE_MS: '600' });
    expect(settling.passed).toBe(true);
  });

  it('all: rewrites even a matching baseline', () => {
    run(SAME, 'missing');
    writeFileSync(BASELINE, Buffer.alloc(0));
    expect(run(SAME, 'all').passed).toBe(true);
    expect(baseline()?.length).toBeGreaterThan(0);
  });
});
