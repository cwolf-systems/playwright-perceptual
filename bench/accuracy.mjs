// Does each comparator pass what it should and fail what it should? Run with
// `npm run bench:accuracy`; it builds first.
//
// Labelled image pairs from three sources:
// - Playwright's own image-comparison fixtures (tests/image_tools/fixtures at v1.60.0), downloaded
//   on first run into bench/data. They are Playwright's files and are not redistributed here.
// - This repository's fixture pages, rendered now in each browser, with labelled variants.
// - The same pages at 2× device scale: a held-out set, kept apart from the two the noise detectors
//   were designed on, and reported separately.
//
// Comparators: exact bytes, pixelmatch at its default threshold and at Playwright's, Playwright's
// experimental ssim-cie94 (loaded from Playwright's own bundle, as its tests do), looks-same, and
// this package. Each is judged at two tolerances: no changed pixels, and 0.1% of the image.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';
import looksSame from 'looks-same';
import pixelmatch from 'pixelmatch';
import { decodePng, PerceptualComparator } from '../dist/index.js';
import { structural } from './experiments/detectors.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, 'bench', 'data', 'playwright-v1.60.0');
const PLAYWRIGHT_COMMIT = '87bb9ddbd78f329df18c2b24847bc9409240cd07';
const FIXTURE_PREFIX = 'tests/image_tools/fixtures/';
const TOLERANCES = [0, 0.001];

const require = createRequire(import.meta.url);
const playwrightCore = require(
  join(dirname(require.resolve('playwright-core/package.json')), 'lib', 'coreBundle.js'),
);

/** A labelled pair: expected and actual, as PNG bytes and decoded. */
function pair(corpus, category, name, shouldMatch, expectedPng, actualPng) {
  return {
    corpus,
    category,
    name,
    shouldMatch,
    expectedPng,
    actualPng,
    expected: decodePng(expectedPng),
    actual: decodePng(actualPng),
  };
}

async function playwrightCorpus() {
  if (!existsSync(DATA)) {
    const tree = await fetch(
      `https://api.github.com/repos/microsoft/playwright/git/trees/${PLAYWRIGHT_COMMIT}?recursive=1`,
    ).then((r) => r.json());
    const files = tree.tree
      .map((entry) => entry.path)
      .filter((path) => path.startsWith(FIXTURE_PREFIX) && path.endsWith('.png'));
    for (const path of files) {
      const url = `https://raw.githubusercontent.com/microsoft/playwright/${PLAYWRIGHT_COMMIT}/${path}`;
      const bytes = Buffer.from(await fetch(url).then((r) => r.arrayBuffer()));
      const target = join(DATA, path.slice(FIXTURE_PREFIX.length));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
  }
  const pairs = [];
  for (const [label, shouldMatch] of [
    ['should-match', true],
    ['should-fail', false],
  ]) {
    const root = join(DATA, label);
    for (const group of readdirNames(root)) {
      for (const file of readdirNames(join(root, group)).filter((f) => f.endsWith('-actual.png'))) {
        const stem = file.slice(0, -'-actual.png'.length);
        const read = (suffix) => readFileSync(join(root, group, `${stem}-${suffix}.png`));
        pairs.push(
          pair(
            'playwright',
            group,
            `${group}/${stem}`,
            shouldMatch,
            read('expected'),
            read('actual'),
          ),
        );
      }
    }
  }
  return pairs;
}

function readdirNames(dir) {
  return existsSync(dir) ? readdirSync(dir) : [];
}

const COLOUR = ['effects', 'image', 'terrain', 'map', 'viewer'];
const SHIFTED = ['text', 'svg', 'chart', 'map', 'viewer'];
const ALL = ['text', 'svg', 'effects', 'image', 'chart', 'terrain', 'map', 'viewer'];
const WEBGL = ['terrain', 'viewer'];
const VIEWPORT = { width: 320, height: 200 };

async function screenshot(page, name, variant) {
  const url = pathToFileURL(join(ROOT, 'test', 'browser', 'fixtures', `${name}.html`));
  if (variant) url.searchParams.set('variant', variant);
  await page.goto(url.href);
  if (WEBGL.includes(name)) {
    const webgl = await page.locator('body').getAttribute('data-webgl');
    if (webgl !== 'available') return null;
  }
  return page.screenshot({ animations: 'disabled', caret: 'hide' });
}

async function renderedCorpus(deviceScaleFactor) {
  const corpus = deviceScaleFactor === 1 ? 'rendered' : `rendered ${deviceScaleFactor}×`;
  const pairs = [];
  const browsers = [
    ['chromium', chromium, {}],
    ['firefox', firefox, {}],
    ['webkit', webkit, {}],
  ];
  for (const [browserName, type, options] of browsers) {
    const browser = await type.launch(options);
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor });
    const add = async (category, name, variant, shouldMatch) => {
      const expected = await screenshot(page, name);
      const actual = await screenshot(page, name, variant);
      if (expected && actual) {
        pairs.push(pair(corpus, category, `${browserName}/${name}`, shouldMatch, expected, actual));
      }
    };
    for (const name of COLOUR) await add('colour', name, 'subtle', true);
    for (const name of SHIFTED) await add('sub-pixel shift', name, 'shifted', true);
    for (const name of ALL) await add('regression', name, 'regression', false);
    for (const name of ALL) await add('faint regression', name, 'faint', false);
    await browser.close();
  }

  // The same page through Chromium's software rasteriser and through the GPU: the case this
  // package is built for. Only where there is a GPU to compare against.
  if (platform() === 'darwin') {
    const software = await chromium.launch();
    const gpu = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
    const softwarePage = await software.newPage({ viewport: VIEWPORT, deviceScaleFactor });
    const gpuPage = await gpu.newPage({ viewport: VIEWPORT, deviceScaleFactor });
    for (const name of ALL) {
      const expected = await screenshot(softwarePage, name);
      const actual = await screenshot(gpuPage, name);
      if (expected && actual) {
        pairs.push(pair(corpus, 'software vs GPU', `chromium/${name}`, true, expected, actual));
      }
    }
    await software.close();
    await gpu.close();
  }
  return pairs;
}

const pixelmatchAt = (threshold) => (p) =>
  pixelmatch(p.expected.data, p.actual.data, null, p.expected.width, p.expected.height, {
    threshold,
  });

const perceptualAt = (maxDeltaE, options = {}, parts = {}) => {
  const comparator = new PerceptualComparator({ maxDeltaE, ...options }, parts);
  return (p) => comparator.compare(p.expected, p.actual).differing;
};

/** Changed pixels each comparator reports; looks-same only says equal or not. */
const COMPARATORS = {
  'exact bytes': (p) => {
    let changed = 0;
    for (let i = 0; i < p.expected.data.length; i += 4) {
      if (
        p.expected.data[i] !== p.actual.data[i] ||
        p.expected.data[i + 1] !== p.actual.data[i + 1] ||
        p.expected.data[i + 2] !== p.actual.data[i + 2] ||
        p.expected.data[i + 3] !== p.actual.data[i + 3]
      ) {
        changed++;
      }
    }
    return changed;
  },
  'pixelmatch 0.05': pixelmatchAt(0.05),
  'pixelmatch 0.1 (its default)': pixelmatchAt(0.1),
  'pixelmatch 0.2 (Playwright default)': pixelmatchAt(0.2),
  'ssim-cie94 (Playwright, experimental)': (p) =>
    playwrightCore.utils.compare(
      p.actual.data,
      p.expected.data,
      null,
      p.expected.width,
      p.expected.height,
      { maxColorDeltaE94: 1 },
    ),
  'looks-same (ΔE00 2.3)': async (p) =>
    (await looksSame(p.expectedPng, p.actualPng, { tolerance: 2.3, ignoreAntialiasing: true }))
      .equal
      ? 0
      : Number.POSITIVE_INFINITY,
  'perceptual ΔE00 1': perceptualAt(1),
  'perceptual ΔE00 1.5': perceptualAt(1.5),
  'perceptual ΔE00 2': perceptualAt(2),
  'perceptual ΔE00 2.3': perceptualAt(2.3),
  'perceptual ΔE00 3': perceptualAt(3),
  'perceptual ΔE00 1.5, shifts counted': perceptualAt(1.5, { ignoreShifts: false }),
  'perceptual ΔE00 1.5, structural for edges (experiment)': perceptualAt(
    1.5,
    {},
    { antialiasing: structural() },
  ),
  'perceptual ΔE00 1.5, structural only (experiment)': perceptualAt(
    1.5,
    {},
    { antialiasing: structural(), shift: null },
  ),
};

/** What should happen to a pair, as the summary groups them. */
function group(r) {
  if (r.category === 'sub-pixel shift') return 'sub-pixel shift';
  if (r.category === 'faint regression') return 'faint regression';
  return r.shouldMatch ? 'should match' : 'large regression';
}

const GROUPS = ['should match', 'large regression', 'faint regression', 'sub-pixel shift'];
const VERDICT = {
  'should match': 'false failures',
  'large regression': 'missed',
  'faint regression': 'missed',
  'sub-pixel shift': 'false failures',
};

const SETS = {
  'design set': [...(await playwrightCorpus()), ...(await renderedCorpus(1))],
  'held-out set': await renderedCorpus(2),
};

const results = [];
for (const [set, pairs] of Object.entries(SETS)) {
  for (const p of pairs) {
    const counts = {};
    for (const [name, compare] of Object.entries(COMPARATORS)) counts[name] = await compare(p);
    results.push({ ...p, set, counts });
  }
}

/** Wrong verdicts by comparator, in a markdown table per tolerance. */
function report(set, rows) {
  const sizes = Object.fromEntries(
    GROUPS.map((g) => [g, rows.filter((r) => group(r) === g).length]),
  );
  console.log(`## ${set}: ${rows.length} pairs on ${platform()}\n`);
  for (const tolerance of TOLERANCES) {
    console.log(
      `### Allowed changed pixels: ${tolerance === 0 ? 'none' : `${tolerance * 100}%`}\n`,
    );
    console.log(
      `| Comparator | ${GROUPS.map((g) => `${g} (${sizes[g]}): ${VERDICT[g]}`).join(' | ')} |`,
    );
    console.log(`|---|${GROUPS.map(() => '---').join('|')}|`);
    for (const name of Object.keys(COMPARATORS)) {
      const wrong = GROUPS.map(
        (g) =>
          rows.filter((r) => {
            const allowed = tolerance * r.expected.width * r.expected.height;
            return group(r) === g && r.counts[name] <= allowed !== r.shouldMatch;
          }).length,
      );
      console.log(`| ${name} | ${wrong.join(' | ')} |`);
    }
    console.log('');
  }
}

for (const set of Object.keys(SETS))
  report(
    set,
    results.filter((r) => r.set === set),
  );

const resultsDir = join(ROOT, 'bench', 'results');
mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  join(resultsDir, `accuracy-${platform()}.json`),
  JSON.stringify(
    results.map(({ set, corpus, category, name, shouldMatch, counts }) => ({
      set,
      corpus,
      category,
      name,
      shouldMatch,
      counts,
    })),
    null,
    2,
  ),
);
