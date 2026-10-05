# Accuracy

Does each comparator pass what it should and fail what it should? Reproduce with
`npm run bench:accuracy` (`bench/accuracy.mjs`).

## Corpus

Labelled pairs from three sources.

- **Playwright's own image-comparison fixtures** (`tests/image_tools/fixtures` at v1.60.0): 13 pairs
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

The first two make the **design set**: the noise detectors were developed while looking at these
results. The third is the **held-out set**: shift tolerance's rule and its slack of three levels
were fixed before it was first rendered. It holds no Playwright fixtures, which exist only at
their own scale. The two GIS scenes were added after both, and the run below is the first that
judged them, at either scale.

## Comparators

Exact bytes; pixelmatch at 0.05, its default 0.1, and Playwright's default 0.2; Playwright's
experimental ssim-cie94, loaded from Playwright's own bundle as its tests do; looks-same at its
default ΔE00 2.3; and this package at ΔE00 1 (its default), 1.5, 2, 2.3 and 3.

Three variants of this package at ΔE00 1.5 compare its noise detection:

- **shifts counted:** `ignoreShifts: false`, anti-aliasing detection only;
- **structural for edges:** Playwright's structural rule in place of anti-aliasing detection, with
  shift tolerance kept. A changed pixel is noise when neither image is flat in its 3×3
  neighbourhood and the 31×31 neighbourhoods are structurally near-identical (SSIM ≥ 0.99);
- **structural only:** the structural rule alone, as in Playwright's comparator.

The structural rule is an experiment in `bench/experiments`, not part of the package.

Each comparator is judged with no changed pixels allowed, and with 0.1% of the image.

## Results

macOS, Apple M4. Each cell counts wrong verdicts.

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
| perceptual ΔE00 1.5                                    | 3                                 | 0                             | 0                             | 14                                   |
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
  and the 2D map through the GPU against the software rasteriser, with 894 changed pixels (1.4%)
  at 1× and 5,067 (2%) at 2×. Those lie along the seams between basemap tiles, which the two
  rasterisers blend differently, and along the edges of the thick flight tracks: hairlines nobody
  would notice, though they reach ΔE00 28. Playwright's default passes this pair; ssim-cie94 and
  the structural rule fail it too. The 3D mission view through the GPU passes (2 and 43 pixels).
- The structural rule passes more rendering noise but hides faint changes. It misses the faint SVG
  regression, a stroke colour nudged, in all three browsers on both sets: a uniform change keeps
  the structure, so SSIM calls it noise. That is the failure this package exists to prevent, so
  the rule stays an experiment.
- Sub-pixel shifts are mostly unsolved. Shift tolerance passes some text and SVG moves at 2×, but
  the map and the 3D camera moved 0.3 px leave 160–560 changed pixels at 1× and 570–5,500 at 2×,
  and text at 1× leaves 200–450.

The benchmark's own gaps (one platform, labels by construction, small counts) and what to try
next are in the [roadmap](../roadmap.md).
