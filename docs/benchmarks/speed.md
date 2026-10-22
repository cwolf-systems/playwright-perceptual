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
| 1280×720  | 0%      | 53.8          | 4.8        | 24.2              | 0.8        | 0.0                       |
| 1280×720  | 1%      | 43.6          | 5.9        | 24.1              | 1.2        | 66.0                      |
| 1280×720  | 10%     | 53.5          | 48.7       | 77.6              | 3.3        | 127.9                     |
| 1280×720  | 100%    | 47.8          | 334.3      | 351.7             | 5.5        | 673.7                     |
| 1920×1080 | 0%      | 110.9         | 7.8        | 49.1              | 2.2        | 0.0                       |
| 1920×1080 | 1%      | 111.1         | 14.0       | 57.5              | 3.3        | 159.6                     |
| 1920×1080 | 10%     | 113.7         | 74.5       | 132.8             | 4.2        | 328.7                     |
| 1920×1080 | 100%    | 110.3         | 858.1      | 906.4             | 12.5       | 1553.3                    |
| 3200×2000 | 0%      | 336.8         | 23.3       | 159.8             | 6.7        | 0.1                       |
| 3200×2000 | 1%      | 336.0         | 66.5       | 222.5             | 12.5       | 464.6                     |
| 3200×2000 | 10%     | 345.3         | 465.2      | 578.8             | 12.8       | 839.8                     |
| 3200×2000 | 100%    | 335.2         | 4390.4     | 4622.0            | 38.6       | 4585.6                    |

## Reading the results

- pixelmatch is far faster. It measures difference with a few multiplications per pixel;
  CIEDE2000 needs trigonometry. That is the price of the better colour judgement.
- On the common path the cost is modest. With no change or a small one, comparison takes less
  time than decoding the screenshot it compares.
- Heavily changed images are slow. Every changed pixel gets the full colour maths, an
  anti-aliasing check and a shift check. A heavily changed image is a failing test, so this cost
  is paid on failure.
- Against looks-same, compare like with like. Its times include decoding, so set them against
  decode plus perceptual: at 3200×2000 that is 403 against 465 ms with 1% changed, 811 against
  840 ms with 10%, and 4,726 against 4,586 ms with everything changed. Close throughout, with
  looks-same a little ahead only when everything changed. It returns at once for identical files,
  since it compares the encoded bytes first.
