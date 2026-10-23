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
| 1280×720  | 0%      | 42.6          | 4.0        | 21.4              | 0.8        | 0.0                       |
| 1280×720  | 1%      | 41.5          | 8.7        | 27.2              | 1.2        | 64.7                      |
| 1280×720  | 10%     | 48.7          | 50.7       | 67.4              | 1.8        | 114.1                     |
| 1280×720  | 100%    | 47.6          | 467.5      | 482.3             | 5.5        | 670.6                     |
| 1920×1080 | 0%      | 109.5         | 7.6        | 48.7              | 2.2        | 0.0                       |
| 1920×1080 | 1%      | 108.8         | 20.5       | 61.9              | 3.3        | 136.6                     |
| 1920×1080 | 10%     | 109.0         | 106.4      | 146.7             | 4.1        | 261.5                     |
| 1920×1080 | 100%    | 109.1         | 1004.9     | 1043.6            | 12.4       | 1473.7                    |
| 3200×2000 | 0%      | 328.1         | 23.5       | 154.8             | 6.5        | 0.1                       |
| 3200×2000 | 1%      | 327.2         | 51.6       | 184.3             | 10.1       | 385.3                     |
| 3200×2000 | 10%     | 328.3         | 320.1      | 449.7             | 12.7       | 764.4                     |
| 3200×2000 | 100%    | 328.7         | 3044.9     | 3011.9            | 38.3       | 4420.7                    |

## Reading the results

- pixelmatch is far faster. It measures difference with a few multiplications per pixel;
  CIEDE2000 needs trigonometry. That is the price of the better colour judgement.
- On the common path the cost is modest. With no change or a small one, comparison takes less
  time than decoding the screenshot it compares.
- Heavily changed images are slow. Every changed pixel gets the full colour maths, an
  anti-aliasing check and a shift check. A heavily changed image is a failing test, so this cost
  is paid on failure. The shift check reads at most 20 box totals per channel, from box filters
  computed once per tile of the image with running sums, so it costs the same over texture as
  over a solid block of colour.
- Against looks-same, compare like with like. Its times include decoding, so set them against
  decode plus perceptual: at 3200×2000 that is 379 against 385 ms with 1% changed, 648 against
  764 ms with 10%, and 3,374 against 4,421 ms with everything changed. It returns at once for
  identical files, since it compares the encoded bytes first.
- Against 0.1.0, as measured by the redesign round's judge on the same machine, fully changed
  images take about two thirds of the time or less, and a drift of one to three levels over a
  whole textured frame 0.61×; the [design log](../design/box-filter.md) has the table.
