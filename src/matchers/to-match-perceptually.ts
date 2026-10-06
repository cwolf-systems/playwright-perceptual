import { test } from '@playwright/test';
import type {
  ExpectMatcherState,
  Locator,
  LocatorScreenshotOptions,
  MatcherReturnType,
  Page,
  PageScreenshotOptions,
} from '@playwright/test';
import { allowedDiffPixels, CAPTURE_DEFAULTS } from '../defaults.js';
import { decodePng } from '../image/png.js';
import { matchSnapshot } from '../snapshot/match.js';
import { FileSnapshotStore } from '../snapshot/store.js';
import type { MatcherDefaults, PerceptualScreenshotOptions, ToMatchPerceptually } from './types.js';
import { comparatorFor } from './shared.js';

const NAME = 'toMatchPerceptually';
const PNG = /\.png$/i;

const isPage = (target: Page | Locator): target is Page => 'mainFrame' in target;

/** Evaluated in the page: settles once two more frames have been drawn. */
const TWO_FRAMES =
  'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))';

/** Lets the page draw two more frames, so a capture doesn't land mid-render. */
async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(TWO_FRAMES);
}

/** Playwright's screenshot timeout, where 0 means none. */
const playwrightTimeout = (timeoutMs: number): number =>
  Number.isFinite(timeoutMs) ? Math.max(1, Math.ceil(timeoutMs)) : 0;

function screenshotOf(
  target: Page | Locator,
  options: PerceptualScreenshotOptions,
): (timeoutMs: number) => Promise<Buffer> {
  const { animations, caret, scale, mask, maskColor, omitBackground, style, fullPage, clip } = {
    ...CAPTURE_DEFAULTS,
    ...options,
  };
  const shared: LocatorScreenshotOptions = {
    animations,
    caret,
    scale,
    ...(mask && { mask }),
    ...(maskColor && { maskColor }),
    ...(omitBackground && { omitBackground }),
    ...(style && { style }),
  };
  const page = isPage(target) ? target : target.page();
  const pageOptions: PageScreenshotOptions = {
    ...shared,
    ...(fullPage && { fullPage }),
    ...(clip && { clip }),
  };
  return async (timeoutMs) => {
    await nextFrames(page);
    const timeout = playwrightTimeout(timeoutMs);
    return isPage(target)
      ? target.screenshot({ ...pageOptions, timeout })
      : target.screenshot({ ...shared, timeout });
  };
}

export function createToMatchPerceptually(defaults: MatcherDefaults): ToMatchPerceptually {
  return async function toMatchPerceptually(
    this: ExpectMatcherState,
    target: Page | Locator,
    name: string,
    overrides: PerceptualScreenshotOptions = {},
  ): Promise<MatcherReturnType> {
    const options = { ...defaults, ...overrides };
    const testInfo = test.info();
    const stem = name.replace(PNG, '');
    const store = new FileSnapshotStore(
      {
        baseline: testInfo.snapshotPath(`${stem}.png`, { kind: 'screenshot' }),
        outputPrefix: testInfo.outputPath(stem),
        attachmentName: stem,
      },
      (attachment, path) => testInfo.attach(attachment, { path, contentType: 'image/png' }),
    );
    const comparator = comparatorFor(options);
    const capture = screenshotOf(target, options);
    const hint = this.utils.matcherHint(NAME, undefined, name, { isNot: this.isNot });
    // In Playwright a timeout of 0 means none.
    const timeout = options.timeout ?? this.timeout;
    const timeoutMs = timeout === 0 ? Number.POSITIVE_INFINITY : timeout;

    if (this.isNot) {
      // `.not` asks for a difference, so it never writes a baseline it would then contradict.
      const baseline = store.readBaseline();
      if (baseline === null) {
        return {
          pass: true,
          name: NAME,
          message: () => `${hint}\n\nNo baseline at ${store.location}.`,
        };
      }
      const expected = decodePng(baseline, store.location);
      const actual = decodePng(await capture(timeoutMs), 'screenshot');
      const sameSize = expected.width === actual.width && expected.height === actual.height;
      const same =
        sameSize &&
        comparator.compare(expected, actual).differing <=
          allowedDiffPixels(options, expected.width * expected.height);
      return {
        pass: same,
        name: NAME,
        message: () =>
          `${hint}\n\nExpected the screenshot to differ from its baseline, but it matches.`,
      };
    }

    const result = await matchSnapshot({
      source: { capture, timeoutMs },
      store,
      comparator,
      tolerance: options,
      mode: testInfo.config.updateSnapshots,
    });
    // Playwright announces regenerated snapshots on the console; do the same.
    if (result.pass && result.wroteBaseline) console.log(`${store.location} updated.`);
    return {
      pass: result.pass,
      name: NAME,
      message: () => `${hint}\n\n${result.message}`,
      log: [...result.log],
    };
  };
}
