import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect as base, test, type Page, type TestInfo } from '@playwright/test';
import {
  createPerceptualMatchers,
  PerceptualComparator,
  perceptualMatchers,
  type ImageComparator,
} from '../../src/index.js';
import { fixture, NO_WEBGL, openFixture } from './fixtures.js';

const expect = base.extend(perceptualMatchers);

/** Saves what the page shows now as the named baseline. */
async function saveBaseline(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.snapshotPath(`${name}.png`, { kind: 'screenshot' });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, await page.screenshot({ animations: 'disabled', caret: 'hide' }));
}

const shiftGradient = (page: Page, rgb: string) =>
  page.evaluate((value) => {
    document.documentElement.style.setProperty('--from', value);
  }, rgb);

test('a page matches its baseline through a change too small to see', async ({
  page,
}, testInfo) => {
  await page.goto(fixture('gradient'));
  await saveBaseline(page, testInfo, 'gradient');
  await shiftGradient(page, '31, 60, 120');
  await expect(page).toMatchPerceptually('gradient');
});

test('a visible change does not match', async ({ page }, testInfo) => {
  await page.goto(fixture('gradient'));
  await saveBaseline(page, testInfo, 'gradient-visible');
  await shiftGradient(page, '90, 60, 120');
  await expect(page).not.toMatchPerceptually('gradient-visible');
});

test('a WebGL scene matches its own baseline after a reload', async ({ page }, testInfo) => {
  test.skip(!(await openFixture(page, 'terrain')), NO_WEBGL);
  await saveBaseline(page, testInfo, 'terrain');
  await openFixture(page, 'terrain');
  await expect(page.locator('canvas')).toMatchPerceptually('terrain', { maxDiffPixelRatio: 0.001 });
});

test('suites set defaults, and an assertion can bring its own comparator', async ({
  page,
}, testInfo) => {
  const tolerant = base.extend(createPerceptualMatchers({ maxDeltaE: 20 }));
  await page.goto(fixture('gradient'));
  await saveBaseline(page, testInfo, 'gradient-tolerant');
  await shiftGradient(page, '50, 60, 120');
  await tolerant(page).toMatchPerceptually('gradient-tolerant');

  let calls = 0;
  const inner = new PerceptualComparator({ maxDeltaE: 20 });
  const counting: ImageComparator = {
    compare: (e, a) => (calls++, inner.compare(e, a)),
    diff: (e, a) => (calls++, inner.diff(e, a)),
  };
  await expect(page).toMatchPerceptually('gradient-tolerant', { comparator: counting });
  expect(calls).toBeGreaterThan(0);
});
