// Does each comparator pass what it should and fail what it should? Run with
// `npm run bench:accuracy`; it builds first.
//
// Labelled image pairs from four sources:
// - Playwright's own image-comparison fixtures (tests/image_tools/fixtures at v1.60.0), downloaded
//   on first run into bench/data. They are Playwright's files and are not redistributed here.
// - This repository's fixture pages, rendered now in each browser, with labelled variants.
// - The same pages at 2× device scale: a held-out set, kept apart from the two the noise detectors
//   were designed on, and reported separately.
// - Synthetic pairs that reproduce findings from a renderer's test suite (bench/synthetic.mjs),
//   also reported separately, pair by pair.
//
// Comparators: exact bytes, pixelmatch at its default threshold and at Playwright's, Playwright's
// experimental ssim-cie94 (loaded from Playwright's own bundle, as its tests do), looks-same, and
// this package. Each is judged at two tolerances: no changed pixels, and 0.1% of the image.

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import looksSame from 'looks-same';
import pixelmatch from 'pixelmatch';
import { decodePng, PerceptualComparator } from '../dist/index.js';
import { playwrightPairs, renderedPairs, syntheticPairs } from './corpus.mjs';
import { structural } from './experiments/detectors.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOLERANCES = [0, 0.001];

const require = createRequire(import.meta.url);
const playwrightCore = require(
  join(dirname(require.resolve('playwright-core/package.json')), 'lib', 'coreBundle.js'),
);

/** A labelled pair from bench/corpus.mjs, decoded. */
const decoded = (pairs) =>
  pairs.map((p) => ({
    ...p,
    expected: decodePng(p.expectedPng),
    actual: decodePng(p.actualPng),
  }));

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
  'design set': decoded([...(await playwrightPairs()), ...(await renderedPairs(1))]),
  'held-out set': decoded(await renderedPairs(2)),
  'synthetic set': decoded(syntheticPairs()),
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

/** Changed pixels by comparator for each pair, with wrong verdicts at no allowance in bold. */
function reportPairs(rows) {
  console.log(`### Changed pixels by pair\n`);
  console.log(
    `| Comparator | ${rows.map((r) => `${r.name} (${r.shouldMatch ? 'match' : 'fail'})`).join(' | ')} |`,
  );
  console.log(`|---|${rows.map(() => '---').join('|')}|`);
  for (const name of Object.keys(COMPARATORS)) {
    const cells = rows.map((r) => {
      const count = r.counts[name];
      const shown = Number.isFinite(count) ? String(count) : 'differ';
      return (count === 0) === r.shouldMatch ? shown : `**${shown}**`;
    });
    console.log(`| ${name} | ${cells.join(' | ')} |`);
  }
  console.log('');
}

for (const set of Object.keys(SETS)) {
  const rows = results.filter((r) => r.set === set);
  report(set, rows);
  if (set === 'synthetic set') reportPairs(rows);
}

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
