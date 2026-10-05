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
| 1280×720  | 0%      | 41.8          | 3.9        | 21.7              | 0.7        | 0.0                       |
| 1280×720  | 1%      | 43.6          | 7.5        | 25.6              | 1.3        | 65.8                      |
| 1280×720  | 10%     | 47.3          | 47.8       | 69.5              | 1.9        | 115.1                     |
| 1280×720  | 100%    | 47.4          | 461.2      | 490.3             | 5.6        | 678.8                     |
| 1920×1080 | 0%      | 108.3         | 7.6        | 50.5              | 2.1        | 0.0                       |
| 1920×1080 | 1%      | 111.5         | 17.9       | 60.5              | 3.5        | 165.4                     |
| 1920×1080 | 10%     | 111.7         | 113.3      | 150.1             | 4.2        | 296.7                     |
| 1920×1080 | 100%    | 112.2         | 1179.1     | 1200.5            | 12.6       | 1511.3                    |
| 3200×2000 | 0%      | 334.5         | 23.6       | 156.6             | 6.5        | 0.1                       |
| 3200×2000 | 1%      | 331.5         | 73.2       | 203.6             | 10.3       | 422.6                     |
| 3200×2000 | 10%     | 331.4         | 537.4      | 672.3             | 12.8       | 807.2                     |
| 3200×2000 | 100%    | 335.1         | 5513.2     | 5917.4            | 39.4       | 4703.6                    |

## Reading the results

- pixelmatch is far faster. It measures difference with a few multiplications per pixel;
  CIEDE2000 needs trigonometry. That is the price of the better colour judgement.
- On the common path the cost is modest. With no change or a small one, comparison takes less
  time than decoding the screenshot it compares.
- Heavily changed images are slow. Every changed pixel gets the full colour maths, an
  anti-aliasing check and a shift check. A heavily changed image is a failing test, so this cost
  is paid on failure.
- Against looks-same, compare like with like. Its times include decoding, so set them against
  decode plus perceptual: at 3200×2000 that is 405 against 423 ms with 1% changed, 869 against
  807 ms with 10%, and 5,848 against 4,704 ms with everything changed. Close on small changes,
  looks-same ahead on large ones. It returns at once for identical files, since it compares the
  encoded bytes first.
