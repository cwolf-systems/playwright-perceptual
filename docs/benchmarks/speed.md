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
| 1280×720  | 0%      | 45.1          | 4.1        | 22.3              | 0.8        | 0.0                       |
| 1280×720  | 1%      | 42.6          | 12.4       | 31.2              | 1.3        | 66.8                      |
| 1280×720  | 10%     | 46.7          | 52.4       | 72.4              | 1.9        | 132.3                     |
| 1280×720  | 100%    | 47.1          | 443.8      | 458.4             | 5.6        | 715.6                     |
| 1920×1080 | 0%      | 111.2         | 7.8        | 52.4              | 2.2        | 0.0                       |
| 1920×1080 | 1%      | 111.7         | 21.4       | 68.3              | 3.4        | 142.6                     |
| 1920×1080 | 10%     | 106.7         | 94.3       | 140.8             | 4.2        | 281.6                     |
| 1920×1080 | 100%    | 111.1         | 910.3      | 956.8             | 12.9       | 1556.3                    |
| 3200×2000 | 0%      | 334.4         | 25.1       | 160.1             | 6.5        | 0.1                       |
| 3200×2000 | 1%      | 320.7         | 47.7       | 175.2             | 10.0       | 399.2                     |
| 3200×2000 | 10%     | 311.7         | 280.8      | 417.9             | 12.6       | 780.9                     |
| 3200×2000 | 100%    | 340.2         | 2632.0     | 2773.9            | 38.9       | 4744.3                    |

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
  decode plus perceptual: at 3200×2000 that is 368 against 399 ms with 1% changed, 593 against
  781 ms with 10%, and 2,972 against 4,744 ms with everything changed. It returns at once for
  identical files, since it compares the encoded bytes first.

## Against 0.1.0

`npm run bench` run at 0.1.0 and at this release, one after the other on the same machine (Node
22.22, Apple M4), perceptual comparison only, milliseconds:

| Size      | Changed | 0.1.0  | 0.2.0  | 0.2.0 ÷ 0.1.0 |
| --------- | ------- | ------ | ------ | ------------- |
| 1280×720  | 1%      | 7.6    | 12.4   | 1.63×         |
| 1280×720  | 10%     | 51.5   | 52.4   | 1.02×         |
| 1280×720  | 100%    | 515.0  | 443.8  | 0.86×         |
| 1920×1080 | 1%      | 18.6   | 21.4   | 1.15×         |
| 1920×1080 | 10%     | 112.1  | 94.3   | 0.84×         |
| 1920×1080 | 100%    | 1229.0 | 910.3  | 0.74×         |
| 3200×2000 | 1%      | 71.1   | 47.7   | 0.67×         |
| 3200×2000 | 10%     | 552.1  | 280.8  | 0.51×         |
| 3200×2000 | 100%    | 5572.4 | 2632.0 | 0.47×         |

Fully changed images and large ones compare faster: the shift test reads box totals from a
summed-area table rather than pixel by pixel, anti-aliasing is asked once for both images, and
rounding is checked before the detectors. Small changes on small images cost more, since the first
changed pixel in a tile reads the whole tile, 256 rows by 512 columns and 66 pixels beyond each
side. With nothing changed the two are the same.
