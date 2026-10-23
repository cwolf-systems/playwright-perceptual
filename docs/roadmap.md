# Roadmap

What is known not to work, what the benchmark cannot yet show, and what to try next. Every
change to the comparison is judged by the [accuracy benchmark](benchmarks/accuracy.md) before it
is adopted, on pages written before the change was run against them.

## Known gaps

These come from the benchmark and from probe pages not included in this repository, at the default
settings with 0.1% of the image allowed.

1. Sub-pixel movement mostly fails. Text, maps and 3D cameras moved by 0.3 px leave hundreds to
   thousands of changed pixels. Shift tolerance passes about 95% of the changed pixels in these
   cases, but rarely all of them, and a few hundred left over still fails the test. A one-pixel
   line moved by part of a pixel, such as a card's border, a table rule, a chart grid line or a
   divider in a list scrolled half a pixel, fades into two rows, and its own colour is then nowhere
   in the other image: about one pixel counts per pixel of line. Whole pages moved by part of a
   pixel fail by thousands, since browsers draw text again at the new position.
2. The 2D map through Chromium's GPU and through its software rasteriser fails: 1.5% of pixels at
   1× scale, 3.9% at 2×. The differences are hairlines along the seams between raster tiles and
   along the edges of thick stroked lines.
3. Shift tolerance passes a hard edge moved by exactly one pixel: a one-pixel layout shift, a
   one-pixel padding change, a one-pixel crop. That is the price of looking one pixel around;
   `ignoreShifts: false` turns it off.
4. Comparison is slow when much of the image changes: about 2.9 s for a fully changed 3200×2000
   screenshot in `npm run bench`, against 40 ms for pixelmatch. Passing tests and small changes
   cost less than decoding the screenshot, so this is mostly paid by failing tests.
5. The thresholds are rules of thumb. ΔE00 1 as "just noticeable" comes from the formula's design
   and from viewing uniform patches, not from people looking at screenshots.
6. A faint change of colour beside an edge that did not move can pass as a shift. A move of the
   edge by a small part of a pixel carries as much colour across each box's border as the change
   took away: ground three levels darker within a few pixels of an edge passes, and so does part
   of a translucent overlay made 5 points more transparent over terrain, beside contour lines.
   Registration, below, would tell the two apart by finding the move first; see
   [the design log](design/shift-tolerance.md).
7. The same scene can land on different pixels between page loads or rasterisers. A label whose
   projected anchor falls either side of a pixel boundary moves by a whole pixel; an aliased
   overlay edge within 1/32 px of a row of pixel centres covers the row in a rasteriser that
   snaps vertices to 1/16 px and not in one that does not. Over a translucent box or textured
   ground, a few such pixels bring colours that were not nearby, so the test fails with no
   allowance. An allowance or a mask hides them; the renderer snapping labels to whole pixels
   removes them. The synthetic pairs in the benchmark reproduce both.
8. A drift of one level per channel everywhere passes as rounding while shift tolerance is on; a
   drift of two over an area counts. A renderer whose exposure differs by one or two levels
   between loads of the same scene used to pass through shift tolerance and now fails, as one scene
   of a downstream renderer's captures did (not included here).
9. Across an image one pixel high or wide, what lies beyond the image is unknown, so shift
   tolerance allows no move across it, and content moved by part of a pixel across such a sliver
   counts as changed. The same holds on the outermost pixels of any image.
10. Thin lines beside strong edges pass. A one-pixel focus ring round a dark control, or a
    one-pixel divider or border between a dark and a light area, can be removed, recoloured or
    lightened and count nothing: each pixel lies on a slope between a darker and a brighter
    neighbour, so anti-aliasing detection explains it, and a grey line is locally the same as the
    edge moving by part of a pixel. Anti-aliasing detection compares brightness, not hue, and each
    channel takes its own move, so a seam between two saturated colours can change hue and pass.
    Requiring an anti-aliased pixel to be a mix of its darker and brighter neighbours in every
    channel is not enough alone: shift tolerance then passes the same pixels, since each channel
    takes its own move. Both would need to change.
11. In an element screenshot whose border runs along the image's edge, a border thickened from one
    to two pixels in the same colour counts nothing: the outer rings read as the content moved
    inward by a pixel. Testing, at such pixels, a box that does not move across the border would
    tell them apart. A light ring round a dark panel thickened the same way counts about 2% of its
    pixels.
12. Small changes made only of edge pixels pass as anti-aliasing: a comma turned into a period, an
    I into an l, an icon's corner moved one pixel.
13. Pairs from different engines, or at 1× against 2×, mostly fail: text and shadows are drawn
    differently, not moved. Keep one baseline per browser and per device scale.

Items 1 and 2 are the same problem: detail too fine for anyone to see, judged pixel by pixel.

## Gaps in the benchmark

- **One platform.** Accuracy is measured on macOS only. The browser suite runs on Linux, macOS and
  Windows, but only checks pass or fail on a handful of pages. Running the benchmark in CI on all
  three and publishing each table is next.
- **Labels by construction.** Each variant is labelled by how it was made: a change of one colour
  level should match, a ΔE00 3 to 11 change should not. No person has judged the pairs. A small
  labelling study, with observers asked whether two images differ, in the manner of ITU-R BT.500,
  would test the labels and calibrate the default threshold and allowance.
- **Our own pages.** Apart from Playwright's fixtures, every pair comes from pages written for this
  benchmark. Pairs from other projects' test suites (looks-same, pixelmatch) and labelled
  screenshots of real applications would show whether the results carry over.
- **Small counts.** With 9 to 24 pairs per group, one pair moves a rate by 4 to 11 points. The
  tables should give 95% intervals (Wilson, 1927) so differences of one or two pairs are not read
  as real.
- **Missing cases.** No pair removes a one-pixel line, such as a geofence outline or a grid line.
  Spatial filtering, below, could hide exactly that, so the case has to exist before filtering is
  tried. Also missing: text anti-aliasing changes (subpixel to greyscale), font hinting changes,
  and dark themes.
- **Self-noise.** Each page should be rendered several times in the same browser to measure how
  much it differs from itself. WebKit's map differs between two loads by two pixels at ΔE00 1.05.
  The synthetic set reproduces two kinds of self-noise reported by a renderer (a label on another
  pixel, a box one row taller), but this repository's own pages are still rendered once.
- **Synthetic pairs.** The synthetic set reproduces reported findings from images generated from
  scratch, since the original captures carry third-party map tiles. Each was checked to produce
  the same classes of pixel as the capture it stands for, but seven pairs written alongside a fix
  are evidence for that fix, not a test of it; the design and held-out sets are.

## Directions

In rough order of expected value.

### Spatial filtering before the colour difference

Blur both images by the contrast sensitivity of the eye at a given viewing distance, then compare.
Detail too fine to resolve stops counting, which covers hairline seams, stroke edges and most
sub-pixel movement. S-CIELAB (Zhang and Wandell, 1997) filters each opponent colour channel
separately before ΔE; Johnson and Fairchild (2003) pair it with CIEDE2000. FLIP (Andersson et al., 2020) does the same in a perceptual space, with HyAB as the distance, adds a term for edges and
points, and states viewing conditions as pixels per degree.

The risk is hiding thin lines that matter. Judge it on the one-pixel-line case above, as well as
on the 2D map pair and the shifted text and maps.

### Global sub-pixel registration

A map panned by a fraction of a pixel, or a camera nudged, moves the whole image by the same
amount. Phase correlation (Kuglin and Hines, 1975) estimates a global translation, and
Guizar-Sicairos, Thurman and Fienup (2008) refine it to a fraction of a pixel cheaply. Shift one
image by the estimate, compare, and report the shift found, so a test can also fail on movement
above a set limit. Optical flow (Lucas and Kanade, 1981) would extend this to parts that move on
their own, such as labels, at more cost.

### A visibility model

Visible difference predictors model contrast sensitivity, masking by nearby texture, and
adaptation: Daly's VDP (1993), HDR-VDP-2 (Mantiuk et al., 2011), and ColorVideoVDP (Mantiuk et
al., 2024), which handles colour. They are heavier than this package's comparison, but could serve
as a reference when choosing filter settings and thresholds, or as an opt-in comparator.

### Better structural tests

SSIM (Wang et al., 2004) passes scattered rendering noise but, measured here, calls faint uniform
colour changes noise too. A structural test that also requires the mean colour of the
neighbourhood to stay within the threshold might keep the first without the second. Shift
tolerance now applies a version of that requirement: a move may change a box's total colour only
by what crosses its border. Anti-aliasing detection could take the same test. Multi-scale
SSIM (Wang, Simoncelli and Bovik, 2003) is the natural variant to measure alongside.

### Other colour differences

HyAB (Abasi, Amani Tehran and Fairchild, 2020) is cheaper than CIEDE2000 and better behaved for
large differences. CAM16-UCS (Li et al., 2017) matches or improves on CIEDE2000 in comparative
studies. ΔE ITP (ITU-R BT.2124) is built for wide-gamut and HDR content, should screenshots ever
carry it. Each plugs in as the comparator's `colorDifference`.

### Regions and layers

A map is layers: basemap, overlays, labels. Comparing them with different tolerances, a loose one
for the basemap and a strict one for geofences and tracks, needs either masks with their own
options or captures of each layer. Region masks with per-region `maxDeltaE` and allowance are the
simple first step. Localising a failure to the element that caused it, as WebSee does for HTML
pages (Mahajan and Halfond, 2015), would make failure messages more useful.

### Speed

Most of the time on heavily changed images goes to colour maths and noise checks per changed
pixel. The screenshot matcher already stops counting past the allowance while it waits for a
stable screenshot; the comparison its failure message reports still runs in full, and so does
`toBePerceptuallyNear`'s. Reporting "more than N" there would bound a failing test's cost, at the
price of a less informative message. Decoding, about 330 ms for two 3200×2000 PNGs, is pngjs; a faster decoder would
mean a native dependency, which this package avoids.

## Out of scope

Learned metrics such as LPIPS (Zhang et al., 2018) need a neural network runtime and give no
account of why two images differ. This package stays dependency-light and explainable.

## References

- P. Andersson, J. Nilsson, T. Akenine-Möller, M. Oskarsson, K. Åström, M. D. Fairchild (2020).
  FLIP: A difference evaluator for alternating images. _Proceedings of the ACM on Computer
  Graphics and Interactive Techniques_ 3(2).
- S. Abasi, M. Amani Tehran, M. D. Fairchild (2020). Distance metrics for very large color
  differences. _Color Research & Application_ 45(2).
- S. Daly (1993). The visible differences predictor: an algorithm for the assessment of image
  fidelity. In A. B. Watson (ed.), _Digital Images and Human Vision_, MIT Press.
- M. Guizar-Sicairos, S. T. Thurman, J. R. Fienup (2008). Efficient subpixel image registration
  algorithms. _Optics Letters_ 33(2).
- ITU-R Recommendation BT.500. Methodologies for the subjective assessment of the quality of
  television images.
- ITU-R Recommendation BT.2124 (2019). Objective metric for the assessment of the potential
  visibility of colour differences in television.
- G. M. Johnson, M. D. Fairchild (2003). A top down description of S-CIELAB and CIEDE2000. _Color
  Research & Application_ 28(6).
- C. D. Kuglin, D. C. Hines (1975). The phase correlation image alignment method. _Proceedings of
  the IEEE International Conference on Cybernetics and Society_.
- C. Li et al. (2017). Comprehensive color solutions: CAM16, CAT16, and CAM16-UCS. _Color
  Research & Application_ 42(6).
- B. D. Lucas, T. Kanade (1981). An iterative image registration technique with an application to
  stereo vision. _Proceedings of the 7th International Joint Conference on Artificial
  Intelligence_.
- S. Mahajan, W. G. J. Halfond (2015). Detection and localization of HTML presentation failures
  using computer vision-based techniques. _IEEE International Conference on Software Testing,
  Verification and Validation_.
- R. Mantiuk, K. J. Kim, A. G. Rempel, W. Heidrich (2011). HDR-VDP-2: a calibrated visual metric
  for visibility and quality predictions in all luminance conditions. _ACM Transactions on
  Graphics_ 30(4).
- R. K. Mantiuk et al. (2024). ColorVideoVDP: a visual difference predictor for image, video and
  display distortions. _ACM Transactions on Graphics_ 43(4).
- Z. Wang, E. P. Simoncelli, A. C. Bovik (2003). Multiscale structural similarity for image
  quality assessment. _Asilomar Conference on Signals, Systems and Computers_.
- Z. Wang, A. C. Bovik, H. R. Sheikh, E. P. Simoncelli (2004). Image quality assessment: from
  error visibility to structural similarity. _IEEE Transactions on Image Processing_ 13(4).
- E. B. Wilson (1927). Probable inference, the law of succession, and statistical inference.
  _Journal of the American Statistical Association_ 22(158).
- X. Zhang, B. A. Wandell (1997). A spatial extension of CIELAB for digital color-image
  reproduction. _Journal of the Society for Information Display_ 5(1).
- R. Zhang, P. Isola, A. A. Efros, E. Shechtman, O. Wang (2018). The unreasonable effectiveness of
  deep features as a perceptual metric. _IEEE Conference on Computer Vision and Pattern
  Recognition_.
