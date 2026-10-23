# Changelog

## 0.2.0 (2026-10-22)

### Stricter: may fail renders that passed before

- **Shift tolerance no longer takes a change of colour for a move.** In 0.1.0 it passed any pixel
  within three levels per channel of the colours around it, and a pixel's own old colour is
  always around it, so any change of up to three levels per channel passed as a shift: a tint
  across a flat panel, a dark theme a shade lighter, a GPU readback drifting by two levels. That
  range test stays, and the 5×5 window around the pixel must now also show that nothing but a
  move happened: each channel's mean over it changed by at most 1.5 levels, or a move of under
  0.75 px explains the change, found by registering the window (one Lucas–Kanade step) and
  agreeing within 0.4 px with the move of the 32×32 tile around it. An edge
  resampled differently, a mixture in both images of the same two colours on either side of it
  that kept their colour, also passes. Texture has no offset that explains a change of colour
  over it, so of a translucent overlay made 5 points more transparent over terrain, 89% of the
  pixels past ΔE00 1 now count, against 0.1% in 0.1.0 (93% of the synthetic reproduction in the
  accuracy benchmark, against none), and of a drift of one to three levels over a whole textured
  frame, 98%, against none. Windows are clipped at the image's border, so slivers and small element
  screenshots are judged as well: a tint on a 200×2, 1×50 or 2×2 panel counts in full.
- **Renders whose colour drifts by two levels or more over an area now fail.** In a renderer's
  golden set of 56 pairs of identical input, 10 failed with 0.1.0 and 11 now: one scene's first
  capture is one to two levels darker over nearly half the frame (37,240 pixels counted against
  each of the other two captures).
- **Pairs that already differed gain counted pixels.** Self-noise in that golden set: a map label
  one pixel over between loads, 139 → 869 pixels, which still passes with 0.1% allowed. In this
  repository's benchmark, among pairs that should match and already failed: the 2D map through
  the GPU against software at 2×, 5,067 → 10,415; the map and 3D view moved 0.3 px, by up to
  2,254; the chart through the GPU against software at 2×, 2 → 248, inside 0.1%; the CSS effects
  through the GPU against software, 3 → 59 at 1×, inside 0.1%, where it also fails at ΔE00 1.5
  (11 pixels: near-white drifting two levels in blue over an area). Text and SVG moved 0.3 px
  lose counted pixels: 333 → 260, 222 → 204.
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

### Speed

- Changed images compare faster than in 0.1.0 in every case the redesign's judge times (medians
  of 5, one machine): a fully changed 3200×2000 image in `npm run bench`, 3.5 s from 4.6 s; a
  drift of one to three levels over a whole textured 1346×819 frame, 451 ms from 604 ms; a real
  whole-frame change in a renderer's capture, 374 ms from 444 ms; film grain over that frame,
  51 ms from 439 ms, since rounding is checked before the detectors. The detectors read a pair of
  images once per 32×32 tile, where they need to, and sum each window from summed-area tables in
  a few lookups.

### Other

- `docs/design/registration.md` records how the shift detector was chosen, with the numbers.
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
