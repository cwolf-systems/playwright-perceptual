// Counts the tests in every suite and writes the total into the README's badge. With --check it
// writes nothing and fails if the badge is out of date. The Vitest suites are run, since only a
// run expands parameterised tests; the browser tests are listed. Needs Chromium for test/runner.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const README = join(ROOT, 'README.md');
const OUTPUT = join(ROOT, 'test-results', 'count');
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const PLAYWRIGHT = join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const BADGE = /img\.shields\.io\/badge\/tests-(\d+)-brightgreen/;

const node = (args) => execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });

function vitestCount(project) {
  const file = join(OUTPUT, `${project}.json`);
  node([VITEST, 'run', '--project', project, '--reporter=json', `--outputFile=${file}`]);
  return JSON.parse(readFileSync(file, 'utf8')).numTotalTests;
}

function playwrightCount() {
  const total = /Total: (\d+) tests? in/.exec(node([PLAYWRIGHT, 'test', '--list']));
  if (!total) throw new Error('playwright test --list printed no total');
  return Number(total[1]);
}

mkdirSync(OUTPUT, { recursive: true });
const counts = {
  unit: vitestCount('unit'),
  runner: vitestCount('runner'),
  browser: playwrightCount(),
};
const total = counts.unit + counts.runner + counts.browser;
console.log(
  `${total} tests: ${counts.unit} unit, ${counts.runner} runner, ${counts.browser} browser`,
);

const readme = readFileSync(README, 'utf8');
const shown = BADGE.exec(readme);
if (!shown) throw new Error('README.md has no tests badge');
if (Number(shown[1]) === total) process.exit(0);
if (process.argv.includes('--check')) {
  console.error(`README.md shows ${shown[1]} tests; run npm run test:count to update it`);
  process.exit(1);
}
writeFileSync(
  README,
  readme.replace(BADGE, (badge) => badge.replace(shown[1], String(total))),
);
console.log('Updated README.md');
