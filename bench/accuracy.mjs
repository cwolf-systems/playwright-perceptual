// Does each comparator pass what it should and fail what it should? Run with
// `npm run bench:accuracy`; it builds first.
//
// Labelled image pairs from five sources:
// - Playwright's own image-comparison fixtures (tests/image_tools/fixtures at v1.60.0), downloaded
//   on first run into bench/data. They are Playwright's files and are not redistributed here.
// - This repository's fixture pages, rendered now in each browser, with labelled variants.
// - The same pages at 2× device scale: a held-out set, kept apart from the two the noise detectors
//   were designed on, and reported separately.
// - Synthetic pairs that reproduce findings from a renderer's test suite (bench/synthetic.mjs),
//   also reported separately, pair by pair.
// - Synthetic should-fail cases the pages lack (bench/cases.mjs): a removed one-pixel line, text
//   anti-aliasing and hinting changes, dark themes. Reported separately, pair by pair.
//
// Then self-noise: each page rendered ten times in each browser at 1× and 2×, every pair of
// renders compared, reported by page. `npm run bench:accuracy -- --self-noise` runs it alone.
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
import { compareImages, decodePng, PerceptualComparator } from '../dist/index.js';
import { MIN_CHANGED, MIN_DELTA_E } from './cases.mjs';
import {
  casePairs,
  playwrightPairs,
  renderedPairs,
  repeatedRenders,
  SELF_NOISE_RENDERS,
  selfNoisePairs,
  syntheticPairs,
} from './corpus.mjs';
import { structural } from './experiments/detectors.mjs';
import { rateCell } from './stats.mjs';

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

// `--self-noise` runs the self-noise set alone. It is quick, and a render that differs only now
// and then shows only over repeated runs.
const SELF_NOISE_ONLY = process.argv.includes('--self-noise');

const SETS = SELF_NOISE_ONLY
  ? {}
  : {
      'design set': decoded([...(await playwrightPairs()), ...(await renderedPairs(1))]),
      'held-out set': decoded(await renderedPairs(2)),
      'synthetic set': decoded(syntheticPairs()),
      'cases set': decoded(casePairs()),
    };

const results = [];
for (const [set, pairs] of Object.entries(SETS)) {
  for (const p of pairs) {
    const counts = {};
    for (const [name, compare] of Object.entries(COMPARATORS)) counts[name] = await compare(p);
    results.push({ ...p, set, counts });
  }
}

/**
 * Wrong verdicts by comparator, in a markdown table per tolerance. Each cell gives the count, its
 * share of the group and the share's 95% interval (Wilson), since a group of 9 to 24 pairs moves 4
 * to 11 points with each pair.
 */
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
      const wrong = GROUPS.map((g) =>
        rateCell(
          rows.filter((r) => {
            const allowed = tolerance * r.expected.width * r.expected.height;
            return group(r) === g && r.counts[name] <= allowed !== r.shouldMatch;
          }).length,
          sizes[g],
        ),
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

/** Every noise class counted, as test/compare/cases.test.ts measures the cases set. */
const STRICT = { ignoreAntialiasing: false, ignoreShifts: false, ignoreRounding: false };

/**
 * Whether each removed-line and case pair is the change it is labelled as: the pixels past ΔE00 1
 * with nothing set aside, and the largest ΔE00. A pair with fewer than MIN_CHANGED such pixels, or
 * none reaching MIN_DELTA_E, does not belong in the benchmark as should-fail.
 */
function reportChanges(rows) {
  console.log(`## Should-fail pairs: the change each makes\n`);
  console.log(
    `| Pair | Past ΔE00 1, nothing set aside | Largest ΔE00 | At least ${MIN_CHANGED}, some ΔE00 ${MIN_DELTA_E} or more |`,
  );
  console.log('|---|---|---|---|');
  for (const r of rows) {
    const { differing, deltaE } = compareImages(r.expected, r.actual, STRICT);
    const meets = differing >= MIN_CHANGED && deltaE.max >= MIN_DELTA_E;
    console.log(
      `| ${r.id} | ${differing} | ${deltaE.max.toFixed(1)} | ${meets ? 'yes' : '**no**'} |`,
    );
  }
  console.log('');
}

for (const set of Object.keys(SETS)) {
  const rows = results.filter((r) => r.set === set);
  report(set, rows);
  if (set === 'synthetic set' || set === 'cases set') reportPairs(rows);
}
if (!SELF_NOISE_ONLY) {
  reportChanges(results.filter((r) => r.category === 'line removed' || r.set === 'cases set'));
}

/**
 * Each page rendered SELF_NOISE_RENDERS times in one browser, every pair of renders compared. The
 * pairs of one page are not independent, so rates are over pages: a page renders identically if
 * every pair of its renders has the same bytes, and a comparator fails a page if it fails any pair.
 */
async function selfNoise() {
  const pages = [];
  for (const scale of [1, 2]) {
    for (const render of await repeatedRenders(scale)) {
      const pairs = decoded(selfNoisePairs(render));
      const differing = pairs.filter((p) => !p.expectedPng.equals(p.actualPng));
      // Pairs with the same bytes pass every comparator, so only the others are compared.
      const failed = {};
      for (const [name, compare] of Object.entries(COMPARATORS)) {
        failed[name] = Object.fromEntries(TOLERANCES.map((t) => [t, 0]));
        for (const p of differing) {
          const count = await compare(p);
          for (const t of TOLERANCES) {
            if (count > t * p.expected.width * p.expected.height) failed[name][t]++;
          }
        }
      }
      const name = `${scale}× ${render.browserName}/${render.page}`;
      pages.push({ name, pairs: pairs.length, differing: differing.length, failed });
    }
  }
  return pages;
}

function reportSelfNoise(pages) {
  const identical = pages.filter((p) => p.differing === 0).length;
  console.log(`## Self-noise: each page rendered ${SELF_NOISE_RENDERS} times on ${platform()}\n`);
  console.log(
    `Pages, by browser and scale, whose renders all have the same bytes, out of ` +
      `${pages.length}: ${rateCell(identical, pages.length)}.\n`,
  );
  console.log('### Pages failed, out of all pages (any pair failed)\n');
  console.log(`| Comparator | ${TOLERANCES.map((t) => `${t * 100}% allowed`).join(' | ')} |`);
  console.log(`|---|${TOLERANCES.map(() => '---').join('|')}|`);
  for (const name of Object.keys(COMPARATORS)) {
    const cells = TOLERANCES.map((t) =>
      rateCell(pages.filter((p) => p.failed[name][t] > 0).length, pages.length),
    );
    console.log(`| ${name} | ${cells.join(' | ')} |`);
  }
  console.log('');
  const moved = pages.filter((p) => p.differing > 0);
  if (moved.length === 0) return;
  console.log('### Pages whose renders differ: pairs failed, none allowed and 0.1% allowed\n');
  console.log(`| Comparator | ${moved.map((p) => p.name).join(' | ')} |`);
  console.log(`|---|${moved.map(() => '---').join('|')}|`);
  console.log(
    `| pairs not byte-identical | ${moved.map((p) => `${p.differing} of ${p.pairs}`).join(' | ')} |`,
  );
  for (const name of Object.keys(COMPARATORS)) {
    const cells = moved.map((p) => TOLERANCES.map((t) => p.failed[name][t]).join(', '));
    console.log(`| ${name} | ${cells.join(' | ')} |`);
  }
  console.log('');
}

reportSelfNoise(await selfNoise());

const resultsDir = join(ROOT, 'bench', 'results');
mkdirSync(resultsDir, { recursive: true });
if (!SELF_NOISE_ONLY) {
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
}
