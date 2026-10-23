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
| 1280×720  | 0%      | 42.1          | 4.1        | 22.0              | 0.8        | 0.0                       |
| 1280×720  | 1%      | 42.2          | 5.5        | 25.5              | 1.3        | 70.7                      |
| 1280×720  | 10%     | 48.6          | 27.6       | 46.3              | 1.9        | 119.0                     |
| 1280×720  | 100%    | 49.1          | 261.2      | 284.8             | 5.7        | 712.5                     |
| 1920×1080 | 0%      | 112.1         | 7.8        | 50.8              | 2.3        | 0.0                       |
| 1920×1080 | 1%      | 118.1         | 18.5       | 56.1              | 3.4        | 187.5                     |
| 1920×1080 | 10%     | 119.1         | 61.7       | 103.1             | 4.3        | 315.8                     |
| 1920×1080 | 100%    | 112.6         | 810.4      | 881.8             | 12.8       | 1536.6                    |
| 3200×2000 | 0%      | 364.1         | 23.9       | 158.4             | 7.0        | 0.1                       |
| 3200×2000 | 1%      | 370.2         | 59.5       | 196.2             | 10.5       | 466.7                     |
| 3200×2000 | 10%     | 367.1         | 430.2      | 589.1             | 13.1       | 813.2                     |
| 3200×2000 | 100%    | 339.2         | 4295.5     | 4377.8            | 39.0       | 4530.7                    |

## Reading the results

- pixelmatch is far faster. It measures difference with a few multiplications per pixel;
  CIEDE2000 needs trigonometry. That is the price of the better colour judgement.
- On the common path the cost is modest. With no change or a small one, comparison takes less
  time than decoding the screenshot it compares.
- Heavily changed images are slow. Every changed pixel gets the full colour maths, an
  anti-aliasing check and a shift check; the checks read each pair of images once per 32×32 tile. A heavily changed image is a failing test, so this cost
  is paid on failure.
- Against looks-same, compare like with like. Its times include decoding, so set them against
  decode plus perceptual: at 3200×2000 that is 430 against 467 ms with 1% changed, 797 against
  813 ms with 10%, and 4,635 against 4,531 ms with everything changed. Close throughout, with
  looks-same a little ahead only when everything changed. It returns at once for identical files,
  since it compares the encoded bytes first.
