# Extending

Each part of the pipeline can be replaced on its own.

## Defaults for a whole suite

```ts
import { createPerceptualMatchers } from '@cwolf-systems/playwright-perceptual';

export const expect = base.extend(
  createPerceptualMatchers({ maxDeltaE: 2, maxDiffPixelRatio: 0.001 }),
);
```

Options given to an assertion override the suite's. `perceptualMatchers` is
`createPerceptualMatchers()` with none.

## Another comparator

Anything that implements `ImageComparator` can replace the built-in comparison, per assertion or
for a suite. A comparison reports the image size, how many pixels changed, and `notes`: lines that
follow the count in a failure message.

```ts
import type { ImageComparator } from '@cwolf-systems/playwright-perceptual';

const strict: ImageComparator = {
  compare(expected, actual) {
    /* return { width, height, differing, notes } */
  },
  diff(expected, actual) {
    /* the same, with a `diff` image */
  },
};

await expect(page).toMatchPerceptually('chart', { comparator: strict });
```

## Other colour science

`PerceptualComparator` takes its colour difference and its two noise detectors as parts:

```ts
import { PerceptualComparator, type ColorDifference } from '@cwolf-systems/playwright-perceptual';

// CIE76: Euclidean distance in CIELAB.
const cie76: ColorDifference = (x, y) => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);

const comparator = new PerceptualComparator({ maxDeltaE: 2.3 }, { colorDifference: cie76 });
```

The detectors, `antialiasing` and `shift`, each decide whether a changed pixel is rendering noise.
Pass your own `NoiseDetector`, `(image, other, x, y) => boolean`, or `null` to turn one off; with
both `null`, every changed pixel counts. A detector reads both images through `Pixels`, whose
`rgbAt(x, y)` gives a colour as `0xRRGGBB`. The built-in ones are exported as `isAntialiased` and
`isShifted`, so a detector can build on them:

```ts
import {
  isShifted,
  PerceptualComparator,
  type NoiseDetector,
} from '@cwolf-systems/playwright-perceptual';

// Tolerate shifts everywhere except the top 40 rows, where a toolbar is pixel-aligned.
const shift: NoiseDetector = (image, other, x, y) => y >= 40 && isShifted(image, other, x, y);

const comparator = new PerceptualComparator({}, { shift });
```

## Other storage

`matchSnapshot` runs the whole snapshot workflow against any `SnapshotStore`; the matcher keeps
baselines on disk where Playwright does. A store reads and writes the baseline and records a run's
images.

```ts
import { matchSnapshot, PerceptualComparator } from '@cwolf-systems/playwright-perceptual';

const result = await matchSnapshot({
  source: { capture: () => page.screenshot(), timeoutMs: 5_000 },
  store: myStore,
  comparator: new PerceptualComparator(),
  tolerance: { maxDiffPixels: 0 },
  mode: 'missing',
});
```
