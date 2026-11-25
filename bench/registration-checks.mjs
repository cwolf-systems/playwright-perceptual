// The component checks the 0.3.0 plan sets for global sub-pixel registration, run before any
// verdict is looked at, on src/image/registration.ts as built in dist/:
//
//   npm run build && node bench/registration-checks.mjs
//
// 1. The synthetic terrain panned by known amounts, 0.1 to 0.9 px in x and in y: the estimate must
//    lie within 0.05 px of the true translation, root mean square.
// 2. The should-fail pairs: those in which nothing moved must give an estimate under 0.02 px, so
//    that registration has nothing to explain away. Every should-fail pair is listed with its
//    estimate if it reaches 0.02 px; which of them moved is read from what each pair changes.
//
// The rendered pairs are the design set (1×) and the 2× held-out set; the 1.5× held-out set is
// left out, unread until a candidate is frozen.

import { register } from '../dist/image/registration.js';
import { decodePng } from '../dist/index.js';
import { CASE_PAIRS } from './cases.mjs';
import { renderedPairs } from './corpus.mjs';
import { renderArea, ROUGH, SYNTHETIC_PAIRS, terrainColour } from './synthetic.mjs';

/** An RGBA image read by pixel, as the comparator's detectors read one. */
const pixels = ({ data, width, height }) => ({
  width,
  height,
  rgbAt: (x, y) => {
    const i = (y * width + x) * 4;
    return (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
  },
});

const terrain = (panX, panY) =>
  pixels(renderArea((x, y) => terrainColour(ROUGH, x + panX, y + panY, 3)));

const unpanned = terrain(0, 0);
let squares = 0;
let pans = 0;
let worst = 0;
for (let i = 1; i <= 9; i++) {
  for (let j = 1; j <= 9; j++) {
    const [panX, panY] = [i / 10, j / 10];
    // Panning the scene by (panX, panY) moves its content by minus that.
    const found = register(unpanned, terrain(panX, panY));
    const error = Math.hypot(found.x + panX, found.y + panY);
    squares += error * error;
    pans++;
    worst = Math.max(worst, error);
  }
}
const rms = Math.sqrt(squares / pans);
console.log(
  `1. ${pans} pans: error ${rms.toFixed(4)} px root mean square, ${worst.toFixed(4)} px at worst.`,
);
console.log(`   ${rms <= 0.05 ? 'Met' : 'Missed'}: within 0.05 px.\n`);

const shouldFail = [
  ...[...(await renderedPairs(1)), ...(await renderedPairs(2))]
    .filter((p) => !p.shouldMatch)
    .map((p) => ({ id: p.id, expected: decodePng(p.expectedPng), actual: decodePng(p.actualPng) })),
  ...CASE_PAIRS.map(({ name, make }) => ({ id: `synthetic/cases/${name}`, ...make() })),
  ...SYNTHETIC_PAIRS.filter((p) => !p.shouldMatch).map(({ finding, name, make }) => ({
    id: `synthetic/${finding}/${name}`,
    ...make(),
  })),
];
const reached = [];
for (const { id, expected, actual } of shouldFail) {
  const found = register(pixels(expected), pixels(actual));
  if (Math.hypot(found.x, found.y) >= 0.02) reached.push({ id, found });
}
console.log(
  `2. ${shouldFail.length} should-fail pairs; an estimate of 0.02 px or more on ${reached.length}:`,
);
for (const { id, found } of reached) {
  console.log(`   ${id}: ${found.x.toFixed(2)}, ${found.y.toFixed(2)} px`);
}
