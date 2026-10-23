# Changelog

## 0.2.0 (2026-10-22)

### Stricter: may fail renders that passed before

- **Shift tolerance no longer takes a change of colour for a move.** In 0.1.0 it passed any pixel
  within three levels per channel of the colours around it, and a pixel's own old colour is
  always around it, so any change of up to three levels per channel passed as a shift: a tint
  across a flat panel, a dark theme a shade lighter, a GPU readback drifting by two levels. Shift
  tolerance now models the move: a pixel counts as shifted only if resampling one image at some
  offset of up to a pixel each way reproduces the other around it. Each image's pixel must lie
  within the range of the other's 3×3 neighbourhood, widened by three levels and half that range,
  and one offset must make the mean colour of the other image, resampled bilinearly, match within
  1.15 levels in all three channels at once, over the 7×7 window around the pixel and the 65×65
  window holding it. A tint, a fainter overlay or a drift of two levels changes those means.
  Panels of any size are judged, down to one pixel high.
- **Renders whose colour drifts by two levels or more over an area now fail**, over flat colour
  and over texture alike: a textured frame drifting by one to three levels per channel is counted
  in full. In a renderer's golden set of 56 pairs of identical input, 10 failed with 0.1.0 and 9
  now. One scene's first capture is one to two levels darker over nearly half the frame (34,695
  pixels counted against each of the other two captures, which passed in 0.1.0); three pairs that
  failed in 0.1.0 by one to eight stray pixels now pass.
- **Some pairs that already differed count more pixels, most count fewer.** In this repository's
  benchmark, among pairs that should match: the 2D map through the GPU against software, 894 →
  986 pixels at 1× and 5,067 → 11,243 at 2×; CSS effects through the GPU against software, 3 → 9
  at 1× and 48 → 86 at 2×. Pages moved 0.3 px count far fewer: the 2D map 383 → 9 and the 3D view
  161 → 0 at 1× in Chromium, and the text, SVG and 3D view of every browser now pass with 0.1% of
  the image allowed. In the golden set, a label one pixel over between loads counts 139 → 32.
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

### Limits

- A uniform change over a smooth gradient can still pass as a move where both windows are
  gradients a move slides along, as beside contour lines: about a seventh of a faint overlay
  change in a renderer's capture. An image under 67 pixels on a side is judged by the 7×7 window
  alone, which takes more of such a change for a move.

### Speed

- Whole-frame changes compare faster than in 0.1.0: in `npm run bench`, a fully changed
  3200×2000 image in about 3.2 s, from 4.5 s; a textured drift over a 1346×819 frame in about
  0.45 s, from 0.58 s; film grain three to eight times faster, since rounding is checked before
  the detectors. Window sums come from totals computed a block of a row at a time, with column
  sums updated as rows enter and leave, and most real changes are refused before any offset is
  sought.

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
