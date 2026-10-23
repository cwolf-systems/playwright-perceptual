// The labelled image pairs of the accuracy benchmark, as PNG bytes, for bench/accuracy.mjs and
// bench/judge.mjs. Each pair has an `id` that names it uniquely and stays the same across runs
// and machines, so a verdict can be compared pair by pair.
//
// - Playwright's own image-comparison fixtures (tests/image_tools/fixtures at v1.60.0), downloaded
//   on first use into bench/data. They are Playwright's files and are not redistributed here.
// - This repository's fixture pages, rendered now in each browser, with labelled variants, at 1×
//   (with the Playwright fixtures, the design set) and at 2× (the held-out set).
// - Synthetic pairs that reproduce findings from a renderer's test suite (bench/synthetic.mjs).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { SYNTHETIC_PAIRS } from './synthetic.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = join(ROOT, 'bench', 'data', 'playwright-v1.60.0');
const PLAYWRIGHT_COMMIT = '87bb9ddbd78f329df18c2b24847bc9409240cd07';
const FIXTURE_PREFIX = 'tests/image_tools/fixtures/';

/** A labelled pair, as PNG bytes. */
const pair = (id, corpus, category, name, shouldMatch, expectedPng, actualPng) => ({
  id,
  corpus,
  category,
  name,
  shouldMatch,
  expectedPng,
  actualPng,
});

function readdirNames(dir) {
  return existsSync(dir) ? readdirSync(dir) : [];
}

export async function playwrightPairs() {
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
            `playwright/${label}/${group}/${stem}`,
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

const COLOUR = ['effects', 'image', 'terrain', 'map', 'viewer'];
const SHIFTED = ['text', 'svg', 'chart', 'map', 'viewer'];
const ALL = ['text', 'svg', 'effects', 'image', 'chart', 'terrain', 'map', 'viewer'];
const WEBGL = ['terrain', 'viewer'];
const VIEWPORT = { width: 320, height: 200 };
const BROWSERS = ['chromium', 'firefox', 'webkit'];

/** Each rendered pair the benchmark asks for: its variant and its label by construction. */
export function renderedPlan(deviceScaleFactor) {
  const corpus = deviceScaleFactor === 1 ? 'rendered' : `rendered ${deviceScaleFactor}×`;
  const plan = [];
  const add = (browserName, category, name, variant, shouldMatch) =>
    plan.push({
      id: `${corpus}/${category}/${browserName}/${name}`,
      corpus,
      category,
      name: `${browserName}/${name}`,
      browserName,
      page: name,
      variant,
      shouldMatch,
    });
  for (const browserName of BROWSERS) {
    for (const name of COLOUR) add(browserName, 'colour', name, 'subtle', true);
    for (const name of SHIFTED) add(browserName, 'sub-pixel shift', name, 'shifted', true);
    for (const name of ALL) add(browserName, 'regression', name, 'regression', false);
    for (const name of ALL) add(browserName, 'faint regression', name, 'faint', false);
  }
  // The same page through Chromium's software rasteriser and through the GPU: the case this
  // package is built for. Only where there is a GPU to compare against.
  for (const name of ALL) add('chromium', 'software vs GPU', name, 'gpu', true);
  return plan;
}

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

/**
 * The fixture pages rendered at a device scale. Pairs a machine cannot render (WebGL unavailable,
 * no GPU to compare with) are left out.
 */
export async function renderedPairs(deviceScaleFactor) {
  // Imported here, not above: a process that loads another checkout's build, which brings its own
  // copy of @playwright/test, may still read the other pairs from this module.
  const { chromium, firefox, webkit } = await import('@playwright/test');
  const plan = renderedPlan(deviceScaleFactor);
  const pairs = [];
  const types = { chromium, firefox, webkit };
  for (const browserName of BROWSERS) {
    const browser = await types[browserName].launch();
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor });
    for (const p of plan.filter((q) => q.browserName === browserName && q.variant !== 'gpu')) {
      const expected = await screenshot(page, p.page);
      const actual = await screenshot(page, p.page, p.variant);
      if (expected && actual) {
        pairs.push(pair(p.id, p.corpus, p.category, p.name, p.shouldMatch, expected, actual));
      }
    }
    await browser.close();
  }

  if (platform() === 'darwin') {
    const software = await chromium.launch();
    const gpu = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
    const softwarePage = await software.newPage({ viewport: VIEWPORT, deviceScaleFactor });
    const gpuPage = await gpu.newPage({ viewport: VIEWPORT, deviceScaleFactor });
    for (const p of plan.filter((q) => q.variant === 'gpu')) {
      const expected = await screenshot(softwarePage, p.page);
      const actual = await screenshot(gpuPage, p.page);
      if (expected && actual) {
        pairs.push(pair(p.id, p.corpus, p.category, p.name, p.shouldMatch, expected, actual));
      }
    }
    await software.close();
    await gpu.close();
  }
  return pairs;
}

export const encodePng = ({ data, width, height }) => {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return PNG.sync.write(png);
};

export function syntheticPairs() {
  return SYNTHETIC_PAIRS.map(({ name, finding, category, shouldMatch, make }) => {
    const { expected, actual } = make();
    return pair(
      `synthetic/${finding}/${name}`,
      'synthetic',
      category,
      `${finding}: ${name}`,
      shouldMatch,
      encodePng(expected),
      encodePng(actual),
    );
  });
}
