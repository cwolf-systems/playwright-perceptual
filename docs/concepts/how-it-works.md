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
6. So is a sub-pixel shift: content moved by up to a pixel, which is the same image resampled at
   an offset. A changed pixel counts as one when resampling one image at some offset reproduces
   the other around it, tested in two parts. First the pixel itself: resampling only mixes
   neighbours, so each image's colour must lie within the range of the 3×3 neighbourhood of the
   same place in the other, channel by channel, give or take three levels for rounding and half
   that range for edges, which a rasteriser covers more sharply than bilinear resampling mixes
   them. Then its surroundings: one offset of up to a pixel each way must make the mean colour of
   the other image, resampled bilinearly, match within 1.15 levels per channel, in all three
   channels at once, over two windows: the 7×7 around the pixel and the 65×65 holding it. Bilinear
   resampling predicts single pixels along a sharp edge only roughly, but it moves the right
   amount of colour across a window's border, so a moved window's mean is reproduced. A real
   change adds or removes colour: a tint, a translucent overlay made a little stronger or weaker,
   or a drift of a couple of levels changes a window's mean, and no offset makes up for it in all
   three channels unless the window is a gradient the offset slides along. Over 7×7 much of a
   textured image is; over 65×65 texture rises and falls, a move carries as much colour in as
   out, and the change remains. The 7×7 window is clipped at the image's border, and resampling
   repeats the border's pixels, so a panel one pixel high is judged like any other. The 65×65
   window moves inward at the border, and an image under 67 pixels on a side is judged by the
   small window alone. The model and the measurements behind it are in the
   [design log](../design/shift-model.md).

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
- Shift tolerance can still take part of a uniform change for a move where both windows are
  gradients a move slides along, such as beside contour lines and edges: about a seventh of the
  pixels of a faint overlay change in a renderer's capture, an eighth in the synthetic one.
- A drift of one level everywhere passes as rounding while shift tolerance is on, even where it
  passes ΔE00 1 (up to 2.45 in near-black greys). A drift of two levels over an area counts.
- An image under 67 pixels on a side has no large window, so there a uniform drift of a couple
  of levels over a smooth gradient can pass as a move. A tint over a flat area is counted at any
  size.
- Not every sub-pixel move passes. Thin text, maps and 3D scenes moved 0.3 px still leave changed
  pixels where edges overlap and produce colours neither image has nearby.
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
- G. Sharma, W. Wu, E. N. Dalal (2005). The CIEDE2000 color-difference formula: implementation
  notes, supplementary test data, and mathematical observations. _Color Research & Application_
  30(1).
- ISO/CIE 11664-6:2014. Colorimetry, part 6: CIEDE2000 colour-difference formula.
- V. Vyšniauskas (2009). Anti-aliased pixel and intensity slope detector.
