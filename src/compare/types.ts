import type { ColorDifference } from '../color/types.js';
import type { NoiseDetector, RgbaImage } from '../image/types.js';

export interface CompareOptions {
  /** Largest ΔE00 a pixel can have and still count as unchanged. */
  readonly maxDeltaE?: number;
  /** Skip pixels that look like anti-aliasing. */
  readonly ignoreAntialiasing?: boolean;
  /** Skip pixels that differ only because content moved by less than a pixel. */
  readonly ignoreShifts?: boolean;
  /**
   * Skip pixels within one level of each other in every channel: rounding, not a change. Such a
   * pixel can reach ΔE00 2.45 in near-black greys. Defaults to on while shift tolerance is on,
   * which in 0.1.0 skipped these pixels as shifts, and off when it is off.
   */
  readonly ignoreRounding?: boolean;
}

/** What any comparator reports. */
export interface Comparison {
  readonly width: number;
  readonly height: number;
  /** Pixels that count as changed. */
  readonly differing: number;
  /** Lines for a failure message, after the count of changed pixels. */
  readonly notes: readonly string[];
}

/** A comparison with an image of where the pixels differ. */
export interface DiffedComparison extends Comparison {
  readonly diff: RgbaImage;
}

/** Compares two images of the same size. */
export interface ImageComparator {
  compare(expected: RgbaImage, actual: RgbaImage): Comparison;
  /** Like `compare`, and also paints where the images differ. */
  diff(expected: RgbaImage, actual: RgbaImage): DiffedComparison;
}

/** ΔE00 over all pixels, identical ones counting as 0. */
export interface DeltaEStats {
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** What the perceptual comparator reports. */
export interface PerceptualComparison extends Comparison {
  /** Pixels past `maxDeltaE`, excluding rounding, anti-aliasing and shifts. */
  readonly differing: number;
  /**
   * Pixels past `maxDeltaE` skipped as rounding: no channel differs by more than one level. Always
   * set by this package's comparator; optional so that comparisons built by hand before 0.2.0, such
   * as test doubles of a custom comparator, still type-check.
   */
  readonly rounded?: number;
  /** Pixels past `maxDeltaE` skipped as anti-aliasing. */
  readonly antialiased: number;
  /** Pixels past `maxDeltaE` skipped as sub-pixel shifts. */
  readonly shifted: number;
  readonly deltaE: DeltaEStats;
}

/** The replaceable parts of the perceptual comparator. `null` turns a detector off. */
export interface ComparatorParts {
  readonly colorDifference?: ColorDifference;
  /** Asked both ways round: expected against actual, then actual against expected. */
  readonly antialiasing?: NoiseDetector | null;
  /** Asked once, expected against actual. */
  readonly shift?: NoiseDetector | null;
}
