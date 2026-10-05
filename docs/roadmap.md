# Roadmap

What is known not to work, what the benchmark cannot yet show, and what to try next. Every
change to the comparison is judged by the [accuracy benchmark](benchmarks/accuracy.md) before it
is adopted, on pages written before the change was run against them.

## Known gaps

These come from the benchmark, at the default settings with 0.1% of the image allowed.

1. Sub-pixel movement mostly fails. Text, maps and 3D cameras moved by 0.3 px leave hundreds to
   thousands of changed pixels. Shift tolerance passes about 95% of the changed pixels in these
   cases, but rarely all of them, and a few hundred left over still fails the test.
2. The 2D map through Chromium's GPU and through its software rasteriser fails: 1.4% of pixels at
   1× scale, 2% at 2×. The differences are hairlines along the seams between raster tiles and
   along the edges of thick stroked lines.
3. Shift tolerance passes a hard edge moved by exactly one pixel. That is the price of looking one
   pixel around; `ignoreShifts: false` turns it off.
4. Comparison is slow when much of the image changes: about 5.5 s for a fully changed 3200×2000
   screenshot, against 40 ms for pixelmatch. Passing tests and small changes cost less than
   decoding the screenshot, so this is mostly paid by failing tests.
5. The thresholds are rules of thumb. ΔE00 1 as "just noticeable" comes from the formula's design
   and from viewing uniform patches, not from people looking at screenshots.

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
neighbourhood to stay within the threshold might keep the first without the second. Multi-scale
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
pixel. Stopping a failing comparison once it is certain to fail, when no diff image is wanted,
would bound it. Decoding, about 330 ms for two 3200×2000 PNGs, is pngjs; a faster decoder would
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
