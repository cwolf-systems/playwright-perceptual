# Design log: register first

How 0.2.0's shift detector was chosen. Approach C of three tried for the release: estimate the local
sub-pixel offset of the actual image against the expected one, align, and judge what the offset
leaves. Every number here is a count of pixels at the default settings (ΔE00 1) unless it says
otherwise, measured on the accuracy benchmark's pairs (193, design and held-out sets), its seven
synthetic pairs, a renderer's golden set of 56 pairs of identical input, and that renderer's
captures of a translucent overlay made 5 points more transparent (issue #2's case), a bilinear
filter in half precision and a film-grain scene.

The bar: no pair whose expected verdict PR #1's detectors get right may go wrong, with no changed
pixel allowed or with 0.1% of the image; issue #2's counted share must rise; whole-frame changes
must compare no slower than 0.1.0. Steps 2 to 4 were run without the golden set, for speed, and
the golden set checked at the end.

## Where PR #1 stood

PR #1 tests each changed pixel with a 3×3 range test (each image's colour lies within the other's
colours nearby, give or take three levels) and conservation over a 5×5 window: each channel's
total may change only by what a move of under a pixel could carry across the window's border.
Near an edge a move can carry a lot, so a faint change of colour beside an edge passes: of the
overlay change, 73.2% of the pixels past ΔE00 1 are counted (66.1% of the synthetic
reproduction). Under three pixels on a side nothing is conserved and 0.1.0's rule applies.

## 1. Register tiles, then compare the residual

Lucas–Kanade on 16×16 tiles (2 px margin, three Gauss–Newton iterations, bilinear resampling,
offset within ±1 px, accepted if the fit halves the squared change), then a changed pixel passes
if its residual against the aligned image stays within three levels and the window's mean
residual within one level.

|                                 | counted share, overlay | synthetic | verdicts lost                   |
| ------------------------------- | ---------------------- | --------- | ------------------------------- |
| PR #1                           | 73.2%                  | 66.1%     | –                               |
| tiles, residual within 3 levels | 98.6%                  | 99.2%     | 42, and 44 golden pairs flipped |

A tint never registers, as hoped, but most noise is not a move. Two kinds of pair fail:

- **Self-noise in the golden set.** One edge pixel takes its neighbour's colour between loads, as
  a rasteriser breaks a tie the other way. No tile offset explains one pixel.
- **GPU against software.** A scaled image, a chart's gradients and blurred CSS effects come out
  differently filtered, not moved: registration leaves 70% to 100% of the change (a tile's fit
  ratio 0.8 to 1.0). This is why a least-squares shift model was dropped during PR #1 too.

## 2. Keep the range test; register only to tell a move from a change of colour

The 3×3 range test (both ways) stays as the first test: it is what lets one pixel flip and noise
through. Conservation's border allowance is dropped. In its place the window's mean change must
stay within a bound, either as it is or after registration.

| variant                    | overlay | synthetic | verdicts lost |
| -------------------------- | ------- | --------- | ------------- |
| mean within 1 level, tiles | 98.6%   | 99.2%     | 33            |
| same, 7×7 window           | 98.3%   | 99.2%     | 28            |
| same, no registration      | 98.3%   | 99.2%     | 33            |

The remaining losses are GPU-against-software pairs. A scaled image drawn by the GPU is 1 to 1.5
levels brighter over whole areas; the overlay change is 1.75 levels or more over most of its
pixels (5×5 means, worst channel):

| window mean                                     | under 1.25 | 1.25–1.75 | 1.75 and over |
| ----------------------------------------------- | ---------- | --------- | ------------- |
| overlay change, pixels                          | 244        | 947       | 8,878         |
| scaled image, GPU against software (2×), pixels | 6,494      | 3,434     | 0             |

So the bound is 1.5 levels: a drift of two levels over an area still counts.

| variant                                       | overlay | synthetic | verdicts lost |
| --------------------------------------------- | ------- | --------- | ------------- |
| mean within 1.5                               | 93.6%   | 96.6%     | 21            |
| mean within 1.5, per-pixel registration (5×5) | 93.6%   | 96.5%     | 23            |

## 3. Register the window, without a brightness term

Tiles mix motions: a label moving over still ground. Registering each pixel's own 5×5 window
fixes that. With a brightness term (each channel's mean removed before the fit) the fit ignores
exactly what tells a tint from a move, so the term goes: the change d is fitted as g·t alone, for
the gradient g of the expected image. Texture has no net gradient, so a change of colour over it
has no offset that explains it; an edge or a ramp does, and there a move and a change of colour
look alike.

Two more changes made registration work:

- **Accept a confident fit as a move.** Requiring the mean test after alignment too failed edges
  moved 0.6 px: an offset off by 0.1 px across a 200-level edge leaves a mean of 4 levels.
  The fit's own quality is the test: an offset that explains enough of the change.
- **Damp along edges.** Along a straight edge the offset is undetermined; with damping of 0.1% of
  the gradient energy a vertical ramp's fit wandered to 1.2 px sideways and was refused. 10%
  keeps it to the part across the edge.

| variant                                      | overlay | synthetic | verdicts lost |
| -------------------------------------------- | ------- | --------- | ------------- |
| no brightness term, mean after alignment     | 93.6%   | 96.5%     | 11            |
| accept a fit leaving under 50%, damping 0.1% | 93.5%   | 96.5%     | 8             |
| damping 10%                                  | 93.3%   | 96.3%     | 7             |

## 4. Edges resampled rather than moved

What was left, again GPU against software: a chart's anti-aliased edges and a radial gradient's
rim, and blurred effects, drawn with a different filter. Neither a move nor a kept mean. Such a
pixel is, in both images, a mixture of the same two colours, and those colours sit on either side
of it and kept their colour. A tint changes the sides too.

| variant                                                               | overlay | synthetic | verdicts lost |
| --------------------------------------------------------------------- | ------- | --------- | ------------- |
| mixture of two kept neighbours in the 3×3                             | 90.3%   | 94.2%     | 5             |
| in the 5×5                                                            | 85.5%   | 90.7%     | 1             |
| in the 5×5, on opposite sides                                         | 88.9%   | 92.9%     | 1             |
| same, fit may leave 70%                                               | 88.2%   | 90.4%     | 0             |
| same, a single linear step instead of three iterations, may leave 60% | 87.3%   | 89.8%     | 0             |
| same, offset within 0.75 px                                           | 88.8%   | 92.1%     | 0             |

Tried and dropped:

- Sides that kept their colour within two levels rather than one, and three levels off the line:
  the overlay change itself then reads as a mixture (5.7% counted).
- Kept meaning "within ΔE00 1": 60.5%.
- Only pairs of sides opposite through the pixel: 5 verdicts lost.
- Mixtures only for changes over three or five levels: the blurred effects need the small ones (4
  verdicts lost).
- Gradients averaged over both images, as in symmetric registration: no better on a soft spot
  moved diagonally, and worse at 0.75 px.
- The mean over changed pixels only, so the rim of a tinted area is not diluted: 90.8%, but 2
  verdicts lost and 5 golden pairs flipped.
- Dropping the slope rule for anti-aliasing, the mixture rule covering it: 3 verdicts lost.
- The mean test for rounding too: 88.8% against 88.6%, at the cost of reading a window for every
  rounded pixel. Rounding stays one level per channel, checked first.

The mixture rule belongs to shift tolerance, not to anti-aliasing: with `ignoreShifts: false`, as
an anti-aliasing rule, it passed film grain (a mixture of two near colours, within two levels).

## 5. Content that moved moves together

A drift of one to three levels over smooth, dark texture (a test the judge added late: two levels
on average, a different one per pixel and channel) still passed in two places of five. The
texture rises a few levels per pixel, so in any one 5×5 window a two-level drift is what a move of
under a pixel would leave, and the fit explains 86% of it. Over a larger area the texture turns,
and the offsets the drift fits turn with it. A real move is the same offset all over.

| check on the window's move                                     | drift counted       | brighter texture, drift | verdicts lost                                                       |
| -------------------------------------------------------------- | ------------------- | ----------------------- | ------------------------------------------------------------------- |
| none                                                           | 60.9%               |                         | 0                                                                   |
| registration window 7×7, 9×9, 13×13                            | 65.0%, 70.0%, 82.8% |                         |                                                                     |
| agrees within 0.25 px with an 11×11 fit                        | 80.1%               |                         |                                                                     |
| agrees within 0.25 px with a 17×17 fit                         | 97.0%               |                         | 2                                                                   |
| agrees within 0.4 px with a 21×21 fit                          | 96.0%               |                         | 0, but the wider tables cost the bench's full change 15% over 0.1.0 |
| the tile's own offset leaves under 60% of the window's change  | 76.3%               | 52.5%                   |                                                                     |
| agrees within 0.4 px with the tile's offset, 32×32             | 98.0%               | 10.3%                   | 0                                                                   |
| both of the last two                                           | 98.3%               | 52.5%                   | 2                                                                   |
| an absolute cap on what the fit leaves, 0.5 level² per channel | 100%                |                         | 6                                                                   |

The tile is the cell the sums are kept for, so its offset costs five lookups. Kept: the window's
offset must agree with the tile's within 0.4 px. On brighter texture (40 to 200 levels) the same
drift fits offsets under 0.2 px everywhere, which agree with any tile, and only a tenth of it
counts; the GPU-against-software pairs that should match fit no move a tile agrees with, so a
stricter test loses them.

## Kept

A changed pixel is a shift if it passes the 3×3 range test both ways and the 5×5 window either
keeps its colour (each channel's mean within 1.5 levels) or is explained by a move (one damped
Lucas–Kanade step over the window finds an offset within ±0.75 px that leaves at most 60% of the
squared change, and within 0.4 px of the offset fitted over its 32×32 tile); or if it is, in both
images, a mixture of two colours on opposite sides of it in the 5×5 window that kept theirs within
a level.

|                                          | PR #1 | register first                   |
| ---------------------------------------- | ----- | -------------------------------- |
| verdicts lost, either allowance          | –     | 0                                |
| verdicts gained                          | –     | 3 benchmark pairs, 1 golden pair |
| overlay change counted                   | 73.2% | 88.9%                            |
| synthetic overlay change counted         | 66.1% | 92.7%                            |
| textured drift of 1–3 levels counted     | 0%    | 98.0%                            |
| tint on a 200×2, 1×50, 2×2 panel counted | 0%    | 100%                             |

At ΔE00 1.5 one pair turns: the CSS effects through the GPU, where 11 pixels of near-white drift
two levels in blue over an area. By the rule that a two-level drift over an area counts, that is
right; PR #1 passed it through the border allowance.

What the overlay change still loses: the rim of the surface, where a window reaches past it and
its mean is diluted (two-fifths unchanged and the rest two levels darker gives 1.2), and pixels
beside contour lines, where the change fits a move of the line.

## Speed

Summing a window per pixel is a hundred reads or more. Each pair of images is read once per
32×32 tile, lazily, into channel planes, with summed-area tables of each channel's change, the
pixels that kept their colour and the five products the fit needs; a window's sum is then four
lookups. Only the current row of tiles is kept. The anti-aliasing rule, otherwise as in PR #1,
turns away a pixel with no neighbour that kept its colour with one lookup in the same tables,
which is most pixels of a whole-frame change.

Medians of 5, milliseconds, the same machine and load, in one process per build:

| case                                   | 0.1.0 | PR #1 | register first |
| -------------------------------------- | ----- | ----- | -------------- |
| bench 1280×720, 100%                   | 636   | 578   | 497            |
| bench 1920×1080, 100%                  | 1,383 | 1,064 | 1,055          |
| bench 3200×2000, 100%                  | 4,419 | 3,425 | 3,437          |
| textured drift of 1–3 levels, 1346×819 | 586   | 765   | 402            |
| film grain of ±1 level, 1346×819       | 422   | 61    | 53             |
| real whole-frame change                | 421   | 1,109 | 350            |
| real film grain                        | 255   | 52    | 77             |
| bench 3200×2000, 1%                    | 57    | 51    | 42             |

Before the tiles, with reads per pixel, the real whole-frame change took 1,927 ms. Smaller tiles
cost less where a few scattered pixels need the detectors and more where many do: 16-pixel tiles
took 68 ms on the real grain and 388 ms on the real whole-frame change, 24-pixel tiles 73 and 373.
