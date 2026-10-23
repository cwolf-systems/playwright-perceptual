import { deltaE2000 } from '../color/ciede2000.js';
import { rgbToLab } from '../color/cielab.js';
import { ROUNDING_LEVELS, withinLevels } from '../color/rgb.js';
import { resolveCompareOptions, type ResolvedCompareOptions } from '../defaults.js';
import { ImageSizeError } from '../errors.js';
import { isAntialiasedEitherWay } from '../image/antialiasing.js';
import { Raster } from '../image/raster.js';
import { isShifted } from '../image/shift.js';
import type { ColorDifference, Lab } from '../color/types.js';
import type {
  ComparatorParts,
  CompareOptions,
  DeltaEStats,
  DiffedComparison,
  ImageComparator,
  PerceptualComparison,
} from './types.js';
import type { NoiseDetector, RgbaImage } from '../image/types.js';
import { DiffImage } from './diff-image.js';
import { Histogram } from './histogram.js';

// 0.01-wide bins keep percentiles to two decimals; sRGB colour differences stay under 128.
const BIN_WIDTH = 0.01;
const BIN_COUNT = 12_800;

// Screenshots repeat colours, and colour pairs, heavily, so CIELAB is cached by colour and ΔE by
// pair. Each cache is a fixed table indexed by a hash of its key: a lookup allocates nothing, and
// a collision only means computing again, so noisy images such as photographs cost no more memory.
const CACHE_BITS = 16;
const HASH = 0x9e3779b1;
const PAIR_HASH = 0x85ebca6b;
const PAIR_KEY_SHIFT = 2 ** 24;
const slot = (key: number): number => Math.imul(key, HASH) >>> (32 - CACHE_BITS);

const fixed = (value: number): string => value.toFixed(2);

function notes(
  maxDeltaE: number,
  deltaE: DeltaEStats,
  rounded: number,
  antialiased: number,
  shifted: number,
  exceeded: boolean,
): string[] {
  const over = exceeded ? 'Over the pixels read before counting stopped' : 'Over all pixels';
  const lines = [
    `Changed means ΔE00 above ${maxDeltaE}. ${over}: median ${fixed(deltaE.median)}, p95 ${fixed(deltaE.p95)}, p99 ${fixed(deltaE.p99)}, max ${fixed(deltaE.max)}.`,
  ];
  if (rounded > 0) {
    lines.push(`${rounded} pixels within one level in every channel were not counted.`);
  }
  if (antialiased > 0) lines.push(`${antialiased} anti-aliased pixels were not counted.`);
  if (shifted > 0) lines.push(`${shifted} pixels shifted by less than a pixel were not counted.`);
  return lines;
}

/** Compares images pixel by pixel by perceived colour difference. */
export class PerceptualComparator implements ImageComparator {
  private readonly options: ResolvedCompareOptions;
  private readonly colorDifference: ColorDifference;
  private readonly antialiasing: NoiseDetector | null;
  private readonly shift: NoiseDetector | null;
  private readonly labColours = new Int32Array(1 << CACHE_BITS).fill(-1);
  private readonly labs = new Array<Lab | null>(1 << CACHE_BITS).fill(null);
  private readonly deltaPairs = new Float64Array(1 << CACHE_BITS).fill(-1);
  private readonly deltas = new Float64Array(1 << CACHE_BITS);

  constructor(options: CompareOptions = {}, parts: ComparatorParts = {}) {
    this.options = resolveCompareOptions(options, { shiftDetector: parts.shift !== null });
    this.colorDifference = parts.colorDifference ?? deltaE2000;
    // Anti-aliasing is asked both ways round. The default asks once for both, sharing the check
    // that a neighbour kept its colour; a detector passed in is asked each way.
    const custom = parts.antialiasing;
    const antialiasing: NoiseDetector | null =
      custom === undefined
        ? isAntialiasedEitherWay
        : custom && ((a, b, x, y) => custom(a, b, x, y) || custom(b, a, x, y));
    const shift = parts.shift === undefined ? isShifted : parts.shift;
    this.antialiasing = this.options.ignoreAntialiasing ? antialiasing : null;
    this.shift = this.options.ignoreShifts ? shift : null;
  }

  compare(expected: RgbaImage, actual: RgbaImage, limit = Infinity): PerceptualComparison {
    return this.run(expected, actual, null, limit);
  }

  diff(expected: RgbaImage, actual: RgbaImage): PerceptualComparison & DiffedComparison {
    const diff = new DiffImage(expected.width, expected.height);
    return { ...this.run(expected, actual, diff, Infinity), diff: diff.image };
  }

  private lab(rgb: number): Lab {
    const i = slot(rgb);
    if (this.labColours[i] !== rgb) {
      this.labColours[i] = rgb;
      this.labs[i] = rgbToLab(rgb);
    }
    return this.labs[i]!;
  }

  private delta(expected: number, actual: number): number {
    const i = slot(expected ^ Math.imul(actual, PAIR_HASH));
    const pair = expected * PAIR_KEY_SHIFT + actual;
    if (this.deltaPairs[i] !== pair) {
      this.deltaPairs[i] = pair;
      this.deltas[i] = this.colorDifference(this.lab(expected), this.lab(actual));
    }
    return this.deltas[i]!;
  }

  private run(
    expectedImage: RgbaImage,
    actualImage: RgbaImage,
    diff: DiffImage | null,
    limit: number,
  ): PerceptualComparison {
    if (expectedImage.width !== actualImage.width || expectedImage.height !== actualImage.height) {
      throw new ImageSizeError(expectedImage, actualImage);
    }
    const expected = new Raster(expectedImage);
    const actual = new Raster(actualImage);
    const histogram = new Histogram(BIN_WIDTH, BIN_COUNT);
    const expectedWords = expected.words;
    const actualWords = actual.words;
    let identical = 0;
    let differing = 0;
    let rounded = 0;
    let antialiased = 0;
    let shifted = 0;

    // Hot loop: once per pixel.
    for (let index = 0; index < expected.pixels; index++) {
      if (expectedWords && actualWords && expectedWords[index] === actualWords[index]) {
        identical++;
        diff?.unchanged(index, expected.rgb(index));
        continue;
      }
      const a = expected.rgb(index);
      const b = actual.rgb(index);
      const delta = a === b ? 0 : this.delta(a, b);
      histogram.add(delta);
      if (delta <= this.options.maxDeltaE) {
        diff?.unchanged(index, a);
        continue;
      }
      // Rounding alone can pass ΔE00 1 in dark and greyish colours.
      if (this.options.ignoreRounding && withinLevels(a, b, ROUNDING_LEVELS)) {
        rounded++;
        diff?.rounded(index);
        continue;
      }
      const x = index % expected.width;
      const y = (index - x) / expected.width;
      if (this.antialiasing?.(expected, actual, x, y)) {
        antialiased++;
        diff?.antialiased(index);
      } else if (this.shift?.(expected, actual, x, y)) {
        shifted++;
        diff?.shifted(index);
      } else {
        differing++;
        diff?.changed(index);
        // Past the limit the verdict is known, and only a diff image would need the rest.
        if (differing > limit) break;
      }
    }
    histogram.add(0, identical);

    const deltaE: DeltaEStats = {
      mean: histogram.mean,
      median: histogram.percentile(0.5),
      p95: histogram.percentile(0.95),
      p99: histogram.percentile(0.99),
      max: histogram.max,
    };
    return {
      width: expected.width,
      height: expected.height,
      differing,
      rounded,
      antialiased,
      shifted,
      deltaE,
      exceeded: differing > limit,
      notes: notes(
        this.options.maxDeltaE,
        deltaE,
        rounded,
        antialiased,
        shifted,
        differing > limit,
      ),
    };
  }
}

/** Compares two same-size images with the default comparator. */
export function compareImages(
  expected: RgbaImage,
  actual: RgbaImage,
  options?: CompareOptions,
): PerceptualComparison {
  return new PerceptualComparator(options).compare(expected, actual);
}
