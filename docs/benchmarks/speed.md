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
| 1280×720  | 0%      | 43.9          | 4.0        | 22.0              | 0.8        | 0.0                       |
| 1280×720  | 1%      | 42.9          | 14.4       | 32.2              | 1.2        | 64.2                      |
| 1280×720  | 10%     | 51.1          | 61.4       | 69.1              | 1.9        | 120.5                     |
| 1280×720  | 100%    | 50.3          | 435.0      | 435.2             | 5.7        | 696.8                     |
| 1920×1080 | 0%      | 112.5         | 7.7        | 50.7              | 2.2        | 0.0                       |
| 1920×1080 | 1%      | 114.4         | 21.2       | 66.0              | 3.4        | 138.4                     |
| 1920×1080 | 10%     | 110.5         | 93.6       | 136.8             | 4.3        | 271.6                     |
| 1920×1080 | 100%    | 111.8         | 921.5      | 969.3             | 12.6       | 1517.6                    |
| 3200×2000 | 0%      | 333.8         | 23.6       | 170.3             | 7.2        | 0.1                       |
| 3200×2000 | 1%      | 336.7         | 52.9       | 195.6             | 10.9       | 406.8                     |
| 3200×2000 | 10%     | 339.8         | 311.8      | 456.9             | 13.7       | 953.1                     |
| 3200×2000 | 100%    | 345.4         | 2943.1     | 3155.7            | 43.2       | 4754.3                    |

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
  decode plus perceptual: at 3200×2000 that is 390 against 407 ms with 1% changed, 652 against
  953 ms with 10%, and 3,289 against 4,754 ms with everything changed. It returns at once for
  identical files, since it compares the encoded bytes first.

## Against 0.1.0

`npm run bench` run at 0.1.0 and at this release, one after the other on the same machine (Node
22.22, Apple M4), perceptual comparison only, milliseconds:

| Size      | Changed | 0.1.0  | 0.2.0  | 0.2.0 ÷ 0.1.0 |
| --------- | ------- | ------ | ------ | ------------- |
| 1280×720  | 1%      | 8.4    | 14.4   | 1.71×         |
| 1280×720  | 10%     | 58.1   | 61.4   | 1.06×         |
| 1280×720  | 100%    | 549.2  | 435.0  | 0.79×         |
| 1920×1080 | 1%      | 18.8   | 21.2   | 1.13×         |
| 1920×1080 | 10%     | 108.7  | 93.6   | 0.86×         |
| 1920×1080 | 100%    | 1220.5 | 921.5  | 0.76×         |
| 3200×2000 | 1%      | 75.5   | 52.9   | 0.70×         |
| 3200×2000 | 10%     | 548.1  | 311.8  | 0.57×         |
| 3200×2000 | 100%    | 5134.9 | 2943.1 | 0.57×         |

Fully changed images and large ones compare faster: the shift test reads box totals from a
summed-area table rather than pixel by pixel, anti-aliasing is asked once for both images, and
rounding is checked before the detectors. Small changes on small images cost more, since the first
changed pixel in a tile reads the whole tile, 256 rows by 512 columns and 66 pixels beyond each
side. With nothing changed the two are the same.
