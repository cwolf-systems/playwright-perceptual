import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// A Playwright project without "type": "module", as `npm init playwright` makes it. Playwright
// compiles its tests to CommonJS, so they load this package with require(), through the package's
// own "exports". The package is installed into the project as npm would: its package.json and its
// built dist/ (npm run test:runner builds first). Its dependencies and @playwright/test resolve
// from this repository's node_modules, further up.

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK = join(ROOT, 'test-results', 'runner-commonjs');
const NAME = '@cwolf-systems/playwright-perceptual';
const INSTALLED = join(WORK, 'node_modules', ...NAME.split('/'));
const require = createRequire(import.meta.url);
const PLAYWRIGHT = join(require.resolve('@playwright/test/package.json'), '..', 'cli.js');
const TSC = require.resolve('typescript/bin/tsc');

const SPEC = `
import { expect as base, test } from '@playwright/test';
import { perceptualMatchers } from '${NAME}';

const expect = base.extend(perceptualMatchers);

test('swatch', async ({ page }) => {
  await page.setContent('<body style="margin: 0; background: rgb(80, 120, 160)">');
  await expect(page).toMatchPerceptually('swatch');
});
`;

const CONFIG = `
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: './output',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  use: { browserName: 'chromium', viewport: { width: 64, height: 48 } },
});
`;

// The same import from a CommonJS file and an ECMAScript module, type-checked as Node resolves them.
const CONSUMER = `
import { perceptualMatchers, type CompareOptions } from '${NAME}';

export const options: CompareOptions = { maxDeltaE: 2 };
export const matchers: object = perceptualMatchers;
`;

const TSCONFIG = {
  compilerOptions: {
    module: 'nodenext',
    moduleResolution: 'nodenext',
    target: 'es2022',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
  files: ['consumer.cts', 'consumer.mts'],
};

function playwright(update: string) {
  return spawnSync(
    process.execPath,
    [
      PLAYWRIGHT,
      'test',
      '--config',
      join(WORK, 'playwright.config.ts'),
      `--update-snapshots=${update}`,
    ],
    { cwd: WORK, encoding: 'utf8' },
  );
}

describe('a CommonJS project', () => {
  beforeAll(() => {
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(INSTALLED, { recursive: true });
    cpSync(join(ROOT, 'package.json'), join(INSTALLED, 'package.json'));
    cpSync(join(ROOT, 'dist'), join(INSTALLED, 'dist'), { recursive: true });
    writeFileSync(join(WORK, 'package.json'), JSON.stringify({ name: 'commonjs-project' }));
    writeFileSync(join(WORK, 'swatch.spec.ts'), SPEC);
    writeFileSync(join(WORK, 'playwright.config.ts'), CONFIG);
    writeFileSync(join(WORK, 'consumer.cts'), CONSUMER);
    writeFileSync(join(WORK, 'consumer.mts'), CONSUMER);
    writeFileSync(join(WORK, 'tsconfig.json'), JSON.stringify(TSCONFIG));
  });

  it('imports the package by name and runs the matcher', () => {
    const write = playwright('all');
    expect(write.stdout + write.stderr).not.toContain('No "exports" main defined');
    expect(write.status, write.stdout + write.stderr).toBe(0);
    const compare = playwright('none');
    expect(compare.status, compare.stdout + compare.stderr).toBe(0);
    expect(readFileSync(join(WORK, 'baselines', 'swatch.png')).length).toBeGreaterThan(0);
  });

  it('is loaded the same by require() and by import', () => {
    // Node 22 loads this ES module through require() too. Both must give the one module instance,
    // or a project mixing the two would extend expect with two copies of the matchers.
    const check = `
      import { createRequire } from 'node:module';
      const required = createRequire(process.cwd() + '/').resolve('${NAME}');
      const imported = await import('${NAME}');
      const viaRequire = createRequire(process.cwd() + '/')('${NAME}');
      if (typeof imported.perceptualMatchers !== 'object') throw new Error('import: no matchers');
      if (viaRequire.perceptualMatchers !== imported.perceptualMatchers) throw new Error('two copies');
      console.log(required);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', check], {
      cwd: WORK,
      encoding: 'utf8',
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(join(INSTALLED, 'dist', 'index.js'));
  });

  it('resolves the types from CommonJS and from an ECMAScript module', () => {
    const result = spawnSync(process.execPath, [TSC, '-p', join(WORK, 'tsconfig.json')], {
      cwd: WORK,
      encoding: 'utf8',
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
