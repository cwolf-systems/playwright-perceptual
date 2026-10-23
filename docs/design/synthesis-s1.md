# Design log: shift tolerance in 0.2.0

How 0.2.0's shift tolerance was put together from four designs tried for it: one that refined the
conservation window (A), one that modelled the move by resampling (B), one that registered each
tile first (C), and one box-filter rule (D). It starts from D, the smallest, and adds a piece of
another design only where a measurement asked for it. D's own log is
[box-filter.md](box-filter.md).

Every figure comes from the redesign judge. It checks verdicts against frozen labels for the
accuracy benchmark's 193 pairs, the synthetic set, the judge's own pairs (a textured drift and
its control, and two changes beside an edge), and 58 captures of a downstream renderer. It reports
how much of a faint overlay change is counted (synthetic and real capture), how much of a
one-to-three-level drift over texture is counted, and the margin: counted pixels on pairs that
should match, as a share of the 0.1% allowance, worst over pairs allowed 10 pixels or more.
"Lost" and "gained" are verdicts against PR #1's detectors, with none allowed / with 0.1%.

## The rule

A move of under a pixel only carries colour across a box's border. Resampled bilinearly, it changes
a box's total by an amount bilinear in the move, so the total lies within the range of the box's
totals at its own place and one pixel across, down and both, in one of four directions. At a
changed pixel each test asks that of one image against the other:

- a 65×65 box, either image being the one that moved;
- a 5×5 box, either image being the one that moved;
- the pixel alone, both ways round, widened by the range of its neighbours where one of them kept
  its colour.

Each box total comes from one summed-area table per channel, read once for each tile of 256 rows by
512 columns where a pixel is judged: four entries per total, whatever the box's size.

## Steps

| Step                                                          | Lost  | Gained  | Overlay counted | Drift | Code |
| ------------------------------------------------------------- | ----- | ------- | --------------- | ----- | ---- |
| D as it was                                                   | 0 / 0 | 1 / 1   | 76.5 / 77.2%    | 3.6%  | 195  |
| A 65×65 box, a level per pixel                                | 0 / 0 | 1 / 1   | 88.4 / 81.8%    | 100%  | 198  |
| The same, 0.75 of a level per pixel                           | 0 / 0 | 1 / 1   | 94.2 / 86.1%    | 100%  | 198  |
| Pixel test widened by the range around it                     | 0 / 0 | 22 / 17 | 94.2 / 86.1%    | 100%  | 199  |
| 5×5 at 1.25, 65×65 at 0.625 levels per pixel                  | 0 / 0 | 23 / 17 | 96.1 / 87.0%    | 100%  | 199  |
| One summed-area table for every box, anti-aliasing asked once | 0 / 0 | 23 / 17 | 96.1 / 87.0%    | 100%  | 202  |
| Widening only beside a kept colour; 65×65 back to 0.75 (kept) | 0 / 0 | 11 / 4  | 93.6 / 82.7%    | 100%  | 209  |

Overlay counted is synthetic / real capture; PR #1 counts 66.1 / 73.2%, and none of the drift.
The last row is scored by the judge with the two edge pairs, which PR #1 and 0.1.0 count 0 and 9
pixels of; the rows above it by the judge before they were added.

### The large box

Over texture whose colour changes by a level or more per pixel, a drift of a level or two is what a
move up the local slope would do to a small box: D counted 3.6% of the judge's textured drift. Over
65×65 the texture rises and falls, a move carries as much colour in as out, and the drift remains:
all of it counts. The size is B's, which found 41×41 the smallest that loses no verdict when its
window shares an offset with a small one. Here each box takes its own move.

Its totals pass 16 bits (65 × 65 × 255 is over a million), so the tables are 32-bit; a unit test
of a bright texture fails with 16-bit sums.

Rounding enters a box's total by up to half a level per pixel in each image, so D allowed a level
per pixel. Over 65×65 the rounding of 4,225 pixels goes both ways and its worst case is not
reached, so a tighter bound counts more of a faint overlay change. How tight is limited by
renderings through the GPU against software, where one is lighter across an area:

| 65×65 slack, levels per pixel | 0.5   | 0.5625 | 0.6   | 0.625 | 0.675 | 0.75  | 0.825 | 0.9   |
| ----------------------------- | ----- | ------ | ----- | ----- | ----- | ----- | ----- | ----- |
| Lost                          | 1 / 0 | 1 / 0  | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Real overlay counted          | 89.3% | 88.5%  | 87.9% | 87.0% | 84.8% | 82.7% | 80.4% | 78.6% |

The verdict lost is Chromium's terrain at 2× through the GPU against software, 2 pixels on its top
row. 0.625 sat a tenth above that; at 0.75, 20% either way loses nothing, for four points of the
real overlay change.

### The pixel test

D's pixel test asked the pixel's colour to lie within its neighbours' colours, give or take three
levels, both ways round. B widened its own by half the neighbourhood's range: a rasteriser draws an
edge more sharply than bilinear resampling mixes it, and a thin line moved by half a pixel gathers
into one pixel darker than any beside it. Here the widening is one more term of the box rule: over
the pixel alone, a total may lie outside the quadrant's range by the range itself (half of it gains
16 / 16 verdicts, the whole of it 22 / 17).

The widening let through a change 0.1.0 counts: an edge whose columns either side changed colour,
eight levels past the flat colour next to them. That is not how a rasteriser differs: drawing an
edge more sharply leaves the colour beside it. So the range is widened only beside a quadrant
neighbour that kept its colour, give or take a level. That restores the edge pair (9 of 27 pixels
counted, as 0.1.0 and PR #1) and keeps half of the widening's gains: 11 / 4. Two other ways were
measured, capping the widened range at the colours nearby in the other image: over 5×5, 7 / 9
gained and a margin of 90.2%; over 7×7, 8 / 11 and 95.3%. Widening beside a kept colour leaves the
pairs that should match furthest from failing (34.4%), so it was kept.

### Speed

The 65×65 box's tiles read 66 pixels beyond each side, so tiles grew from 128 to 256 rows. A's
anti-aliasing changes came in whole: brightness in integer thousandths of a level, direct 3×3
loops, and asking once for both ways round, which needs a neighbour that kept its colour and so
stops at once across most of a real change. One summed-area table in place of running sums per box
size is a little slower on a whole-frame change and faster on grain, for 13 fewer lines. The
kept-colour check is read only where the widened range decides. The judge's times at the final
code are in [speed.md](../benchmarks/speed.md).

## Sensitivity

Each tuned constant alone, the others at the values kept, against the judge with the edge pairs:

| Constant (kept value) | Values tried           | Lost  | Gained     | Overlay counted        | Worst margin            |
| --------------------- | ---------------------- | ----- | ---------- | ---------------------- | ----------------------- |
| 65×65 slack (0.75)    | 0.6, 0.675, 0.825, 0.9 | 0 / 0 | 11 / 4     | 96.3–89.3 / 87.9–78.6% | 34.4%                   |
| 5×5 slack (1.25)      | 1.0, 1.125, 1.375, 1.5 | 0 / 0 | 10–11 / 4  | 94.2–92.9 / 86.1–79.7% | 73.0, 46.1, 34.4, 34.4% |
| Widening (1 × range)  | 0.8, 0.9, 1.1, 1.2     | 0 / 0 | 10–13 / 4  | unchanged              | 34.4%                   |
| Kept colour (1 level) | 0, 2, 3 levels         | 0 / 0 | 9–12 / 1–5 | unchanged              | 33.2, 56.2, 45.3%       |

Drift stays at 100% and slivers at one pixel throughout. Only the 65×65 slack has a lost verdict
near it, at 0.5625, a quarter below. The 5×5 slack loses nothing over the range; below 1.25 the
margin worsens quickly (GPU-against-software effects at 2×), above it less of the real overlay is
counted.

## Soundness

The box rules are sound for any bilinear move, give or take rounding. On 400,000 bilinear moves of
random content, each judged at a random pixel of an 11×11 image whose edge continues beyond it, they
refused none; a unit test runs 2,000 of them. The pixel test is not sound on such content: random
levels keep no neighbour's colour after a move, so it is not widened, and a pixel's colour can lie
well outside its neighbours' as a colour that went away does. The full test refuses 1,465 of 2,000
such moves. Rendered content keeps flat colour beside its edges, which is where the widening
applies.

## What was measured and not kept

- **One offset shared by every box and the pixel**, B's solver adapted so no offset between steps
  is missed: about 70 more lines. It counts the 11×11 forms of the two edge cases, but not the
  judge's pairs (0 of 44 and 0 of 27), and loses a verdict (terrain at 2× through the GPU). With the
  5×5 box also placed at the pixel's four corners it loses five.
- **Lazy filtering per box size**: 4 ms less on small changes, 14 ms more on a whole frame.
- **Other box orders**: testing the pixel or the 5×5 box first made the textured drift 590 ms
  against 350.

## Limits

- **A faint change beside an edge that did not move passes.** Over ground three levels darker,
  every pixel within reach of an edge, a move of the edge by a small part of a pixel carries as much
  colour across each box's border as the change took away. The judge's pair has 0 of 44 pixels
  counted; 0.1.0 and PR #1 count none either. Registration (C) catches it, at 150 to 190 more lines
  and losing verdicts at most settings.
- **A pixel along an edge where only the edge pixel changed** passes if it lies within the colours
  either side: that is what two rasterisers do.
- The tuned constants were set on the benchmark the judge scores, held-out set included, so it is
  no longer unseen for them.
