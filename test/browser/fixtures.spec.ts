import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect as base, test, type Page, type TestInfo } from '@playwright/test';
import { perceptualMatchers } from '../../src/index.js';
import { ALL_FIXTURES, COLOUR_NOISE, NO_WEBGL, openFixture } from './fixtures.js';

const expect = base.extend(perceptualMatchers);

async function saveBaseline(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.snapshotPath(`${name}.png`, { kind: 'screenshot' });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, await page.screenshot({ animations: 'disabled', caret: 'hide' }));
}

for (const name of COLOUR_NOISE) {
  test(`${name}: a colour change too small to see still matches`, async ({ page }, testInfo) => {
    test.skip(!(await openFixture(page, name)), NO_WEBGL);
    await saveBaseline(page, testInfo, `${name}-subtle`);
    await openFixture(page, name, 'subtle');
    await expect(page).toMatchPerceptually(`${name}-subtle`);
  });
}

for (const name of ALL_FIXTURES) {
  test(`${name}: a visible regression does not match`, async ({ page }, testInfo) => {
    test.skip(!(await openFixture(page, name)), NO_WEBGL);
    await saveBaseline(page, testInfo, `${name}-regression`);
    await openFixture(page, name, 'regression');
    await expect(page).not.toMatchPerceptually(`${name}-regression`);
  });
}

for (const name of ALL_FIXTURES) {
  test(`${name}: a faint but visible regression does not match`, async ({ page }, testInfo) => {
    test.skip(!(await openFixture(page, name)), NO_WEBGL);
    await saveBaseline(page, testInfo, `${name}-faint`);
    await openFixture(page, name, 'faint');
    await expect(page).not.toMatchPerceptually(`${name}-faint`);
  });
}
