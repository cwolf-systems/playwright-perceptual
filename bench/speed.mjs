// How long a comparison takes, against pixelmatch (Playwright's default comparator) and
// looks-same, on screenshot-sized images. Run with `npm run bench`; it builds first.
//
// Playwright's own experimental ssim-cie94 comparator is not exported, so it is not measured.

import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import looksSame from 'looks-same';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { decodePng, PerceptualComparator } from '../dist/index.js';

const encodePng = ({ data, width, height }) => {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return PNG.sync.write(png);
};

const SIZES = [
  [1280, 720],
  [1920, 1080],
  [3200, 2000],
];

/** Share of the image covered by a visible change, as one block. */
const CHANGES = [0, 0.01, 0.1, 1];

const RUNS = 7;

/** A smooth, deterministic picture: gradients and soft bands, like a rendered page or map. */
function scene(width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 255) / width;
      data[i + 1] = 128 + 100 * Math.sin(x / 37) * Math.cos(y / 29);
      data[i + 2] = (y * 255) / height;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** A copy with a square block covering `fraction` of the image shifted visibly in colour. */
function changed(image, fraction) {
  const data = Uint8Array.from(image.data);
  const side = Math.sqrt(fraction * image.width * image.height);
  const w = Math.min(image.width, Math.round(fraction === 1 ? image.width : side));
  const h = Math.min(image.height, Math.round(fraction === 1 ? image.height : side));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * image.width + x) * 4;
      data[i] = Math.min(255, data[i] + 40);
    }
  }
  return { data, width: image.width, height: image.height };
}

async function median(run) {
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

const ms = (value) => value.toFixed(1).padStart(8);

console.log(`Node ${process.version}, ${cpus()[0].model}, median of ${RUNS} runs, milliseconds\n`);
console.log(
  '| Size | Changed | PNG decode ×2 | perceptual | perceptual + diff | pixelmatch | looks-same (incl. decode) |',
);
console.log('|---|---|---|---|---|---|---|');

const comparator = new PerceptualComparator();

for (const [width, height] of SIZES) {
  const expected = scene(width, height);
  const expectedPng = encodePng(expected);
  for (const fraction of CHANGES) {
    const actual = changed(expected, fraction);
    const actualPng = encodePng(actual);
    const decode = await median(() => {
      decodePng(expectedPng);
      decodePng(actualPng);
    });
    const perceptual = await median(() => comparator.compare(expected, actual));
    const withDiff = await median(() => comparator.diff(expected, actual));
    const pixelmatchTime = await median(() =>
      pixelmatch(expected.data, actual.data, null, width, height, { threshold: 0.1 }),
    );
    const looksSameTime = await median(() =>
      looksSame(expectedPng, actualPng, { tolerance: 2.3, ignoreAntialiasing: true }),
    );
    console.log(
      `| ${width}×${height} | ${String(fraction * 100).padStart(3)}% | ${ms(decode)} | ${ms(perceptual)} | ${ms(withDiff)} | ${ms(pixelmatchTime)} | ${ms(looksSameTime)} |`,
    );
  }
}
