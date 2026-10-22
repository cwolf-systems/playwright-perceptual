# How it works

## Comparing two images

Two images of the same size are compared pixel by pixel.

1. Pixels whose bytes match are unchanged, with no colour maths. In a typical screenshot that is
   almost all of them.
2. A changed pixel's colour is blended over white, as a transparent screenshot is seen, and
   converted from sRGB to CIELAB (CIE 15:2004, D65 white). Conversions are cached, since
   screenshots repeat colours heavily.
3. The difference is CIEDE2000 (ISO/CIE 11664-6), the current CIE colour-difference formula,
   built so that about 1.0 is just noticeable anywhere in colour space. The implementation
   follows Sharma, Wu and Dalal (2005) equation by equation and matches their 34 published test
   pairs to four decimal places.
4. A pixel past the threshold whose channels each differ by at most one level is rounding: two
   renderings of the same colour, each rounded to the nearest of 256 levels, can differ that much,
   and in dark or greyish colours that alone can pass ΔE00 1. The most it reaches is ΔE00 2.45,
   for (23, 24, 23) against (24, 23, 24): one level apart in each channel, in a near-black grey.
   While shift tolerance is on, it is reported, not counted. Shift tolerance in 0.1.0 already
   passed these pixels as shifts, so turning it off counts them again unless
   `ignoreRounding: true` asks otherwise.
5. A pixel that sits on a slope between a darker and a brighter neighbour, one of which lies in a
   flat area in both images and keeps its colour there give or take a level, is anti-aliasing
   that rasterisers place differently (Vyšniauskas, 2009). It is reported, not counted.
6. So is a sub-pixel shift. Content moved by part of a pixel is resampled between neighbours, so
   each image's colour at a changed pixel lies within the range of colours in the 3×3
   neighbourhood of the same place in the other image, channel by channel, give or take three
   levels for rounding. On textured ground that range is wide enough to hold a faint change of
   colour, so the 5×5 window around the pixel must also show that nothing but a move happened,
   in one of two ways:
   - **It kept its colour:** each channel's mean over the window changed by at most 1.5 levels,
     as rounding, grain and a GPU's filtering leave it. A change of colour shifts the mean by what
     it adds everywhere; a drift of two levels over an area counts.
   - **A move explains it:** the window is registered. The change is fitted as the expected
     image's gradient times one offset (a single, damped Lucas–Kanade step: Lucas and Kanade,
     1981), and the offset must lie within 0.75 px along each axis and explain at least 40% of
     the squared change. Texture moved one way and back averages to no change, so a change of
     colour over texture has no offset that explains it.

   A pixel is also shifted if, in both images, it is a mixture of the same two colours found on
   opposite sides of it in the window, each of which kept its colour give or take a level: an edge
   resampled differently rather than moved, as a GPU and a software rasteriser draw a soft edge
   or the end of a gradient. A change of colour over an area changes those sides too.

   Each pair of images is read once per 32×32 tile, where a detector asks, with summed-area
   tables (Crow, 1984) of what the tests sum, so each window costs a few lookups.

The result is the number of changed pixels and the distribution of ΔE00 over the whole image:
mean, median, p95, p99 and maximum. The count says how much changed; the distribution says how
visibly.

## Why CIEDE2000

Exact comparison fails whenever two GPUs, drivers or browser versions draw the same page:
gradients, shadows, filters and shaded 3D land a level or two apart, which nobody can see.
Playwright's default, pixelmatch, measures difference in the YIQ colour space (Kotsarenko and
Ramos, 2010) against a single threshold; YIQ was designed for broadcast television. CIEDE2000 was
fitted to experiments on what people notice (Luo, Cui and Rigg, 2001), with corrections for
lightness, chroma and hue, and for blues, where earlier formulas were least accurate.

## Limits

- A hard-edged shape moved by a whole pixel passes shift tolerance, because every colour it shows
  was already within a pixel. Turn it off with `ignoreShifts: false` where that matters. Over a
  translucent box or textured ground, a shape moved a whole pixel does not always pass: a label
  that lands on the next pixel in another page load, or an aliased edge that runs within 1/32 px
  of a row of pixel centres and covers that row in one rasteriser but not another, leaves a few
  pixels counted.
- At the rim of an area whose colour changed, the window reaches past the area and its mean
  moves by only part of the change, and beside a line or edge a change of colour can fit a move
  of the line. There shift tolerance still takes part of a faint uniform change for noise: about
  a tenth of the pixels of a translucent overlay made 5 points more transparent, in the cases
  measured.
- A drift of one level per channel everywhere passes as rounding while shift tolerance is on,
  even where it passes ΔE00 1 (up to 2.45 in near-black greys). A drift of two levels over an
  area counts, down to images a pixel wide.
- Not every sub-pixel move passes. Thin text, maps and 3D scenes moved 0.3 px still leave changed
  pixels where edges overlap and produce colours neither image has nearby. The peak of a small
  bright spot, and content that a move brings in from beyond the image's border, fall outside
  the colours nearby too.
- Fine detail is judged at full resolution. CIEDE2000 was built for uniform patches; the eye blends
  detail too fine to resolve, and per-pixel comparison does not. Hairline differences, such as
  seams between map tiles drawn by two rasterisers, count in full.
- Beyond about ΔE00 10 the formula orders differences less reliably. That rarely matters here:
  anything past the threshold is a change.

The [roadmap](../roadmap.md) covers what to do about these, with references.

## References

- Y. Kotsarenko, F. Ramos (2010). Measuring perceived color difference using YIQ NTSC transmission
  color space in mobile applications. _Programación Matemática y Software_ 2(2).
- M. R. Luo, G. Cui, B. Rigg (2001). The development of the CIE 2000 colour-difference formula:
  CIEDE2000. _Color Research & Application_ 26(5).
- F. C. Crow (1984). Summed-area tables for texture mapping. _Computer Graphics (SIGGRAPH '84)_
  18(3).
- B. D. Lucas, T. Kanade (1981). An iterative image registration technique with an application to
  stereo vision. _Proceedings of the 7th International Joint Conference on Artificial
  Intelligence_.
- G. Sharma, W. Wu, E. N. Dalal (2005). The CIEDE2000 color-difference formula: implementation
  notes, supplementary test data, and mathematical observations. _Color Research & Application_
  30(1).
- ISO/CIE 11664-6:2014. Colorimetry, part 6: CIEDE2000 colour-difference formula.
- V. Vyšniauskas (2009). Anti-aliased pixel and intensity slope detector.
