# Design log: shift tolerance in 0.2.0

How 0.2.0 decides that a changed pixel only moved by less than a pixel, what was tried on the way,
and what was kept.

## Where the figures come from

- **Reproducible here.** `npm run bench:accuracy` reproduces the counts on this repository's
  benchmark pairs, synthetic set included; `npm run bench` reproduces the speed figures; the unit
  tests pin down every case named below.
- **Measured with captures not in this repository.** Verdict counts against 0.2.0's first draft,
  the share of a real overlay change counted, the margin and the sensitivity tables come from
  `bench/judge.mjs`, run on this benchmark's pairs together with a downstream renderer's captures,
  which are not included. Figures on this repository's pairs can be rerun with the judge and the
  constant under test edited; figures on the captures cannot. All were measured on one machine
  (Apple M4). "Lost" and "gained" are verdicts that change against the first draft, with no
  pixels allowed / with 0.1% allowed. The margin is the counted pixels of pairs that should match,
  as a share of the 0.1% allowance, worst over pairs allowed 10 pixels or more.

## The rule

A move of under a pixel only carries colour across a box's border. Resampled bilinearly, a move of
(tx, ty), each between 0 and 1 in one of four directions, changes a box's total by
tx·Lx + ty·Ly + tx·ty·K, where Lx is the column brought in less the column taken out, Ly the same
for rows, and K the corners where they cross. That is bilinear in tx and ty, so it lies between its
values at the corners of the square: the box's total moved one pixel across, down, both, or not at
all.

So at a changed pixel one image's box total must lie within the range of the other's at the box and
one pixel over, in one of the four directions, give or take rounding:

- over a 65×65 box, either image being the one that moved;
- over a 5×5 box, either image being the one that moved;
- over the pixel alone, both ways round, give or take three levels: each image's colour lies within
  the colours next to it in the other.

Near the border, a box moves inward so that the box moved is in the image too; a move conserves
colour over any box, so this stays sound off centre. The pixel's own test stays on the pixel, so
on the outermost pixels a move from beyond the border explains nothing, and across an image one
pixel wide no move does.

Each box total comes from a summed-area table per channel, built once for each tile of 256 rows by
512 columns where a pixel is judged, reading 66 pixels beyond each side: four reads per total,
whatever the box's size. Totals of a 65×65 box pass 16 bits, so the tables are 32-bit; a unit test
of a bright texture fails with 16-bit sums.

## Why each part

- **The 5×5 box** is the smallest that loses no verdict against the first draft. With 3×3, a faint
  SVG stroke change and a faint text change pass. Over a box that holds no edge, a tint, a fainter
  overlay or a drift of a few levels changes the total by more than a move could.
- **The 65×65 box.** Over texture whose colour changes by a level or more per pixel, a drift of a
  level or two is what a move up the local slope would do to any small box. Over 65×65 the texture
  rises and falls, a move carries as much colour in as out, and the drift remains. With the 5×5
  box alone, 3.6% of a drift of one to three levels over a whole textured frame is counted; with
  the large box, all of it. A unit test pins it down on a 160×160 texture.
- **The pixel, both ways round.** A colour that appears, or a faint speck that goes away, changes
  a box's total by less than its slack. Asked both ways round, the pixel's own colour must be
  among the colours now next to it, so it counts. A unit test pins it down.

## Slack

Rounding enters a box's total by up to half a level per pixel in each image, so a level per pixel
covers it. Measured outside this repository:

- **5×5 box: 1.25 levels per pixel.** Renderings of the same scene through the GPU and in software
  differ by a little more than rounding where one is lighter across an area. From 1.0 to 1.5 no
  verdict is lost; at 1.0 the GPU-against-software effects page at 2× counts 187 of 256 allowed
  pixels, at 1.25 85.
- **65×65 box: 0.75 levels per pixel.** Over 4,225 pixels rounding goes both ways and its worst
  case is not reached, so a tighter bound counts more of a faint overlay change. At 0.5625 or less
  Chromium's terrain at 2× through the GPU against software fails, by 2 pixels on its top row; from
  0.6 up nothing is lost. 0.75 keeps 20% either way clear of that edge, at the cost of a few points
  of the real overlay change: 87.9% counted at 0.6, 82.7% at 0.75.
- **The pixel: 3 levels**, 0.1.0's slack. With one or two, real renders of the same scene fail.

## Sensitivity

Each constant alone, the others at the values kept. Measured outside this repository:

| Constant (kept)    | Values tried           | Lost  | Gained | Overlay counted, synthetic / real | Worst margin              |
| ------------------ | ---------------------- | ----- | ------ | --------------------------------- | ------------------------- |
| 65×65 slack (0.75) | 0.6, 0.675, 0.825, 0.9 | 0 / 0 | 1 / 1  | 96.3–89.3 / 87.9–78.6%            | 48.4%                     |
| 65×65 slack        | 0.5625                 | 1 / 0 | 1 / 1  | 96.9 / 88.5%                      | 48.4%                     |
| 5×5 slack (1.25)   | 1.0, 1.125, 1.375, 1.5 | 0 / 0 | 1 / 1  | 94.2–92.9 / 86.1–79.7%            | 73.0% at 1.0, 48.4% above |

The gained verdict is the textured drift. The drift stays counted in full, and slivers down to one
pixel across, throughout.

## What was tried and not kept

- **Widening the pixel test.** A rasteriser draws an edge more sharply than bilinear resampling
  mixes it: a thin line moved by half a pixel gathers into one pixel darker than any beside it.
  Widening the pixel's range by the contrast around it passed many more sub-pixel moves of text,
  SVG and the 3D view (22 / 17 gained). But a band of new colour one pixel wide beside an edge lies
  beyond the colours next to it in just the same way, and each box takes its own move of the edge,
  so rings, outlines and halos passed, and so did a changed border along an element screenshot's
  own edge: changes 0.1.0 counts. Widening only beside a neighbour that kept its colour still
  passed them. Capping the widened range at the colours within 2 or 3 pixels in the other image
  passed a changed column beside an edge; capping it at the 3×3 colours counted every case but kept
  none of the gains, which makes it the same as no widening. So the pixel's range is not widened.
  Unit tests cover a light, blue and reddish column beside a dark shape, an outline round a dark
  square, ground beside an edge changed by 6 to 32 levels, and a changed border along the image's
  edge.
- **One move shared by every box and the pixel**, solved exactly in one offset and stepped in the
  other, with the tolerance widened by what a total changes over half a step so no move is missed:
  about 70 more lines. It counts an edge pixel whose sides changed colour too, in a small fixture,
  but not the larger forms of these cases, and loses a verdict.
- **Other sizes.** A 7×7 or 9×9 small box passes a text caret that went away; a larger box than
  65×65 adds nothing measured.
- **Running sums per box size** in place of one summed-area table: a little faster on a fully
  changed frame, slower on grain, and 13 more lines.

## Soundness

The box rules are sound for any bilinear move, give or take rounding. On 400,000 bilinear moves of
random content, each judged at a random pixel of an 11×11 image whose edge continues beyond it, they
refused none; a unit test runs 2,000. The pixel test, asked both ways round, is not sound on such
content: after a move of random levels, a pixel's old colour often lies outside the colours now
next to it, as a colour that went away does, and the full test refuses most such moves (1,587 of
2,000). Rendered content keeps flat colour beside its edges.

## Limits

- **A faint change beside an edge that did not move passes.** Over ground a few levels darker,
  every pixel within reach of an edge, a move of the edge by a small part of a pixel carries as much
  colour across each box's border as the change took away. 0.1.0 passes it too. Telling the two
  apart needs the move found first, by registering each tile: measured, the smallest such piece
  costs 150 to 190 lines and loses verdicts at most settings.
- The constants were set on the benchmark the evaluation scores, held-out set included, so it is no
  longer unseen for them.
