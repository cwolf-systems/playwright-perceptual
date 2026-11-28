# Design log: global sub-pixel registration in 0.3.0

Item (iii) of the [0.3.0 plan](../releases/0.3.0.md): estimate the translation between two images
to a fraction of a pixel, shift one image by it before comparing, and report the shift found. The
plan stops the item if either of two component checks is missed, before any verdict is looked at.
The second was missed, so registration is not in 0.3.0, and the comparison never ran with it.

## Where the figures come from

`npm run build && node bench/registration-checks.mjs` on branch `registration/phase-correlation`,
on macOS (Apple M4, Playwright 1.63). The branch holds the estimator, `src/image/registration.ts`,
which nothing in the comparison calls, and the checks. The figures for the normalised version
below come from the same first check run on that version, which the branch does not keep.

## The estimator

Over the centred region of the image, at most 512 pixels a side, the luminance less its mean is
tapered by a Hann window and padded to powers of two. The inverse transform of the cross-power
spectrum of the two regions peaks at the translation to the pixel (Kuglin and Hines, 1975). The
spectrum's inverse is then evaluated on finer grids around that peak by matrix-multiply discrete
Fourier transforms (Guizar-Sicairos, Thurman and Fienup, 2008): over 1.5 px in steps of 0.1 px,
then over 0.15 px in steps of 0.01 px.

The first version normalised the spectrum to unit magnitude, as phase correlation proper does. On
the panned terrain it was off by 0.0436 px root mean square and up to 0.1 px, every estimate pulled
towards the nearest whole pixel: normalising weights every frequency alike, and near the highest
the renders, averaged over each pixel's area, do not follow a pure phase shift. The plain
cross-power spectrum, as Guizar-Sicairos et al. use, weights frequencies by their power and is
the version kept on the branch.

## The checks

1. **The terrain panned by known amounts**, 0.1 to 0.9 px in x and in y in steps of 0.1, 81 pans:
   the estimate must lie within 0.05 px of the truth, root mean square. **Met:** every estimate is
   exact to its 0.01 px grid.
2. **The should-fail pairs in which nothing moved** must give an estimate under 0.02 px. **Missed.**
   Of the 117 should-fail pairs the script reads (the rendered pairs at 1× and 2×, the cases and
   `bench/synthetic.mjs`'s pairs; not Playwright's fixtures or the judge's own synthetic pairs),
   45 give 0.02 px or more. That count includes pairs in which something did move; the check
   is over those in which nothing moved, and each of these misses it:

   | Pair                                                   | Estimate (x, y) | Length   |
   | ------------------------------------------------------ | --------------- | -------- |
   | Text, subpixel to greyscale anti-aliasing (cases)      | −0.06, 0.00 px  | 0.060 px |
   | Text, hinted to unhinted (cases)                       | −0.03, −0.05 px | 0.058 px |
   | Surface opacity 35% to 30% (synthetic)                 | −0.01, 0.02 px  | 0.022 px |
   | A card shadow turned red, each browser, 1×             | 0.01, 0.02 px   | 0.022 px |
   | The map's red zone gone, 2×, Chromium and Firefox      | 0.05, 0.04 px   | 0.064 px |
   | The map's overlay fill stronger, 2×, Chromium, Firefox | −0.03, −0.02 px | 0.036 px |

   The estimates lie on the 0.01 px grid, so their lengths are exact. The 3D terrain with its light
   turned or moved, where nothing moved but the light, gives 1.8 to 3.8 px for a few degrees and 34
   to 68 px for the light moved across. The rest are the chart with a bar taller, 0.08 to 0.34 px,
   where something did move, and the image page's regression, 72.6 px at 1× and 139.3 to 139.6 px
   at 2×.

## Why it stops here

A registration that finds a move where nothing moved has something to explain away: shifting one
image by 0.06 px before comparing would set aside part of a change of text rendering, the very
case the should-fail pairs of 0.3.0 were added to protect. The likely reason is that the estimate is
right about these images, in a sense: a change of anti-aliasing or hinting, or of colour over part
of the image, moves the centre of the luminance, and a cross-correlation measures that centre. If
so, a better estimator would not pass the check; a rule that ignores small estimates might, but
that is a different design, to be judged against a check of its own written before its data. On the terrain's
lighting changes the estimate is pixels to tens of pixels: there registration would also need a
test of whether the images match after the shift before using it.

## What remains

- The 1.5× held-out set, rendered and labelled for this item before any of its code ran, is in an
  open pull request (#13), unread pair by pair, for a later candidate. It was not merged for 0.3.0:
  nothing reads it, and rendering it timed out once in three Windows runs.
- A later plan for registration should count the verdicts it gains by page, not by pair. Pairs of
  one page in three browsers are not independent, so five gained pairs may be two pages, and the
  0.3.0 plan's sign test over pairs would overstate them.
- Speed was not measured; the item stopped first.
