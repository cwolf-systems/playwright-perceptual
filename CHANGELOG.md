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
  both ways round, give or take three levels as before. Near the image's border the boxes move
  inward, and the pixel's own test stays on the pixel, so a changed border along an element
  screenshot's own edge counts, and images down to one pixel high or wide are judged.
- **Renders whose colour drifts by two levels or more over an area now fail, over texture too.** A
  drift of one to three levels per channel over smooth texture, which 0.1.0 passes, is counted in
  full. On a downstream renderer's captures of identical input (not included, so not reproducible
  here), one scene whose first capture is one to two levels darker over nearly half the frame now
  fails, as it should.
- **Some pairs that should match count more pixels.** In this repository's benchmark
  (`npm run bench:accuracy`): the 2D map through the GPU against the software rasteriser, which
  already failed, from 894 to 953 at 1× and from 5,067 to 10,034 at 2×; CSS effects through the
  GPU, from 3 to 8 at 1× and from 48 to 85 at 2×, still within 0.1%.
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
  0.1.0, and so does part of a faint overlay change beside contour lines.
- Not every sub-pixel move passes. A thin line moved by half a pixel can gather into a pixel darker
  than any beside it, which looks exactly like a line of new colour and counts. On random noise
  most sub-pixel moves count as changes for the same reason; the box tests alone pass every
  bilinear move of such content.
- Anti-aliasing detection compares brightness, not hue, as in 0.1.0. Beside a black edge, a column
  of white that turns pure blue or red is taken for anti-aliasing, and so can a coloured ring a
  pixel wide round a dark shape.
- In an image one pixel high or wide, what lies beyond the image across that side is unknown, so
  shift tolerance allows no move across it: a sub-pixel move of content across such a sliver
  counts as a change. In 0.1.0 such slivers took any change within three levels of the colours
  nearby for a shift.

### Speed

From `npm run bench` (median of seven, Apple M4, Node 22), run at 0.1.0 and at this release on the
same machine; the tables are in [docs/benchmarks/speed.md](docs/benchmarks/speed.md).

- Fully changed images compare faster: 3200×2000 in 2.63 s, from 5.57 s; 1920×1080 in 0.91 s,
  from 1.23 s; 1280×720 in 0.44 s, from 0.52 s. CIELAB and ΔE are cached in fixed tables,
  anti-aliasing is asked once for both images and stops where no neighbour kept its colour, every
  box total is four reads of a summed-area table, and rounding is checked before the detectors.
- With 10% changed, 3200×2000 takes 281 ms, from 552 ms; 1920×1080 94 ms, from 112 ms.
- Small changes on small images cost more: with 1% of a 1280×720 image changed, 12.4 ms, from
  7.6 ms, and at 1920×1080 21.4 ms, from 18.6 ms. The first changed pixel in a tile of 256 by 512
  pixels reads the whole tile and 66 pixels beyond it. At 3200×2000, 47.7 ms, from 71.1 ms.

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
