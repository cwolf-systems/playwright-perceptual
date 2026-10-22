# Changelog

## 0.2.0 (unreleased)

### Stricter: may fail renders that passed before

- **Shift tolerance no longer takes a change of colour for a move.** In 0.1.0 it passed any pixel
  within three levels per channel of the colours around it, and a pixel's own old colour is
  always around it, so any change of up to three levels per channel passed as a shift: a tint
  across a flat panel, a dark theme a shade lighter, a GPU readback drifting by two levels. A
  pixel now counts as shifted only if the colour in the 5×5 window around it is also conserved,
  as a move of under a pixel conserves it, give or take a level per pixel for rounding. Near the
  image's border the window moves inward, so the border and small element screenshots are
  judged too.
- **Renders whose colour drifts by two levels or more over an area now fail.** In a renderer's
  golden set of 56 pairs of identical input, 10 failed with 0.1.0 and 12 now: one scene's first
  capture is one to two levels darker over nearly half the frame (41,872 pixels counted against
  each of the other two captures).
- **Pairs that already differed gain counted pixels.** Self-noise in that golden set: a map label
  one pixel over between loads, 139 → 150 pixels; a second scene's label and box edge, 82 → 94.
  In this repository's benchmark, among pairs that should match: the 2D map through the GPU
  against software at 2×, 5,067 → 5,581; the map and 3D view moved 0.3 px at 2×, by up to 72;
  CSS effects through the GPU against software, 3 → 9 at 1× and 48 → 116 at 2×, where it now
  also fails at ΔE00 1.5 (11 pixels).
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

### Limits

- In an image under three pixels high or wide, shift tolerance cannot test whether colour was
  conserved along that side, since what lies beyond the image is unknown, so 0.1.0's rule still
  applies there. Use `ignoreShifts: false` for such slivers.

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
