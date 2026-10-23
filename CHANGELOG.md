# Changelog

## 0.2.0 (2026-10-22)

### Stricter: may fail renders that passed before

- **Shift tolerance no longer takes a change of colour for a move.** In 0.1.0 it passed any pixel
  within three levels per channel of the colours around it, and a pixel's own old colour is
  always around it, so any change of up to three levels per channel passed as a shift: a tint
  across a flat panel, a dark theme a shade lighter, a GPU readback drifting by two levels. It is
  now one rule about boxes of pixels. A move of under a pixel only carries colour across a box's
  border, and changes the box's total by no more than moving the box a whole pixel would. So at a
  changed pixel one image's box total must lie within the range of the other's at the box and one
  pixel over, give or take rounding, over a 65×65 box and a 5×5 box, and over the pixel alone,
  both ways round, give or take three levels as before. Where a neighbour kept its colour, the
  pixel's range is widened by the contrast around it, since a rasteriser draws an edge more
  sharply than resampling mixes it. Near the image's border the boxes move inward, so the border
  and small element screenshots are judged too, down to one pixel high or wide.
- **Renders whose colour drifts by two levels or more over an area now fail, over texture too.** A
  drift of one to three levels over a whole textured 1346×819 frame, which 0.1.0 passes, is
  counted in full. In a renderer's golden set of 56 pairs of identical input, 10 failed with no
  allowance with 0.1.0 and 9 now; one scene's first capture is one to two levels darker over
  nearly half the frame (37,112 pixels counted against each of the other two captures), which
  fails as it should.
- **Some pairs that should match count more pixels.** In this repository's benchmark, the 2D map
  through the GPU against the software rasteriser at 2×, which failed before, from 5,067 to 9,694;
  CSS effects through the GPU, from 3 to 8 at 1× and from 48 to 85 at 2×, still within 0.1%. Most
  sub-pixel moves count fewer: text at 1× from 325–438 to 205–279, and the 3D view at 1× from
  161–163 to 14–22, which now passes with 0.1% allowed.
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
- `isShifted` keeps a summed-area table of the tiles it has read for each `Pixels` object. A
  custom detector built on it must not change an image's pixels while it is being judged; the
  comparator passes new ones for each comparison.
- The comparator asks the built-in anti-aliasing detector once for both images, sharing the check
  that a neighbour kept its colour. A detector passed as `antialiasing` is still asked each way
  round, as before.

### Limits

- Beside an edge that did not move, a faint change of colour can pass as a shift: a move of the
  edge by a small part of a pixel carries as much colour across each box's border as the change
  took away. Ground three levels darker within a few pixels of an edge passes, as it does with
  0.1.0. Of a real faint overlay change over terrain, 17% of the changed pixels still pass this
  way, beside contour lines.
- On random noise most sub-pixel moves count as changes: no neighbour keeps its colour, so the
  pixel's range is not widened. The box tests alone pass every bilinear move of such content.
- In an image one pixel high or wide, what lies beyond the image across that side is unknown, so
  shift tolerance allows no move across it: a sub-pixel move of content across such a sliver
  counts as a change. In 0.1.0 such slivers took any change within three levels of the colours
  nearby for a shift.

### Speed

Measured by the redesign judge against 0.1.0 on the same machine (median of five, Apple M4,
Node 22); `npm run bench` gives the same picture in
[docs/benchmarks/speed.md](docs/benchmarks/speed.md).

- Fully changed images compare in about half of 0.1.0's time: 3200×2000 in 2.35 s, from 4.49 s;
  1920×1080 in 0.80 s, from 1.41 s. CIELAB and ΔE are cached in fixed tables, anti-aliasing is
  asked once for both images and stops where no neighbour kept its colour, and every box total is
  four reads of a summed-area table.
- A drift of one to three levels over a whole textured 1346×819 frame takes 271 ms, from 572 ms;
  a real whole-frame change of that size 359 ms, from 462 ms.
- Grainy images are three to twenty times faster (22 ms from 448 ms for synthetic grain, 85 ms
  from 258 ms for a real one), since rounding is checked before the detectors.
- With 1% of a 1280×720 image changed, comparison takes 14.0 ms, from 9.0 ms: the first changed
  pixel in a tile of 256 by 512 pixels reads the whole tile. From 1920×1080 up, or with 10%
  changed, it is as fast as 0.1.0 or faster.

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
