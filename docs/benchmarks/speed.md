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
| 1280×720  | 0%      | 41.8          | 4.1        | 21.9              | 0.8        | 0.0                       |
| 1280×720  | 1%      | 43.7          | 6.9        | 24.8              | 1.3        | 66.2                      |
| 1280×720  | 10%     | 52.4          | 23.2       | 43.1              | 1.9        | 121.3                     |
| 1280×720  | 100%    | 48.3          | 258.8      | 282.3             | 5.6        | 692.9                     |
| 1920×1080 | 0%      | 111.6         | 7.7        | 50.6              | 2.2        | 0.0                       |
| 1920×1080 | 1%      | 113.4         | 14.9       | 58.6              | 3.3        | 160.1                     |
| 1920×1080 | 10%     | 113.9         | 52.5       | 94.7              | 4.1        | 277.3                     |
| 1920×1080 | 100%    | 110.8         | 630.8      | 663.3             | 12.5       | 1488.5                    |
| 3200×2000 | 0%      | 332.8         | 23.3       | 152.1             | 6.6        | 0.1                       |
| 3200×2000 | 1%      | 332.8         | 42.4       | 185.9             | 10.2       | 406.4                     |
| 3200×2000 | 10%     | 332.7         | 181.4      | 315.5             | 13.1       | 782.5                     |
| 3200×2000 | 100%    | 335.4         | 1775.9     | 1879.4            | 39.0       | 4542.1                    |

## Reading the results

- pixelmatch is far faster. It measures difference with a few multiplications per pixel;
  CIEDE2000 needs trigonometry. That is the price of the better colour judgement.
- On the common path the cost is modest. With no change or a small one, comparison takes less
  time than decoding the screenshot it compares.
- Heavily changed images are slow. Every changed pixel gets the full colour maths, an
  anti-aliasing check and a shift check. A heavily changed image is a failing test, so this cost
  is paid on failure.
- Against looks-same, compare like with like. Its times include decoding, so set them against
  decode plus perceptual: at 3200×2000 that is 375 against 406 ms with 1% changed, 514 against
  783 ms with 10%, and 2,111 against 4,542 ms with everything changed. It returns at once for
  identical files, since it compares the encoded bytes first.

## Frames that change everywhere, against 0.1.0

Measured with the detector judge of the 0.2.0 redesign (`node bench/judge.mjs`, on its own
branch), each build in a process of its own, median of 5 runs, Node 22.22, Apple M4. The real
captures come from a downstream renderer and are not in this repository.

| Case                                                          | 0.1.0    | 0.2.0    |
| ------------------------------------------------------------- | -------- | -------- |
| `npm run bench`'s scene, 1280×720, everything changed         | 751 ms   | 363 ms   |
| `npm run bench`'s scene, 1920×1080, everything changed        | 1,481 ms | 665 ms   |
| `npm run bench`'s scene, 3200×2000, everything changed        | 4,479 ms | 1,587 ms |
| A drift of one to three levels over a textured 1346×819 frame | 567 ms   | 332 ms   |
| Film grain of ±1 level over the same frame                    | 420 ms   | 24 ms    |
| A real capture changed everywhere, 1346×819                   | 419 ms   | 351 ms   |
| A real capture with film grain, 1346×819                      | 247 ms   | 47 ms    |

Shift tolerance reads its windows from summed-area tables, so each test costs a few lookups
however much of the image changed; anti-aliasing and the 3×3 neighbourhood test are settled at
once where the answer is plain; and ΔE00 for each pair of colours is kept in a fixed table.
