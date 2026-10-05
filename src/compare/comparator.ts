import { deltaE2000 } from '../color/ciede2000.js';
import { rgbToLab } from '../color/cielab.js';
import { resolveCompareOptions, type ResolvedCompareOptions } from '../defaults.js';
import { ImageSizeError } from '../errors.js';
import { isAntialiased } from '../image/antialiasing.js';
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

// Screenshots repeat colours, and colour pairs, heavily: CIELAB is computed once per colour and
// ΔE once per pair. The caps bound memory on noisy images such as photographs.
const LAB_CACHE_LIMIT = 1 << 20;
const DELTA_CACHE_LIMIT = 1 << 20;
const PAIR_KEY_SHIFT = 2 ** 24;

const fixed = (value: number): string => value.toFixed(2);

function notes(
  maxDeltaE: number,
  deltaE: DeltaEStats,
  antialiased: number,
  shifted: number,
): string[] {
  const lines = [
    `Changed means ΔE00 above ${maxDeltaE}. Over all pixels: median ${fixed(deltaE.median)}, p95 ${fixed(deltaE.p95)}, p99 ${fixed(deltaE.p99)}, max ${fixed(deltaE.max)}.`,
  ];
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
  private readonly labs = new Map<number, Lab>();
  private readonly deltas = new Map<number, number>();

  constructor(options: CompareOptions = {}, parts: ComparatorParts = {}) {
    this.options = resolveCompareOptions(options);
    this.colorDifference = parts.colorDifference ?? deltaE2000;
    const antialiasing = parts.antialiasing === undefined ? isAntialiased : parts.antialiasing;
    const shift = parts.shift === undefined ? isShifted : parts.shift;
    this.antialiasing = this.options.ignoreAntialiasing ? antialiasing : null;
    this.shift = this.options.ignoreShifts ? shift : null;
  }

  compare(expected: RgbaImage, actual: RgbaImage): PerceptualComparison {
    return this.run(expected, actual, null);
  }

  diff(expected: RgbaImage, actual: RgbaImage): PerceptualComparison & DiffedComparison {
    const diff = new DiffImage(expected.width, expected.height);
    return { ...this.run(expected, actual, diff), diff: diff.image };
  }

  private lab(rgb: number): Lab {
    const cached = this.labs.get(rgb);
    if (cached) return cached;
    const lab = rgbToLab(rgb);
    if (this.labs.size < LAB_CACHE_LIMIT) this.labs.set(rgb, lab);
    return lab;
  }

  private delta(expected: number, actual: number): number {
    const key = expected * PAIR_KEY_SHIFT + actual;
    const cached = this.deltas.get(key);
    if (cached !== undefined) return cached;
    const delta = this.colorDifference(this.lab(expected), this.lab(actual));
    if (this.deltas.size < DELTA_CACHE_LIMIT) this.deltas.set(key, delta);
    return delta;
  }

  private run(
    expectedImage: RgbaImage,
    actualImage: RgbaImage,
    diff: DiffImage | null,
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
      const x = index % expected.width;
      const y = (index - x) / expected.width;
      if (
        this.antialiasing?.(expected, actual, x, y) ||
        this.antialiasing?.(actual, expected, x, y)
      ) {
        antialiased++;
        diff?.antialiased(index);
      } else if (this.shift?.(expected, actual, x, y)) {
        shifted++;
        diff?.shifted(index);
      } else {
        differing++;
        diff?.changed(index);
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
      antialiased,
      shifted,
      deltaE,
      notes: notes(this.options.maxDeltaE, deltaE, antialiased, shifted),
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
