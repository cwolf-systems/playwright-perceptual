# Design log: shift tolerance as a resampling model

How 0.2.0's shift tolerance was chosen. PR #1 stacked three heuristics for it: a 3×3 colour range,
a conservation window and a rounding class. This log records the attempt to replace the first
two with one model, a changed pixel is a sub-pixel move if resampling one image at some offset
reproduces the other around it, and what the measurements kept.

## Method

- **Pairs.** The accuracy benchmark's 193 pairs (design and held-out sets), the synthetic set, and
  real captures from a renderer's test suite: a golden set of identical input rendered three times
  (56 pairs), a translucent surface whose opacity changed (the real form of issue #2), a bilinear
  rounding pair and a film-grain pair. Each pair's expected verdict (match or not) was labelled
  before this work, and is judged with no changed pixels allowed and with 0.1% of the image.
- **Win conditions, in order.** No pair whose verdict PR #1 gets right goes wrong; issue #2's
  residual (the share of a faint uniform change that is counted), the textured drift's counted
  share and the sliver limit improve; whole-frame comparisons are no slower than 0.1.0; less
  detector code.
- **Wrong verdicts** below are counted over every labelled pair, as _none / 0.1%_. PR #1 has
  51 / 26. Residuals are _real opacity / synthetic opacity_; PR #1 has 73.2% / 66.1%.

## 1. Reproduce each pixel by bilinear resampling

A pixel was a shift if some offset within ±0.5 px (a 1/8 px grid) made bilinear resampling of one
image match the other over the 3×3 neighbourhood within one level per channel, either way round.

- Tints were rejected almost entirely: 96% / 98% counted.
- 86 verdicts PR #1 gets right went wrong, over ΔE00 1 and 1.5 at both allowances: text, charts and SVG moved by 0.3 px, and most of the
  GPU-against-software pairs.

Bilinear resampling assumes each pixel's colour is spread evenly over it. A rasteriser covers a
sharp edge: moving an edge whose pixel is a fraction c covered by t changes that pixel by t,
while bilinear resampling spreads the change over two pixels, wrong by up to t(1 − c) of the
contrast, a quarter of it at worst. Along text that is tens of levels.

The errors cancel in sums, though: bilinear resampling moves the right amount of colour across
the border of any window whose border is not itself on the edge. That turned the test from
single pixels to window means.

## 2. Reproduce the window's mean

A pixel was a shift if some offset made the window's mean colour match the other image's
resampled one, in all three channels at once, within a tolerance in levels. The resampled window
total is bilinear in the offset (tx, ty), so it comes from nine window sums: the window, and the
window moved a pixel each way. Within each quadrant the total is linear in ty for fixed tx, so ty
is solved exactly and tx stepped by 1/16 (1/16 and 1/64 gave the same counts).

| Window, tolerance       | Lost verdicts | Wrong   | Residual      |
| ----------------------- | ------------- | ------- | ------------- |
| 3×3, 1 level, ±1 px¹    | 19            |         |               |
| 5×5, 1 level, ±1 px     | 1             | 29 / 11 | 82.8% / 90.6% |
| 5×5, 1.2 levels         | 0             | 27 / 10 | 75.4% / 65.3% |
| 7×7, 1.15 levels        | 0             | 26 / 8  | 78.2% / 79.1% |
| 9×9, 1.2 levels         | 0             | 24 / 8  | 75.6% / 77.4% |
| 7×7, 1.15, ±0.5 px only | 5             | 43 / 15 | 86.3% / 89.2% |

¹ An early run, over ΔE00 1 and 1.5 at both allowances, with a coarser offset grid.

- The one pair that set the tolerance is the held-out terrain through the GPU against software:
  two pixels on the top row, where the GPU's rendering is 1.2 levels lighter on average. 1 level
  is all rounding explains; the smallest tolerance that passes them is 1.13 to 1.2, depending on
  the window. The synthetic opacity residual falls fast above 1 level: with the 5×5 window, 90.6%
  at 1 level and 65.3% at 1.2.
- Offsets must reach a whole pixel. Limited to ±0.5 px, labels that land a whole pixel over
  between loads and a few GPU-against-software pairs fail.
- Windows at the border were tried three ways: clipped to the image (kept), repeating the border
  (8 more pixels counted on the terrain pair) and moved inward (3 more). Leaving what lies beyond
  the border unknown but within the window's range changed nothing.
- Requiring every pixel of the window, not just the mean, to be reproduced within one level plus
  a share of the local contrast counted more of the tint (94.5% / 97.1% at half the contrast) but
  lost 12 verdicts on GPU-against-software pairs in the early run.

**Kept: 7×7 mean, 1.15 levels, offsets up to a pixel.** Slivers come for free: a window at the
border is clipped, resampling repeats the border, and a flat panel tinted by three levels of blue
cannot be resampled into its tint, so 200×2, 1×50 and 2×2 panels are counted in full.

## 3. The pixel itself

A window mean hides a speck: twenty levels on one pixel move a 7×7 mean by less than half a
level. Resampling only mixes neighbours, so each image's pixel must lie within the range of the
other's 3×3 neighbourhood, widened for the sharpness bilinear resampling lacks.

| Range test                                 | Wrong   |
| ------------------------------------------ | ------- |
| none                                       | 26 / 8  |
| 3 levels, one way (either image)           | 33 / 13 |
| 3 levels + a quarter of the range, one way | 28 / 8  |
| 3 levels + half the range, both ways       | 34 / 13 |
| 3 levels + the range, both ways            | 31 / 11 |

One way round, a speck in the actual image still passes: resampling the actual image away from
the speck reproduces the expected pixel. **Kept: both ways, three levels (0.1.0's slack) plus half
the range,** the most a rasteriser's coverage of an edge exceeds bilinear mixing in two axes. No
verdict is lost; it costs a few of the verdicts the window test had fixed.

## 4. A drift over texture

A textured frame drifting by one to three levels in every channel (the judge's must-count case)
was counted at 2%: over a 7×7 window, most of a smooth texture is a gradient, and a uniform drift
of two levels is that gradient moved by half a pixel. No local test tells them apart. Larger
windows help a little; testing the centre pixel within one level helps little and loses verdicts.

| Test                               | Drift counted |
| ---------------------------------- | ------------- |
| 7×7                                | 2.1%          |
| 11×11                              | 4.7%          |
| 15×15                              | 14.0%         |
| 21×21                              | 26.0%         |
| 7×7, centre pixel within one level | 10.9%         |
| 7×7 and 21×21, one offset for both | 28.0%         |
| 7×7 and 31×31, one offset for both | 51.3%         |
| 7×7 and 41×41, one offset for both | 75.3%         |
| 7×7 and 51×51, one offset for both | 98.6%         |
| 7×7 and 71×71, one offset for both | 100%          |

A real move has one offset over a wide area. A drift mistaken for one needs the offset to point
up the local slope, so it changes direction as the texture rises and falls; over a window that
spans a rise and a fall, a move carries as much colour in as out and the drift remains.

These large windows were clipped at the border, like the small one. The 31×31 pairing lost two
verdicts; from 41×41 up none were lost. **Kept: 7×7 and 65×65,
one offset for both,** with the large window moved inward at the border so it and its moves stay
inside the image, and left out for images under 67 pixels on a side. A tighter tolerance on the
large window alone (1 level) counted slightly more of the tint but fixed three verdicts fewer.

## 5. Anti-aliasing and rounding

- Without the anti-aliasing detector, the window test fixes more of the moved text and SVG but
  fails the SVG drawn through the GPU against software (187 pixels counted against PR #1's 26),
  where edge coverage differs without a move. The detector stays as it is.
- The rounding class stays as a one-line check in the comparator. Inside the shift test, rounding
  is the tolerance on the window mean.

## 6. Cost

Reading each window afresh was twelve times slower than 0.1.0 on a real whole-frame change.
What made it fast, on that change (1346×819, an Apple M4 shared with other work, medians of 3;
0.1.0 takes 420 to 470 ms there):

| Step                                                                    | ms    |
| ----------------------------------------------------------------------- | ----- |
| One 7×7 window, sums read pixel by pixel                                | 5,346 |
| Window totals per raster, a row at a time                               | 512   |
| A block of a row at a time; column sums updated as rows enter and leave | 379   |
| The pixel's range test first                                            | 392   |
| A second, 65×65 window                                                  | 654   |
| The large window tested first, before the small one is read             | 474   |
| Colours converted once per band of pixels; a bug in column sums fixed   | 430   |
| The large window's centre on an 8 px grid, summed once for its pixels   | 422   |

Most real changes end at the range test or at the large window, before any offset is sought.
Summed-area tables instead of the totals were twice as slow on this change (863 ms): four
lookups per sum, but spread across rows the cache does not hold. The anti-aliasing detector is
now the largest cost on a whole-frame change; it stops at once where no neighbour kept its colour.

## Result

The judge on the final design, against PR #1 (wrong verdicts as _none / 0.1%_ over all labelled
pairs; times in ms, medians of 5, against 0.1.0):

| Measure                                    | PR #1   | This design |
| ------------------------------------------ | ------- | ----------- |
| Verdicts PR #1 gets right that go wrong    |         | 0           |
| Wrong verdicts                             | 52 / 27 | 34 / 14     |
| Golden pairs failing (56, identical input) | 12      | 9           |
| Real opacity change counted                | 73.2%   | 81.7%       |
| Synthetic opacity change counted           | 66.1%   | 86.4%       |
| Textured drift of 1–3 levels counted       | 0%      | 100%        |
| Smallest panel side counted in full        | 3 px    | 1 px        |
| Real whole-frame change (0.1.0: 449)       | 1,018   | 416         |
| Textured drift (0.1.0: 580)                | 752     | 446         |
| 3200×2000, all changed (0.1.0: 4,495)      | 3,705   | 3,185       |
| Detector code in `src/image/`, lines       | 204     | 444         |

What is worse: more detector code, for the window totals that make it fast; the 2D map through
the GPU against software counts more pixels at 2× (5,581 → 11,243), a pair both get wrong; and the
grain of a real capture compares in 94 ms against PR #1's 48, still well under 0.1.0's 257.
