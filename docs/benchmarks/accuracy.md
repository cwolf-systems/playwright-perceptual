# Accuracy

Does each comparator pass what it should and fail what it should? Reproduce with
`npm run bench:accuracy` (`bench/accuracy.mjs`).

## Corpus

Labelled pairs from four sources.

- **Playwright's own image-comparison fixtures** (`tests/image_tools/fixtures` at v1.60.0): 12 pairs
  that should match (Chrome's non-deterministic rendering, WebKit rendering artefacts,
  anti-aliasing cases from looks-same's tests, trivial cases) and 9 that should not (colour changes,
  a missing caret, single pixels, and traps for SSIM-based comparison). They are downloaded on
  first run and not redistributed.
- **This repository's fixture pages** (text, SVG, CSS effects, a scaled image, a canvas chart, a
  WebGL height field, and two GIS scenes: a 2D operations map of resampled raster tiles with
  geofences, flight tracks and labelled drones, and a 3D mission view of hillshaded terrain with
  contours, fog and drones on altitude stems), rendered in Chromium, Firefox and WebKit:
  - **should match:** a colour change too small to see (15), and the same page through Chromium's
    software rasteriser and through the GPU (8, on machines with a GPU; measured here as
    SwiftShader against ANGLE on Metal, Apple M4);
  - **large regression:** a word changed, an icon removed, a bar taller, a shadow turned red, the
    light moved across, a geofence or a drone gone (24);
  - **faint regression:** visible but small, ΔE00 3 to 11: text grey lightened, a stroke or bar
    colour nudged, a shadow a third stronger, the light turned a few degrees, a geofence fill a
    little stronger, contour lines a little darker (24);
  - **sub-pixel shift:** text, strokes, paths, the map and the 3D camera moved 0.25–0.3 px,
    invisible but reported apart (15).
- **The same pages at 2× device scale**, rendered the same way: different rasterisation, and shifts
  of 0.5–0.6 device pixels.
- **Synthetic pairs** (`bench/synthetic.mjs`) that reproduce four findings from a renderer's test
  suite, generated from scratch because the original captures carry third-party map tiles. Each
  was checked to produce the same classes of pixel as the capture it stands for:
  - **faint regression:** a translucent surface over dark terrain, its opacity from 35% to 30%;
    two or three levels per channel, ΔE00 up to 2.6, nothing moved;
  - **sub-pixel shift:** the same scene panned 0.3 px, the control for the first;
  - **self-noise, should match:** a label whose anchor lands either side of a pixel boundary in
    two loads, so it moves a whole pixel; and its box one row taller for the same reason. They
    count as should-match because the input is identical, so failing them counts against every
    comparator, though the pixels did change and failing them is defensible;
  - **software vs GPU, should match:** terrain, and terrain under an aliased translucent geofence,
    rasterised exactly and with vertices snapped to 1/16 px;
  - **rounding, should match:** a 4×4 texture magnified bilinearly, exactly and in half
    precision; every channel within one level.

The first two make the **design set**: the noise detectors were developed while looking at these
results. The third is the **held-out set**, which holds no Playwright fixtures, since those exist
only at their own scale. Shift tolerance's neighbourhood rule and its slack of three levels were
fixed before it was first rendered, but the conservation rule and the rounding class added since
0.1.0 were measured on it while being developed (see the end of this page). The two GIS scenes
were added to both sets after the noise detectors were designed. The fourth is the **synthetic
set**, reported pair by pair; it was written alongside the changes it motivated, so it shows what
they fix, not how they generalise.

## Comparators

Exact bytes; pixelmatch at 0.05, its default 0.1, and Playwright's default 0.2; Playwright's
experimental ssim-cie94, loaded from Playwright's own bundle as its tests do; looks-same at its
default ΔE00 2.3; and this package at ΔE00 1 (its default), 1.5, 2, 2.3 and 3.

Three variants of this package at ΔE00 1.5 compare its noise detection:

- **shifts counted:** `ignoreShifts: false`, anti-aliasing detection only (rounding then counts,
  as in 0.1.0);
- **structural for edges:** Playwright's structural rule in place of anti-aliasing detection, with
  shift tolerance kept. A changed pixel is noise when neither image is flat in its 3×3
  neighbourhood and the 31×31 neighbourhoods are structurally near-identical (SSIM ≥ 0.99);
- **structural only:** the structural rule alone, as in Playwright's comparator.

The structural rule is an experiment in `bench/experiments`, not part of the package.

Each comparator is judged with no changed pixels allowed, and with 0.1% of the image.

## Results

macOS, Apple M4. Each cell counts wrong verdicts, except in the last table, which gives each
synthetic pair's changed pixels (looks-same reports only whether two images differ).

### Design set (107 pairs), no changed pixels allowed

| Comparator                                             | Should match (35): false failures | Large regression (33): missed | Faint regression (24): missed | Sub-pixel shift (15): false failures |
| ------------------------------------------------------ | --------------------------------- | ----------------------------- | ----------------------------- | ------------------------------------ |
| exact bytes                                            | 33                                | 0                             | 0                             | 15                                   |
| pixelmatch 0.05                                        | 8                                 | 1                             | 9                             | 15                                   |
| pixelmatch 0.1 (its default)                           | 3                                 | 1                             | 21                            | 15                                   |
| pixelmatch 0.2 (Playwright default)                    | 2                                 | 9                             | 24                            | 12                                   |
| ssim-cie94 (Playwright, experimental)                  | 4                                 | 0                             | 3                             | 15                                   |
| looks-same (ΔE00 2.3)                                  | 10                                | 1                             | 0                             | 15                                   |
| perceptual ΔE00 1                                      | 8                                 | 0                             | 0                             | 12                                   |
| perceptual ΔE00 1.5                                    | 7                                 | 0                             | 0                             | 12                                   |
| perceptual ΔE00 2                                      | 7                                 | 1                             | 0                             | 12                                   |
| perceptual ΔE00 2.3                                    | 7                                 | 1                             | 0                             | 12                                   |
| perceptual ΔE00 3                                      | 6                                 | 1                             | 0                             | 12                                   |
| perceptual ΔE00 1.5, shifts counted                    | 12                                | 0                             | 0                             | 15                                   |
| perceptual ΔE00 1.5, structural for edges (experiment) | 3                                 | 0                             | 3                             | 12                                   |
| perceptual ΔE00 1.5, structural only (experiment)      | 4                                 | 0                             | 3                             | 15                                   |

### Design set, 0.1% of the image allowed

| Comparator                                             | Should match (35): false failures | Large regression (33): missed | Faint regression (24): missed | Sub-pixel shift (15): false failures |
| ------------------------------------------------------ | --------------------------------- | ----------------------------- | ----------------------------- | ------------------------------------ |
| exact bytes                                            | 29                                | 2                             | 0                             | 15                                   |
| pixelmatch 0.05                                        | 2                                 | 3                             | 9                             | 12                                   |
| pixelmatch 0.1 (its default)                           | 1                                 | 3                             | 21                            | 12                                   |
| pixelmatch 0.2 (Playwright default)                    | 0                                 | 11                            | 24                            | 8                                    |
| ssim-cie94 (Playwright, experimental)                  | 2                                 | 2                             | 3                             | 15                                   |
| looks-same (ΔE00 2.3)                                  | 10                                | 1                             | 0                             | 15                                   |
| perceptual ΔE00 1                                      | 2                                 | 2                             | 0                             | 12                                   |
| perceptual ΔE00 1.5                                    | 2                                 | 2                             | 0                             | 12                                   |
| perceptual ΔE00 2                                      | 2                                 | 3                             | 0                             | 12                                   |
| perceptual ΔE00 2.3                                    | 2                                 | 3                             | 0                             | 12                                   |
| perceptual ΔE00 3                                      | 2                                 | 3                             | 3                             | 9                                    |
| perceptual ΔE00 1.5, shifts counted                    | 6                                 | 2                             | 0                             | 12                                   |
| perceptual ΔE00 1.5, structural for edges (experiment) | 1                                 | 2                             | 3                             | 12                                   |
| perceptual ΔE00 1.5, structural only (experiment)      | 2                                 | 2                             | 3                             | 15                                   |

### Held-out set (86 pairs), no changed pixels allowed

| Comparator                                             | Should match (23): false failures | Large regression (24): missed | Faint regression (24): missed | Sub-pixel shift (15): false failures |
| ------------------------------------------------------ | --------------------------------- | ----------------------------- | ----------------------------- | ------------------------------------ |
| exact bytes                                            | 23                                | 0                             | 0                             | 15                                   |
| pixelmatch 0.05                                        | 4                                 | 0                             | 9                             | 15                                   |
| pixelmatch 0.1 (its default)                           | 2                                 | 0                             | 21                            | 15                                   |
| pixelmatch 0.2 (Playwright default)                    | 1                                 | 6                             | 24                            | 12                                   |
| ssim-cie94 (Playwright, experimental)                  | 4                                 | 0                             | 0                             | 15                                   |
| looks-same (ΔE00 2.3)                                  | 5                                 | 0                             | 0                             | 15                                   |
| perceptual ΔE00 1                                      | 4                                 | 0                             | 0                             | 14                                   |
| perceptual ΔE00 1.5                                    | 4                                 | 0                             | 0                             | 14                                   |
| perceptual ΔE00 2                                      | 3                                 | 0                             | 0                             | 14                                   |
| perceptual ΔE00 2.3                                    | 3                                 | 0                             | 0                             | 14                                   |
| perceptual ΔE00 3                                      | 3                                 | 0                             | 0                             | 14                                   |
| perceptual ΔE00 1.5, shifts counted                    | 5                                 | 0                             | 0                             | 15                                   |
| perceptual ΔE00 1.5, structural for edges (experiment) | 2                                 | 0                             | 0                             | 15                                   |
| perceptual ΔE00 1.5, structural only (experiment)      | 4                                 | 0                             | 0                             | 15                                   |

### Held-out set, 0.1% of the image allowed

| Comparator                                             | Should match (23): false failures | Large regression (24): missed | Faint regression (24): missed | Sub-pixel shift (15): false failures |
| ------------------------------------------------------ | --------------------------------- | ----------------------------- | ----------------------------- | ------------------------------------ |
| exact bytes                                            | 23                                | 0                             | 0                             | 15                                   |
| pixelmatch 0.05                                        | 2                                 | 0                             | 9                             | 9                                    |
| pixelmatch 0.1 (its default)                           | 1                                 | 0                             | 21                            | 9                                    |
| pixelmatch 0.2 (Playwright default)                    | 0                                 | 6                             | 24                            | 2                                    |
| ssim-cie94 (Playwright, experimental)                  | 1                                 | 0                             | 3                             | 15                                   |
| looks-same (ΔE00 2.3)                                  | 5                                 | 0                             | 0                             | 15                                   |
| perceptual ΔE00 1                                      | 1                                 | 0                             | 0                             | 9                                    |
| perceptual ΔE00 1.5                                    | 1                                 | 0                             | 0                             | 9                                    |
| perceptual ΔE00 2                                      | 1                                 | 0                             | 0                             | 9                                    |
| perceptual ΔE00 2.3                                    | 1                                 | 0                             | 0                             | 9                                    |
| perceptual ΔE00 3                                      | 1                                 | 0                             | 3                             | 9                                    |
| perceptual ΔE00 1.5, shifts counted                    | 4                                 | 0                             | 0                             | 10                                   |
| perceptual ΔE00 1.5, structural for edges (experiment) | 1                                 | 0                             | 3                             | 9                                    |
| perceptual ΔE00 1.5, structural only (experiment)      | 1                                 | 0                             | 3                             | 15                                   |

### Synthetic set (7 pairs), no changed pixels allowed

| Comparator                                             | Should match (5): false failures | Large regression (0): missed | Faint regression (1): missed | Sub-pixel shift (1): false failures |
| ------------------------------------------------------ | -------------------------------- | ---------------------------- | ---------------------------- | ----------------------------------- |
| exact bytes                                            | 5                                | 0                            | 0                            | 1                                   |
| pixelmatch 0.05                                        | 3                                | 0                            | 1                            | 0                                   |
| pixelmatch 0.1 (its default)                           | 3                                | 0                            | 1                            | 0                                   |
| pixelmatch 0.2 (Playwright default)                    | 2                                | 0                            | 1                            | 0                                   |
| ssim-cie94 (Playwright, experimental)                  | 3                                | 0                            | 0                            | 1                                   |
| looks-same (ΔE00 2.3)                                  | 3                                | 0                            | 1                            | 1                                   |
| perceptual ΔE00 1                                      | 3                                | 0                            | 0                            | 1                                   |
| perceptual ΔE00 1.5                                    | 3                                | 0                            | 0                            | 1                                   |
| perceptual ΔE00 2                                      | 3                                | 0                            | 0                            | 0                                   |
| perceptual ΔE00 2.3                                    | 3                                | 0                            | 0                            | 0                                   |
| perceptual ΔE00 3                                      | 3                                | 0                            | 1                            | 0                                   |
| perceptual ΔE00 1.5, shifts counted                    | 3                                | 0                            | 0                            | 1                                   |
| perceptual ΔE00 1.5, structural for edges (experiment) | 3                                | 0                            | 0                            | 1                                   |
| perceptual ΔE00 1.5, structural only (experiment)      | 3                                | 0                            | 0                            | 1                                   |

### Synthetic set, 0.1% of the image allowed

| Comparator                                             | Should match (5): false failures | Large regression (0): missed | Faint regression (1): missed | Sub-pixel shift (1): false failures |
| ------------------------------------------------------ | -------------------------------- | ---------------------------- | ---------------------------- | ----------------------------------- |
| exact bytes                                            | 4                                | 0                            | 0                            | 1                                   |
| pixelmatch 0.05                                        | 2                                | 0                            | 1                            | 0                                   |
| pixelmatch 0.1 (its default)                           | 2                                | 0                            | 1                            | 0                                   |
| pixelmatch 0.2 (Playwright default)                    | 1                                | 0                            | 1                            | 0                                   |
| ssim-cie94 (Playwright, experimental)                  | 2                                | 0                            | 0                            | 1                                   |
| looks-same (ΔE00 2.3)                                  | 3                                | 0                            | 1                            | 1                                   |
| perceptual ΔE00 1                                      | 0                                | 0                            | 0                            | 0                                   |
| perceptual ΔE00 1.5                                    | 0                                | 0                            | 0                            | 0                                   |
| perceptual ΔE00 2                                      | 0                                | 0                            | 0                            | 0                                   |
| perceptual ΔE00 2.3                                    | 0                                | 0                            | 1                            | 0                                   |
| perceptual ΔE00 3                                      | 0                                | 0                            | 1                            | 0                                   |
| perceptual ΔE00 1.5, shifts counted                    | 2                                | 0                            | 0                            | 1                                   |
| perceptual ΔE00 1.5, structural for edges (experiment) | 0                                | 0                            | 0                            | 0                                   |
| perceptual ΔE00 1.5, structural only (experiment)      | 2                                | 0                            | 0                            | 0                                   |

### Synthetic set, changed pixels by pair (bold: wrong verdict with none allowed)

| Comparator                                             | 1: surface opacity 35% → 30% (fail) | 1: surface panned 0.3 px (match) | 2: label moved a pixel (match) | 2: label box one row taller (match) | 3: terrain, snapped vertices (match) | 3: geofence, snapped vertices (match) | 4: bilinear in half precision (match) |
| ------------------------------------------------------ | ----------------------------------- | -------------------------------- | ------------------------------ | ----------------------------------- | ------------------------------------ | ------------------------------------- | ------------------------------------- |
| exact bytes                                            | 26985                               | **23283**                        | **120**                        | **34**                              | **17447**                            | **16415**                             | **1297**                              |
| pixelmatch 0.05                                        | **0**                               | 0                                | **116**                        | **32**                              | 0                                    | **213**                               | 0                                     |
| pixelmatch 0.1 (its default)                           | **0**                               | 0                                | **116**                        | **32**                              | 0                                    | **213**                               | 0                                     |
| pixelmatch 0.2 (Playwright default)                    | **0**                               | 0                                | **98**                         | **8**                               | 0                                    | 0                                     | 0                                     |
| ssim-cie94 (Playwright, experimental)                  | 728                                 | **73**                           | **120**                        | **34**                              | 0                                    | **218**                               | 0                                     |
| looks-same (ΔE00 2.3)                                  | **0**                               | **differ**                       | **differ**                     | **differ**                          | 0                                    | **differ**                            | 0                                     |
| perceptual ΔE00 1                                      | 15074                               | **10**                           | **2**                          | **5**                               | 0                                    | **29**                                | 0                                     |
| perceptual ΔE00 1.5                                    | 2783                                | **3**                            | **2**                          | **5**                               | 0                                    | **29**                                | 0                                     |
| perceptual ΔE00 2                                      | 1227                                | 0                                | **2**                          | **5**                               | 0                                    | **29**                                | 0                                     |
| perceptual ΔE00 2.3                                    | 1                                   | 0                                | **2**                          | **5**                               | 0                                    | **29**                                | 0                                     |
| perceptual ΔE00 3                                      | **0**                               | 0                                | **2**                          | **5**                               | 0                                    | **29**                                | 0                                     |
| perceptual ΔE00 1.5, shifts counted                    | 4259                                | **301**                          | **116**                        | **32**                              | 0                                    | **213**                               | 0                                     |
| perceptual ΔE00 1.5, structural for edges (experiment) | 79                                  | **2**                            | **2**                          | **5**                               | 0                                    | **29**                                | 0                                     |
| perceptual ΔE00 1.5, structural only (experiment)      | 90                                  | **62**                           | **120**                        | **34**                              | 0                                    | **218**                               | 0                                     |

## Reading the results

- Playwright's default misses every faint regression, 24 of 24 in each set, and a quarter to a
  third of the large ones. At threshold 0.2 pixelmatch passed the WebGL terrain lit from the
  opposite side, a card shadow turned red, a stronger geofence fill and darker contours on the 3D
  terrain, in all three browsers.
- This package catches every faint regression at ΔE00 2.3 and below, in both sets and at both
  tolerances, the GIS scenes included. Exact bytes and looks-same do too, but fail far more pairs
  that should match. ssim-cie94 misses three: the faint SVG change below.
- Shift tolerance cuts false failures without missing anything. At ΔE00 1.5 with 0.1% allowed,
  pairs that should match but fail drop from 6 to 2 on the design set and from 4 to 1 on the
  held-out set.
- What still fails at the default with 0.1% allowed: a WebKit artefact from Playwright's fixtures;
  two large regressions of a few pixels, which fall under the allowance; most sub-pixel shifts;
  and the 2D map through the GPU against the software rasteriser, with 895 changed pixels (1.4%)
  at 1× and 5,581 (2.2%) at 2×. Those lie along the seams between basemap tiles, which the two
  rasterisers blend differently, and along the edges of the thick flight tracks: hairlines nobody
  would notice, though they reach ΔE00 28. Playwright's default passes this pair; ssim-cie94 and
  the structural rule fail it too. The 3D mission view through the GPU passes (2 and 45 pixels).
- The structural rule passes more rendering noise but hides faint changes. It misses the faint SVG
  regression, a stroke colour nudged, in all three browsers on both sets: a uniform change keeps
  the structure, so SSIM calls it noise. That is the failure this package exists to prevent, so
  the rule stays an experiment.
- Sub-pixel shifts are mostly unsolved. Shift tolerance passes some text and SVG moves at 2×, but
  the map and the 3D camera moved 0.3 px leave 160–560 changed pixels at 1× and 570–5,500 at 2×,
  and text at 1× leaves 200–450.

- In the synthetic set, the faint overlay change, two or three levels per channel and nothing
  moved, is missed by pixelmatch at every threshold and by looks-same, and caught by this package
  at ΔE00 2 and below at both allowances. At ΔE00 2.3 it is caught by a single pixel with none
  allowed, and missed with 0.1% allowed. Its control, the same scene panned 0.3 px, passes at 0.1%. The other five
  pairs should match: the terrain and the bilinear pair pass at both allowances; the moved label,
  the taller label box and the geofence through two rasterisers fail with none allowed and pass at
  0.1% (see the roadmap's known gaps).

## Changes since 0.1.0

Three changes to the noise detection, each judged on these pairs before it was adopted, against
0.1.0 on the same machine:

- **Shift tolerance requires a move to conserve colour** over the 5×5 window around a pixel,
  moved inward near the image's border.
- **Rounding is its own class**: while shift tolerance is on, a pixel within one level in every
  channel is not counted.
- **Anti-aliasing detection requires the flat side of a slope to keep its colour**, give or take a
  level.

In the design and held-out sets, one verdict changed: at ΔE00 1.5 with no pixels allowed,
Chromium's CSS effects page through the GPU against its software rasteriser at 2× fails with 11
pixels (it already failed at ΔE00 1, with 48 pixels before and 116 now). Nothing else changed at
any threshold or allowance. Regressions gain counted pixels, and some pairs that should match gain
a few: the 2D map through the GPU at 2×, from 5,067 to 5,581; the map and 3D view moved 0.3 px
at 2×, by up to 72; the CSS effects page through the GPU at 1×, from 3 to 9. In the synthetic set
the faint overlay change, 0 counted pixels before, now has 15,074 at ΔE00 1.

Comparison is slower where shift tolerance must test conservation at many pixels, and faster on
grainy images, where rounding is checked before the detectors. On a downstream renderer's captures
(1346×819, not included), a whole-frame real change took about twice as long (830–900 ms
against 422–480 ms), and a film-grain scene 50–59 ms against 240–255 ms. A synthetic worst case, a
drift of one to three levels over a whole textured frame of that size, took 3.6 times as long
(2.0 s against 0.56 s). `npm run bench` changes a solid block of colour, which shift tolerance
rejects at once, so its times are unchanged within run-to-run noise.

These rules were measured on the held-out set while being developed, so for them it is no longer
unseen.

The benchmark's own gaps (one platform, labels by construction, small counts) and what to try
next are in the [roadmap](../roadmap.md).
