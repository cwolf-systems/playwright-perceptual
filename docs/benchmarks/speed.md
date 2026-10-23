# Speed

How long one comparison takes, against pixelmatch (Playwright's default comparator) and
looks-same, on screenshot-sized images. Reproduce with `npm run bench` (`bench/speed.mjs`).

## Method

- **Images:** a smooth, deterministic picture of gradients and soft bands, the kind of content
  a rendered page or map produces, so nearly every pixel has a distinct colour. That is a hard
  case for caching.
- **Changes:** a single block covering 0%, 1%, 10% or 100% of the image, shifted visibly in colour.
- **Timing:** median of seven runs, in one process, after the comparators have warmed up.
- PNG decode is timed separately: the matcher decodes each screenshot Playwright returns.
- looks-same is timed including its own PNG decoding, which it does not expose separately.
- Playwright's ssim-cie94 comparator is not exported, so it is not measured.

## Results

Node 22.22, Apple M4, milliseconds.

| Size      | Changed | PNG decode ×2 | perceptual | perceptual + diff | pixelmatch | looks-same (incl. decode) |
| --------- | ------- | ------------- | ---------- | ----------------- | ---------- | ------------------------- |
| 1280×720  | 0%      | 43.0          | 4.1        | 22.8              | 0.8        | 0.0                       |
| 1280×720  | 1%      | 42.2          | 11.7       | 30.7              | 1.3        | 68.2                      |
| 1280×720  | 10%     | 51.3          | 51.5       | 70.1              | 1.9        | 119.5                     |
| 1280×720  | 100%    | 48.7          | 443.3      | 448.6             | 5.6        | 688.6                     |
| 1920×1080 | 0%      | 110.1         | 7.6        | 49.4              | 2.1        | 0.0                       |
| 1920×1080 | 1%      | 109.5         | 20.4       | 61.9              | 3.3        | 138.0                     |
| 1920×1080 | 10%     | 112.4         | 96.3       | 136.9             | 4.1        | 268.8                     |
| 1920×1080 | 100%    | 109.8         | 914.1      | 948.5             | 12.6       | 1511.5                    |
| 3200×2000 | 0%      | 327.7         | 23.6       | 157.2             | 6.6        | 0.1                       |
| 3200×2000 | 1%      | 328.8         | 49.8       | 181.3             | 10.3       | 392.1                     |
| 3200×2000 | 10%     | 328.8         | 303.3      | 432.2             | 12.9       | 786.7                     |
| 3200×2000 | 100%    | 327.0         | 2621.8     | 2732.5            | 38.7       | 4431.2                    |

## Reading the results

- pixelmatch is far faster. It measures difference with a few multiplications per pixel;
  CIEDE2000 needs trigonometry. That is the price of the better colour judgement.
- On the common path the cost is modest. With no change or a small one, comparison takes less
  time than decoding the screenshot it compares.
- Heavily changed images are slow. Every changed pixel gets the full colour maths, an
  anti-aliasing check and a shift check. A heavily changed image is a failing test, so this cost
  is paid on failure. The shift check reads box totals from a summed-area table built once per
  tile of the image, four reads per total whatever the box's size, so it costs the same over
  texture as over a solid block of colour.
- Against looks-same, compare like with like. Its times include decoding, so set them against
  decode plus perceptual: at 3200×2000 that is 379 against 392 ms with 1% changed, 632 against
  787 ms with 10%, and 2,949 against 4,431 ms with everything changed. It returns at once for
  identical files, since it compares the encoded bytes first.

## Against 0.1.0

The redesign judge times 0.1.0, PR #1's first draft of 0.2.0 and this release, each in a process
of its own on the same machine (Apple M4, Node 22), median of five. Whole-frame cases, milliseconds:

| Case                                   | 0.1.0  | First draft | 0.2.0  | vs 0.1.0 |
| -------------------------------------- | ------ | ----------- | ------ | -------- |
| bench 1280×720, all changed            | 688.0  | 625.8       | 368.2  | 0.54×    |
| bench 1920×1080, all changed           | 1414.7 | 1292.6      | 796.0  | 0.56×    |
| bench 3200×2000, all changed           | 4485.1 | 3438.6      | 2350.1 | 0.52×    |
| textured drift of 1–3 levels, 1346×819 | 572.1  | 707.5       | 271.1  | 0.47×    |
| film grain of ±1 level, 1346×819       | 448.0  | 51.0        | 22.3   | 0.05×    |
| real whole-frame change, 1346×819      | 461.7  | 997.1       | 359.4  | 0.78×    |
| real film grain, 1346×819              | 257.8  | 52.2        | 85.4   | 0.33×    |

The real captures come from a downstream renderer and are not included. Small changes cost more
than with 0.1.0 at 1280×720 (14.0 ms against 9.0 with 1% changed), since the first changed pixel
in a tile reads the whole tile, 256 rows by 512 columns and 66 pixels beyond each side; from
1920×1080 up, and from 10% changed, they cost the same or less.
