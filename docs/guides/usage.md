# Using the matchers

Register the matchers once, then use them like Playwright's own.

```ts
import { expect as base, test } from '@playwright/test';
import { perceptualMatchers } from '@cwolf-systems/playwright-perceptual';

export const expect = base.extend(perceptualMatchers);
```

## Screenshots: `toMatchPerceptually`

```ts
await expect(page).toMatchPerceptually('dashboard');
await expect(page.locator('canvas')).toMatchPerceptually('map', { maxDiffPixelRatio: 0.001 });
```

It behaves like `toHaveScreenshot`:

- Baselines live where Playwright keeps screenshot baselines (`snapshotPathTemplate`, per
  project and platform by default).
- Screenshots are retaken until two in a row agree, or until the timeout. A first
  screenshot that already matches the baseline is accepted at once.
- Update modes follow `--update-snapshots`: a missing baseline is written and the test fails
  (`missing`, the default), or passes (`changed`, `all`); `changed` rewrites baselines that differ;
  `all` rewrites every one; `none` writes nothing.
- Failures attach `<name>-expected`, `-actual` and `-diff` images, which the HTML report shows
  as an image diff, and the message gives the changed pixels and the ΔE00 distribution. In the diff
  image, changes are red, anti-aliasing yellow and sub-pixel shifts blue.
- `.not` passes when the screenshot differs from its baseline; it never writes one.

## Pixels: `toBePerceptuallyNear`

For pixels read back from the page, such as a canvas or WebGL `readPixels`, with no PNG encoding
on the way:

```ts
expect(pixels).toBePerceptuallyNear(expected, { maxDeltaE: 1, within: 0.99 });
```

Both arguments are `{ data, width, height }` with 8-bit RGBA data.

## Options

| Option               | Default            | Meaning                                                        |
| -------------------- | ------------------ | -------------------------------------------------------------- |
| `maxDeltaE`          | `1`                | Largest ΔE00 a pixel can have and still count as unchanged     |
| `maxDiffPixels`      | `0`                | Changed pixels allowed                                         |
| `maxDiffPixelRatio`  |                    | Changed pixels allowed, as a share of all pixels               |
| `ignoreAntialiasing` | `true`             | Skip pixels that look like anti-aliasing                       |
| `ignoreShifts`       | `true`             | Skip pixels that differ only by a sub-pixel move               |
| `within`             | `1`                | `toBePerceptuallyNear`: share of pixels that must be unchanged |
| `timeout`            | the expect timeout | How long to wait for a stable screenshot                       |
| `comparator`         | perceptual         | Any `ImageComparator`, replacing the built-in one              |

Screenshot options (`animations`, `caret`, `scale`, `mask`, `maskColor`, `omitBackground`,
`style`, and for pages `clip` and `fullPage`) pass through to `screenshot()` with
`toHaveScreenshot`'s defaults: animations disabled, caret hidden, CSS scale.

Out-of-range options throw `InvalidOptionError`; an unreadable baseline throws `PngDecodeError`.

## Choosing a tolerance

Start with the defaults. Renders that differ only in colour, such as the same scene through
another GPU, usually pass. Sub-pixel movement often does not: see the
[limits](../concepts/how-it-works.md#limits).

Set `ignoreShifts: false` where a one-pixel move is itself a regression, such as pixel-aligned
icons or borders. Shift tolerance cannot tell a hard edge moved by a whole pixel from one moved by
part of a pixel.

A small allowance, `maxDiffPixelRatio: 0.001`, absorbs isolated stray pixels. It also passes
changes of only a few pixels, like two of the regressions in the
[accuracy benchmark](../benchmarks/accuracy.md), so leave it at zero where a single pixel matters.

## Maps and 3D scenes

- Keep baselines per browser and rendering path. GPU and software rendering differ along tile
  seams and stroke edges by more than the defaults allow.
- Fix the camera and the viewport to whole pixels, and wait for tiles and terrain to finish
  loading before the assertion.
- For a WebGL canvas, `toBePerceptuallyNear` on pixels read back with `readPixels` skips PNG
  encoding and the page around the canvas.
