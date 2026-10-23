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
6. So is a sub-pixel shift. Content moved by part of a pixel keeps its colour: over a box of
   pixels, each channel's total changes only by what the move carries across the box's border.
   For a move of (tx, ty), each up to a pixel, resampled bilinearly, that change is bilinear in tx
   and ty, so it lies between its values for whole-pixel moves: the box's total moved one pixel
   across, down, both, or not at all. So at a changed pixel one image's box total must lie within
   the range of the other's totals at the box and one pixel over, in one of the four directions,
   give or take rounding. Three tests ask it:
   - a 65×65 box, either image being the one that moved. Over texture a drift of a level or two
     looks like a small move in any small box, but over a box this large the texture rises and
     falls, a move carries as much colour in as out, and the drift remains;
   - a 5×5 box, either image being the one that moved, which a smaller real change survives;
   - the pixel alone, both ways round, give or take three levels: each image's colour lies within
     the colours next to it in the other.

   Box totals come from a summed-area table per channel, built once for each tile of the image
   where a pixel is judged, so a box of any size costs four reads. Near the image's border a box
   moves inward so that the box moved is in the image too. A pixel that passes all three is
   reported as shifted. A real change brings in a colour that was not nearby, such as a line that
   went away or a ring of new colour round a shape, or changes the colour of a whole box at once,
   such as a translucent overlay made a little stronger or weaker, or a drift over textured
   ground.

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

Shift tolerance and anti-aliasing detection set changed pixels aside as rendering noise. Some real
changes look exactly like that noise and pass; some noise does not look like it and counts. 0.1.0
has every miss below too. Unless a figure says it comes from this repository's benchmark, it was
measured on probe pages not included here.

Changes that can pass:

- **Whole-pixel moves.** A shape, a block of text or the whole page moved by exactly one pixel
  passes, because every colour it shows was already a pixel away. A one-pixel layout shift, a
  padding change of one pixel and a one-pixel crop all pass this way; a two-pixel shift counts.
  Turn shift tolerance off with `ignoreShifts: false` where that matters.
- **Thin lines beside strong edges.** A one-pixel focus ring round a dark control can be removed,
  recoloured or lightened and count nothing, and so can a one-pixel divider or border between a
  dark and a light area. Each of its pixels lies between a darker and a brighter neighbour, so it
  passes as anti-aliasing, and a grey line is locally the same as the edge moving by part of a
  pixel. Anti-aliasing detection compares brightness, not hue, and each channel takes its own move,
  so a seam between two saturated colours can change hue and pass too. A ring or line two pixels
  wide counts.
- **A border one pixel thicker in an element screenshot.** Where the border runs along the image's
  own edge, a border thickened from one to two pixels in the same colour counts nothing: the
  image's outer rings read as the content moved inward by a pixel. The same change inside a
  full-page screenshot counts.
- **A ring thickened beside a dark panel.** A light ring round a dark panel thickened from one to
  two pixels counts about 2% of its pixels (12 of 572), though each is about ΔE00 15 off: the
  panel's edge lets every box take the change for a move.
- **Small changes made only of edge pixels.** A comma turned into a period, an I into an l, an
  icon's corner moved one pixel, a spinner one frame on: all their changed pixels lie on slopes,
  so anti-aliasing explains them and few or none count.
- **A faint change beside an edge that did not move.** A move of the edge by a small part of a
  pixel carries as much colour across each box's border as the change took away: ground three
  levels darker within a few pixels of an edge passes, and so does part of a faint overlay change
  beside contour lines.
- **A drift of one level everywhere** passes as rounding while shift tolerance is on, even where it
  passes ΔE00 1 (up to 2.45 in near-black greys). A drift of two levels over an area counts.

Noise that can count:

- **One-pixel lines moved by part of a pixel.** A hairline under a fractional transform or at a
  fractional coordinate, such as a bordered card, a table's rules, a chart's grid lines, or a list
  of dividers scrolled half a pixel, fades into two rows at part strength. The line's own colour is
  then nowhere in the other image, so roughly one pixel per pixel of line length counts, often more
  than 0.1% of the image. A thin line moved by half a pixel can also gather into a pixel darker
  than any beside it, which looks exactly like a line of new colour.
- **Whole pages moved by part of a pixel.** Browsers draw text again at the new position rather
  than resampling it, so the glyphs' shades change rather than blend, and a page moved by a
  quarter or half a pixel fails, by thousands of pixels.
- **Other engines and other scales.** Firefox or WebKit against Chromium, and 1× against 2×, mostly
  fail: text and shadows are drawn differently, not moved. Keep one baseline per browser and per
  device scale, as Playwright does by default.
- **The GPU against the software rasteriser.** Rounded corners and blurred shadows can differ by
  a few levels and count a few pixels with no allowance; 0.1% covers them in the cases measured.
- **Different JPEG quality or decoders.** Compression error of tens of levels is none of the noise
  modelled here.
- On random noise most sub-pixel moves count, for the same reason as the one-pixel lines.

Other limits:

- In an image one pixel high or wide, what lies beyond the image across that side is unknown, so
  a move across it explains nothing and is not allowed for; a move along it is. A sub-pixel move
  of content across such a sliver counts as a change.
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
