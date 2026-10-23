# Changelog

## 0.2.0 (2026-10-22)

### Stricter: may fail renders that passed before

- **Shift tolerance no longer takes a change of colour for a move.** In 0.1.0 it passed any pixel
  within three levels per channel of the colours around it, and a pixel's own old colour is
  always around it, so any change of up to three levels per channel passed as a shift: a tint
  across a flat panel, a dark theme a shade lighter, a GPU readback drifting by two levels. It is
  now one box-filter rule. A move of under a pixel only carries colour across a box's border, and
  changes the box's total by no more than moving the box a whole pixel would. So both images are
  box-filtered, and at a changed pixel one image's 5×5 box total must lie within the range of the
  other's at the box and one pixel over, give or take a level per pixel; and the pixel's own
  colour must lie within the colours next to it, both ways round, give or take three levels, as
  before. Near the image's border the box moves inward, so the border and small element
  screenshots are judged too, down to two pixels high or wide.
- **Renders whose colour drifts by two levels or more over an area now fail.** In a renderer's
  golden set of 56 pairs of identical input, 10 failed with 0.1.0 and 12 now: one scene's first
  capture is one to two levels darker over nearly half the frame (44,548 pixels counted against
  each of the other two captures). Over fine texture, where the colour changes by a level or more
  per pixel, a drift of a level or two mostly still passes; see Limits.
- **Pairs that already differed gain counted pixels.** Self-noise in that golden set: a map label
  one pixel over between loads, 139 → 165 pixels; a second scene's label and box edge, 82 → 94.
  In this repository's benchmark, among pairs that should match: the 2D map through the GPU
  against software, 894 → 954 at 1× and 5,067 → 5,741 at 2×; the map and 3D view moved 0.3 px
  at 2×, by up to 95; CSS effects through the GPU against software, 3 → 9 at 1× and 48 → 187 at
  2×, where it now also fails at ΔE00 1.5.
- **Anti-aliasing detection asks that the flat area beside a slope keep its colour**, give or take
  a level. A uniform change of colour no longer passes there as anti-aliasing.
- If a test starts failing, look at the diff image: red is what counts. If the change is
  acceptable, update the baseline (`--update-snapshots`), or allow a few pixels with
  `maxDiffPixelRatio` where the render is known to be noisy.

### Behaviour changes

- **Rounding is its own class.** A pixel past `maxDeltaE` whose channels each differ by at most
  one level is skipped, counted in `rounded`, noted in the failure message and painted pale blue
  in the diff image. Such a pixel can reach ΔE00 2.45, in near-black greys. `ignoreRounding`
  defaults to on while shift tolerance is on, which in 0.1.0 already skipped these pixels as
  shifts, and to off when `ignoreShifts: false` or the shift detector is `null`, so turning shift
  tolerance off still counts every pixel past `maxDeltaE`, as in 0.1.0. Set
  `ignoreRounding: true` to skip rounding with the detectors off, as a GPU readback compared with
  an exact reference may want, or `ignoreRounding: false` to count it with shift tolerance on.
- `PerceptualComparison.rounded` is new and optional in the type, so comparisons built by hand
  still type-check; the built-in comparator always sets it.
- Playwright 1.64's `default` update mode is supported, and `missing` follows it there: a missing
  baseline is written and the test fails in `default`, and passes in `missing`, as with
  `toHaveScreenshot`. With Playwright before 1.64, `missing` still writes and fails. `UpdateMode`
  gains `'default'`; `matchSnapshot` callers who passed `'missing'` to get a failing write should
  pass `'default'`.

- **The screenshot matcher stops counting past the allowance while it waits for a stable
  screenshot**, and for `.not`, where only the verdict is used; the failure message still comes
  from a full comparison. `ImageComparator.compare` takes an optional third argument, `limit`,
  and a `Comparison` may set `exceeded` when it stopped there. A custom comparator needs no
  change: it may ignore `limit`. Code that calls `compare` itself gets full counts unless it
  passes a limit.
- `isShifted` keeps the box filter of the tiles it has read for each `Pixels` object. A custom
  detector built on it must not change an image's pixels while it is being judged; the
  comparator passes new ones for each comparison.

### Limits

- In an image one pixel high or wide, shift tolerance cannot test that side, since what lies
  beyond the image is unknown, and any change passes as a shift. Use `ignoreShifts: false` for
  such slivers. Images two pixels across are judged.
- Over texture whose colour changes by a level or more per pixel, a drift of one to three levels
  is mostly taken for a move: the judge's textured drift over a whole 1346×819 frame has 3.6% of
  its changed pixels counted, enough to fail it with up to 2% of the image allowed. Of a faint
  overlay change over terrain, about a fifth still passes as shifts, beside contour lines.

### Speed

Measured by the redesign round's judge (median of five, Apple M4, Node 22) against 0.1.0 on the
same machine; `npm run bench` gives the same picture in [docs/benchmarks/speed.md](docs/benchmarks/speed.md).

- Fully changed images compare in about two thirds of 0.1.0's time: 3200×2000 in 2.6 s, from
  4.1 s; 1920×1080 in 0.90 s, from 1.37 s. CIELAB and ΔE are cached in fixed tables, and the
  shift test reads 20 values per channel at most, whatever the size of its box.
- A drift of one to three levels over a whole textured 1346×819 frame takes 332 ms, from 551 ms;
  a real whole-frame change of that size 340 ms, from 406 ms. Each box is computed once, with
  running sums over tiles of the image, rather than read pixel by pixel at every changed pixel.
- Grainy images are four to twenty times faster (22 ms from 411 ms for synthetic grain, 56 ms
  from 239 ms for a real one), since rounding is checked before the detectors.
- With 1% of a 1280×720 image changed, comparison takes 10.5 ms, from 8.7 ms: the tiles around
  the first changed pixels are filtered whole.

### Other

- The accuracy benchmark has a synthetic set reproducing four findings from a renderer's tests,
  and reports it pair by pair.
- Source maps carry the TypeScript sources, so stack traces and debuggers show them.
- The matchers' types are exported: `PerceptualMatchers`, `ToMatchPerceptually` and
  `ToBePerceptuallyNear`.

## 0.1.0

First release.

- `toMatchPerceptually`: screenshot assertions judged by CIEDE2000 colour difference, with
  `toHaveScreenshot`'s baselines, update modes, stable-screenshot loop and report attachments.
- `toBePerceptuallyNear`: the same comparison for pixels read back from a canvas.
- Anti-aliasing and sub-pixel shift tolerance, each replaceable or switchable off.
- Speed and accuracy benchmarks against pixelmatch, Playwright's experimental comparator and
  looks-same.
