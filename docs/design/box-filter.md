# Design log: one box-filter rule for shift tolerance

Shift tolerance decides whether a changed pixel differs only because content moved by less than a
pixel. Before this change it stacked two rules: a 3×3 range test with three levels of slack, and
a 5×5 window whose colour had to be conserved up to what a move could carry across its border,
measured by reading the border pixel by pixel. This log records how they became one rule tested
at two sizes, what was tried, the numbers, and what was kept. The rounding class and
anti-aliasing detection are unchanged.
Every number comes from the redesign round's judge (accuracy with `--skip-speed`, speed from a
full run), which scores a build against frozen expected verdicts on the accuracy benchmark's 193
pairs, the synthetic set, a textured drift with a sub-pixel move as its control, and 58 real
captures of a downstream renderer, and against the previous detectors on the same bytes.

## The principle

A move only carries colour across the border of a box; inside it, colour is conserved. Resampled
bilinearly, a move of (tx, ty), each between 0 and 1 in one of the four diagonal directions,
changes the total of a channel over a box by

    tx·Lx + ty·Ly + tx·ty·K

where Lx is the column of pixels brought in less the column taken out, Ly the same for rows, and K
the four corner pixels where they cross. This is bilinear in tx and ty, so over the unit square it
lies between its values at the four corners, and those are the box's total moved by a whole pixel:
across, down, both, or not at all. Over the four directions, the totals a move of under a pixel
can produce lie within the range of the box's total at its own position and the eight positions
one pixel over.

So the rule is: box-filter both images, and at a changed pixel one image's box total must lie
within the range of the other's box totals there and one pixel over, give or take rounding. The
range test of 0.1.0 is the same rule over a box of one pixel.

Rounding enters each image's box total at up to half a level per pixel, so a level per pixel of
the box covers it: 25 levels for a 5×5 box.

## How it is computed

- Each channel of a tile of 128 rows by 512 columns, plus a margin of six pixels, is read once,
  then box-filtered with separable running sums: totals down each column, then across. A box of
  one pixel is the tile itself. Tiles are filtered only where a pixel is judged, and kept for the
  current row of tiles of each image.
- A pixel's test reads, per channel and direction, the target box total and four totals of the
  other image, in each of up to four directions: at most 20 reads, whatever the box's size. The
  5×5 box is tested first, since it decides most real changes, and a channel that fails ends the
  test.
- Near the border the 5×5 box moves inward so the box moved by a pixel is in the image too. A
  move conserves colour over any box, so this stays sound off centre. Where a side is only one
  pixel longer than the box, a box sits at each end, each judging the move whose neighbour fits,
  so images two pixels high or wide are judged. The box of one pixel stays on the pixel: on the
  outermost pixels a move from beyond the border explains nothing. Across an image one pixel high
  or wide no move is allowed, for the same reason, and moves along it are judged.

The colour caches changed at the same time: CIELAB by colour and ΔE by pair are kept in fixed
tables indexed by a hash, rather than maps that grew to a million entries each on frames of
distinct colours.

## What was tried

Lost and gained are verdicts against PR #1's detectors, with none allowed / with 0.1% allowed.
Residual is the share of issue #2's faint overlay change that is counted (synthetic / real
capture); drift is the share of the textured drift of one to three levels that is counted; the
sliver limit is the smallest side from which a three-level tint is counted in full. PR #1 scores
66.1% / 73.2%, 0.0% and 3 px.

The first runs had the reverse direction's sign wrong (the expected image's box total was tested
as if it were the actual's) and are left out. The box-size, rounding and anti-aliasing sweeps
below were run while the pixel test still accepted either direction; the last rows re-measure the
rule as kept. Until the last row, an image one pixel high or wide passed any change, so no limit
below 2 px could show.

| Variant                                                     | Lost   | Gained | Residual    | Drift | Sliver |
| ----------------------------------------------------------- | ------ | ------ | ----------- | ----- | ------ |
| Boxes 5 and 1, either image moved, a level per pixel        | 0 / 0  | 24/16  | 78.2 / 79.9 | 3.6%  | 2      |
| Box 5 only                                                  | 0 / 3  | 29/20  | 76.5 / 77.8 | 3.6%  | 2      |
| Boxes 3 and 1                                               | 4 / 8  | 25/15  | 66.3 / 75.4 | 1.4%  | 2      |
| Boxes 7 and 1                                               | 1 / 0  | 22/16  | 83.4 / 81.6 | 4.4%  | 2      |
| Boxes 9 and 1                                               | 2 / 0  | 22/16  | 85.8 / 82.5 | 5.6%  | 2      |
| Boxes 7, 5 and 1                                            | 0 / 0  | 22/16  | 84.9 / 83.7 | 4.7%  | 2      |
| Boxes 9, 5 and 1                                            | 1 / 0  | 21/16  | 87.9 / 85.6 | 6.0%  | 2      |
| Rounding 0.75 level per pixel                               | 1 / 1  | 20/16  | 86.4 / 87.0 | 9.8%  | 2      |
| Rounding 0.5 level per pixel                                | 2 / 2  | 16/13  | 90.3 / 89.2 | 16.3% | 2      |
| Without the corner term K                                   | 2 / 0  | 18/18  | 80.4 / 82.0 | 4.8%  | 2      |
| Only the expected image's box moved                         | 14 / 2 | 3/3    | 84.3 / 86.1 | 23.8% | 2      |
| Both images' boxes must explain the change                  | 2 / 2  | 5/8    | 88.4 / 87.9 | 19.0% | 2      |
| Anti-aliasing detection off                                 | 0 / 1  | 20/16  | 78.4 / 80.3 | 3.6%  | 2      |
| Pixel test both ways round, a level of slack                | 19 / 4 | 2/1    | 85.0 / 88.1 | 23.7% | 2      |
| Pixel test both ways round, two levels                      | 9 / 0  | 2/1    | 76.8 / 78.3 | 5.7%  | 2      |
| **Pixel test both ways round, three levels (kept)**         | 0 / 0  | 1/1    | 76.5 / 77.2 | 3.6%  | 2      |
| Kept, and three levels for the 5×5 box too (27)             | 0 / 0  | 2/1    | 72.4 / 74.4 | 2.1%  | 3      |
| Kept, but both images' 5×5 boxes must explain it            | 2 / 2  | 2/1    | 88.0 / 86.6 | 19.0% | 2      |
| Kept, but both images' 5×5 boxes, with 10 levels more slack | 1 / 0  | 2/1    | 67.9 / 72.3 | 7.3%  | 4      |
| Kept, and sides of one pixel judged (final)                 | 0 / 0  | 1/1    | 76.5 / 77.2 | 3.6%  | 1      |

What each taught:

- **Box size.** A 5×5 box with the pixel test is the smallest that loses nothing. With a 3×3 box
  the faint SVG stroke change passes entirely at 1× and at 0.1% at 2×, and the faint text change
  at 0.1%. The 5×5 box alone, without the pixel test, passes the SVG change at 2× with 0.1%
  allowed. Larger boxes count a little more of the faint changes, but a 7×7 or 9×9 box passes a
  text caret that went away, a regression in Playwright's fixtures, and boxes of 9 fail the
  terrain through the GPU against software at 2×. Adding a 7×7 box to the 5×5 one lost nothing
  and counted 4 to 7 points more of the overlay change, for a third test per pixel; it was left
  out for that cost and the extra code.
- **Rounding.** A level per pixel is what rounding allows in the worst case, and the data needs
  all of it: at 0.75 or 0.5 a level per pixel, the terrain and CSS effects pages through
  Chromium's GPU against its software rasteriser fail.
- **The corner term.** Leaving out K, the pixels diagonally beyond the box's corners, fails two
  real captures of identical input, by a pixel each.
- **Which image moved.** A move is symmetric, so either image may be taken as the moved one. Only
  testing the expected image fails 14 pairs. Asking both to explain the 5×5 box counts five times
  more of the textured drift but fails four pairs, among them the geofence through two
  rasterisers.
- **The pixel test.** Over a single pixel, accepting either direction gains 24 verdicts with none
  allowed and 16 with 0.1% over PR #1, most of them sub-pixel moves of text, SVG and the 3D view
  that should match. A unit test caught what that costs: a colour that
  appears beside a strong edge passes, since the edge lets a 5×5 box take almost any total, and
  the old colour is still among the new image's neighbours. A colour that appears or goes away is
  not a move, so the pixel test asks both ways round, as 0.1.0 and PR #1 did. It then needs the
  same three levels of slack they used: with one level it fails 19 pairs, with two, 9.
- **Anti-aliasing.** With anti-aliasing detection off, the box rule passes everything else but
  fails Chromium's SVG page through the GPU against software at 1× (187 pixels counted, 64
  allowed): thin strokes anti-aliased with different coverage do not conserve colour. The
  detector stays as it was.
- **Directions per channel.** Whether the three channels must share a direction of move changed no
  verdict, so each channel takes its own, which is simpler.
- **Border.** With the box of one pixel moved inward like the 5×5 one, a red speck in an image's
  corner passed: the moved box no longer held the pixel.

## Result

The kept rule, as the judge scores it (full run; speed is the median of five, Apple M4, Node 22):

- **Verdicts:** none lost against PR #1, with none allowed or 0.1%; one gained, the textured
  drift, which now fails as it should. Wrong verdicts per set are otherwise PR #1's.
- **Issue #2's residual:** 76.5% of the synthetic overlay change counted (PR #1 66.1%), 77.2% of
  the real capture (73.2%).
- **Textured drift:** 3.6% counted (26,312 of 740,228 pixels; PR #1 none). Enough to fail it at any
  allowance up to 2%, but most of it still passes as shifts.
- **Slivers:** a three-level tint is counted in full at every size, down to a side of 1 px (PR #1:
  from 3 px).
- **Detector code:** 195 lines under `src/image/` (PR #1: 204), 27 of types, 69 of comments.

| Whole-frame case, ms                   | 0.1.0  | PR #1  | Box filter | vs 0.1.0 |
| -------------------------------------- | ------ | ------ | ---------- | -------- |
| bench 1280×720, all changed            | 727.0  | 570.2  | 435.2      | 0.60×    |
| bench 1920×1080, all changed           | 1419.9 | 1122.3 | 924.0      | 0.65×    |
| bench 3200×2000, all changed           | 4261.6 | 3244.5 | 2648.5     | 0.62×    |
| textured drift of 1–3 levels, 1346×819 | 560.7  | 699.3  | 342.9      | 0.61×    |
| film grain of ±1 level, 1346×819       | 414.1  | 49.2   | 22.3       | 0.05×    |
| real whole-frame change, 1346×819      | 408.0  | 995.7  | 349.5      | 0.86×    |
| real film grain, 1346×819              | 238.6  | 48.1   | 60.4       | 0.25×    |

With 1% or 10% of the image changed, it is faster than 0.1.0 in every case and within 14 ms of
PR #1 either way; the largest gap is 3200×2000 with 10% changed, 290.8 ms against 277.3.

## What is better, and what is not

Better:

- One rule, at two sizes, in place of a range test and a conservation window read pixel by pixel.
  Its slack follows from rounding, except the pixel test's three levels, which 0.1.0 and PR #1
  already used; the box's size, 5, is the smallest that loses no verdict.
- Every test costs the same whatever the box's size, and the speed gap on textured changes is
  gone: the textured drift takes 0.61× and the real whole-frame change 0.86× of 0.1.0's time,
  from 1.25× and 2.44× with PR #1.
- More of a faint uniform change is counted, slivers down to one pixel across are judged, and the
  textured drift fails.

Not better, or worse:

- Most of the textured drift still passes. Over texture whose colour changes by a level or more
  per pixel, a drift of a level or two is what a move of a pixel would do to any small box. A
  bigger box or asking both images to explain it counts more and fails real renders; telling the
  two apart needs the move found first, as registration would.
- About a fifth of the overlay change still passes as shifts, beside contour lines.
- Pairs that should match gain counted pixels, without a verdict changing: Chromium's CSS effects
  page through the GPU against software at 2×, 116 → 187 of 256 allowed; the 2D map the same way,
  895 → 954 at 1× and 5,581 → 5,741 at 2×. In the real golden captures, a label one pixel over,
  150 → 165, and the frame a level or two darker, 41,872 → 44,548.
- Small changes cost a little more than with PR #1, though less than with 0.1.0: tiles are
  filtered whole, 140 rows by up to 524 columns, for the first changed pixel in them. With 1% of
  a 1280×720 image changed, 10.4 ms against 7.5.
- A sub-pixel move across an image one pixel high or wide counts as a change, as it does on the
  outermost pixels of any image: what it would bring in is unknown. The first draft passed any
  change in such slivers, a red pixel in a 10×1 readback included; a browser test caught it.
